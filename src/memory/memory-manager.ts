import fs from 'fs/promises';
import path from 'path';
import { AgentId } from '../types/agents.js';
import type {
  MemoryReadRequest,
  MemoryReadResult,
  MemoryWriteRequest,
  MemoryWriteResult,
} from '../types/memory.js';
import { createDistributedLock, type IDistributedLock } from './distributed-lock.js';

const LOCK_TTL_MS = 5_000;

export class MemoryManager {
  private readonly basePath: string;
  private readonly tenantId: string | undefined;
  private readonly distributedLock: IDistributedLock;
  private readonly lockTokens = new Map<string, string>(); // filePath → token
  private onWriteCallback?: (domain: string, relativePath: string, operation: string) => void;

  /** Register a callback invoked after every successful memory write. */
  onMemoryWrite(fn: (domain: string, relativePath: string, operation: string) => void): void {
    this.onWriteCallback = fn;
  }

  constructor(
    basePath: string = process.env.CLAW_MEMORY_PATH ?? '/opt/claw/memory',
    tenantId?: string,
    lock?: IDistributedLock,
  ) {
    this.basePath = basePath;
    this.tenantId = tenantId;
    this.distributedLock = lock ?? createDistributedLock();
  }

  async read(request: MemoryReadRequest): Promise<MemoryReadResult> {
    const fullPath = this.resolvePath(request.path);
    const raw = await fs.readFile(fullPath, 'utf-8');
    const stats = await fs.stat(fullPath);

    let content = raw;
    if (request.section) {
      content = this.extractSection(raw, request.section);
    }

    // Best-effort extract the last writer from the file footer comment
    const writerMatch = raw.match(/<!-- written-by: ([a-z_]+) -->/);
    const modifiedBy = (writerMatch?.[1] as AgentId) ?? AgentId.OPS;

    return {
      path: request.path,
      content,
      lastModified: stats.mtime.toISOString(),
      modifiedBy,
    };
  }

  async write(request: MemoryWriteRequest): Promise<MemoryWriteResult> {
    const fullPath = this.resolvePath(request.path);

    try {
      await this.acquireLock(request.path, request.writtenBy);
    } catch (err) {
      return {
        path: request.path,
        success: false,
        operation: request.operation,
        newSize: 0,
        error: (err as Error).message,
      };
    }

    try {
      switch (request.operation) {
        case 'create':
          await this.createFile(fullPath, request);
          break;
        case 'append':
          await this.appendToFile(fullPath, request);
          break;
        case 'update_section':
          await this.updateSection(fullPath, request);
          break;
      }

      const stats = await fs.stat(fullPath);

      // Notify WS SYNC_UPDATE listeners
      const domain = request.path.split('/')[0] ?? 'unknown';
      this.onWriteCallback?.(domain, request.path, request.operation);

      return {
        path: request.path,
        success: true,
        operation: request.operation,
        newSize: stats.size,
      };
    } catch (err) {
      return {
        path: request.path,
        success: false,
        operation: request.operation,
        newSize: 0,
        error: (err as Error).message,
      };
    } finally {
      await this.releaseLock(request.path);
    }
  }

  private async createFile(fullPath: string, request: MemoryWriteRequest): Promise<void> {
    try {
      await fs.access(fullPath);
      throw new Error(`File already exists: ${request.path}`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    const content = `${request.content}\n<!-- written-by: ${request.writtenBy} -->\n`;
    await fs.writeFile(fullPath, content, 'utf-8');
  }

  private async appendToFile(fullPath: string, request: MemoryWriteRequest): Promise<void> {
    const timestamp = new Date().toISOString();
    const entry = `\n<!-- ${timestamp} written-by: ${request.writtenBy} -->\n${request.content}\n`;
    await fs.appendFile(fullPath, entry, 'utf-8');
  }

  private async updateSection(fullPath: string, request: MemoryWriteRequest): Promise<void> {
    if (!request.section) throw new Error('update_section requires a section name');
    const raw = await fs.readFile(fullPath, 'utf-8');
    const updated = this.replaceSection(raw, request.section, request.content, request.writtenBy);
    await fs.writeFile(fullPath, updated, 'utf-8');
  }

  private extractSection(content: string, section: string): string {
    const normalizedSection = section.replace(/_/g, ' ');
    // Match ## Section Name (case-insensitive)
    const pattern = new RegExp(
      `## ${normalizedSection}[^\\n]*\\n([\\s\\S]*?)(?=\\n## |$)`,
      'i',
    );
    const match = content.match(pattern);
    return match?.[1]?.trim() ?? '';
  }

  private replaceSection(
    content: string,
    section: string,
    newContent: string,
    writtenBy: AgentId,
  ): string {
    const normalizedSection = section.replace(/_/g, ' ');
    const timestamp = new Date().toISOString();
    const pattern = new RegExp(
      `(## ${normalizedSection}[^\\n]*\\n)[\\s\\S]*?(?=\\n## |$)`,
      'i',
    );
    const replacement = `$1${newContent}\n<!-- ${timestamp} written-by: ${writtenBy} -->\n`;

    if (pattern.test(content)) {
      return content.replace(pattern, replacement);
    }

    // Section not found — append it
    return `${content.trimEnd()}\n\n## ${normalizedSection}\n${newContent}\n<!-- ${timestamp} written-by: ${writtenBy} -->\n`;
  }

  private resolvePath(relativePath: string): string {
    if (this.tenantId) {
      // Tenant-scoped: paths live under basePath/tenants/{tenantId}/
      const tenantBase = path.resolve(this.basePath, 'tenants', this.tenantId);
      const resolved = path.resolve(tenantBase, relativePath);
      // Strict guard: resolved path must be inside this tenant's directory
      if (!resolved.startsWith(tenantBase + path.sep)) {
        throw new Error(`Invalid memory path: ${relativePath}`);
      }
      return resolved;
    }

    // Legacy flat-path behavior (no tenantId)
    const resolved = path.resolve(this.basePath, relativePath);
    if (!resolved.startsWith(path.resolve(this.basePath) + path.sep) &&
        resolved !== path.resolve(this.basePath)) {
      throw new Error(`Invalid memory path: ${relativePath}`);
    }
    return resolved;
  }

  private async acquireLock(filePath: string, _agentId: AgentId): Promise<void> {
    const lockKey = `lock:${filePath}`;
    const token = await this.distributedLock.acquire(lockKey, LOCK_TTL_MS);
    if (!token) {
      throw new Error(`Memory file is locked — another operation is in progress: ${filePath}`);
    }
    this.lockTokens.set(filePath, token);
  }

  private async releaseLock(filePath: string): Promise<void> {
    const token = this.lockTokens.get(filePath);
    if (token) {
      await this.distributedLock.release(`lock:${filePath}`, token);
      this.lockTokens.delete(filePath);
    }
  }

  /** Expose whether a lock is held (for testing) */
  isLocked(filePath: string): boolean {
    return this.lockTokens.has(filePath);
  }
}
