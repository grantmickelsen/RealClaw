import fs from 'fs/promises';
import path from 'path';
import type { MemorySearchRequest, MemorySearchResult } from '../types/memory.js';

export class MemorySearch {
  private readonly basePath: string;

  constructor(basePath: string = process.env.CLAW_MEMORY_PATH ?? '/opt/claw/memory') {
    this.basePath = basePath;
  }

  async search(request: MemorySearchRequest): Promise<MemorySearchResult> {
    const domainPath = path.join(this.basePath, request.domain);

    let files: string[] = [];
    try {
      files = await this.walkDirectory(domainPath);
    } catch {
      return { matches: [] };
    }

    const query = request.query.toLowerCase();
    const results: { path: string; snippet: string; relevanceScore: number }[] = [];

    for (const filePath of files) {
      if (!filePath.endsWith('.md') && !filePath.endsWith('.json')) continue;

      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const score = this.computeScore(content, query);

        if (score > 0) {
          const snippet = this.extractSnippet(content, query);
          const relativePath = path.relative(this.basePath, filePath);
          results.push({ path: relativePath, snippet, relevanceScore: score });
        }
      } catch {
        // Skip unreadable files
      }
    }

    return {
      matches: results
        .sort((a, b) => b.relevanceScore - a.relevanceScore)
        .slice(0, request.maxResults),
    };
  }

  private async walkDirectory(dir: string): Promise<string[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const subFiles = await this.walkDirectory(fullPath);
        files.push(...subFiles);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }

    return files;
  }

  private computeScore(content: string, query: string): number {
    const lower = content.toLowerCase();
    const terms = query.split(/\s+/).filter(Boolean);
    let score = 0;

    for (const term of terms) {
      let index = 0;
      while ((index = lower.indexOf(term, index)) !== -1) {
        // Title-level matches (first 100 chars) worth more
        score += index < 100 ? 3 : 1;
        index += term.length;
      }
    }

    return score;
  }

  private extractSnippet(content: string, query: string): string {
    const lower = content.toLowerCase();
    const terms = query.split(/\s+/).filter(Boolean);

    let bestIndex = -1;
    for (const term of terms) {
      const idx = lower.indexOf(term);
      if (idx !== -1 && (bestIndex === -1 || idx < bestIndex)) {
        bestIndex = idx;
      }
    }

    if (bestIndex === -1) return content.slice(0, 150).trim();

    const start = Math.max(0, bestIndex - 60);
    const end = Math.min(content.length, bestIndex + 120);
    let snippet = content.slice(start, end).replace(/\n+/g, ' ').trim();

    if (start > 0) snippet = `...${snippet}`;
    if (end < content.length) snippet = `${snippet}...`;

    return snippet;
  }
}
