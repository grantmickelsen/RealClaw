import { describe, it, expect } from 'vitest';
import { normalizeInbound, formatOutbound } from '../../../src/utils/normalize.js';

describe('normalizeInbound', () => {
  it('normalizes a Discord message', () => {
    const raw = {
      id: 'disc-123',
      channelId: 'chan-456',
      content: 'Hello Claw!',
      author: { id: 'user-789', username: 'GrantM' },
      attachments: [],
    };
    const result = normalizeInbound('discord', raw);
    expect(result.type).toBe('INBOUND_MESSAGE');
    expect(result.platform).toBe('discord');
    expect(result.channelId).toBe('chan-456');
    expect(result.sender.displayName).toBe('GrantM');
    expect(result.content.text).toBe('Hello Claw!');
    expect(result.messageId).toBeTruthy();
    expect(result.correlationId).toBeTruthy();
    expect(result.timestamp).toBeTruthy();
  });

  it('normalizes a Slack message', () => {
    const raw = {
      type: 'message',
      user: 'U123',
      username: 'grant',
      text: 'Schedule a showing for tomorrow',
      channel: 'C456',
    };
    const result = normalizeInbound('slack', raw);
    expect(result.platform).toBe('slack');
    expect(result.content.text).toBe('Schedule a showing for tomorrow');
    expect(result.sender.platformId).toBe('U123');
  });

  it('normalizes an SMS message', () => {
    const raw = {
      From: '+16195929468',
      Body: 'Can you pull comps for Oak Ave?',
      MessageSid: 'SM123',
    };
    const result = normalizeInbound('sms', raw);
    expect(result.platform).toBe('sms');
    expect(result.content.text).toBe('Can you pull comps for Oak Ave?');
    expect(result.channelId).toBe('+16195929468');
  });

  it('generates unique messageIds', () => {
    const raw = { channelId: 'c1', content: 'x', author: { id: 'u1', username: 'user' }, attachments: [] };
    const r1 = normalizeInbound('discord', raw);
    const r2 = normalizeInbound('discord', raw);
    expect(r1.messageId).not.toBe(r2.messageId);
  });
});

describe('normalizeInbound — media attachments', () => {
  it('guesses audio media type for audio content_type', () => {
    const raw = {
      id: 'disc-1',
      channelId: 'chan-1',
      content: '',
      author: { id: 'u1', username: 'user' },
      attachments: [{ content_type: 'audio/mpeg', filename: 'recording.mp3', size: 1024 }],
    };
    const result = normalizeInbound('discord', raw);
    expect(result.content.media[0]?.type).toBe('audio');
  });

  it('guesses video media type for video content_type', () => {
    const raw = {
      id: 'disc-2',
      channelId: 'chan-1',
      content: '',
      author: { id: 'u1', username: 'user' },
      attachments: [{ content_type: 'video/mp4', filename: 'clip.mp4', size: 2048 }],
    };
    const result = normalizeInbound('discord', raw);
    expect(result.content.media[0]?.type).toBe('video');
  });

  it('guesses document type for unknown content_type', () => {
    const raw = {
      id: 'disc-3',
      channelId: 'chan-1',
      content: '',
      author: { id: 'u1', username: 'user' },
      attachments: [{ content_type: 'application/pdf', filename: 'contract.pdf', size: 4096 }],
    };
    const result = normalizeInbound('discord', raw);
    expect(result.content.media[0]?.type).toBe('document');
  });
});

describe('normalizeInbound — additional platforms', () => {
  it('normalizes a WhatsApp message', () => {
    const raw = {
      key: { remoteJid: '+15551234567', id: 'ABCDEF' },
      pushName: 'Jane',
      message: { conversation: 'Show me Oak Ave' },
    };
    const result = normalizeInbound('whatsapp', raw);
    expect(result.platform).toBe('whatsapp');
    expect(result.content.text).toBe('Show me Oak Ave');
    expect(result.sender.displayName).toBe('Jane');
    expect(result.channelId).toBe('+15551234567');
  });

  it('normalizes a WhatsApp extended text message', () => {
    const raw = {
      key: { remoteJid: 'group@g.us' },
      pushName: 'Bob',
      message: { extendedTextMessage: { text: 'Can we push the closing?' } },
    };
    const result = normalizeInbound('whatsapp', raw);
    expect(result.content.text).toBe('Can we push the closing?');
  });

  it('normalizes an iMessage', () => {
    const raw = {
      guid: 'imessage://+16195929468',
      chatGuid: 'iMessage;+;+16195929468',
      handle: '+16195929468',
      text: 'Comps for Elm St please',
    };
    const result = normalizeInbound('imessage', raw);
    expect(result.platform).toBe('imessage');
    expect(result.content.text).toBe('Comps for Elm St please');
    expect(result.channelId).toBe('iMessage;+;+16195929468');
  });

  it('normalizes WhatsApp message with no text content (empty string fallback)', () => {
    const raw = {
      key: { remoteJid: '+15551234567', id: 'ABCDEF' },
      pushName: 'Bob',
      message: {}, // neither conversation nor extendedTextMessage
    };
    const result = normalizeInbound('whatsapp', raw);
    expect(result.content.text).toBe('');
  });

  it('normalizes an unknown platform via generic fallback', () => {
    const raw = { channelId: 'ch1', userId: 'u1', username: 'tester', text: 'hello' };
    const result = normalizeInbound('signal', raw as never);
    expect(result.platform).toBe('signal');
    expect(result.content.text).toBe('hello');
  });
});

describe('formatOutbound', () => {
  it('formats Discord message as object with content', () => {
    const msg = {
      platform: 'discord' as const,
      channelId: 'chan-1',
      text: 'Hello from Claw',
    };
    const result = formatOutbound('discord', msg) as Record<string, unknown>;
    expect(result['content']).toBe('Hello from Claw');
  });

  it('formats Slack message as Block Kit blocks', () => {
    const msg = {
      platform: 'slack' as const,
      channelId: 'C123',
      text: 'Here is your briefing',
    };
    const result = formatOutbound('slack', msg) as { blocks: unknown[] };
    expect(Array.isArray(result.blocks)).toBe(true);
  });

  it('truncates long SMS to 160 chars', () => {
    const msg = {
      platform: 'sms' as const,
      channelId: '+1234567890',
      text: 'x'.repeat(300),
    };
    const result = formatOutbound('sms', msg) as string;
    expect(result.length).toBeLessThanOrEqual(160);
    expect(result).toContain('continued in next message');
  });

  it('formats approval request into Discord message', () => {
    const msg = {
      platform: 'discord' as const,
      channelId: 'chan-1',
      text: 'I have some actions pending your approval.',
      approvalRequest: {
        messageId: 'ap-1',
        timestamp: new Date().toISOString(),
        correlationId: 'corr-1',
        type: 'APPROVAL_REQUEST' as const,
        approvalId: 'appr-uuid',
        batch: [
          {
            index: 0,
            actionType: 'send_email' as const,
            preview: 'Send email to John about the offer.',
            medium: 'email',
            recipients: ['john@example.com'],
            originatingAgent: 'comms' as never,
            taskResultId: 'task-1',
          },
        ],
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
    };
    const result = formatOutbound('discord', msg) as { content: string };
    expect(result.content).toContain('Pending Approvals');
    expect(result.content).toContain('Send email to John');
  });

  it('formats Slack approval request with Block Kit', () => {
    const msg = {
      platform: 'slack' as const,
      channelId: 'C123',
      text: 'Pending your approval.',
      approvalRequest: {
        messageId: 'ap-2',
        timestamp: new Date().toISOString(),
        correlationId: 'corr-2',
        type: 'APPROVAL_REQUEST' as const,
        approvalId: 'appr-slack',
        batch: [
          {
            index: 0,
            actionType: 'send_email' as const,
            preview: 'Email the Chen family',
            medium: 'email',
            recipients: ['chen@example.com'],
            originatingAgent: 'comms' as never,
            taskResultId: 'task-2',
          },
        ],
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
    };
    const result = formatOutbound('slack', msg) as { blocks: unknown[] };
    expect(result.blocks.length).toBeGreaterThan(1);
  });

  it('formats SMS approval with Y/E/X text codes', () => {
    const msg = {
      platform: 'sms' as const,
      channelId: '+1234567890',
      text: 'Approval needed.',
      approvalRequest: {
        messageId: 'ap-3',
        timestamp: new Date().toISOString(),
        correlationId: 'corr-3',
        type: 'APPROVAL_REQUEST' as const,
        approvalId: 'appr-sms',
        batch: [
          {
            index: 0,
            actionType: 'send_email' as const,
            preview: 'Send offer summary',
            medium: 'email',
            recipients: ['buyer@example.com'],
            originatingAgent: 'comms' as never,
            taskResultId: 'task-3',
          },
        ],
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
    };
    const result = formatOutbound('sms', msg) as string;
    expect(result).toContain('Y=approve');
    expect(result).toContain('Send offer summary');
  });
});
