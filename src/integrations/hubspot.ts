import { BaseIntegration } from './base-integration.js';
import type { IntegrationStatus, NormalizedContact } from '../types/integrations.js';
import { IntegrationId } from '../types/integrations.js';

export class HubSpotIntegration extends BaseIntegration {
  async healthCheck(): Promise<IntegrationStatus> {
    const token = await this.vault.retrieve(IntegrationId.HUBSPOT, 'access_token');
    if (!token) return this.notConfigured();
    try {
      await this.authenticatedRequest('GET', '/crm/v3/objects/contacts?limit=1');
      return this.connected();
    } catch {
      return { ...this.notConfigured(), status: 'disconnected' };
    }
  }

  async listContacts(limit = 100, after?: string): Promise<NormalizedContact[]> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (after) params.set('after', after);

    const data = await this.authenticatedRequest(
      'GET',
      `/crm/v3/objects/contacts?${params}&properties=firstname,lastname,email,phone,hs_lead_status,hs_lifecyclestage`,
    ) as HubSpotListResponse;

    return (data.results ?? []).map(c => this.normalizeContact(c));
  }

  async getContact(contactId: string): Promise<NormalizedContact> {
    const data = await this.authenticatedRequest(
      'GET',
      `/crm/v3/objects/contacts/${contactId}?properties=firstname,lastname,email,phone,hs_lead_status,notes_last_updated`,
    ) as HubSpotContact;
    return this.normalizeContact(data);
  }

  async createContact(contact: Partial<NormalizedContact>): Promise<{ id: string }> {
    const data = await this.authenticatedRequest('POST', '/crm/v3/objects/contacts', {
      properties: {
        firstname: contact.firstName ?? '',
        lastname: contact.lastName ?? '',
        email: contact.email ?? '',
        phone: contact.phone ?? '',
      },
    }) as { id: string };
    return { id: data.id };
  }

  async updateContact(contactId: string, updates: Partial<NormalizedContact>): Promise<void> {
    await this.authenticatedRequest('PATCH', `/crm/v3/objects/contacts/${contactId}`, {
      properties: {
        ...(updates.firstName && { firstname: updates.firstName }),
        ...(updates.lastName && { lastname: updates.lastName }),
        ...(updates.email && { email: updates.email }),
        ...(updates.phone && { phone: updates.phone }),
        ...(updates.stage && { hs_lead_status: updates.stage }),
      },
    });
  }

  async addNote(contactId: string, note: string): Promise<void> {
    // Create note engagement
    await this.authenticatedRequest('POST', '/crm/v3/objects/notes', {
      properties: {
        hs_note_body: note,
        hs_timestamp: Date.now(),
      },
      associations: [{
        to: { id: contactId },
        types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }],
      }],
    });
  }

  private normalizeContact(c: HubSpotContact): NormalizedContact {
    const p = c.properties ?? {};
    return {
      contactId: c.id,
      source: IntegrationId.HUBSPOT,
      firstName: p['firstname'] ?? '',
      lastName: p['lastname'] ?? '',
      email: p['email'] ?? null,
      phone: p['phone'] ?? null,
      tags: [],
      stage: p['hs_lifecyclestage'] ?? p['hs_lead_status'] ?? null,
      notes: p['notes_last_updated'] ?? '',
      createdAt: c.createdAt ?? new Date().toISOString(),
      updatedAt: c.updatedAt ?? new Date().toISOString(),
      customFields: {},
    };
  }
}

// ─── HubSpot API Types ───

interface HubSpotContact {
  id: string;
  properties?: Record<string, string>;
  createdAt?: string;
  updatedAt?: string;
}

interface HubSpotListResponse {
  results?: HubSpotContact[];
  paging?: { next?: { after: string } };
}
