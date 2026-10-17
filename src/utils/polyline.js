/**
 * Google encoded-polyline decoder (precision 5, the format written by
 * tools/build_local_map.py). Returns an array of [lat, lng] pairs.
 */
export function decodePolyline(encoded, precision = 5) {
  const factor = 10 ** precision;
  const points = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const length = encoded.length;
  while (index < length) {
    let result = 0;
    let shift = 0;
    let byte;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    result = 0;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    points.push([lat / factor, lng / factor]);
  }
  return points;
}

/** Decode a ring and close it again for Leaflet polygons. */
export function decodeRing(encoded, precision = 5) {
  const points = decodePolyline(encoded, precision);
  if (points.length > 2) points.push(points[0]);
  return points;
}

/**
 * Decode the delta-encoded node coordinate arrays of the road graph.
 * Returns a flat Float64Array of [lat0, lng0, lat1, lng1, ...].
 */
export function decodeGraphNodes(latDeltas, lonDeltas, precision = 5) {
  const factor = 10 ** precision;
  const count = latDeltas.length;
  const coordinates = new Float64Array(count * 2);
  let lat = 0;
  let lon = 0;
  for (let i = 0; i < count; i += 1) {
    lat += latDeltas[i];
    lon += lonDeltas[i];
    coordinates[i * 2] = lat / factor;
    coordinates[i * 2 + 1] = lon / factor;
  }
  return coordinates;
}
