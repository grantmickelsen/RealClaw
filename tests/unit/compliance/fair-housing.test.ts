import { describe, it, expect } from 'vitest';
import { scanContent } from '../../../src/agents/compliance/fair-housing-rules.js';

describe('scanContent', () => {
  it('passes clean listing content', () => {
    const result = scanContent(
      'Beautiful 3 bedroom home in a quiet neighborhood. Open floor plan, updated kitchen, large backyard. Minutes from shopping and dining.',
    );
    expect(result.flags.some(f => f.severity === 'error')).toBe(false);
  });

  it('flags race/national origin violations', () => {
    const result = scanContent('whites only neighborhood');
    expect(result.passed).toBe(false);
    expect(result.flags.some(f => f.ruleId === 'fh-001')).toBe(true);
    expect(result.flags[0]?.severity).toBe('error');
  });

  it('flags family status violations', () => {
    const result = scanContent('adults only community, no kids allowed');
    expect(result.passed).toBe(false);
    expect(result.flags.some(f => f.ruleId === 'fh-002')).toBe(true);
  });

  it('flags religion discrimination', () => {
    const result = scanContent('christian community preferred neighborhood');
    expect(result.passed).toBe(false);
    expect(result.flags.some(f => f.ruleId === 'fh-003')).toBe(true);
  });

  it('flags disability discrimination', () => {
    const result = scanContent('ideal for able-bodied individuals');
    expect(result.passed).toBe(false);
    expect(result.flags.some(f => f.ruleId === 'fh-004')).toBe(true);
  });

  it('warns on school district references', () => {
    const result = scanContent('Located in a great schools district');
    const warning = result.flags.find(f => f.ruleId === 'fh-005');
    expect(warning).toBeDefined();
    expect(warning?.severity).toBe('warning');
  });

  it('content with warnings but no errors passes', () => {
    const result = scanContent('Great schools nearby. Quiet neighborhood.');
    // Warnings don't make it fail
    expect(result.passed).toBe(true);
  });

  it('returns suggestions for flagged content', () => {
    const result = scanContent('no children community');
    expect(result.flags[0]?.suggestion).toBeTruthy();
  });

  it('handles case-insensitive matching', () => {
    const result = scanContent('WHITES ONLY PROPERTY');
    expect(result.passed).toBe(false);
  });
});
