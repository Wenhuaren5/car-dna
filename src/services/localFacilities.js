import {loadFacilityFile} from './localMapData';
import {countWithinRadiusMiles} from '../utils/distance';

const memory = new Map();

/**
 * Load one facility layer (EV chargers or gas stations) from the local JSON files
 * that tools/build_local_map.py produced. No online facility service is contacted.
 */
export async function loadFacilityLayer(kind) {
  if (!memory.has(kind)) {
    memory.set(kind, loadFacilityFile(kind)
      .then(payload => ({
        kind: payload.kind,
        label: payload.label,
        count: payload.count,
        generatedAt: payload.generatedAt,
        source: payload.source,
        provenance: payload.provenance,
        unknownPolicy: payload.unknownPolicy,
        mergedDuplicates: payload.mergedDuplicates,
        stations: payload.stations.map(station => ({
          ...station,
          lat: station.latitude,
          lng: station.longitude,
        })),
      }))
      .catch(error => {
        memory.delete(kind);
        throw error;
      }));
  }
  return memory.get(kind);
}

export function stationsWithinBounds(stations, bounds) {
  if (!bounds) return stations;
  return stations.filter(station => station.lat >= bounds.minLat && station.lat <= bounds.maxLat
    && station.lng >= bounds.minLng && station.lng <= bounds.maxLng);
}

export function nearbyCount(payload, point, radiusMiles) {
  return payload ? countWithinRadiusMiles(payload.stations, point, radiusMiles) : 0;
}
