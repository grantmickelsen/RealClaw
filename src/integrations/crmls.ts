import { BaseIntegration } from './base-integration.js';
import type { IntegrationStatus, NormalizedListing } from '../types/integrations.js';
import { IntegrationId } from '../types/integrations.js';
import type { MlsProvider, MlsCompsQuery, MarketStats } from './mls-provider.js';

// ─── CRMLS RESO Web API response shapes (OData) ─────────────────────────────

interface CrmlsListing {
  ListingKey?: string;
  ListingId?: string;
  UnparsedAddress?: string;
  City?: string;
  StateOrProvince?: string;
  PostalCode?: string;
  ListPrice?: number;
  BedroomsTotal?: number;
  BathroomsTotalInteger?: number;
  LivingArea?: number;
  LotSizeAcres?: number;
  YearBuilt?: number;
  DaysOnMarket?: number;
  ListAgentFullName?: string;
  ListAgentDirectPhone?: string;
  ListAgentEmail?: string;
  ShowingInstructions?: string;
  ShowingContactPhone?: string;
  Latitude?: number;
  Longitude?: number;
  Media?: Array<{ MediaURL?: string }>;
  PublicRemarks?: string;
  PoolFeatures?: string[];
  GarageSpaces?: number;
  PropertySubType?: string;
  StandardStatus?: string;
  OriginalListPrice?: number;
  ClosePrice?: number;
  CloseDate?: string;
  ListingContractDate?: string;
}

interface CrmlsODataResponse {
  value: CrmlsListing[];
  '@odata.nextLink'?: string;
}

// ─── Buyer criteria for active-listing search ────────────────────────────────

export interface BuyerCriteria {
  minPrice?: number;
  maxPrice?: number;
  minBeds?: number;
  maxBeds?: number;
  minBaths?: number;
  city?: string;
  zip?: string;
  minSqft?: number;
  maxSqft?: number;
  pool?: boolean;
  minGarageSpaces?: number;
  propertySubTypes?: string[];
  maxDaysOnMarket?: number;
}

export type ShowingType = 'go_direct' | 'contact_agent' | 'platform_booking' | 'unknown';

// ─── CRMLS Integration ───────────────────────────────────────────────────────

export class CrmlsIntegration extends BaseIntegration implements MlsProvider {
  private static readonly SELECT_FIELDS = [
    'ListingKey', 'ListingId', 'UnparsedAddress', 'City', 'StateOrProvince', 'PostalCode',
    'ListPrice', 'BedroomsTotal', 'BathroomsTotalInteger', 'LivingArea', 'LotSizeAcres',
    'YearBuilt', 'DaysOnMarket', 'ListAgentFullName', 'ListAgentDirectPhone', 'ListAgentEmail',
    'ShowingInstructions', 'ShowingContactPhone', 'Latitude', 'Longitude',
    'Media', 'PublicRemarks', 'PoolFeatures', 'GarageSpaces', 'PropertySubType',
    'StandardStatus', 'ListingContractDate', 'ClosePrice', 'CloseDate', 'OriginalListPrice',
  ].join(',');

  // ─── MlsProvider interface ───────────────────────────────────────────────

  async searchComps(query: MlsCompsQuery): Promise<NormalizedListing[]> {
    const { address, daysBack = 180, minBeds, maxBeds } = query;

    const filters: string[] = [
      `StandardStatus eq 'Closed'`,
      `CloseDate ge ${new Date(Date.now() - daysBack * 86_400_000).toISOString().slice(0, 10)}`,
    ];
    if (minBeds !== undefined) filters.push(`BedroomsTotal ge ${minBeds}`);
    if (maxBeds !== undefined) filters.push(`BedroomsTotal le ${maxBeds}`);

    // Simple city match — CRMLS doesn't support radius on OData directly
    const cityMatch = address.split(',')[1]?.trim();
    if (cityMatch) filters.push(`City eq '${cityMatch}'`);

    const listings = await this.queryListings(filters.join(' and '), 25);
    return listings.map(l => this.normalizeListing(l, 'sold'));
  }

  async getMarketStats(zipCode: string): Promise<MarketStats> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const sevenDaysAgo  = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);

    const [active, pending, recentlyClosed, newListings] = await Promise.all([
      this.queryListings(`PostalCode eq '${zipCode}' and StandardStatus eq 'Active'`, 200),
      this.queryListings(`PostalCode eq '${zipCode}' and StandardStatus eq 'Pending'`, 200),
      this.queryListings(`PostalCode eq '${zipCode}' and StandardStatus eq 'Closed' and CloseDate ge ${thirtyDaysAgo}`, 200),
      this.queryListings(`PostalCode eq '${zipCode}' and StandardStatus eq 'Active' and ListingContractDate ge ${sevenDaysAgo}`, 200),
    ]);

    const prices = recentlyClosed.map(l => l.ClosePrice ?? 0).filter(p => p > 0);
    const medianSalePrice = prices.length > 0 ? this.median(prices) : 0;

    const domValues = active.map(l => l.DaysOnMarket ?? 0).filter(d => d > 0);
    const avgDaysOnMarket = domValues.length > 0
      ? domValues.reduce((a, b) => a + b, 0) / domValues.length
      : 0;

    return {
      zipCode,
      medianSalePrice,
      avgDaysOnMarket: Math.round(avgDaysOnMarket),
      activeListings: active.length,
      pendingListings: pending.length,
      soldLast30Days: recentlyClosed.length,
      newListingsLast7Days: newListings.length,
      priceDirection: 'flat',
      asOf: new Date().toISOString(),
    };
  }

  async getActiveListings(zipCode: string, maxResults = 20): Promise<NormalizedListing[]> {
    const listings = await this.queryListings(
      `PostalCode eq '${zipCode}' and StandardStatus eq 'Active'`,
      maxResults,
    );
    return listings.map(l => this.normalizeListing(l, 'active'));
  }

  // ─── CRMLS-specific: buyer criteria search ───────────────────────────────

  async searchByBuyerCriteria(criteria: BuyerCriteria, maxResults = 30): Promise<NormalizedListing[]> {
    const filters: string[] = [`StandardStatus eq 'Active'`];

    if (criteria.maxPrice !== undefined) filters.push(`ListPrice le ${criteria.maxPrice}`);
    if (criteria.minPrice !== undefined) filters.push(`ListPrice ge ${criteria.minPrice}`);
    if (criteria.minBeds  !== undefined) filters.push(`BedroomsTotal ge ${criteria.minBeds}`);
    if (criteria.maxBeds  !== undefined) filters.push(`BedroomsTotal le ${criteria.maxBeds}`);
    if (criteria.minBaths !== undefined) filters.push(`BathroomsTotalInteger ge ${criteria.minBaths}`);
    if (criteria.minSqft  !== undefined) filters.push(`LivingArea ge ${criteria.minSqft}`);
    if (criteria.maxSqft  !== undefined) filters.push(`LivingArea le ${criteria.maxSqft}`);
    if (criteria.city)                   filters.push(`City eq '${criteria.city}'`);
    if (criteria.zip)                    filters.push(`PostalCode eq '${criteria.zip}'`);
    if (criteria.maxDaysOnMarket !== undefined) filters.push(`DaysOnMarket le ${criteria.maxDaysOnMarket}`);
    if (criteria.minGarageSpaces !== undefined) filters.push(`GarageSpaces ge ${criteria.minGarageSpaces}`);

    if (criteria.propertySubTypes && criteria.propertySubTypes.length > 0) {
      const subTypeFilter = criteria.propertySubTypes
        .map(t => `PropertySubType eq '${t}'`)
        .join(' or ');
      filters.push(`(${subTypeFilter})`);
    }

    const listings = await this.queryListings(filters.join(' and '), maxResults);
    return listings.map(l => this.normalizeListing(l, 'active'));
  }

  // ─── Health check ────────────────────────────────────────────────────────

  async healthCheck(): Promise<IntegrationStatus> {
    const token = await this.vault.retrieve(IntegrationId.CRMLS, 'access_token');
    if (!token) return this.notConfigured();
    try {
      await this.queryListings(`StandardStatus eq 'Active'`, 1);
      return this.connected();
    } catch {
      return { ...this.notConfigured(), status: 'disconnected' };
    }
  }

  // ─── OAuth2 token refresh ────────────────────────────────────────────────

  protected override async handleUnauthorized(): Promise<void> {
    const clientId     = await this.vault.retrieve(IntegrationId.CRMLS, 'client_id');
    const clientSecret = await this.vault.retrieve(IntegrationId.CRMLS, 'client_secret');
    if (!clientId || !clientSecret) {
      const { IntegrationError } = await import('../utils/errors.js');
      throw new IntegrationError(IntegrationId.CRMLS, 'No OAuth2 credentials stored', 401, false);
    }

    const tokenUrl = `${this.config.baseUrl}/oauth2/token`;
    const body = new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     clientId,
      client_secret: clientSecret,
    });

    const res = await fetch(tokenUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    body.toString(),
    });

    if (!res.ok) {
      const { IntegrationError } = await import('../utils/errors.js');
      throw new IntegrationError(IntegrationId.CRMLS, `Token refresh failed: ${res.status}`, res.status, false);
    }

    const data = await res.json() as { access_token: string; expires_in?: number };
    await this.vault.store(IntegrationId.CRMLS, 'access_token', data.access_token);
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  private async queryListings(filter: string, top: number): Promise<CrmlsListing[]> {
    const params = new URLSearchParams({
      $filter:  filter,
      $top:     String(top),
      $select:  CrmlsIntegration.SELECT_FIELDS,
      $expand:  'Media($select=MediaURL)',
    });

    const data = await this.authenticatedRequest(
      'GET',
      `/reso/odata/Property?${params}`,
    ) as CrmlsODataResponse;

    return Array.isArray(data?.value) ? data.value : [];
  }

  private normalizeListing(l: CrmlsListing, status: 'active' | 'pending' | 'sold'): NormalizedListing {
    const photos = (l.Media ?? [])
      .map(m => m.MediaURL)
      .filter((u): u is string => Boolean(u));

    const hasPool = Array.isArray(l.PoolFeatures) && l.PoolFeatures.length > 0 &&
      !l.PoolFeatures.every(f => f === 'None');

    const showingType = classifyShowingType(l.ShowingInstructions ?? '');

    return {
      mlsNumber:    l.ListingId ?? l.ListingKey ?? '',
      address:      l.UnparsedAddress ?? '',
      city:         l.City ?? '',
      zip:          l.PostalCode ?? '',
      price:        l.ListPrice ?? 0,
      status:       status === 'sold' ? 'sold' : status === 'pending' ? 'pending' : 'active',
      beds:         l.BedroomsTotal ?? 0,
      baths:        l.BathroomsTotalInteger ?? 0,
      sqft:         l.LivingArea ?? 0,
      lotSqft:      l.LotSizeAcres ? Math.round(l.LotSizeAcres * 43_560) : 0,
      yearBuilt:    l.YearBuilt ?? 0,
      dom:          l.DaysOnMarket ?? 0,
      description:  l.PublicRemarks ?? '',
      features:     [],
      photos,
      listingAgent: {
        name:  l.ListAgentFullName ?? '',
        phone: l.ListAgentDirectPhone ?? l.ShowingContactPhone ?? '',
        email: l.ListAgentEmail ?? '',
      },
      listingDate:         l.ListingContractDate ?? '',
      soldDate:            l.CloseDate ?? null,
      soldPrice:           status === 'sold' ? (l.ClosePrice ?? null) : null,
      showingInstructions: l.ShowingInstructions,
      showingType,
      latitude:     l.Latitude,
      longitude:    l.Longitude,
      pool:         hasPool,
      garageSpaces: l.GarageSpaces,
    };
  }

  private median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? ((sorted[mid - 1]! + sorted[mid]!) / 2)
      : sorted[mid]!;
  }
}

// ─── Showing type classifier (exported for testing) ──────────────────────────

export function classifyShowingType(instructions: string): ShowingType {
  if (!instructions) return 'unknown';
  if (/go.?direct|supra|lockbox/i.test(instructions))                  return 'go_direct';
  if (/showingtime|brokerBay|showing\.com/i.test(instructions))        return 'platform_booking';
  if (/text|call|contact.?agent|appointment|48.?hour|24.?hour/i.test(instructions)) return 'contact_agent';
  return 'unknown';
}
