import { BaseIntegration } from './base-integration.js';
import type { IntegrationStatus, NormalizedListing, RentCastPropertyRecord } from '../types/integrations.js';
import { IntegrationId } from '../types/integrations.js';
import type { MlsProvider, MlsCompsQuery, MarketStats } from './mls-provider.js';

// ─── RentCast API response shapes ───

interface RentCastListing {
  id?: string;
  formattedAddress?: string;
  addressLine1?: string;
  city?: string;
  zipCode?: string;
  state?: string;
  bedrooms?: number;
  bathrooms?: number;
  squareFootage?: number;
  lotSize?: number;
  yearBuilt?: number;
  price?: number;
  listingType?: string;
  listingStatus?: string;
  listedDate?: string;
  removedDate?: string;
  daysOnMarket?: number;
  propertyType?: string;
  description?: string;
  photos?: string[];
}

interface RentCastPropertyResponse {
  formattedAddress?: string;
  addressLine1?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  county?: string;
  latitude?: number;
  longitude?: number;
  propertyType?: string;
  bedrooms?: number;
  bathrooms?: number;
  squareFootage?: number;
  lotSize?: number;
  yearBuilt?: number;
  zoning?: string;
  lastSaleDate?: string;
  lastSalePrice?: number;
  ownerName?: string;
  ownerOccupied?: boolean;
  features?: {
    garage?: boolean;
    garageSpaces?: number;
    pool?: boolean;
    spa?: boolean;
    stories?: number;
    roofType?: string;
    constructionType?: string;
    foundation?: string;
    heating?: string;
    cooling?: string;
    fireplaces?: number;
  };
  hoa?: { fee?: number | null; frequency?: string | null };
  schools?: { elementary?: { district?: string } };
  taxInfo?: { assessedValue?: number; taxYear?: number; annualTaxAmount?: number };
  floodZoneType?: string;
}

interface RentCastAvmResponse {
  price?: number;
  priceRangeLow?: number;
  priceRangeHigh?: number;
}

interface RentCastMarket {
  zipCode?: string;
  averageSalePrice?: number;
  medianSalePrice?: number;
  averageDaysOnMarket?: number;
  medianDaysOnMarket?: number;
  totalListings?: number;
  averageSalePricePerSquareFoot?: number;
  saleToListRatio?: number;
}

export class RentCastIntegration extends BaseIntegration implements MlsProvider {
  // ─── MlsProvider interface ───

  async searchComps(query: MlsCompsQuery): Promise<NormalizedListing[]> {
    const { address, radiusMiles = 1, daysBack = 180, minBeds, maxBeds } = query;

    const params = new URLSearchParams({
      address,
      radius: String(radiusMiles),
      daysOld: String(daysBack),
      limit: '25',
      status: 'Sold',
      ...(minBeds !== undefined ? { bedrooms: String(minBeds) } : {}),
      ...(maxBeds !== undefined ? { bedroomsMax: String(maxBeds) } : {}),
    });

    const data = await this.authenticatedRequest(
      'GET',
      `/v1/listings/sale?${params}`,
    ) as RentCastListing[];

    return (Array.isArray(data) ? data : []).map(l => this.normalizeListing(l, 'sold'));
  }

  async getMarketStats(zipCode: string): Promise<MarketStats> {
    const params = new URLSearchParams({ zipCode, historyRange: '3' });
    const data = await this.authenticatedRequest(
      'GET',
      `/v1/markets?${params}`,
    ) as RentCastMarket;

    // Fetch active listing count separately
    const activeParams = new URLSearchParams({ zipCode, status: 'Active', limit: '1' });
    let activeListings = 0;
    let pendingListings = 0;
    let newListings = 0;
    try {
      const activeData = await this.authenticatedRequest(
        'GET',
        `/v1/listings/sale?${activeParams}`,
      ) as RentCastListing[];
      activeListings = Array.isArray(activeData) ? activeData.length : 0;

      const pendingParams = new URLSearchParams({ zipCode, status: 'Pending', limit: '1' });
      const pendingData = await this.authenticatedRequest(
        'GET',
        `/v1/listings/sale?${pendingParams}`,
      ) as RentCastListing[];
      pendingListings = Array.isArray(pendingData) ? pendingData.length : 0;

      const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
      const newParams = new URLSearchParams({ zipCode, status: 'Active', listedAfter: sevenDaysAgo, limit: '50' });
      const newData = await this.authenticatedRequest(
        'GET',
        `/v1/listings/sale?${newParams}`,
      ) as RentCastListing[];
      newListings = Array.isArray(newData) ? newData.length : 0;
    } catch {
      // supplemental counts failed — use 0, main stats still valid
    }

    const medianPrice = data.medianSalePrice ?? data.averageSalePrice ?? 0;
    const avgDom = data.medianDaysOnMarket ?? data.averageDaysOnMarket ?? 0;

    return {
      zipCode,
      medianSalePrice: medianPrice,
      avgDaysOnMarket: avgDom,
      activeListings,
      pendingListings,
      soldLast30Days: data.totalListings ?? 0,
      newListingsLast7Days: newListings,
      priceDirection: this.inferPriceDirection(data),
      asOf: new Date().toISOString(),
    };
  }

  async getActiveListings(zipCode: string, maxResults = 20): Promise<NormalizedListing[]> {
    const params = new URLSearchParams({
      zipCode,
      status: 'Active',
      limit: String(maxResults),
    });

    const data = await this.authenticatedRequest(
      'GET',
      `/v1/listings/sale?${params}`,
    ) as RentCastListing[];

    return (Array.isArray(data) ? data : []).map(l => this.normalizeListing(l, 'active'));
  }

  async getPropertyDetails(address: string, zipCode?: string): Promise<RentCastPropertyRecord> {
    const params = new URLSearchParams({ address });
    if (zipCode) params.set('zipCode', zipCode);

    const data = await this.authenticatedRequest(
      'GET',
      `/v1/properties?${params}`,
    ) as RentCastPropertyResponse;

    const f = data.features ?? {};
    return {
      address: data.formattedAddress ?? data.addressLine1 ?? address,
      city: data.city ?? '',
      state: data.state ?? '',
      zip: data.zipCode ?? zipCode ?? '',
      county: data.county,
      latitude: data.latitude,
      longitude: data.longitude,
      propertyType: data.propertyType,
      beds: data.bedrooms,
      baths: data.bathrooms,
      sqft: data.squareFootage,
      lotSqft: data.lotSize,
      yearBuilt: data.yearBuilt,
      zoning: data.zoning,
      lastSaleDate: data.lastSaleDate,
      lastSalePrice: data.lastSalePrice,
      ownerName: data.ownerName,
      ownerOccupied: data.ownerOccupied,
      garageSpaces: f.garageSpaces,
      pool: f.pool,
      spa: f.spa,
      stories: f.stories,
      roofType: f.roofType,
      constructionType: f.constructionType,
      foundation: f.foundation,
      heating: f.heating,
      cooling: f.cooling,
      fireplaces: f.fireplaces,
      hoaMonthly: data.hoa?.fee ?? null,
      schoolDistrict: data.schools?.elementary?.district,
      taxAssessedValue: data.taxInfo?.assessedValue,
      taxYear: data.taxInfo?.taxYear,
      taxAmount: data.taxInfo?.annualTaxAmount,
      floodZone: data.floodZoneType,
    };
  }

  async getAvm(address: string, zipCode?: string): Promise<{ value: number; low: number; high: number }> {
    const params = new URLSearchParams({ address });
    if (zipCode) params.set('zipCode', zipCode);

    const data = await this.authenticatedRequest(
      'GET',
      `/v1/avm/value?${params}`,
    ) as RentCastAvmResponse;

    return {
      value: data.price ?? 0,
      low: data.priceRangeLow ?? 0,
      high: data.priceRangeHigh ?? 0,
    };
  }

  /** Implements BaseIntegration abstract method — returns IntegrationStatus */
  async healthCheck(): Promise<IntegrationStatus> {
    const key = await this.vault.retrieve(IntegrationId.RENTCAST, 'api_key');
    if (!key) return this.notConfigured();
    try {
      const params = new URLSearchParams({ zipCode: '90210', limit: '1' });
      await this.authenticatedRequest('GET', `/v1/listings/sale?${params}`);
      return this.connected();
    } catch {
      return { ...this.notConfigured(), status: 'disconnected' };
    }
  }


  // ─── Overrides ───

  /** RentCast uses X-Api-Key header instead of Authorization: Bearer */
  protected override async buildAuthHeaders(): Promise<Record<string, string>> {
    const key = await this.vault.retrieve(IntegrationId.RENTCAST, 'api_key');
    if (!key) {
      const { IntegrationError } = await import('../utils/errors.js');
      throw new IntegrationError(IntegrationId.RENTCAST, 'No API key stored', 401, false);
    }
    return { 'X-Api-Key': key };
  }

  // ─── Private helpers ───

  private normalizeListing(l: RentCastListing, status: 'active' | 'pending' | 'sold'): NormalizedListing {
    const mlsStatus = status === 'sold' ? 'sold' : status === 'pending' ? 'pending' : 'active';
    return {
      mlsNumber: l.id ?? '',
      address: l.formattedAddress ?? l.addressLine1 ?? '',
      city: l.city ?? '',
      zip: l.zipCode ?? '',
      price: l.price ?? 0,
      status: mlsStatus as NormalizedListing['status'],
      beds: l.bedrooms ?? 0,
      baths: l.bathrooms ?? 0,
      sqft: l.squareFootage ?? 0,
      lotSqft: l.lotSize ?? 0,
      yearBuilt: l.yearBuilt ?? 0,
      dom: l.daysOnMarket ?? 0,
      description: l.description ?? '',
      features: [],
      photos: l.photos ?? [],
      listingAgent: { name: '', phone: '', email: '' },
      listingDate: l.listedDate ?? '',
      soldDate: l.removedDate ?? null,
      soldPrice: status === 'sold' ? (l.price ?? null) : null,
    };
  }

  private inferPriceDirection(data: RentCastMarket): 'up' | 'flat' | 'down' {
    // RentCast market endpoint doesn't provide trend directly;
    // use sale-to-list ratio as a proxy: >1 = up, <0.97 = down
    const ratio = data.saleToListRatio ?? 1;
    if (ratio > 1.01) return 'up';
    if (ratio < 0.97) return 'down';
    return 'flat';
  }
}
