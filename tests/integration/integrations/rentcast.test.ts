import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { RentCastIntegration } from '../../../src/integrations/rentcast.js';
import { CredentialVault } from '../../../src/credentials/vault.js';
import { RateLimiter } from '../../../src/middleware/rate-limiter.js';
import { AuditLogger } from '../../../src/middleware/audit-logger.js';
import { IntegrationId } from '../../../src/types/integrations.js';
import type { IntegrationConfig } from '../../../src/types/integrations.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

// ─── Test setup ───

let tmpDir: string;
let vault: CredentialVault;
let rateLimiter: RateLimiter;
let auditLogger: AuditLogger;
let integration: RentCastIntegration;

const mockConfig: IntegrationConfig = {
  id: IntegrationId.RENTCAST,
  authMethod: 'api_key',
  owningAgent: 'research' as never,
  baseUrl: 'https://api.rentcast.io',
  rateLimitPerMinute: 60,
  enabled: true,
};

const mockListing = {
  id: 'listing-001',
  formattedAddress: '123 Oak St, Ventura, CA 93001',
  city: 'Ventura',
  zipCode: '93001',
  state: 'CA',
  bedrooms: 3,
  bathrooms: 2,
  squareFootage: 1500,
  lotSize: 6000,
  yearBuilt: 1985,
  price: 750000,
  listingStatus: 'Sold',
  daysOnMarket: 14,
  listedDate: '2024-10-01T00:00:00Z',
  removedDate: '2024-10-15T00:00:00Z',
};

const mockMarket = {
  zipCode: '93001',
  medianSalePrice: 725000,
  averageSalePrice: 740000,
  medianDaysOnMarket: 18,
  averageDaysOnMarket: 22,
  totalListings: 45,
  saleToListRatio: 1.02,
};

const server = setupServer(
  http.get('https://api.rentcast.io/v1/listings/sale', () =>
    HttpResponse.json([mockListing]),
  ),
  http.get('https://api.rentcast.io/v1/markets', () =>
    HttpResponse.json(mockMarket),
  ),
);

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claw-rentcast-test-'));
  const masterKey = crypto.randomBytes(32).toString('base64');
  process.env.CLAW_VAULT_MASTER_KEY = masterKey;

  vault = new CredentialVault(tmpDir);
  await vault.store(IntegrationId.RENTCAST, 'api_key', 'rc_test_key_123');

  rateLimiter = new RateLimiter();
  auditLogger = new AuditLogger(tmpDir);
  integration = new RentCastIntegration(mockConfig, vault, rateLimiter, auditLogger);

  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(async () => {
  server.resetHandlers();
  server.close();
  await fs.rm(tmpDir, { recursive: true, force: true });
  delete process.env.CLAW_VAULT_MASTER_KEY;
});

describe('RentCastIntegration', () => {
  it('searchComps returns normalized NormalizedListing array', async () => {
    const comps = await integration.searchComps({ address: '123 Oak St, Ventura, CA 93001' });

    expect(comps).toHaveLength(1);
    expect(comps[0].address).toBe('123 Oak St, Ventura, CA 93001');
    expect(comps[0].price).toBe(750000);
    expect(comps[0].beds).toBe(3);
    expect(comps[0].baths).toBe(2);
    expect(comps[0].sqft).toBe(1500);
    expect(comps[0].dom).toBe(14);
    expect(comps[0].status).toBe('sold');
  });

  it('getMarketStats returns correct MarketStats shape', async () => {
    server.use(
      http.get('https://api.rentcast.io/v1/listings/sale', () =>
        HttpResponse.json([mockListing]),
      ),
    );

    const stats = await integration.getMarketStats('93001');

    expect(stats.zipCode).toBe('93001');
    expect(stats.medianSalePrice).toBe(725000);
    expect(stats.avgDaysOnMarket).toBe(18);
    expect(stats.priceDirection).toBe('up'); // saleToListRatio 1.02 > 1.01
    expect(typeof stats.asOf).toBe('string');
  });

  it('getActiveListings returns listings with active status', async () => {
    const listings = await integration.getActiveListings('93001');

    expect(Array.isArray(listings)).toBe(true);
    expect(listings.length).toBeGreaterThanOrEqual(0);
  });

  it('sends API key as X-Api-Key header', async () => {
    let capturedHeaders: Headers | undefined;

    server.use(
      http.get('https://api.rentcast.io/v1/listings/sale', ({ request }) => {
        capturedHeaders = request.headers;
        return HttpResponse.json([mockListing]);
      }),
    );

    await integration.searchComps({ address: '123 Main St' });

    expect(capturedHeaders?.get('x-api-key')).toBe('rc_test_key_123');
  });

  it('healthCheck returns connected when API responds 200', async () => {
    const status = await integration.healthCheck();
    expect(status.status).toBe('connected');
  });

  it('healthCheck returns not_configured when no api_key in vault', async () => {
    // Create a fresh vault with no stored key
    const emptyVaultDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claw-rc-empty-'));
    const emptyVault = new CredentialVault(emptyVaultDir);
    const freshIntegration = new RentCastIntegration(mockConfig, emptyVault, rateLimiter, auditLogger);

    const status = await freshIntegration.healthCheck();
    expect(status.status).toBe('not_configured');

    await fs.rm(emptyVaultDir, { recursive: true, force: true });
  });

  it('healthCheck returns disconnected when API returns 401', async () => {
    server.use(
      http.get('https://api.rentcast.io/v1/listings/sale', () =>
        HttpResponse.json({ message: 'Unauthorized' }, { status: 401 }),
      ),
    );

    const status = await integration.healthCheck();
    expect(status.status).toBe('disconnected');
  });

  it('priceDirection is down when saleToListRatio < 0.97', async () => {
    server.use(
      http.get('https://api.rentcast.io/v1/markets', () =>
        HttpResponse.json({ ...mockMarket, saleToListRatio: 0.94 }),
      ),
    );

    const stats = await integration.getMarketStats('93001');
    expect(stats.priceDirection).toBe('down');
  });

  it('priceDirection is flat when saleToListRatio between 0.97 and 1.01', async () => {
    server.use(
      http.get('https://api.rentcast.io/v1/markets', () =>
        HttpResponse.json({ ...mockMarket, saleToListRatio: 0.99 }),
      ),
    );

    const stats = await integration.getMarketStats('93001');
    expect(stats.priceDirection).toBe('flat');
  });

  it('searchComps handles empty array response gracefully', async () => {
    server.use(
      http.get('https://api.rentcast.io/v1/listings/sale', () =>
        HttpResponse.json([]),
      ),
    );

    const comps = await integration.searchComps({ address: '999 Nowhere St' });
    expect(comps).toHaveLength(0);
  });
});
