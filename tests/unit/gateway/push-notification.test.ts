import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PushNotificationService,
  createPushNotificationService,
} from '../../../src/gateway/push-notification.js';

// ─── Expo SDK mock (vi.hoisted required — vi.mock factory is hoisted) ─────────

const { mockSend, mockChunk, mockIsExpoPushToken, MockExpoCtor } = vi.hoisted(() => {
  const mockSend = vi.fn().mockResolvedValue([]);
  const mockChunk = vi.fn().mockImplementation((msgs: unknown[]) => [msgs]);
  const mockIsExpoPushToken = vi.fn().mockReturnValue(true);
  const MockExpoCtor = Object.assign(
    vi.fn().mockImplementation(() => ({
      sendPushNotificationsAsync: mockSend,
      chunkPushNotifications: mockChunk,
    })),
    { isExpoPushToken: mockIsExpoPushToken },
  );
  return { mockSend, mockChunk, mockIsExpoPushToken, MockExpoCtor };
});

vi.mock('expo-server-sdk', () => ({
  Expo: MockExpoCtor,
}));

function makeQueryFn(rows: unknown[] = []) {
  return vi.fn().mockResolvedValue({ rows });
}

describe('PushNotificationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsExpoPushToken.mockReturnValue(true);
    mockChunk.mockImplementation((msgs: unknown[]) => [msgs]);
    mockSend.mockResolvedValue([]);
  });

  // ─── registerDevice ──────────────────────────────────────────────────────

  it('registerDevice calls INSERT with correct params', async () => {
    const queryFn = makeQueryFn();
    const svc = new PushNotificationService(queryFn);
    await svc.registerDevice('tenant1', 'user-1', 'ExponentPushToken[xxx]', 'ios');
    expect(queryFn).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO tenant_device_tokens'),
      ['tenant1', 'user-1', 'ExponentPushToken[xxx]', 'ios'],
    );
  });

  it('registerDevice rejects an invalid Expo push token', async () => {
    mockIsExpoPushToken.mockReturnValue(false);
    const queryFn = makeQueryFn();
    const svc = new PushNotificationService(queryFn);
    await expect(
      svc.registerDevice('t1', 'u1', 'INVALID_TOKEN', 'ios'),
    ).rejects.toThrow(/invalid expo push token/i);
  });

  it('registerDevice uses ON CONFLICT for idempotency', async () => {
    const queryFn = makeQueryFn();
    const svc = new PushNotificationService(queryFn);
    await svc.registerDevice('t1', 'u1', 'ExponentPushToken[abc]', 'android');
    const sql = queryFn.mock.calls[0][0] as string;
    expect(sql.toLowerCase()).toContain('on conflict');
  });

  // ─── sendToTenant ─────────────────────────────────────────────────────────

  it('sendToTenant fetches device tokens then calls sendPushNotificationsAsync', async () => {
    const queryFn = makeQueryFn([{ expo_token: 'ExponentPushToken[t1]' }]);
    const svc = new PushNotificationService(queryFn);
    await svc.sendToTenant('tenant1', { title: 'Test', body: 'Hello' });
    expect(mockSend).toHaveBeenCalledOnce();
    const payload = mockChunk.mock.calls[0][0] as { to: string }[];
    expect(payload[0].to).toBe('ExponentPushToken[t1]');
  });

  it('sendToTenant with no device tokens does NOT call sendPushNotificationsAsync', async () => {
    const queryFn = makeQueryFn([]);
    const svc = new PushNotificationService(queryFn);
    await svc.sendToTenant('tenant1', { title: 'Test', body: 'Hello' });
    expect(mockSend).not.toHaveBeenCalled();
  });

  // ─── sendApprovalPush ─────────────────────────────────────────────────────

  it('sendApprovalPush sends correct title, body (truncated to 150), and data', async () => {
    const queryFn = makeQueryFn([{ expo_token: 'ExponentPushToken[x]' }]);
    const svc = new PushNotificationService(queryFn);
    const longPreview = 'A'.repeat(200);
    await svc.sendApprovalPush('t1', 'approval-id-1', longPreview);

    const messages = mockChunk.mock.calls[0][0] as {
      title: string; body: string; data: Record<string, unknown>;
    }[];
    expect(messages[0].title).toBe('Action Required');
    expect(messages[0].body.length).toBe(150);
    expect(messages[0].data['approvalId']).toBe('approval-id-1');
    expect(messages[0].data['category']).toBe('APPROVAL');
  });

  // ─── sendTaskCompletePush ─────────────────────────────────────────────────

  it('sendTaskCompletePush sends correct body (truncated to 80)', async () => {
    const queryFn = makeQueryFn([{ expo_token: 'ExponentPushToken[x]' }]);
    const svc = new PushNotificationService(queryFn);
    const longHeadline = 'B'.repeat(120);
    await svc.sendTaskCompletePush('t1', 'corr-1', longHeadline);

    const messages = mockChunk.mock.calls[0][0] as { body: string }[];
    expect(messages[0].body.length).toBe(80);
  });

  // ─── sendIntegrationDownPush ──────────────────────────────────────────────

  it('sendIntegrationDownPush includes integrationId in data', async () => {
    const queryFn = makeQueryFn([{ expo_token: 'ExponentPushToken[x]' }]);
    const svc = new PushNotificationService(queryFn);
    await svc.sendIntegrationDownPush('t1', 'gmail');

    const messages = mockChunk.mock.calls[0][0] as {
      data: Record<string, unknown>;
    }[];
    expect(messages[0].data['integrationId']).toBe('gmail');
    expect(messages[0].data['category']).toBe('SYSTEM');
  });

  // ─── sendLeadDecayPush ────────────────────────────────────────────────────

  it('sendLeadDecayPush includes contactName and daysSince in body', async () => {
    const queryFn = makeQueryFn([{ expo_token: 'ExponentPushToken[x]' }]);
    const svc = new PushNotificationService(queryFn);
    await svc.sendLeadDecayPush('t1', 'Jane Doe', 14);

    const messages = mockChunk.mock.calls[0][0] as { body: string }[];
    expect(messages[0].body).toContain('Jane Doe');
    expect(messages[0].body).toContain('14');
  });
});

// ─── createPushNotificationService factory ────────────────────────────────────

describe('createPushNotificationService', () => {
  it('returns PushNotificationService when queryFn is provided', () => {
    const queryFn = vi.fn();
    const svc = createPushNotificationService(queryFn as never);
    expect(svc).toBeInstanceOf(PushNotificationService);
  });

  it('returns null when queryFn is not provided', () => {
    const svc = createPushNotificationService();
    expect(svc).toBeNull();
  });
});
