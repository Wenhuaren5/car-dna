/**
 * Offline driving-distance routing for the local San Jose map.
 *
 * The road graph shipped in `public/map/sanjose-road-graph.json` was built from the same
 * OpenStreetMap extract as the basemap. Routing is a real A* search over that graph, so
 * distances are road distances (not straight lines) and no network service is involved.
 */

import {decodeGraphNodes} from '../utils/polyline.js';
import {loadRoadGraph} from './localMapData.js';

export const METERS_PER_MILE = 1609.344;
const METRES_PER_DEG_LAT = 110574;
const METRES_PER_DEG_LON = 111320;
const SNAP_CELL_DEGREES = 0.005;            // ~550 m snapping grid
const SNAP_CELL_METRES = SNAP_CELL_DEGREES * METRES_PER_DEG_LAT;
const MAX_SNAP_METRES = 2500;
const FLAG_ONEWAY = 1;
const FLAG_REVERSED = 32;

let graphPromise = null;

const radians = value => (value * Math.PI) / 180;

function metresBetween(lat1, lng1, lat2, lng2) {
  const dLat = radians(lat2 - lat1);
  const dLng = radians(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(a)));
}

const cellKey = (lat, lng) => {
  const x = Math.floor(lat / SNAP_CELL_DEGREES) + 1000;
  const y = Math.floor(lng / SNAP_CELL_DEGREES) + 1000;
  return x * 8192 + y;
};

function buildGraph(source) {
  const coordinates = decodeGraphNodes(source.lat, source.lon, source.precision || 5);
  const nodeCount = source.nodes;
  const names = source.names || [];
  const wayRecords = source.waysIndex;

  let edgeTotal = 0;
  for (const record of wayRecords) {
    const points = record.length - 2;
    if (points < 2) continue;
    edgeTotal += (record[1] & FLAG_ONEWAY) ? points - 1 : (points - 1) * 2;
  }

  const edgeFrom = new Int32Array(edgeTotal);
  const edgeTo = new Int32Array(edgeTotal);
  const edgeMetres = new Float32Array(edgeTotal);
  const edgeWay = new Int32Array(edgeTotal);
  const degree = new Int32Array(nodeCount + 1);

  let edge = 0;
  for (let w = 0; w < wayRecords.length; w += 1) {
    const record = wayRecords[w];
    const pointCount = record.length - 2;
    if (pointCount < 2) continue;
    let current = record[2];
    let currentLat = coordinates[current * 2];
    let currentLng = coordinates[current * 2 + 1];
    for (let p = 3; p < record.length; p += 1) {
      const next = current + record[p];
      const nextLat = coordinates[next * 2];
      const nextLng = coordinates[next * 2 + 1];
      const metres = metresBetween(currentLat, currentLng, nextLat, nextLng);
      const oneway = record[1] & FLAG_ONEWAY;
      const reversed = record[1] & FLAG_REVERSED;
      if (!oneway || reversed) {
        edgeFrom[edge] = next;
        edgeTo[edge] = current;
        edgeMetres[edge] = metres;
        edgeWay[edge] = w;
        degree[next + 1] += 1;
        edge += 1;
      }
      if (!oneway || !reversed) {
        edgeFrom[edge] = current;
        edgeTo[edge] = next;
        edgeMetres[edge] = metres;
        edgeWay[edge] = w;
        degree[current + 1] += 1;
        edge += 1;
      }
      current = next;
      currentLat = nextLat;
      currentLng = nextLng;
    }
  }

  const offsets = new Int32Array(nodeCount + 1);
  for (let i = 0; i < nodeCount; i += 1) offsets[i + 1] = offsets[i] + degree[i + 1];
  const cursor = offsets.slice(0, nodeCount);
  const adjacency = new Int32Array(edgeTotal);
  const adjacencyMetres = new Float32Array(edgeTotal);
  const adjacencyWay = new Int32Array(edgeTotal);
  for (let i = 0; i < edge; i += 1) {
    const node = edgeFrom[i];
    const slot = cursor[node];
    cursor[node] = slot + 1;
    adjacency[slot] = edgeTo[i];
    adjacencyMetres[slot] = edgeMetres[i];
    adjacencyWay[slot] = edgeWay[i];
  }

  const cells = new Map();
  for (let node = 0; node < nodeCount; node += 1) {
    const key = cellKey(coordinates[node * 2], coordinates[node * 2 + 1]);
    const list = cells.get(key);
    if (list) list.push(node);
    else cells.set(key, [node]);
  }

  return {
    nodeCount,
    ways: wayRecords.length,
    names,
    coordinates,
    offsets,
    adjacency,
    adjacencyMetres,
    adjacencyWay,
    edgeCount: edge,
    cells,
    wayRecords,
    scratch: null,
  };
}

function nearestNode(graph, lat, lng) {
  const baseX = Math.floor(lat / SNAP_CELL_DEGREES) + 1000;
  const baseY = Math.floor(lng / SNAP_CELL_DEGREES) + 1000;
  let best = -1;
  let bestMetres = Infinity;
  const maxRing = Math.ceil(MAX_SNAP_METRES / SNAP_CELL_METRES) + 1;
  for (let ring = 0; ring <= maxRing; ring += 1) {
    for (let dx = -ring; dx <= ring; dx += 1) {
      for (let dy = -ring; dy <= ring; dy += 1) {
        if (ring > 0 && Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const list = graph.cells.get((baseX + dx) * 8192 + (baseY + dy));
        if (!list) continue;
        for (let i = 0; i < list.length; i += 1) {
          const node = list[i];
          const distance = metresBetween(
            lat, lng, graph.coordinates[node * 2], graph.coordinates[node * 2 + 1],
          );
          if (distance < bestMetres) {
            bestMetres = distance;
            best = node;
          }
        }
      }
    }
    if (best >= 0 && bestMetres <= Math.max(1, ring) * SNAP_CELL_METRES) break;
    if ((ring + 1) * SNAP_CELL_METRES > MAX_SNAP_METRES) break;
  }
  return best >= 0 && bestMetres <= MAX_SNAP_METRES ? {node: best, metres: bestMetres} : null;
}

function scratchFor(graph) {
  if (!graph.scratch) {
    graph.scratch = {
      gScore: new Float64Array(graph.nodeCount),
      fScore: new Float64Array(graph.nodeCount),
      cameFrom: new Int32Array(graph.nodeCount),
      cameEdge: new Int32Array(graph.nodeCount),
      closed: new Int32Array(graph.nodeCount),
      stamp: new Int32Array(graph.nodeCount),
      heapNode: new Int32Array(graph.nodeCount + 1),
      heapScore: new Float64Array(graph.nodeCount + 1),
      generation: 0,
    };
  }
  return graph.scratch;
}

function heapPush(heap, size, node, score) {
  heap.heapNode[size] = node;
  heap.heapScore[size] = score;
  let index = size;
  while (index > 0) {
    const parent = (index - 1) >> 1;
    if (heap.heapScore[parent] <= heap.heapScore[index]) break;
    const scoreValue = heap.heapScore[parent];
    const nodeValue = heap.heapNode[parent];
    heap.heapScore[parent] = heap.heapScore[index];
    heap.heapNode[parent] = heap.heapNode[index];
    heap.heapScore[index] = scoreValue;
    heap.heapNode[index] = nodeValue;
    index = parent;
  }
  return size + 1;
}

function heapPop(heap, size) {
  const top = heap.heapNode[0];
  size -= 1;
  heap.heapNode[0] = heap.heapNode[size];
  heap.heapScore[0] = heap.heapScore[size];
  let index = 0;
  for (;;) {
    const left = index * 2 + 1;
    const right = left + 1;
    let smallest = index;
    if (left < size && heap.heapScore[left] < heap.heapScore[smallest]) smallest = left;
    if (right < size && heap.heapScore[right] < heap.heapScore[smallest]) smallest = right;
    if (smallest === index) break;
    const scoreValue = heap.heapScore[smallest];
    const nodeValue = heap.heapNode[smallest];
    heap.heapScore[smallest] = heap.heapScore[index];
    heap.heapNode[smallest] = heap.heapNode[index];
    heap.heapScore[index] = scoreValue;
    heap.heapNode[index] = nodeValue;
    index = smallest;
  }
  return {node: top, size};
}

function search(graph, start, goal) {
  const scratch = scratchFor(graph);
  scratch.generation += 1;
  const mark = scratch.generation;
  let heapSize = 0;
  const goalLat = graph.coordinates[goal * 2];
  const goalLng = graph.coordinates[goal * 2 + 1];
  const heuristic = node => metresBetween(
    graph.coordinates[node * 2], graph.coordinates[node * 2 + 1], goalLat, goalLng,
  );

  scratch.stamp[start] = mark;
  scratch.gScore[start] = 0;
  scratch.fScore[start] = heuristic(start);
  scratch.cameFrom[start] = -1;
  scratch.cameEdge[start] = -1;
  heapSize = heapPush(scratch, heapSize, start, scratch.fScore[start]);
  let expanded = 0;
  let found = start === goal;

  while (heapSize > 0 && !found) {
    const popped = heapPop(scratch, heapSize);
    heapSize = popped.size;
    const node = popped.node;
    if (scratch.closed[node] === mark) continue;
    scratch.closed[node] = mark;
    expanded += 1;
    if (node === goal) {
      found = true;
      break;
    }
    const from = graph.offsets[node];
    const to = graph.offsets[node + 1];
    for (let slot = from; slot < to; slot += 1) {
      const neighbour = graph.adjacency[slot];
      if (scratch.closed[neighbour] === mark) continue;
      const tentative = scratch.gScore[node] + graph.adjacencyMetres[slot];
      if (scratch.stamp[neighbour] === mark && tentative >= scratch.gScore[neighbour]) continue;
      scratch.stamp[neighbour] = mark;
      scratch.gScore[neighbour] = tentative;
      scratch.fScore[neighbour] = tentative + heuristic(neighbour);
      scratch.cameFrom[neighbour] = node;
      scratch.cameEdge[neighbour] = slot;
      heapSize = heapPush(scratch, heapSize, neighbour, scratch.fScore[neighbour]);
    }
  }

  if (!found || scratch.stamp[goal] !== mark) return null;
  const nodes = [];
  const ways = [];
  let cursor = goal;
  while (cursor !== -1) {
    nodes.push(cursor);
    const slot = scratch.cameEdge[cursor];
    if (slot >= 0) ways.push(graph.adjacencyWay[slot]);
    cursor = scratch.cameFrom[cursor];
  }
  nodes.reverse();
  ways.reverse();
  return {nodes, ways, metres: scratch.gScore[goal], expanded};
}

export async function loadOfflineRoadGraph() {
  if (!graphPromise) {
    graphPromise = loadRoadGraph().then(buildGraph).catch(error => {
      graphPromise = null;
      throw error;
    });
  }
  return graphPromise;
}

/* Exported for the Node test in tools/test_routing.mjs so the graph logic can be verified
   without a browser. These helpers are not used by the React components. */
export const buildGraphFromSource = source => buildGraph(source);
export const snapToGraph = (graph, lat, lng) => nearestNode(graph, Number(lat), Number(lng));

/** First mapped street name among the ways that touch a graph node, or ''. */
function nodeStreetName(graph, node) {
  const start = graph.offsets[node];
  const stop = graph.offsets[node + 1];
  for (let slot = start; slot < stop; slot += 1) {
    const record = graph.wayRecords[graph.adjacencyWay[slot]];
    const name = record && record[0] ? graph.names[record[0]] : '';
    if (name) return name;
  }
  return '';
}

/**
 * Nearest *named* road to a point, searched on the same local graph the router uses.
 * This is the street-level fallback of the offline reverse geocoder: it reports the road that
 * OpenStreetMap actually maps closest to the point, and the distance to it, so callers can be
 * honest about how far the reference is.
 */
export async function nearestRoadName(point, options = {}) {
  const maxMetres = options.maxMetres || 180;
  const graph = await loadOfflineRoadGraph();
  const lat = Number(point.lat);
  const lng = Number(point.lng);
  const baseX = Math.floor(lat / SNAP_CELL_DEGREES) + 1000;
  const baseY = Math.floor(lng / SNAP_CELL_DEGREES) + 1000;
  const maxRing = Math.ceil(maxMetres / SNAP_CELL_METRES) + 1;
  let best = null;
  let candidates = 0;
  for (let ring = 0; ring <= maxRing; ring += 1) {
    for (let dx = -ring; dx <= ring; dx += 1) {
      for (let dy = -ring; dy <= ring; dy += 1) {
        if (ring > 0 && Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const list = graph.cells.get((baseX + dx) * 8192 + (baseY + dy));
        if (!list) continue;
        for (let i = 0; i < list.length; i += 1) {
          const node = list[i];
          const name = nodeStreetName(graph, node);
          if (!name) continue;
          candidates += 1;
          const distance = metresBetween(lat, lng, graph.coordinates[node * 2], graph.coordinates[node * 2 + 1]);
          if (distance > maxMetres) continue;
          if (!best || distance < best.metres) best = {name, metres: distance};
        }
      }
    }
    if (best && best.metres <= Math.max(1, ring) * SNAP_CELL_METRES) break;
    if ((ring + 1) * SNAP_CELL_METRES > maxMetres) break;
  }
  return best ? {...best, candidates} : null;
}

export function routeBetweenNodes(graph, startNode, goalNode) {
  const result = search(graph, startNode, goalNode);
  if (!result) return null;
  return {
    distanceMeters: result.metres,
    distanceMiles: result.metres / METERS_PER_MILE,
    nodesExpanded: result.expanded,
    geometry: result.nodes.map(node => [
      graph.coordinates[node * 2], graph.coordinates[node * 2 + 1],
    ]),
    streetNames: [...new Set(result.ways.map(index => {
      const record = graph.wayRecords[index];
      return record && record[0] ? graph.names[record[0]] : '';
    }).filter(Boolean))].slice(0, 12),
  };
}

/**
 * Real driving distance between two {lat, lng} points on the local road network.
 * `origin` and `destination` are snapped to the nearest local road node first.
 */
export async function routeOffline(origin, destination) {
  const graph = await loadOfflineRoadGraph();
  const start = nearestNode(graph, Number(origin.lat), Number(origin.lng));
  const goal = nearestNode(graph, Number(destination.lat), Number(destination.lng));
  if (!start || !goal) {
    throw Object.assign(
      new Error(`The local road network has no drivable road within ${MAX_SNAP_METRES} m of `
        + `${start ? 'the destination' : 'the origin'} point.`),
      {code: 'snap_failed'},
    );
  }
  const result = search(graph, start.node, goal.node);
  if (!result) {
    throw Object.assign(
      new Error('The local road network has no drivable connection between these two points.'),
      {code: 'no_path'},
    );
  }
  const geometry = result.nodes.map(node => [
    graph.coordinates[node * 2], graph.coordinates[node * 2 + 1],
  ]);
  const streetNames = [];
  result.ways.forEach(wayIndex => {
    const record = graph.wayRecords[wayIndex];
    const name = (record && record[0] ? graph.names[record[0]] : '') || '';
    if (name && streetNames[streetNames.length - 1] !== name) streetNames.push(name);
  });
  return {
    status: 'ready',
    distanceMeters: result.metres,
    distanceMiles: result.metres / METERS_PER_MILE,
    geometry,
    streetNames: streetNames.slice(0, 12),
    method: 'offline road network (OpenStreetMap extract + A* search)',
    dataSource: 'Local OpenStreetMap extract (ODbL 1.0)',
    methodDetail: 'You clicked a point, so a real drivable distance is computed, not a straight line.',
    snapMetres: {origin: Math.round(start.metres), destination: Math.round(goal.metres)},
    nodesExpanded: result.expanded,
    computedAt: new Date().toISOString(),
  };
}
