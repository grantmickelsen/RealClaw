export class ClawError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = 'ClawError';
  }
}

export class IntegrationError extends ClawError {
  constructor(
    public readonly integrationId: string,
    message: string,
    public readonly statusCode: number | null = null,
    retryable = false,
  ) {
    super(message, 'INTEGRATION_ERROR', retryable);
    this.name = 'IntegrationError';
  }
}

export class MemoryError extends ClawError {
  constructor(message: string, public readonly path?: string) {
    super(message, 'MEMORY_ERROR', false);
    this.name = 'MemoryError';
  }
}

export class AgentTimeoutError extends ClawError {
  constructor(public readonly agentId: string, public readonly timeoutMs: number) {
    super(`Agent ${agentId} timed out after ${timeoutMs}ms`, 'AGENT_TIMEOUT', true);
    this.name = 'AgentTimeoutError';
  }
}

export class ApprovalExpiredError extends ClawError {
  constructor(public readonly approvalId: string) {
    super(`Approval ${approvalId} has expired`, 'APPROVAL_EXPIRED', false);
    this.name = 'ApprovalExpiredError';
  }
}

export class CredentialError extends ClawError {
  constructor(public readonly integrationId: string, message: string) {
    super(message, 'CREDENTIAL_ERROR', false);
    this.name = 'CredentialError';
  }
}

export function isRetryable(err: unknown): boolean {
  if (err instanceof ClawError) return err.retryable;
  return false;
}

export function toClawError(err: unknown, code = 'UNKNOWN_ERROR'): ClawError {
  if (err instanceof ClawError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new ClawError(message, code, false);
}
