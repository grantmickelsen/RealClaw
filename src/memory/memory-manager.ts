import fs from 'fs/promises';
import path from 'path';
import { AgentId } from '../types/agents.js';
import type {
  MemoryReadRequest,
  MemoryReadResult,
  MemoryWriteRequest,
  MemoryWriteResult,
  MemoryLock,
} from '../types/memory.js';

const LOCK_TTL_MS = 5_000;

export class MemoryManager {
  private readonly basePath: string;
  private locks = new Map<string, MemoryLock>();

  constructor(basePath: string = process.env.CLAW_MEMORY_PATH ?? '/opt/claw/memory') {
    this.basePath = basePath;
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
      this.releaseLock(request.path);
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
    // Prevent directory traversal
    const resolved = path.resolve(this.basePath, relativePath);
    if (!resolved.startsWith(path.resolve(this.basePath))) {
      throw new Error(`Invalid memory path: ${relativePath}`);
    }
    return resolved;
  }

  private async acquireLock(filePath: string, agentId: AgentId): Promise<void> {
    this.pruneStaleLocks();

    const existing = this.locks.get(filePath);
    if (existing) {
      throw new Error(
        `Memory file is locked by ${existing.heldBy} until ${existing.expiresAt}`,
      );
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + LOCK_TTL_MS);
    this.locks.set(filePath, {
      path: filePath,
      heldBy: agentId,
      acquiredAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });

    // Auto-release after TTL
    setTimeout(() => this.releaseLock(filePath), LOCK_TTL_MS);
  }

  private releaseLock(filePath: string): void {
    this.locks.delete(filePath);
  }

  private pruneStaleLocks(): void {
    const now = Date.now();
    for (const [key, lock] of this.locks) {
      if (new Date(lock.expiresAt).getTime() <= now) {
        this.locks.delete(key);
      }
    }
  }

  /** Expose lock state for testing */
  getLock(filePath: string): MemoryLock | undefined {
    return this.locks.get(filePath);
  }
}
