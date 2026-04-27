import { useAuthStore } from '../store/auth';
import { useWsStore } from '../store/ws';
import { useChatStore } from '../store/chat';
import { useStudioStore } from '../store/studio';
import { useContactsStore, type SuggestedAction } from '../store/contacts';
import { useSmsStore, type ExtractedSignals } from '../store/sms';
import { useToursStore, type AccessStatus } from '../store/tours';
import { useDealsStore, type MilestoneStatus } from '../store/deals';
import { saveMessage } from '../lib/db';
import { drainPendingContacts } from '../lib/contact-sync';
import { WS_URL } from '../constants/api';

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const RECONNECT_DELAY_MS = 3_000;

// ─── Streaming ref buffer — 80ms flush (Decision 5) ───
const streamBuffers = new Map<string, string>(); // correlationId → accumulated text
let flushInterval: ReturnType<typeof setInterval> | null = null;

function startFlushInterval(): void {
  if (flushInterval) return;
  flushInterval = setInterval(() => {
    for (const [correlationId, text] of streamBuffers.entries()) {
      if (text) {
        useChatStore.getState().updateMessage(correlationId, { text, status: 'streaming' });
        streamBuffers.set(correlationId, '');
      }
    }
  }, 80);
}

function stopFlushInterval(): void {
  if (flushInterval) {
    clearInterval(flushInterval);
    flushInterval = null;
  }
  streamBuffers.clear();
}

export function connect(): void {
  const { accessToken } = useAuthStore.getState();
  if (!accessToken) return;

  const { setStatus, setSocket } = useWsStore.getState();
  setStatus('connecting');

  // Use Sec-WebSocket-Protocol header for auth (Decision 2)
  socket = new WebSocket(WS_URL, [`bearer.${accessToken}`]);

  socket.onopen = () => {
    setStatus('connected');
    setSocket(socket);
    startFlushInterval();
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  socket.onmessage = (event) => {
    try {
      handleMessage(JSON.parse(event.data as string) as WsEvent);
    } catch {
      // ignore malformed messages
    }
  };

  socket.onerror = () => {
    setStatus('error');
  };

  socket.onclose = () => {
    setStatus('disconnected');
    setSocket(null);
    stopFlushInterval();
    socket = null;
    // Reconnect after delay if still authenticated
    if (useAuthStore.getState().status === 'authenticated') {
      reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
    }
  };
}

export function disconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  stopFlushInterval();
  socket?.close();
  socket = null;
  useWsStore.getState().setStatus('disconnected');
  useWsStore.getState().setSocket(null);
}

// ─── WS message shape ───

interface WsEvent {
  type: string;
  correlationId: string;
  tenantId?: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

function handleMessage(event: WsEvent): void {
  void useWsStore;

  switch (event.type) {
    case 'CONNECTED':
      void drainPendingContacts();
      break;

    case 'AGENT_TYPING':
      useChatStore.getState().updateMessage(event.correlationId, { status: 'streaming' });
      break;

    case 'TOKEN_STREAM': {
      const token = (event.payload.token as string) ?? '';
      // Route oracle tokens to the tours store; everything else buffers for chat
      if (event.correlationId === useToursStore.getState().oracleCorrelationId) {
        useToursStore.getState().appendOracleToken(event.correlationId, token);
        break;
      }
      const existing = streamBuffers.get(event.correlationId) ?? '';
      streamBuffers.set(event.correlationId, existing + token);
      break;
    }

    case 'TASK_COMPLETE': {
      const buffered = streamBuffers.get(event.correlationId);
      const hasApproval = !!(event.payload.hasApproval);
      const approvalId = (event.payload.approvalId as string | undefined) ?? undefined;
      let finalText: string;
      if (buffered) {
        finalText = buffered;
        streamBuffers.delete(event.correlationId);
      } else {
        const payloadText = ((event.payload.text as string) ?? '').trim();
        finalText = payloadText || (useChatStore.getState().messages.find(m => m.correlationId === event.correlationId && m.role === 'assistant')?.text ?? '');
      }

      // Contacts dossier result
      const { pendingDossierCorrelationId } = useContactsStore.getState();
      if (pendingDossierCorrelationId && event.correlationId === pendingDossierCorrelationId) {
        useContactsStore.getState().setPendingDossierCorrelationId(null);
        try {
          const d = JSON.parse(finalText) as { narrative?: string; suggestedActions?: SuggestedAction[] };
          useContactsStore.getState().setDossierResult(
            d.narrative ?? 'No summary available.',
            d.suggestedActions ?? [],
          );
        } catch {
          useContactsStore.getState().setDossierResult('Could not generate summary.', []);
        }
        useWsStore.getState().removePending(event.correlationId);
        break;
      }

      // Studio content generation / virtual staging result
      if (useStudioStore.getState().pendingCorrelationId === event.correlationId) {
        try {
          const parsed = JSON.parse(finalText) as {
            stagedImageUrl?: string;
            mlsDescription?: string; instagramCaption?: string; facebookPost?: string;
            emailContent?: string; smsText?: string;
            complianceFlags?: string[]; featureJson?: object;
          };
          if (parsed.stagedImageUrl) {
            useStudioStore.getState().setStagingResult(parsed.stagedImageUrl);
          } else if (parsed.mlsDescription || parsed.instagramCaption || parsed.facebookPost || parsed.emailContent || parsed.smsText) {
            useStudioStore.getState().setResult(parsed.featureJson ?? {}, {
              mlsDescription: parsed.mlsDescription,
              instagramCaption: parsed.instagramCaption,
              facebookPost: parsed.facebookPost,
              emailContent: parsed.emailContent,
              smsText: parsed.smsText,
              complianceFlags: parsed.complianceFlags ?? [],
            });
          }
        } catch { /* not a studio result */ }
      }

      useChatStore.getState().updateMessage(event.correlationId, { text: finalText, status: 'done', hasApproval, approvalId });

      // Persist the assistant message so it survives app restarts
      const assistantMsg = useChatStore.getState().messages.find(m => m.correlationId === event.correlationId && m.role === 'assistant');
      if (assistantMsg) {
        void saveMessage({
          id: assistantMsg.id,
          correlation_id: event.correlationId,
          role: 'assistant',
          text: finalText,
          status: 'done',
          agent_id: assistantMsg.agentId ?? null,
          has_approval: hasApproval ? 1 : 0,
          approval_id: approvalId ?? null,
          timestamp: assistantMsg.timestamp,
          synced: 1,
        });
      }

      useWsStore.getState().removePending(event.correlationId);
      break;
    }

    case 'SMS_RECEIVED': {
      const p = event.payload;
      const contactId = (p.contactId as string | null) ?? null;
      const smsStore = useSmsStore.getState();
      smsStore.appendMessage(contactId ?? (p.fromNumber as string), {
        id: p.messageId as string,
        direction: 'inbound',
        body: p.body as string,
        status: 'received',
        sentVia: 'contact',
        extractedSignals: null,
        createdAt: p.createdAt as string,
        twilioSid: null,
      });
      smsStore.upsertConversation({
        contactId,
        contactName: (p.contactName as string | null) ?? null,
        phone: (p.fromNumber as string) ?? null,
        lastMessage: p.body as string,
        lastMessageAt: p.createdAt as string,
        lastDirection: 'inbound',
        unreadCount: 1,
        latestSignals: null,
      });
      break;
    }

    case 'SMS_STATUS': {
      const p = event.payload;
      useSmsStore.getState().updateMessageStatus(
        p.twilioSid as string,
        p.status as string,
      );
      break;
    }

    case 'SMS_SIGNALS_READY': {
      const p = event.payload;
      useSmsStore.getState().updateMessageSignals(
        p.messageId as string,
        p.extractedSignals as ExtractedSignals,
      );
      break;
    }

    case 'SMS_SUGGESTIONS_READY': {
      const p = event.payload;
      useSmsStore.getState().setSuggestions(
        p.contactId as string,
        p.suggestions as string[],
      );
      break;
    }

    // ─── Tours events ──────────────────────────────────────────────────────

    case 'PROPERTY_CURATION_READY': {
      const p = event.payload;
      useToursStore.getState().addPendingCuration({
        searchId:    p.searchId as string,
        contactId:   p.contactId as string,
        contactName: (p.contactName as string | null) ?? null,
        count:       p.count as number,
      });
      break;
    }

    case 'SHOWING_ACCESS_UPDATE': {
      const p = event.payload;
      useToursStore.getState().updateStopAccess(
        p.showingDayPropertyId as string,
        p.status as AccessStatus,
        (p.notes as string | null) ?? null,
      );
      break;
    }

    case 'ROUTE_READY': {
      const p = event.payload;
      useToursStore.getState().setShowingDays(
        useToursStore.getState().showingDays.map((d) =>
          d.id === (p.showingDayId as string)
            ? { ...d, status: 'confirmed' as const }
            : d,
        ),
      );
      break;
    }

    case 'FIELD_ORACLE_READY': {
      const p = event.payload;
      useToursStore.getState().setFieldOracle(p.content as string, false);
      break;
    }

    // ─── Deals events ──────────────────────────────────────────────────────

    case 'DEAL_INGEST_READY': {
      const p = event.payload;
      useDealsStore.getState().handleDealIngestReady({
        dealId:          p.dealId as string,
        address:         p.address as string,
        complianceCount: p.complianceCount as number,
      });
      break;
    }

    case 'DEAL_ALERT': {
      const p = event.payload;
      useDealsStore.getState().handleDealAlert({
        alertId:     p.alertId as string,
        dealId:      p.dealId as string,
        priority:    p.priority as number,
        message:     p.message as string,
        actionType:  (p.actionType as string | null) ?? null,
        actionLabel: (p.actionLabel as string | null) ?? null,
      });
      break;
    }

    case 'DEAL_MILESTONE_UPDATE': {
      const p = event.payload;
      useDealsStore.getState().handleMilestoneUpdate({
        dealId:      p.dealId as string,
        milestoneId: p.milestoneId as string,
        status:      p.status as MilestoneStatus,
      });
      break;
    }

    case 'DEAL_COMPLIANCE_READY': {
      const p = event.payload;
      useDealsStore.getState().handleComplianceReady({
        dealId:        p.dealId as string,
        documentCount: p.documentCount as number,
        blockingCount: p.blockingCount as number,
      });
      break;
    }

    // ─── TASK_COMPLETE: finalize oracle stream if applicable ───────────────

    case 'ERROR':
      useChatStore.getState().updateMessage(event.correlationId, {
        text: `Error: ${(event.payload.message as string) ?? 'Unknown error'}`,
        status: 'error',
      });
      useWsStore.getState().removePending(event.correlationId);
      break;

    default:
      break;
  }
}
