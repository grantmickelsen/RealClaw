import { v4 as uuidv4 } from 'uuid';
import type { InboundMessage, MediaAttachment, OutboundMessage, ApprovalRequest } from '../types/messages.js';

type Platform = InboundMessage['platform'];

// ─── Inbound Normalization ───

export function normalizeInbound(platform: string, rawMessage: RawMessage): InboundMessage {
  const messageId = uuidv4();
  const correlationId = (typeof rawMessage['correlationId'] === 'string' && rawMessage['correlationId'])
    ? rawMessage['correlationId']
    : uuidv4();
  const timestamp = new Date().toISOString();
  const typedPlatform = platform as Platform;

  switch (typedPlatform) {
    case 'discord':
      return normalizeDiscord(rawMessage as DiscordMessage, messageId, correlationId, timestamp);
    case 'slack':
      return normalizeSlack(rawMessage as SlackMessage, messageId, correlationId, timestamp);
    case 'whatsapp':
      return normalizeWhatsApp(rawMessage as WhatsAppMessage, messageId, correlationId, timestamp);
    case 'imessage':
      return normalizeIMessage(rawMessage as IMessage, messageId, correlationId, timestamp);
    case 'sms':
      return normalizeSms(rawMessage as SmsMessage, messageId, correlationId, timestamp);
    default:
      return normalizeGeneric(rawMessage, typedPlatform, messageId, correlationId, timestamp);
  }
}

function normalizeDiscord(
  msg: DiscordMessage,
  messageId: string,
  correlationId: string,
  timestamp: string,
): InboundMessage {
  return {
    messageId,
    timestamp,
    correlationId,
    type: 'INBOUND_MESSAGE',
    platform: 'discord',
    channelId: msg.channelId ?? msg.channel_id ?? '',
    sender: {
      platformId: msg.author?.id ?? '',
      displayName: msg.author?.username ?? 'Unknown',
      isClient: true,
    },
    content: {
      text: msg.content ?? '',
      media: normalizeDiscordAttachments(msg.attachments ?? []),
    },
    replyTo: msg.message_reference?.message_id ?? null,
  };
}

function normalizeDiscordAttachments(
  attachments: DiscordAttachment[],
): MediaAttachment[] {
  return attachments.map(a => ({
    type: guessMediaType(a.content_type ?? ''),
    localPath: '',  // Populated after download
    filename: a.filename ?? '',
    mimeType: a.content_type ?? 'application/octet-stream',
    sizeBytes: a.size ?? 0,
  }));
}

function normalizeSlack(
  msg: SlackMessage,
  messageId: string,
  correlationId: string,
  timestamp: string,
): InboundMessage {
  return {
    messageId,
    timestamp,
    correlationId,
    type: 'INBOUND_MESSAGE',
    platform: 'slack',
    channelId: msg.channel ?? '',
    sender: {
      platformId: msg.user ?? '',
      displayName: msg.username ?? msg.user ?? 'Unknown',
      isClient: true,
    },
    content: {
      text: msg.text ?? '',
      media: [],
    },
    replyTo: msg.thread_ts ?? null,
  };
}

function normalizeWhatsApp(
  msg: WhatsAppMessage,
  messageId: string,
  correlationId: string,
  timestamp: string,
): InboundMessage {
  const text =
    msg.message?.conversation ??
    msg.message?.extendedTextMessage?.text ??
    '';

  return {
    messageId,
    timestamp,
    correlationId,
    type: 'INBOUND_MESSAGE',
    platform: 'whatsapp',
    channelId: msg.key?.remoteJid ?? '',
    sender: {
      platformId: msg.key?.remoteJid ?? '',
      displayName: msg.pushName ?? 'Unknown',
      isClient: true,
    },
    content: { text, media: [] },
    replyTo: null,
  };
}

function normalizeIMessage(
  msg: IMessage,
  messageId: string,
  correlationId: string,
  timestamp: string,
): InboundMessage {
  return {
    messageId,
    timestamp,
    correlationId,
    type: 'INBOUND_MESSAGE',
    platform: 'imessage',
    channelId: msg.chatGuid ?? '',
    sender: {
      platformId: msg.handle ?? '',
      displayName: msg.handle ?? 'Unknown',
      isClient: true,
    },
    content: { text: msg.text ?? '', media: [] },
    replyTo: null,
  };
}

function normalizeSms(
  msg: SmsMessage,
  messageId: string,
  correlationId: string,
  timestamp: string,
): InboundMessage {
  return {
    messageId,
    timestamp,
    correlationId,
    type: 'INBOUND_MESSAGE',
    platform: 'sms',
    channelId: msg.From ?? '',
    sender: {
      platformId: msg.From ?? '',
      displayName: msg.From ?? 'Unknown',
      isClient: true,
    },
    content: { text: msg.Body ?? '', media: [] },
    replyTo: null,
  };
}

function normalizeGeneric(
  msg: RawMessage,
  platform: Platform,
  messageId: string,
  correlationId: string,
  timestamp: string,
): InboundMessage {
  return {
    messageId,
    timestamp,
    correlationId,
    type: 'INBOUND_MESSAGE',
    platform,
    channelId: String((msg as Record<string, unknown>)['channelId'] ?? ''),
    sender: {
      platformId: String((msg as Record<string, unknown>)['userId'] ?? ''),
      displayName: String((msg as Record<string, unknown>)['username'] ?? 'Unknown'),
      isClient: true,
    },
    content: {
      text: String((msg as Record<string, unknown>)['text'] ?? ''),
      media: [],
    },
    replyTo: null,
  };
}

// ─── Outbound Formatting ───

const PLATFORM_MAX_LENGTH: Record<Platform, number> = {
  discord: 2000,
  slack: 40000,
  whatsapp: 4096,
  imessage: 20000,
  signal: 50000,
  sms: 160,
};

export function formatOutbound(platform: Platform, message: OutboundMessage): unknown {
  const maxLen = PLATFORM_MAX_LENGTH[platform] ?? 2000;
  const text = truncateText(message.text, maxLen);

  switch (platform) {
    case 'slack':
      return formatSlack(text, message.approvalRequest);
    case 'discord':
      return formatDiscord(text, message.approvalRequest);
    case 'sms':
    case 'whatsapp':
    case 'imessage':
    case 'signal':
      return formatTextCode(text, message.approvalRequest);
    default:
      return { text };
  }
}

function formatSlack(text: string, approval?: ApprovalRequest): unknown {
  const blocks: unknown[] = [{ type: 'section', text: { type: 'mrkdwn', text } }];

  if (approval) {
    for (const item of approval.batch) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `*${item.index + 1}.* ${item.preview}` },
        accessory: {
          type: 'overflow',
          action_id: `approval_${approval.approvalId}_${item.index}`,
          options: [
            { text: { type: 'plain_text', text: 'Approve' }, value: 'approve' },
            { text: { type: 'plain_text', text: 'Edit' }, value: 'edit' },
            { text: { type: 'plain_text', text: 'Cancel' }, value: 'cancel' },
          ],
        },
      });
    }
  }

  return { blocks };
}

function formatDiscord(text: string, approval?: ApprovalRequest): unknown {
  if (!approval) return { content: text };

  const approvalText = approval.batch
    .map(item => `${item.index + 1}. ${item.preview}`)
    .join('\n');

  return {
    content: `${text}\n\n**Pending Approvals:**\n${approvalText}\nReact with ✅ to approve, ✏️ to edit, ❌ to cancel.`,
  };
}

function formatTextCode(text: string, approval?: ApprovalRequest): string {
  if (!approval) return text;

  const approvalText = approval.batch
    .map(item => `${item.index + 1}. ${item.preview}`)
    .join('\n');

  return `${text}\n\nPending Approval:\n${approvalText}\nReply Y=approve, E=edit, X=cancel (e.g., "Y1 E2 X3")`;
}

function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const suffix = '\n... continued in next message';
  return text.slice(0, maxLen - suffix.length) + suffix;
}

function guessMediaType(mimeType: string): MediaAttachment['type'] {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('video/')) return 'video';
  return 'document';
}

// ─── Raw Platform Message Types ───

type RawMessage = Record<string, unknown>;

interface DiscordMessage {
  id?: string;
  channelId?: string;
  channel_id?: string;
  content?: string;
  author?: { id: string; username: string };
  attachments?: DiscordAttachment[];
  message_reference?: { message_id: string };
}

interface DiscordAttachment {
  id?: string;
  filename?: string;
  content_type?: string;
  size?: number;
  url?: string;
}

interface SlackMessage {
  type?: string;
  user?: string;
  username?: string;
  text?: string;
  channel?: string;
  thread_ts?: string;
}

interface WhatsAppMessage {
  key?: { remoteJid?: string; id?: string };
  pushName?: string;
  message?: {
    conversation?: string;
    extendedTextMessage?: { text?: string };
  };
}

interface IMessage {
  guid?: string;
  chatGuid?: string;
  handle?: string;
  text?: string;
}

interface SmsMessage {
  From?: string;
  Body?: string;
  MessageSid?: string;
}
