import { BaseIntegration } from './base-integration.js';
import type { IntegrationStatus } from '../types/integrations.js';
import { IntegrationId } from '../types/integrations.js';

// ─── Shared types ────────────────────────────────────────────────────────────

export interface LatLng {
  lat: number;
  lng: number;
}

export interface DurationMatrixElement {
  status: string;
  duration:  { value: number; text: string };  // value = seconds
  distance:  { value: number; text: string };  // value = meters
}

export interface DurationMatrix {
  status: string;
  originAddresses:      string[];
  destinationAddresses: string[];
  rows: Array<{ elements: DurationMatrixElement[] }>;
}

// ─── Google Maps API response shapes ────────────────────────────────────────

interface DistanceMatrixResponse {
  status: string;
  origin_addresses:      string[];
  destination_addresses: string[];
  rows: Array<{
    elements: Array<{
      status: string;
      duration?:  { value: number; text: string };
      distance?:  { value: number; text: string };
    }>;
  }>;
}

interface GeocodeResponse {
  status: string;
  results: Array<{
    geometry: {
      location: { lat: number; lng: number };
    };
    formatted_address: string;
  }>;
}

// ─── Google Maps Integration ─────────────────────────────────────────────────

export class GoogleMapsIntegration extends BaseIntegration {
  private static readonly DISTANCE_MATRIX_URL = 'https://maps.googleapis.com/maps/api/distancematrix/json';
  private static readonly GEOCODE_URL          = 'https://maps.googleapis.com/maps/api/geocode/json';

  /**
   * Fetch an N×N drive time matrix for a set of locations.
   * Supports up to 10 origins × 10 destinations in one request (100 elements, within free tier).
   * For routes with >10 stops, batch calls externally.
   */
  async getDriveTimeMatrix(origins: LatLng[], destinations: LatLng[]): Promise<DurationMatrix> {
    const apiKey = await this.getApiKey();

    const originParam      = origins.map(p => `${p.lat},${p.lng}`).join('|');
    const destinationParam = destinations.map(p => `${p.lat},${p.lng}`).join('|');

    const params = new URLSearchParams({
      origins:      originParam,
      destinations: destinationParam,
      mode:         'driving',
      units:        'imperial',
      key:          apiKey,
    });

    const data = await this.authenticatedRequest(
      'GET',
      `${GoogleMapsIntegration.DISTANCE_MATRIX_URL}?${params}`,
    ) as DistanceMatrixResponse;

    if (data.status !== 'OK') {
      const { IntegrationError } = await import('../utils/errors.js');
      throw new IntegrationError(
        IntegrationId.GOOGLE_MAPS,
        `Distance Matrix returned status: ${data.status}`,
        null,
        data.status === 'OVER_DAILY_LIMIT' || data.status === 'OVER_QUERY_LIMIT' ? false : true,
      );
    }

    return {
      status:               data.status,
      originAddresses:      data.origin_addresses,
      destinationAddresses: data.destination_addresses,
      rows: data.rows.map(row => ({
        elements: row.elements.map(el => ({
          status:   el.status,
          duration: el.duration ?? { value: 0, text: 'unknown' },
          distance: el.distance ?? { value: 0, text: 'unknown' },
        })),
      })),
    };
  }

  /**
   * Geocode a street address to lat/lng.
   * Used as fallback when CRMLS doesn't include coordinates.
   */
  async geocodeAddress(address: string): Promise<LatLng | null> {
    const apiKey = await this.getApiKey();

    const params = new URLSearchParams({ address, key: apiKey });
    const data = await this.authenticatedRequest(
      'GET',
      `${GoogleMapsIntegration.GEOCODE_URL}?${params}`,
    ) as GeocodeResponse;

    if (data.status !== 'OK' || data.results.length === 0) return null;

    const { lat, lng } = data.results[0]!.geometry.location;
    return { lat, lng };
  }

  /**
   * Build a Google Maps multi-stop web URL for a client SMS link.
   * Uses the web URL (not app scheme) so it works universally without app install.
   *
   * Example output:
   *   https://www.google.com/maps/dir/?api=1&origin=...&destination=...&waypoints=...&travelmode=driving
   */
  static buildMultiStopUrl(origin: string, stops: string[]): string {
    if (stops.length === 0) return '';

    const destination = stops[stops.length - 1]!;
    const waypoints   = stops.slice(0, -1);

    const params = new URLSearchParams({
      api:        '1',
      origin:     origin,
      destination,
      travelmode: 'driving',
    });

    if (waypoints.length > 0) {
      params.set('waypoints', waypoints.join('|'));
    }

    return `https://www.google.com/maps/dir/?${params}`;
  }

  // ─── Health check ────────────────────────────────────────────────────────

  async healthCheck(): Promise<IntegrationStatus> {
    const key = await this.vault.retrieve(IntegrationId.GOOGLE_MAPS, 'api_key');
    if (!key) return this.notConfigured();
    try {
      // Geocode a well-known address as a canary
      const result = await this.geocodeAddress('1600 Amphitheatre Parkway, Mountain View, CA');
      if (!result) return { ...this.notConfigured(), status: 'degraded' };
      return this.connected();
    } catch {
      return { ...this.notConfigured(), status: 'disconnected' };
    }
  }

  // ─── Auth override ───────────────────────────────────────────────────────

  /** Google Maps uses query-param key, not Authorization header — override to return empty headers */
  protected override async buildAuthHeaders(): Promise<Record<string, string>> {
    return {};
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  private async getApiKey(): Promise<string> {
    const key = await this.vault.retrieve(IntegrationId.GOOGLE_MAPS, 'api_key');
    if (!key) {
      const { IntegrationError } = await import('../utils/errors.js');
      throw new IntegrationError(IntegrationId.GOOGLE_MAPS, 'No API key stored', 401, false);
    }
    return key;
  }
}
