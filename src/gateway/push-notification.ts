import { Expo, type ExpoPushMessage } from 'expo-server-sdk';

type QueryFn = (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

export class PushNotificationService {
  private readonly expo: Expo;

  constructor(
    private readonly queryFn: QueryFn,
    expo?: Expo,
  ) {
    this.expo = expo ?? new Expo();
  }

  /**
   * Register an Expo push token for a tenant user.
   * Idempotent — ON CONFLICT updates platform only.
   */
  async registerDevice(
    tenantId: string,
    userId: string,
    expoPushToken: string,
    platform: 'ios' | 'android',
  ): Promise<void> {
    if (!Expo.isExpoPushToken(expoPushToken)) {
      throw new Error(`Invalid Expo push token: ${expoPushToken}`);
    }
    await this.queryFn(
      `INSERT INTO tenant_device_tokens (tenant_id, user_id, expo_token, platform)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (expo_token) DO UPDATE SET platform = EXCLUDED.platform`,
      [tenantId, userId, expoPushToken, platform],
    );
  }

  /** Send a push message to all registered devices for a tenant. No-op if no tokens. */
  async sendToTenant(tenantId: string, message: Omit<ExpoPushMessage, 'to'>): Promise<void> {
    const tokens = await this.getDeviceTokens(tenantId);
    if (!tokens.length) return;

    const messages: ExpoPushMessage[] = tokens.map(token => ({ ...message, to: token }));
    const chunks = this.expo.chunkPushNotifications(messages);
    for (const chunk of chunks) {
      try {
        await this.expo.sendPushNotificationsAsync(chunk);
      } catch (err) {
        console.error('[Push] Failed to send chunk:', err);
      }
    }
  }

  async sendApprovalPush(tenantId: string, approvalId: string, preview: string): Promise<void> {
    await this.sendToTenant(tenantId, {
      title: 'Action Required',
      body: preview.slice(0, 150),
      data: { approvalId, category: 'APPROVAL' },
      categoryId: 'APPROVAL',
      mutableContent: true,
    });
  }

  async sendTaskCompletePush(tenantId: string, correlationId: string, headline: string): Promise<void> {
    await this.sendToTenant(tenantId, {
      title: 'Task Complete',
      body: headline.slice(0, 80),
      data: { correlationId, category: 'BRIEFING' },
    });
  }

  async sendIntegrationDownPush(tenantId: string, integrationId: string): Promise<void> {
    await this.sendToTenant(tenantId, {
      title: 'Integration Disconnected',
      body: `Your ${integrationId} connection needs to be renewed.`,
      data: { integrationId, category: 'SYSTEM' },
    });
  }

  async sendLeadDecayPush(tenantId: string, contactName: string, daysSince: number): Promise<void> {
    await this.sendToTenant(tenantId, {
      title: 'Lead Follow-up',
      body: `${contactName} hasn't been contacted in ${daysSince} days.`,
      data: { contactName, daysSince, category: 'LEAD_ALERT' },
    });
  }

  private async getDeviceTokens(tenantId: string): Promise<string[]> {
    const result = await this.queryFn(
      `SELECT expo_token FROM tenant_device_tokens WHERE tenant_id = $1`,
      [tenantId],
    );
    return result.rows.map(r => r['expo_token'] as string);
  }
}

/**
 * Returns a PushNotificationService when a queryFn is provided, null otherwise.
 * Callers must null-check before using.
 */
export function createPushNotificationService(queryFn?: QueryFn): PushNotificationService | null {
  return queryFn ? new PushNotificationService(queryFn) : null;
}
