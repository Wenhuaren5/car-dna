/**
 * Infrastructure context — EV chargers and gas stations around the user's home.
 *
 * This is *context*, not a hidden score input. The data ships with the prototype and covers only
 * the San Jose extract. When the user's home is outside that area, or a layer cannot be read, the
 * count is `null` and the UI must show "Unknown" — never 0, which would falsely claim that no
 * charger exists.
 *
 * The context is built once per user/home location and then shared by every recommended car.
 */

import {haversineMiles} from '../utils/distance.js';

const ACCESS = {
  public: new Set(['yes', 'permissive']),
  limited: new Set(['customers']),
  private: new Set(['private']),
};

const toPoint = value => {
  const lat = Number(value?.lat ?? value?.latitude);
  const lng = Number(value?.lng ?? value?.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) ? {lat, lng} : null;
};

const accessClass = access => {
  if (ACCESS.public.has(access)) return 'public';
  if (ACCESS.limited.has(access)) return 'limited';
  if (ACCESS.private.has(access)) return 'private';
  return 'unknown';
};

function manifestBounds(manifest) {
  const bounds = manifest?.area?.bounds;
  if (!bounds) return null;
  const minLat = Number(bounds.minLat);
  const maxLat = Number(bounds.maxLat);
  const minLng = Number(bounds.minLng ?? bounds.minLon);
  const maxLng = Number(bounds.maxLng ?? bounds.maxLon);
  return [minLat, maxLat, minLng, maxLng].every(Number.isFinite)
    ? {minLat, maxLat, minLng, maxLng}
    : null;
}

const inside = (point, bounds) => Boolean(point && bounds)
  && point.lat >= bounds.minLat && point.lat <= bounds.maxLat
  && point.lng >= bounds.minLng && point.lng <= bounds.maxLng;

function stationsOf(layer) {
  const stations = Array.isArray(layer) ? layer : layer?.stations;
  return Array.isArray(stations) ? stations : null;
}

function chargingSummary(layer, point, radiusMiles) {
  const stations = stationsOf(layer);
  if (!stations) {
    return {
      status: 'unknown', known: false, totalWithinRadius: null, publicCount: null,
      limitedCount: null, unknownAccessCount: null, privateCount: null,
      nearestPublicMiles: null, radiusMiles,
      reason: 'The local charging-station layer is not available, so availability is unknown.',
    };
  }
  const within = stations
    .map(station => ({station, point: toPoint(station)}))
    .filter(item => item.point)
    .map(item => ({...item, miles: haversineMiles(point, item.point)}))
    .filter(item => item.miles <= radiusMiles);
  const classes = within.map(item => accessClass(item.station.access));
  const publicItems = within.filter((item, index) => classes[index] === 'public');
  return {
    status: 'covered',
    known: true,
    totalWithinRadius: within.length,
    publicCount: publicItems.length,
    limitedCount: classes.filter(value => value === 'limited').length,
    unknownAccessCount: classes.filter(value => value === 'unknown').length,
    privateCount: classes.filter(value => value === 'private').length,
    nearestPublicMiles: publicItems.length
      ? Math.round(Math.min(...publicItems.map(item => item.miles)) * 10) / 10
      : null,
    radiusMiles,
    sourceStatus: layer?.provenance?.primarySourceStatus || null,
    usedSource: layer?.provenance?.usedSource || layer?.source?.name || null,
    generatedAt: layer?.generatedAt || null,
  };
}

function gasSummary(layer, point, radiusMiles) {
  const stations = stationsOf(layer);
  if (!stations) {
    return {status: 'unknown', known: false, count: null, nearestMiles: null, radiusMiles, reason: 'The local gas-station layer is not available.'};
  }
  const distances = stations
    .map(station => toPoint(station))
    .filter(Boolean)
    .map(stationPoint => haversineMiles(point, stationPoint))
    .filter(miles => miles <= radiusMiles);
  return {
    status: 'covered',
    known: true,
    count: distances.length,
    nearestMiles: distances.length ? Math.round(Math.min(...distances) * 10) / 10 : null,
    radiusMiles,
    generatedAt: layer?.generatedAt || null,
  };
}

/**
 * Build the context from already-loaded JSON. Pure and synchronous so it can be tested without a browser.
 *
 * @param {object} input point, manifest, chargers, gas and the search radius.
 * @returns {object} provider-agnostic context shared by all recommendations.
 */
export function buildInfrastructureContext({point, manifest, chargers, gas, radiusMiles = 3} = {}) {
  const home = toPoint(point);
  const bounds = manifestBounds(manifest);
  const area = manifest?.area || null;
  if (!home) {
    return {
      status: 'unknown-location',
      covered: false,
      point: null,
      radiusMiles,
      area,
      charging: {status: 'unknown', known: false, totalWithinRadius: null, publicCount: null, nearestPublicMiles: null, radiusMiles, reason: 'No home coordinates are stored.'},
      gas: {status: 'unknown', known: false, count: null, nearestMiles: null, radiusMiles, reason: 'No home coordinates are stored.'},
      caveats: [{code: 'infrastructure-unknown', severity: 'info', message: 'Home coordinates are unknown, so local charging and refuelling availability cannot be checked.'}],
    };
  }
  if (!bounds || !inside(home, bounds)) {
    return {
      status: 'out-of-coverage',
      covered: false,
      point: home,
      radiusMiles,
      area,
      charging: {status: 'unknown', known: false, totalWithinRadius: null, publicCount: null, nearestPublicMiles: null, radiusMiles, reason: 'The local facility extract covers San Jose only; this home is outside it.'},
      gas: {status: 'unknown', known: false, count: null, nearestMiles: null, radiusMiles, reason: 'The local facility extract covers San Jose only; this home is outside it.'},
      caveats: [{code: 'infrastructure-out-of-coverage', severity: 'info', message: 'Your home is outside the local San Jose map extract. Charging and gas availability are shown as Unknown rather than zero.'}],
    };
  }

  const charging = chargingSummary(chargers, home, radiusMiles);
  const refuelling = gasSummary(gas, home, radiusMiles);
  const caveats = [];
  if (charging.known && charging.publicCount === 0) {
    caveats.push({
      code: 'no-public-charger-nearby',
      severity: 'warning',
      message: `No publicly accessible charger is recorded within ${radiusMiles} mi of home. This is a measured zero inside the local extract, not a global absence.`,
    });
  } else if (charging.known && charging.publicCount < 3) {
    caveats.push({
      code: 'few-public-chargers-nearby',
      severity: 'info',
      message: `Only ${charging.publicCount} publicly accessible charger${charging.publicCount === 1 ? '' : 's'} within ${radiusMiles} mi of home.`,
    });
  }
  if (refuelling.known && refuelling.count === 0) {
    caveats.push({code: 'no-gas-station-nearby', severity: 'info', message: `No gas station is recorded within ${radiusMiles} mi of home.`});
  }

  return {
    status: 'covered',
    covered: true,
    point: home,
    radiusMiles,
    area,
    charging: {
      ...charging,
      note: 'Counts cover public (yes/permissive), limited (customers), unknown-access and private stations separately. Connector type, power and live availability are not assumed.',
    },
    gas: refuelling,
    caveats,
    provenance: {
      mapGeneratedAt: manifest?.generatedAt || null,
      source: manifest?.source?.name || 'OpenStreetMap contributors',
      license: manifest?.source?.license || null,
      chargingGeneratedAt: chargers?.generatedAt || null,
      gasGeneratedAt: gas?.generatedAt || null,
      method: `Straight-line distance from home to each recorded station, filtered to ${radiusMiles} mi. No route distance and no online availability lookup is used.`,
      outOfCoveragePolicy: 'Outside the manifest bounds every count stays null and is displayed as Unknown.',
    },
  };
}

/** Context used when the layers cannot be loaded; still explicit about being unknown. */
export function unavailableInfrastructureContext(point, radiusMiles = 3) {
  const home = toPoint(point);
  return {
    status: 'unavailable',
    covered: false,
    point: home,
    radiusMiles,
    area: null,
    charging: {status: 'unknown', known: false, totalWithinRadius: null, publicCount: null, nearestPublicMiles: null, radiusMiles, reason: 'The local facility files could not be read in this session.'},
    gas: {status: 'unknown', known: false, count: null, nearestMiles: null, radiusMiles, reason: 'The local facility files could not be read in this session.'},
    caveats: [{code: 'infrastructure-unavailable', severity: 'info', message: 'Local charger and gas-station data could not be loaded, so infrastructure is shown as Unknown.'}],
  };
}

