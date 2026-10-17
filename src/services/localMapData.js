/**
 * Loader for the locally built San Jose map and facility data.
 *
 * Every path below is a static file that ships inside `public/`, so the app works from
 * any local web server (and from GitHub Pages) without contacting MapTiler, Stadia,
 * Overpass, AFDC or any other online service. Files are cached in memory only; nothing
 * here pretends that a network cache is an offline map.
 */

const memory = new Map();

/** Resolve a data path against the document base so any deploy sub-path works. */
export function localUrl(path) {
  return new URL(path.replace(/^\//, ''), document.baseURI).toString();
}

export function loadJson(path, options = {}) {
  const url = localUrl(path);
  if (memory.has(url)) return memory.get(url);
  const pending = fetch(url, {signal: options.signal})
    .then(response => {
      if (!response.ok) {
        throw Object.assign(
          new Error(`Local map file ${path} could not be read (HTTP ${response.status}).`),
          {code: 'local_data_missing', path},
        );
      }
      return response.json();
    })
    .catch(error => {
      memory.delete(url);
      throw error;
    });
  memory.set(url, pending);
  return pending;
}

export const loadManifest = () => loadJson('map/manifest.json');
export const loadBasemapLayer = file => loadJson(file);
export const loadRoadGraph = () => loadJson('map/sanjose-road-graph.json');
export const loadPlaces = () => loadJson('map/places.json');
export const loadAddressIndex = () => loadJson('map/addresses/index.json');
/** Chunked loading: one shard per click, resolved against the document base like every other file. */
export const loadAddressShard = file => loadJson(file.startsWith('map/') ? file : `map/${file}`);

const FACILITY_FILES = {
  chargers: 'data/charging-stations.json',
  gas: 'data/gas-stations.json',
};

export const loadFacilityFile = kind => loadJson(FACILITY_FILES[kind]);

export function resetLocalDataCache() {
  memory.clear();
}
