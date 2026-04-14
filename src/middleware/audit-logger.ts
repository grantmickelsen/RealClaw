import fs from 'fs/promises';
import path from 'path';
import type { AuditEntry } from '../types/messages.js';
import type { AgentId } from '../types/agents.js';

export interface AuditQueryFilters {
  startDate?: string;   // ISO-8601
  endDate?: string;     // ISO-8601
  agent?: AgentId;
  actionType?: string;
  correlationId?: string;
  contactId?: string;
}

export class AuditLogger {
  private readonly logDir: string;
  private readonly timezone: string;
  private readonly tenantId: string | undefined;

  constructor(
    logDir: string = path.join(process.env.CLAW_MEMORY_PATH ?? '/opt/claw/memory', 'system'),
    timezone = 'America/Los_Angeles',
    tenantId?: string,
  ) {
    this.logDir = logDir;
    this.timezone = timezone;
    this.tenantId = tenantId;
  }

  async log(entry: AuditEntry): Promise<void> {
    const filePath = this.logFilePath();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const enriched: AuditEntry = this.tenantId ? { ...entry, tenantId: this.tenantId } : entry;
    const line = JSON.stringify(enriched) + '\n';
    await fs.appendFile(filePath, line, 'utf-8');
  }

  async query(filters: AuditQueryFilters): Promise<AuditEntry[]> {
    const files = await this.getLogFiles(filters.startDate, filters.endDate);
    const results: AuditEntry[] = [];

    for (const filePath of files) {
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const lines = content.split('\n').filter(l => l.trim());

        for (const line of lines) {
          try {
            const entry = JSON.parse(line) as AuditEntry;
            if (this.matchesFilters(entry, filters)) {
              results.push(entry);
            }
          } catch {
            // Skip malformed lines
          }
        }
      } catch {
        // Skip unreadable files
      }
    }

    return results.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  private logFilePath(): string {
    const date = this.currentDateString();
    return path.join(this.logDir, `audit-log-${date}.jsonl`);
  }

  private currentDateString(): string {
    // Format as YYYY-MM-DD in client timezone
    return new Date().toLocaleDateString('en-CA', {
      timeZone: this.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  }

  private async getLogFiles(startDate?: string, endDate?: string): Promise<string[]> {
    let entries: string[] = [];
    try {
      const dirEntries = await fs.readdir(this.logDir);
      entries = dirEntries
        .filter(f => f.startsWith('audit-log-') && f.endsWith('.jsonl'))
        .sort();
    } catch {
      return [];
    }

    return entries
      .filter(filename => {
        const dateStr = filename.replace('audit-log-', '').replace('.jsonl', '');
        if (startDate && dateStr < startDate.slice(0, 10)) return false;
        if (endDate && dateStr > endDate.slice(0, 10)) return false;
        return true;
      })
      .map(f => path.join(this.logDir, f));
  }

  private matchesFilters(entry: AuditEntry, filters: AuditQueryFilters): boolean {
    if (filters.startDate && entry.timestamp < filters.startDate) return false;
    if (filters.endDate && entry.timestamp > filters.endDate) return false;
    if (filters.agent && entry.agent !== filters.agent) return false;
    if (filters.actionType && entry.actionType !== filters.actionType) return false;
    if (filters.correlationId && entry.correlationId !== filters.correlationId) return false;
    if (filters.contactId && entry.target?.id !== filters.contactId) return false;
    return true;
  }
}
