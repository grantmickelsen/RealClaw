import { describe, it, expect } from 'vitest';
import {
  ClawError,
  IntegrationError,
  MemoryError,
  AgentTimeoutError,
  ApprovalExpiredError,
  CredentialError,
  isRetryable,
  toClawError,
} from '../../../src/utils/errors.js';

describe('ClawError', () => {
  it('creates error with name and code', () => {
    const err = new ClawError('test message', 'TEST_CODE');
    expect(err.message).toBe('test message');
    expect(err.code).toBe('TEST_CODE');
    expect(err.name).toBe('ClawError');
    expect(err.retryable).toBe(false);
  });

  it('creates retryable error', () => {
    const err = new ClawError('retry me', 'RETRY_CODE', true);
    expect(err.retryable).toBe(true);
  });
});

describe('IntegrationError', () => {
  it('stores integration id and status code', () => {
    const err = new IntegrationError('gmail', 'API failed', 429, true);
    expect(err.integrationId).toBe('gmail');
    expect(err.statusCode).toBe(429);
    expect(err.retryable).toBe(true);
    expect(err.code).toBe('INTEGRATION_ERROR');
    expect(err.name).toBe('IntegrationError');
  });

  it('defaults statusCode to null', () => {
    const err = new IntegrationError('twilio', 'Network error');
    expect(err.statusCode).toBeNull();
  });
});

describe('MemoryError', () => {
  it('stores path', () => {
    const err = new MemoryError('File not found', 'contacts/john.md');
    expect(err.path).toBe('contacts/john.md');
    expect(err.code).toBe('MEMORY_ERROR');
    expect(err.retryable).toBe(false);
  });
});

describe('AgentTimeoutError', () => {
  it('formats message with agent id and timeout', () => {
    const err = new AgentTimeoutError('calendar', 5000);
    expect(err.message).toContain('calendar');
    expect(err.message).toContain('5000ms');
    expect(err.agentId).toBe('calendar');
    expect(err.timeoutMs).toBe(5000);
    expect(err.retryable).toBe(true);
    expect(err.code).toBe('AGENT_TIMEOUT');
  });
});

describe('ApprovalExpiredError', () => {
  it('stores approvalId', () => {
    const err = new ApprovalExpiredError('appr-123');
    expect(err.approvalId).toBe('appr-123');
    expect(err.code).toBe('APPROVAL_EXPIRED');
    expect(err.retryable).toBe(false);
  });
});

describe('CredentialError', () => {
  it('stores integrationId', () => {
    const err = new CredentialError('hubspot', 'Token missing');
    expect(err.integrationId).toBe('hubspot');
    expect(err.code).toBe('CREDENTIAL_ERROR');
  });
});

describe('isRetryable', () => {
  it('returns true for retryable ClawError', () => {
    expect(isRetryable(new ClawError('x', 'X', true))).toBe(true);
  });

  it('returns false for non-retryable ClawError', () => {
    expect(isRetryable(new ClawError('x', 'X', false))).toBe(false);
  });

  it('returns false for plain Error', () => {
    expect(isRetryable(new Error('plain'))).toBe(false);
  });

  it('returns false for non-error values', () => {
    expect(isRetryable('string error')).toBe(false);
    expect(isRetryable(null)).toBe(false);
  });
});

describe('toClawError', () => {
  it('returns ClawError unchanged', () => {
    const original = new ClawError('original', 'ORIG');
    expect(toClawError(original)).toBe(original);
  });

  it('wraps plain Error', () => {
    const err = toClawError(new Error('plain error'));
    expect(err).toBeInstanceOf(ClawError);
    expect(err.message).toBe('plain error');
  });

  it('wraps string', () => {
    const err = toClawError('something went wrong');
    expect(err.message).toBe('something went wrong');
  });

  it('uses provided code', () => {
    const err = toClawError(new Error('x'), 'CUSTOM_CODE');
    expect(err.code).toBe('CUSTOM_CODE');
  });
});
