import type { GoogleMapsIntegration } from '../../integrations/google-maps.js';
import { GoogleMapsIntegration as GMI } from '../../integrations/google-maps.js';
import type { DurationMatrix } from '../../integrations/google-maps.js';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface RouteStop {
  id: string;
  address: string;
  latitude?: number;
  longitude?: number;
  /** ISO datetime — locked slot (e.g. confirmed ShowingTime booking). */
  fixedTime?: string;
  durationMinutes: number;
}

export interface RouteInput {
  origin: string;
  stops: RouteStop[];
  /** ISO datetime — when the tour starts. Defaults to now. */
  startTime?: string;
}

export interface OrderedStop {
  id: string;
  address: string;
  latitude?: number;
  longitude?: number;
  sequenceOrder: number;
  scheduledTime: string;  // ISO datetime
  durationMinutes: number;
  fixedTime?: string;
}

export interface RouteOutput {
  orderedStops: OrderedStop[];
  totalDistanceMiles: number;
  totalDurationMinutes: number;
  /** Google Maps multi-stop web URL for client SMS link. */
  mapsUrl: string;
  warnings: string[];
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function optimizeRoute(
  input: RouteInput,
  mapsIntegration: GoogleMapsIntegration,
): Promise<RouteOutput> {
  const warnings: string[] = [];
  const stops = input.stops.map(s => ({ ...s })); // shallow copy — don't mutate input

  if (stops.length === 0) {
    return { orderedStops: [], totalDistanceMiles: 0, totalDurationMinutes: 0, mapsUrl: '', warnings: ['No stops provided'] };
  }

  // 1. Geocode stops that are missing coordinates
  await Promise.allSettled(
    stops.map(async (stop) => {
      if (stop.latitude == null || stop.longitude == null) {
        const coords = await mapsIntegration.geocodeAddress(stop.address);
        if (coords) {
          stop.latitude = coords.lat;
          stop.longitude = coords.lng;
        } else {
          warnings.push(`Could not geocode: ${stop.address}`);
        }
      }
    }),
  );

  // Separate geocoded from ungeocoded — ungeocoded appended at the end
  const geocodedStops = stops.filter(s => s.latitude != null && s.longitude != null);
  const ungeocodedStops = stops.filter(s => s.latitude == null || s.longitude == null);

  if (ungeocodedStops.length > 0) {
    warnings.push(`${ungeocodedStops.length} stop(s) could not be geocoded — placed at end of route`);
  }

  if (geocodedStops.length === 0) {
    return fallbackSequential(stops, input.startTime, warnings);
  }

  // 2. Geocode origin
  const originCoords = await mapsIntegration.geocodeAddress(input.origin);
  if (!originCoords) {
    warnings.push(`Could not geocode origin address — using sequential order`);
    return fallbackSequential(stops, input.startTime, warnings);
  }

  // 3. Fetch drive-time matrix
  // rows: [origin, stop[0], stop[1], ..., stop[N-1]]
  // cols: [stop[0], stop[1], ..., stop[N-1]]
  let matrix: DurationMatrix;
  try {
    const allOrigins = [originCoords, ...geocodedStops.map(s => ({ lat: s.latitude!, lng: s.longitude! }))];
    const allDests  = geocodedStops.map(s => ({ lat: s.latitude!, lng: s.longitude! }));
    matrix = await mapsIntegration.getDriveTimeMatrix(allOrigins, allDests);
  } catch {
    warnings.push('Drive-time matrix request failed — using sequential order');
    return fallbackSequential(stops, input.startTime, warnings);
  }

  // 4. Nearest-neighbor heuristic with fixed-time anchoring
  const startMs = input.startTime ? new Date(input.startTime).getTime() : Date.now();
  const orderedIndices = buildOrderedIndices(geocodedStops, matrix, startMs, warnings);

  // 5. Build final ordered stops with recalculated ETAs
  const orderedGeo = buildOrderedStops(geocodedStops, orderedIndices, matrix, startMs, warnings);

  // 6. Append ungeocoded stops at end
  let tailMs = orderedGeo.length > 0
    ? new Date(orderedGeo[orderedGeo.length - 1]!.scheduledTime).getTime() +
      orderedGeo[orderedGeo.length - 1]!.durationMinutes * 60_000
    : startMs;

  const allOrdered: OrderedStop[] = [...orderedGeo];
  for (const stop of ungeocodedStops) {
    allOrdered.push({
      id:            stop.id,
      address:       stop.address,
      sequenceOrder: allOrdered.length,
      scheduledTime: new Date(tailMs).toISOString(),
      durationMinutes: stop.durationMinutes,
      fixedTime:     stop.fixedTime,
    });
    tailMs += stop.durationMinutes * 60_000;
  }

  // 7. Compute aggregate metrics
  const { totalDriveSecs, totalDistanceMeters } = sumMatrix(orderedIndices, matrix);
  const totalStopMinutes = allOrdered.reduce((acc, s) => acc + s.durationMinutes, 0);
  const totalDurationMinutes = Math.round(totalDriveSecs / 60) + totalStopMinutes;
  const totalDistanceMiles  = Math.round((totalDistanceMeters / 1609.34) * 10) / 10;
  const mapsUrl = GMI.buildMultiStopUrl(input.origin, allOrdered.map(s => s.address));

  return { orderedStops: allOrdered, totalDistanceMiles, totalDurationMinutes, mapsUrl, warnings };
}

// ─── Nearest-neighbor with fixed-time anchoring ────────────────────────────────

/**
 * Returns the ordered indices into `stops` (geocoded stops only).
 * Algorithm:
 *   - Fixed-time stops are anchored in chronological order.
 *   - Flexible stops are inserted greedily (nearest-neighbor) in each gap
 *     between fixed stops, as long as they don't push a fixed stop late.
 *   - Any flexible stop that cannot fit before a fixed deadline is placed
 *     in the next available gap or appended at the end.
 */
function buildOrderedIndices(
  stops: RouteStop[],
  matrix: DurationMatrix,
  startMs: number,
  warnings: string[],
): number[] {
  const N = stops.length;
  const visited = new Array<boolean>(N).fill(false);
  const ordered: number[] = [];

  // Indices of fixed-time stops sorted chronologically
  const fixedIdxs = stops
    .map((s, i) => (s.fixedTime ? i : -1))
    .filter(i => i !== -1)
    .sort((a, b) => new Date(stops[a]!.fixedTime!).getTime() - new Date(stops[b]!.fixedTime!).getTime());

  const flexIdxs = stops.map((_, i) => i).filter(i => !fixedIdxs.includes(i));

  let currentMs = startMs;
  let currentRowIdx = 0; // 0 = origin in matrix

  // Helper: drive time in ms from currentRowIdx to stop j
  const driveMsTo = (j: number): number =>
    (matrix.rows[currentRowIdx]?.elements[j]?.duration.value ?? 0) * 1000;

  // Helper: drive time in ms from stop a to stop b
  const driveMsBetween = (a: number, b: number): number =>
    (matrix.rows[a + 1]?.elements[b]?.duration.value ?? 0) * 1000;

  // Process each fixed-time anchor
  for (const fixedIdx of fixedIdxs) {
    const fixedDeadline = new Date(stops[fixedIdx]!.fixedTime!).getTime();

    // Greedily insert flexible stops that fit before this fixed stop
    let inserted = true;
    while (inserted) {
      inserted = false;
      let bestFlex = -1;
      let bestDrive = Infinity;

      for (const flexIdx of flexIdxs) {
        if (visited[flexIdx]) continue;

        const driveToFlex = driveMsTo(flexIdx);
        const arriveAtFlex = currentMs + driveToFlex;
        const departFlex = arriveAtFlex + stops[flexIdx]!.durationMinutes * 60_000;
        const driveFlexToFixed = driveMsBetween(flexIdx, fixedIdx);
        const arriveAtFixed = departFlex + driveFlexToFixed;

        // Only insert if we still arrive at the fixed stop ≤ 5 min late
        if (arriveAtFixed <= fixedDeadline + 5 * 60_000 && driveToFlex < bestDrive) {
          bestDrive = driveToFlex;
          bestFlex = flexIdx;
        }
      }

      if (bestFlex !== -1) {
        ordered.push(bestFlex);
        visited[bestFlex] = true;
        currentMs += driveMsTo(bestFlex) + stops[bestFlex]!.durationMinutes * 60_000;
        currentRowIdx = bestFlex + 1;
        inserted = true;
      }
    }

    // Now visit the fixed stop
    const driveToFixed = driveMsTo(fixedIdx);
    const arriveAtFixed = currentMs + driveToFixed;
    if (arriveAtFixed > fixedDeadline + 5 * 60_000) {
      warnings.push(`${stops[fixedIdx]!.address}: cannot reach by scheduled time ${stops[fixedIdx]!.fixedTime}`);
    }
    currentMs = Math.max(arriveAtFixed, fixedDeadline) + stops[fixedIdx]!.durationMinutes * 60_000;
    ordered.push(fixedIdx);
    visited[fixedIdx] = true;
    currentRowIdx = fixedIdx + 1;
  }

  // Append remaining flexible stops nearest-neighbor from current position
  const remaining = flexIdxs.filter(i => !visited[i]);
  const unvisited = new Set(remaining);

  while (unvisited.size > 0) {
    let bestFlex = -1;
    let bestDrive = Infinity;
    for (const flexIdx of unvisited) {
      const d = driveMsTo(flexIdx);
      if (d < bestDrive) { bestDrive = d; bestFlex = flexIdx; }
    }
    if (bestFlex === -1) break;

    ordered.push(bestFlex);
    visited[bestFlex] = true;
    unvisited.delete(bestFlex);
    currentMs += bestDrive + stops[bestFlex]!.durationMinutes * 60_000;
    currentRowIdx = bestFlex + 1;
  }

  return ordered;
}

// ─── ETA calculation from ordered indices ─────────────────────────────────────

function buildOrderedStops(
  stops: RouteStop[],
  orderedIndices: number[],
  matrix: DurationMatrix,
  startMs: number,
  _warnings: string[],
): OrderedStop[] {
  let etaMs = startMs;
  let prevStopIdx = -1; // -1 = origin (matrix row 0)

  return orderedIndices.map((stopIdx, seqIdx) => {
    const stop = stops[stopIdx]!;
    const fromRow = prevStopIdx + 1; // -1+1=0 (origin), i+1 (stop i)
    const driveSecs = matrix.rows[fromRow]?.elements[stopIdx]?.duration.value ?? 0;
    etaMs += driveSecs * 1000;

    const scheduledMs = stop.fixedTime
      ? Math.max(etaMs, new Date(stop.fixedTime).getTime())
      : etaMs;

    etaMs = scheduledMs + stop.durationMinutes * 60_000;
    prevStopIdx = stopIdx;

    return {
      id:            stop.id,
      address:       stop.address,
      latitude:      stop.latitude,
      longitude:     stop.longitude,
      sequenceOrder: seqIdx,
      scheduledTime: new Date(scheduledMs).toISOString(),
      durationMinutes: stop.durationMinutes,
      fixedTime:     stop.fixedTime,
    };
  });
}

// ─── Aggregate drive distance/time along the ordered route ────────────────────

function sumMatrix(orderedIndices: number[], matrix: DurationMatrix): { totalDriveSecs: number; totalDistanceMeters: number } {
  let totalDriveSecs = 0;
  let totalDistanceMeters = 0;

  for (let i = 0; i < orderedIndices.length; i++) {
    const toIdx = orderedIndices[i]!;
    const fromRow = i === 0 ? 0 : orderedIndices[i - 1]! + 1;
    const el = matrix.rows[fromRow]?.elements[toIdx];
    totalDriveSecs     += el?.duration.value ?? 0;
    totalDistanceMeters += el?.distance.value ?? 0;
  }

  return { totalDriveSecs, totalDistanceMeters };
}

// ─── Fallback: sequential order with no optimisation ─────────────────────────

function fallbackSequential(stops: RouteStop[], startTime: string | undefined, warnings: string[]): RouteOutput {
  const startMs = startTime ? new Date(startTime).getTime() : Date.now();
  let currentMs = startMs;

  const orderedStops: OrderedStop[] = stops.map((stop, i) => {
    const scheduledMs = stop.fixedTime
      ? Math.max(currentMs, new Date(stop.fixedTime).getTime())
      : currentMs;
    currentMs = scheduledMs + stop.durationMinutes * 60_000;
    return {
      id:            stop.id,
      address:       stop.address,
      latitude:      stop.latitude,
      longitude:     stop.longitude,
      sequenceOrder: i,
      scheduledTime: new Date(scheduledMs).toISOString(),
      durationMinutes: stop.durationMinutes,
      fixedTime:     stop.fixedTime,
    };
  });

  const totalDurationMinutes = stops.reduce((acc, s) => acc + s.durationMinutes, 0);
  const mapsUrl = GMI.buildMultiStopUrl(stops[0]?.address ?? '', stops.slice(1).map(s => s.address));

  return { orderedStops, totalDistanceMiles: 0, totalDurationMinutes, mapsUrl, warnings };
}
