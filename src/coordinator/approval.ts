import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import path from 'path';
import type {
  ApprovalRequest,
  ApprovalResponse,
  ApprovalItem,
} from '../types/messages.js';

interface PendingApprovals {
  [approvalId: string]: ApprovalRequest;
}

interface ApprovalConfig {
  batchThreshold: number;
  approvalTimeout: {
    reminderAfterMs: number;
    expireAfterMs: number;
  };
}

export class ApprovalManager {
  private readonly pending = new Map<string, ApprovalRequest>();
  private readonly storeFile: string;
  private readonly config: ApprovalConfig;
  private readonly reminderTimers = new Map<string, NodeJS.Timeout>();
  private readonly expiryTimers = new Map<string, NodeJS.Timeout>();
  private onApprovalExecute?: (request: ApprovalRequest, response: ApprovalResponse) => Promise<void>;

  constructor(
    memoryPath: string = process.env.CLAW_MEMORY_PATH ?? '/opt/claw/memory',
    config: ApprovalConfig = { batchThreshold: 3, approvalTimeout: { reminderAfterMs: 14_400_000, expireAfterMs: 86_400_000 } },
  ) {
    this.storeFile = path.join(memoryPath, 'system', 'pending-approvals.json');
    this.config = config;
  }

  onExecute(callback: (request: ApprovalRequest, response: ApprovalResponse) => Promise<void>): void {
    this.onApprovalExecute = callback;
  }

  async createApprovalRequest(items: ApprovalItem[]): Promise<ApprovalRequest> {
    const approvalId = uuidv4();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.config.approvalTimeout.expireAfterMs);

    const request: ApprovalRequest = {
      messageId: uuidv4(),
      timestamp: now.toISOString(),
      correlationId: uuidv4(),
      type: 'APPROVAL_REQUEST',
      approvalId,
      batch: items,
      expiresAt: expiresAt.toISOString(),
    };

    this.pending.set(approvalId, request);
    await this.persistPending();
    this.scheduleTimers(request);

    return request;
  }

  async processApprovalResponse(response: ApprovalResponse): Promise<void> {
    const request = this.pending.get(response.approvalId);
    if (!request) {
      console.warn(`[Approval] Unknown approval ID: ${response.approvalId}`);
      return;
    }

    if (new Date(request.expiresAt) < new Date()) {
      console.warn(`[Approval] Approval ${response.approvalId} has expired`);
      this.cleanup(response.approvalId);
      return;
    }

    this.cleanup(response.approvalId);

    if (this.onApprovalExecute) {
      await this.onApprovalExecute(request, response);
    }

    await this.persistPending();
  }

  shouldBatch(items: ApprovalItem[]): boolean {
    return items.length >= this.config.batchThreshold;
  }

  getPending(approvalId: string): ApprovalRequest | undefined {
    return this.pending.get(approvalId);
  }

  getAllPending(): ApprovalRequest[] {
    return [...this.pending.values()];
  }

  async loadFromDisk(): Promise<void> {
    try {
      const raw = await fs.readFile(this.storeFile, 'utf-8');
      const stored = JSON.parse(raw) as PendingApprovals;
      const now = new Date();

      for (const [id, request] of Object.entries(stored)) {
        if (new Date(request.expiresAt) > now) {
          this.pending.set(id, request);
          this.scheduleTimers(request);
        }
      }
    } catch {
      // No stored approvals — start fresh
    }
  }

  private async persistPending(): Promise<void> {
    const stored: PendingApprovals = {};
    for (const [id, request] of this.pending) {
      stored[id] = request;
    }
    await fs.mkdir(path.dirname(this.storeFile), { recursive: true });
    await fs.writeFile(this.storeFile, JSON.stringify(stored, null, 2), 'utf-8');
  }

  private scheduleTimers(request: ApprovalRequest): void {
    const now = Date.now();
    const expiresMs = new Date(request.expiresAt).getTime();
    const reminderMs = now + this.config.approvalTimeout.reminderAfterMs;

    if (reminderMs < expiresMs) {
      const reminderTimer = setTimeout(() => {
        console.log(`[Approval] Reminder: approval ${request.approvalId} still pending`);
      }, reminderMs - now);
      this.reminderTimers.set(request.approvalId, reminderTimer);
    }

    const expiryTimer = setTimeout(() => {
      console.log(`[Approval] Expired: approval ${request.approvalId}`);
      this.cleanup(request.approvalId);
      this.persistPending().catch(() => {});
    }, expiresMs - now);
    this.expiryTimers.set(request.approvalId, expiryTimer);
  }

  private cleanup(approvalId: string): void {
    this.pending.delete(approvalId);
    const reminder = this.reminderTimers.get(approvalId);
    const expiry = this.expiryTimers.get(approvalId);
    if (reminder) clearTimeout(reminder);
    if (expiry) clearTimeout(expiry);
    this.reminderTimers.delete(approvalId);
    this.expiryTimers.delete(approvalId);
  }
}
