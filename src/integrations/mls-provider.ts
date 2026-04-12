import type { NormalizedListing } from '../types/integrations.js';

export interface MlsCompsQuery {
  address: string;
  radiusMiles?: number;   // default 1
  daysBack?: number;      // default 180
  minBeds?: number;
  maxBeds?: number;
}

export interface MarketStats {
  zipCode: string;
  medianSalePrice: number;
  avgDaysOnMarket: number;
  activeListings: number;
  pendingListings: number;
  soldLast30Days: number;
  newListingsLast7Days: number;
  priceDirection: 'up' | 'flat' | 'down';
  asOf: string;  // ISO-8601
}

/** Provider-agnostic interface for listing data sources (RentCast, ATTOM, Trestle, etc.) */
export interface MlsProvider {
  searchComps(query: MlsCompsQuery): Promise<NormalizedListing[]>;
  getMarketStats(zipCode: string): Promise<MarketStats>;
  getActiveListings(zipCode: string, maxResults?: number): Promise<NormalizedListing[]>;
}
