/**
 * Offline reverse geocoding for the local San Jose map.
 *
 * Every answer comes from `public/map/addresses/`, a sharded index that was built at build
 * time from OpenStreetMap `addr:*` tags, plus (only as a fallback) the local road graph and the
 * local place labels. No geocoding service is contacted: there is no MapTiler, no Google and no
 * Nominatim call anywhere in this file, and the clicked coordinates never leave the browser.
 *
 * The lookup follows one strict ladder and never invents anything:
 *   1. `house`  - the nearest mapped address point / address building inside the index radius.
 *                 It is a *reference*, so it is reported as "Nearest known address".
 *   2. `street` - the name of the nearest mapped road, when no address is that close.
 *   3. `area`   - the nearest mapped place/neighbourhood label, when there is no road name.
 *   4. `none`   - coordinates only, reported as "Address unavailable".
 * House numbers are never interpolated and never taken from a road.
 */

import {loadAddressIndex, loadAddressShard, loadPlaces} from './localMapData.js';
import {nearestRoadName} from './offlineRoutingService.js';

export const ADDRESS_SOURCE = 'OpenStreetMap (ODbL 1.0)';
const AREA_RADIUS_METRES = 6000;
const HIGH_CONFIDENCE_METRES = 25;
const VIEW_CONSTRUCTORS = {
  int16: Int16Array, int32: Int32Array,
  uint8: Uint8Array, uint16: Uint16Array, uint32: Uint32Array,
};

let indexPromise = null;
const shardCache = new Map();

const radians = value => (value * Math.PI) / 180;

export function metresBetween(lat1, lng1, lat2, lng2) {
  const dLat = radians(lat2 - lat1);
  const dLng = radians(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(a)));
}

export async function loadAddressMeta() {
  if (!indexPromise) {
    indexPromise = loadAddressIndex().catch(error => {
      indexPromise = null;
      throw error;
    });
  }
  return indexPromise;
}

export function resetAddressCache() {
  indexPromise = null;
  shardCache.clear();
}

function decodeBase64Blob(blob) {
  const binary = atob(blob.data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const View = VIEW_CONSTRUCTORS[blob.dtype];
  if (!View) throw new Error(`Unsupported address index dtype ${blob.dtype}.`);
  return new View(bytes.buffer, 0, Math.floor(bytes.byteLength / View.BYTES_PER_ELEMENT));
}

/** Turn one shard file into plain per-entry accessors (coordinates in degrees). */
export function decodeAddressShard(shard) {
  const lat = decodeBase64Blob(shard.blobs.lat);
  const lon = decodeBase64Blob(shard.blobs.lon);
  const street = decodeBase64Blob(shard.blobs.street);
  const city = decodeBase64Blob(shard.blobs.city);
  const postcode = decodeBase64Blob(shard.blobs.postcode);
  const kind = decodeBase64Blob(shard.blobs.kind);
  const scale = shard.coordinateScale || 100000;
  const originLat = shard.origin ? shard.origin.lat : 0;
  const originLng = shard.origin ? shard.origin.lng : 0;
  return {
    count: shard.count,
    houses: shard.houseNumbers || [],
    streets: (shard.tables && shard.tables.streets) || [],
    cities: (shard.tables && shard.tables.cities) || [],
    postcodes: (shard.tables && shard.tables.postcodes) || [],
    latitude: index => (originLat + lat[index]) / scale,
    longitude: index => (originLng + lon[index]) / scale,
    streetName: index => street[index],
    cityName: index => city[index],
    postcodeName: index => postcode[index],
    isBuilding: index => kind[index] === 1,
  };
}

export async function loadAddressShardFile(file) {
  if (!shardCache.has(file)) {
    const pending = loadAddressShard(file).then(decodeAddressShard).catch(error => {
      shardCache.delete(file);
      throw error;
    });
    shardCache.set(file, pending);
  }
  return shardCache.get(file);
}

/** Shard that contains a point, taken from the index catalogue (chunked loading).

 * The catalogue is a small quadtree: a dense base cell is stored as four finer shards, so the
 * deepest shard containing the point is the one that gets read.
 */
export function shardForPoint(index, lat, lng) {
  let best = null;
  (index.shards || []).forEach(entry => {
    const bounds = entry.bounds;
    if (!bounds) return;
    if (lat < bounds.minLat || lat > bounds.maxLat || lng < bounds.minLng || lng > bounds.maxLng) return;
    if (!best || (entry.level || 0) > (best.level || 0)) best = entry;
  });
  return best || null;
}

function formatHouseAddress(components, index) {
  const head = [components.houseNumber, components.street].filter(Boolean).join(' ');
  const tail = [components.city || index.defaultCity || '', components.state || index.defaultState || '']
    .filter(Boolean).join(', ');
  return [head, tail].filter(Boolean).join(', ');
}

function baseResult(lat, lng) {
  return {
    lat, lng,
    displayName: 'Address unavailable',
    precision: 'none',
    relation: 'none',
    matchLabel: 'Address unavailable',
    components: {houseNumber: null, street: null, city: null, state: null, postcode: null},
    distanceMetres: null,
    confidence: 'none',
    source: ADDRESS_SOURCE,
    sourceKind: 'none',
    detail: 'No mapped address, road name or place name is available in the local data for this point.',
    offline: true,
    resolvedAt: new Date().toISOString(),
  };
}


async function nearestAddress(index, lat, lng) {
  const entry = shardForPoint(index, lat, lng);
  if (!entry) return null;
  const shard = await loadAddressShardFile(entry.file);
  const radius = index.queryRadiusMetres || 70;
  let best = null;
  for (let i = 0; i < shard.count; i += 1) {
    const distance = metresBetween(lat, lng, shard.latitude(i), shard.longitude(i));
    if (distance > radius) continue;
    if (!best || distance < best.distanceMetres) {
      best = {
        distanceMetres: distance,
        houseNumber: shard.houses[i] || '',
        street: shard.streets[shard.streetName(i)] || '',
        city: shard.cities[shard.cityName(i)] || '',
        postcode: shard.postcodes[shard.postcodeName(i)] || '',
        sourceKind: shard.isBuilding(i)
          ? 'address building (centroid of the mapped outline)'
          : 'address point (mapped node)',
        shard: {row: entry.row, col: entry.col},
      };
    }
  }
  return best;
}

async function nearestArea(lat, lng) {
  let places;
  try {
    places = await loadPlaces();
  } catch {
    return null;
  }
  let best = null;
  (places.features || []).forEach(feature => {
    const distance = metresBetween(lat, lng, feature.lat, feature.lon);
    if (distance > AREA_RADIUS_METRES) return;
    if (!best || distance < best.distanceMetres) {
      best = {distanceMetres: distance, name: feature.name, place: feature.place};
    }
  });

  return best;
}

/**
 * Resolve the geographic address of a point using local data only.
 * A normal click never throws: an unresolvable point returns `precision: 'none'`.
 */
export async function resolveAddress(point, options = {}) {
  const lat = Number(point && point.lat);
  const lng = Number(point && point.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw Object.assign(new Error('The selected point has no valid coordinates.'), {code: 'invalid_point'});
  }
  const result = baseResult(lat, lng);
  let index;
  try {
    index = await loadAddressMeta();
  } catch (error) {
    result.sourceKind = 'unavailable';
    result.indexMissing = true;
    result.detail = `The local address index could not be read (${error.message}).`;
    return result;
  }
  result.index = {
    entries: (index.counts && index.counts.entries) ?? null,
    shards: (index.counts && index.counts.shards) ?? null,
    queryRadiusMetres: index.queryRadiusMetres ?? null,
    generatedAt: index.generatedAt || null,
  };

  const house = await nearestAddress(index, lat, lng);
  if (house && house.street) {
    const components = {
      houseNumber: house.houseNumber, street: house.street, city: house.city,
      state: index.defaultState || 'CA', postcode: house.postcode || null,
    };
    return {
      ...result,
      displayName: formatHouseAddress(components, index),
      precision: 'house',
      relation: 'nearest',
      matchLabel: 'Nearest known address',
      components,
      distanceMetres: Number(house.distanceMetres.toFixed(1)),
      confidence: house.distanceMetres <= HIGH_CONFIDENCE_METRES ? 'high' : 'medium',
      sourceKind: house.sourceKind,
      detail: `OpenStreetMap maps this address ${Math.round(house.distanceMetres)} m away. It is the`
        + ' closest known address, not a confirmed match for the exact point you clicked.',
      shard: house.shard,
    };
  }

  if (!options.skipRoads) {
    let road = null;
    try {
      road = await nearestRoadName({lat, lng});
    } catch {
      road = null;
    }
    if (road && road.name) {
      const city = index.defaultCity || '';
      const components = {houseNumber: null, street: road.name, city,
        state: index.defaultState || 'CA', postcode: null};
      return {
        ...result,
        displayName: formatHouseAddress(components, index),
        precision: 'street',
        relation: 'nearest-road',
        matchLabel: 'Nearest mapped road',
        components,
        distanceMetres: Number(road.metres.toFixed(1)),
        confidence: road.metres <= 60 ? 'medium' : 'low',
        sourceKind: `road name from the local road graph (${road.candidates} named node candidate(s) checked)`,
        detail: `No mapped house number is within ${index.queryRadiusMetres || 70} m of this point, so`
          + ` the nearest mapped road centreline is shown (${Math.round(road.metres)} m away).`,
      };
    }
  }

  const area = await nearestArea(lat, lng);
  if (area) {
    const city = index.defaultCity || '';
    const inside = area.name.toLowerCase().replace(/\s+/g, '')
      === city.toLowerCase().replace(/\s+/g, '');
    const components = {houseNumber: null, street: null, city: inside ? area.name : city,
      state: index.defaultState || 'CA', postcode: null};
    return {
      ...result,
      displayName: [area.name, inside ? '' : city, index.defaultState || 'CA'].filter(Boolean).join(', '),
      precision: 'area',
      relation: 'nearest-area',
      matchLabel: 'Nearest mapped area',
      components,
      distanceMetres: Number(area.distanceMetres.toFixed(1)),
      confidence: 'low',
      sourceKind: `OpenStreetMap place label (${area.place || 'place'})`,
      detail: 'No mapped house number or road name is close enough, so the nearest mapped place'
        + ` name is shown (${Math.round(area.distanceMetres)} m away).`,
    };
  }

  result.detail = 'No house number, road name or place label is mapped in the local data for this point.';
  return result;
}

/** Coverage description of the address index, for the UI and the report. */
export async function describeAddressIndex() {
  try {
    const index = await loadAddressMeta();
    const counts = index.counts || {};
    return {
      available: true,
      entries: counts.entries || 0,
      elements: counts.elements || 0,
      addressNodes: counts.addressNodes || 0,
      addressBuildings: counts.addressBuildings || 0,
      mergedDuplicates: counts.mergedDuplicates || 0,
      shards: counts.shards || 0,
      streets: counts.streets || 0,
      postcodes: counts.postcodes || 0,
      queryRadiusMetres: index.queryRadiusMetres ?? null,
      shardMarginMetres: index.shardMarginMetres ?? null,
      generatedAt: index.generatedAt || null,
      source: index.source || null,
      method: index.method || '',
    };
  } catch (error) {
    return {available: false, error: error.message, entries: 0, shards: 0};
  }
}
