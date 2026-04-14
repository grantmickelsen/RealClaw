/**
 * Phase 2 — WebSocket Session Manager
 *
 * Maintains the set of active WebSocket connections per tenant.
 * Provides push() to broadcast WsEnvelope events to all open sockets.
 * Tracks AbortControllers so in-flight LLM calls are aborted when a
 * client disconnects mid-stream.
 *
 * Design note: In Phase 2 push() broadcasts to all sessions for a tenant.
 * The mobile client ignores envelopes for correlationIds it didn't initiate.
 * Phase 4 adds SUBSCRIBE-message filtering.
 */

import { WebSocket } from 'ws';
import type { WsEnvelope } from '../types/ws.js';

/** Narrow interface used by Coordinator — no direct ws package dep in business logic. */
export interface WsPusher {
  push(tenantId: string, envelope: WsEnvelope): void;
}

interface SessionEntry {
  ws: WebSocket;
  tenantId: string;
  /** AbortControllers for in-flight requests, keyed by correlationId. */
  activeControllers: Map<string, AbortController>;
}

export class WsSessionManager implements WsPusher {
  /** tenantId → set of active sessions */
  private readonly sessions = new Map<string, Set<SessionEntry>>();
  /** WebSocket → SessionEntry for O(1) lookup on close */
  private readonly bySocket = new Map<WebSocket, SessionEntry>();

  /**
   * Register a new WebSocket connection for a tenant.
   * Returns the SessionEntry so the caller can pass it to trackRequest().
   */
  register(tenantId: string, ws: WebSocket): SessionEntry {
    const entry: SessionEntry = { ws, tenantId, activeControllers: new Map() };
    if (!this.sessions.has(tenantId)) {
      this.sessions.set(tenantId, new Set());
    }
    this.sessions.get(tenantId)!.add(entry);
    this.bySocket.set(ws, entry);
    return entry;
  }

  /**
   * Unregister a WebSocket connection.
   * Aborts all in-flight AbortControllers associated with this socket.
   */
  unregister(ws: WebSocket): void {
    const entry = this.bySocket.get(ws);
    if (!entry) return;

    // Abort all in-flight LLM calls for this socket
    for (const controller of entry.activeControllers.values()) {
      controller.abort();
    }
    entry.activeControllers.clear();

    this.sessions.get(entry.tenantId)?.delete(entry);
    if (this.sessions.get(entry.tenantId)?.size === 0) {
      this.sessions.delete(entry.tenantId);
    }
    this.bySocket.delete(ws);
  }

  /**
   * Associate an AbortController with a correlationId on a specific socket.
   * Called by the POST /v1/messages handler before starting async processing.
   */
  trackRequest(ws: WebSocket, correlationId: string, controller: AbortController): void {
    this.bySocket.get(ws)?.activeControllers.set(correlationId, controller);
  }

  /**
   * Remove an AbortController when a request completes (success or error).
   */
  untrackRequest(ws: WebSocket, correlationId: string): void {
    this.bySocket.get(ws)?.activeControllers.delete(correlationId);
  }

  /**
   * Push an envelope to all open WebSocket sessions for a tenant.
   * Silently skips sockets that are CLOSING or CLOSED.
   */
  push(tenantId: string, envelope: WsEnvelope): void {
    const tenantSessions = this.sessions.get(tenantId);
    if (!tenantSessions || tenantSessions.size === 0) return;

    const payload = JSON.stringify(envelope);
    for (const entry of tenantSessions) {
      if (entry.ws.readyState === WebSocket.OPEN) {
        try {
          entry.ws.send(payload);
        } catch {
          // Ignore send errors — the close handler will clean up
        }
      }
    }
  }

  /** Number of active sessions for a tenant (useful for health/debug). */
  getSessionCount(tenantId: string): number {
    return this.sessions.get(tenantId)?.size ?? 0;
  }

  /** Total session count across all tenants. */
  getTotalSessionCount(): number {
    let total = 0;
    for (const set of this.sessions.values()) total += set.size;
    return total;
  }

  /**
   * Return all WebSocket instances for a tenant (for tests / debug).
   * Returns a copy so callers cannot mutate the internal set.
   */
  getSockets(tenantId: string): WebSocket[] {
    return [...(this.sessions.get(tenantId) ?? [])].map(e => e.ws);
  }
}
