import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemorySearch } from '../../../src/memory/memory-search.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

let tmpDir: string;
let search: MemorySearch;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claw-search-test-'));
  search = new MemorySearch(tmpDir);

  // Seed test files
  await fs.mkdir(path.join(tmpDir, 'contacts'), { recursive: true });
  await fs.mkdir(path.join(tmpDir, 'knowledge'), { recursive: true });

  await fs.writeFile(
    path.join(tmpDir, 'contacts', 'john-doe.md'),
    '# Contact: John Doe\n\nJohn is looking for a 3 bedroom house in Ventura.\n\n## Buying Criteria\nBudget: $800k, prefers single story.',
  );
  await fs.writeFile(
    path.join(tmpDir, 'contacts', 'jane-smith.md'),
    '# Contact: Jane Smith\n\nJane wants a condo near downtown with ocean views.',
  );
  await fs.writeFile(
    path.join(tmpDir, 'knowledge', 'market-ventura.md'),
    '# Market: Ventura\n\nMedian price $720k. 28 days on market. Strong seller market.',
  );
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('MemorySearch', () => {
  it('finds files matching a query', async () => {
    const result = await search.search({ domain: 'contacts', query: 'John Doe', maxResults: 5 });
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches[0]!.path).toContain('john-doe');
  });

  it('returns results sorted by relevance', async () => {
    const result = await search.search({ domain: 'contacts', query: 'bedroom house Ventura', maxResults: 5 });
    expect(result.matches.length).toBeGreaterThan(0);
    // John's file mentions all three terms
    expect(result.matches[0]!.path).toContain('john-doe');
  });

  it('returns empty matches for no results', async () => {
    const result = await search.search({ domain: 'contacts', query: 'xyznotfound', maxResults: 5 });
    expect(result.matches).toHaveLength(0);
  });

  it('respects maxResults limit', async () => {
    const result = await search.search({ domain: 'contacts', query: 'contact', maxResults: 1 });
    expect(result.matches.length).toBeLessThanOrEqual(1);
  });

  it('includes snippets in results', async () => {
    const result = await search.search({ domain: 'contacts', query: 'ocean views', maxResults: 5 });
    expect(result.matches[0]?.snippet).toBeTruthy();
    expect(result.matches[0]?.snippet).toContain('ocean');
  });

  it('returns empty array when domain directory does not exist', async () => {
    const result = await search.search({ domain: 'listings', query: 'house', maxResults: 5 });
    expect(result.matches).toHaveLength(0);
  });

  it('cross-domain search stays within domain', async () => {
    const result = await search.search({ domain: 'knowledge', query: 'Ventura', maxResults: 5 });
    expect(result.matches.length).toBeGreaterThan(0);
    for (const match of result.matches) {
      expect(match.path).toContain('knowledge');
    }
  });
});
