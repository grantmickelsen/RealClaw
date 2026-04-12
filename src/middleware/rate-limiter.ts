import type { IntegrationId } from '../types/integrations.js';

interface WindowEntry {
  timestamps: number[];       // Call timestamps in the current window
  warningLogged: boolean;
}

export interface RateLimitCheck {
  allowed: boolean;
  remaining: number;
  resetsAt: string;           // ISO-8601
}

const WINDOW_MS = 60_000;    // 1-minute sliding window

export class RateLimiter {
  private readonly windows = new Map<string, WindowEntry>();
  private readonly limitOverrides = new Map<string, number>();

  checkLimit(
    integrationId: IntegrationId,
    limitPerMinute?: number,
  ): RateLimitCheck {
    const limit = this.limitOverrides.get(integrationId) ?? limitPerMinute ?? 60;
    const key = integrationId;
    const now = Date.now();

    let entry = this.windows.get(key);
    if (!entry) {
      entry = { timestamps: [], warningLogged: false };
      this.windows.set(key, entry);
    }

    // Prune timestamps outside the window
    entry.timestamps = entry.timestamps.filter(t => now - t < WINDOW_MS);

    const remaining = limit - entry.timestamps.length;
    const oldest = entry.timestamps[0];
    const resetsAt = oldest
      ? new Date(oldest + WINDOW_MS).toISOString()
      : new Date(now + WINDOW_MS).toISOString();

    if (remaining <= 0) {
      return { allowed: false, remaining: 0, resetsAt };
    }

    // Log warning at 80% capacity
    if (!entry.warningLogged && remaining <= Math.ceil(limit * 0.2)) {
      console.warn(`[RateLimiter] ${integrationId} at ${Math.floor((entry.timestamps.length / limit) * 100)}% capacity`);
      entry.warningLogged = true;
    } else if (remaining > Math.ceil(limit * 0.2)) {
      entry.warningLogged = false; // Reset warning flag when usage drops
    }

    // Record this call
    entry.timestamps.push(now);
    return { allowed: true, remaining: remaining - 1, resetsAt };
  }

  setLimit(integrationId: IntegrationId, limitPerMinute: number): void {
    this.limitOverrides.set(integrationId, limitPerMinute);
  }

  getRemainingCalls(integrationId: IntegrationId, limitPerMinute = 60): number {
    const entry = this.windows.get(integrationId);
    if (!entry) return limitPerMinute;
    const now = Date.now();
    const active = entry.timestamps.filter(t => now - t < WINDOW_MS).length;
    return Math.max(0, limitPerMinute - active);
  }

  reset(integrationId: IntegrationId): void {
    this.windows.delete(integrationId);
  }
}
