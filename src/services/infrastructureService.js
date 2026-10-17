/**
 * Browser-side infrastructure loader.
 *
 * Loads the manifest, charging layer and gas layer once per session (their own loaders cache the
 * network promises) and builds one InfrastructureContext per home location. Every recommendation
 * then shares that same context instead of recomputing a radius search per car.
 */

import {loadManifest} from './localMapData';
import {loadFacilityLayer} from './localFacilities';
import {
  buildInfrastructureContext,
  unavailableInfrastructureContext,
} from '../algorithms/infrastructureContext';

let manifestPromise = null;
let chargersPromise = null;
let gasPromise = null;
const contextCache = new Map();

const layers = () => {
  if (!manifestPromise) manifestPromise = loadManifest().catch(error => {
    manifestPromise = null;
    throw error;
  });
  if (!chargersPromise) chargersPromise = loadFacilityLayer('chargers').catch(error => {
    chargersPromise = null;
    throw error;
  });
  if (!gasPromise) gasPromise = loadFacilityLayer('gas').catch(error => {
    gasPromise = null;
    throw error;
  });
  return Promise.all([manifestPromise, chargersPromise, gasPromise]);
};

const locationKey = point => {
  const lat = Number(point?.lat);
  const lng = Number(point?.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) ? `${lat.toFixed(4)},${lng.toFixed(4)}` : 'unknown';
};

/**
 * @param {{lat:number,lng:number}|null} point the user's home.
 * @param {{radiusMiles?:number}} [options]
 * @returns {Promise<object>} context; failures return an explicit unknown context, never zero counts.
 */
export async function getInfrastructureContext(point, options = {}) {
  const radiusMiles = Number(options.radiusMiles) || 3;
  const key = `${locationKey(point)}|${radiusMiles}`;
  if (contextCache.has(key)) return contextCache.get(key);
  const pending = layers()
    .then(([manifest, chargers, gas]) => buildInfrastructureContext({point, manifest, chargers, gas, radiusMiles}))
    .catch(() => unavailableInfrastructureContext(point, radiusMiles));
  contextCache.set(key, pending);
  return pending;
}

/** Clear caches after a data refresh; not used by normal navigation. */
export function resetInfrastructureContextCache() {
  contextCache.clear();
  manifestPromise = null;
  chargersPromise = null;
  gasPromise = null;
}
