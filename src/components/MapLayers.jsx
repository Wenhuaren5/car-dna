import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useMap, useMapEvents} from 'react-leaflet';
import L from 'leaflet';
import {loadBasemapLayer} from '../services/localMapData';
import {stationsWithinBounds} from '../services/localFacilities';
import {decodePolyline, decodeRing} from '../utils/polyline';
import {facilityRows, facilityTitle, UNKNOWN} from '../utils/facilityFields';

/**
 * Leaflet drawing primitives for the offline San Jose map: the vector basemap tiers, the local
 * facility markers, the click plumbing and the attribution control. All of it paints from files
 * that ship inside `public/`; nothing here talks to a tile server or a geocoding service.
 */

export const escapeHtml = text => String(text).replace(/[&<>"]/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[character]));

// Dark "tech" palette for the vector basemap; drawn by Leaflet on a canvas, never a tile server.
const STYLES = {
  urban: {fillColor:'#111d18', fillOpacity:0.6, color:'#1d3027', weight:0.5},
  green: {fillColor:'#153c2a', fillOpacity:0.85, color:'#215839', weight:0.8},
  water: {fillColor:'#0d2f45', fillOpacity:0.95, color:'#1c5f88', weight:1},
  waterway: {color:'#2b7bab', weight:2, opacity:0.9},
  coastline: {color:'#4fb3c8', weight:2, dashArray:'5 4', opacity:0.9},
  rail: {color:'#7f8b94', weight:1.5, dashArray:'7 5', opacity:0.7},
  arterial: {color:'#ffcf70', weight:3.2, opacity:0.95},
  collector: {color:'#c9a86a', weight:2.2, opacity:0.9},
  local: {color:'#93a29a', weight:1.3, opacity:0.75},
};

const placeLabelIcon = feature => L.divIcon({
  className:`place-label place-${feature.place}`,
  html:`<span>${escapeHtml(feature.name)}</span>`,
  iconSize:null,
  iconAnchor:[0,0],
});

export function buildBasemapLeafletLayer(payload, renderer, zoom) {
  const precision = payload.precision || 5;
  if (payload.kind === 'point') {
    const group = L.layerGroup();
    payload.features.forEach(feature => {
      if (feature.minZoom > zoom) return;
      group.addLayer(L.marker([feature.lat, feature.lon], {interactive:false, icon:placeLabelIcon(feature), keyboard:false}));
    });
    return group.getLayers().length ? group : null;
  }
  const style = STYLES[payload.style] || STYLES.local;
  const shapes = [];
  payload.features.forEach(feature => {
    if (payload.kind === 'polygon') feature[3].forEach(ring => shapes.push(decodeRing(ring, precision)));
    else shapes.push(decodePolyline(feature[3], precision));
  });
  if (!shapes.length) return null;
  return payload.kind === 'polygon'
    ? L.polygon(shapes, {...style, renderer, interactive:false})
    : L.polyline(shapes, {...style, renderer, interactive:false});
}

/** Draws the locally built vector basemap, one Leaflet layer per level of detail. */
export function BasemapLayers({manifest, showLabels, onError}) {
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());
  const renderer = useMemo(() => L.canvas({padding:0.3}), []);
  const active = useRef(new Map());

  useEffect(() => {
    const handleZoom = () => setZoom(map.getZoom());
    map.on('zoomend', handleZoom);
    return () => map.off('zoomend', handleZoom);
  }, [map]);

  useEffect(() => () => {
    active.current.forEach(entry => map.removeLayer(entry.layer));
    active.current.clear();
  }, [map]);

  useEffect(() => {
    let cancelled = false;
    manifest.basemap.forEach(entry => {
      const isLabels = entry.layer === 'place';
      const visible = zoom >= entry.minZoom && (!isLabels || showLabels);
      const key = isLabels ? `${entry.file}@${zoom}` : entry.file;
      const existing = active.current.get(entry.file);
      if (visible && existing && existing.key === key) return;
      if (existing) {
        map.removeLayer(existing.layer);
        active.current.delete(entry.file);
      }
      if (!visible) return;
      loadBasemapLayer(entry.file)
        .then(payload => {
          if (cancelled || active.current.has(entry.file)) return;
          const layer = buildBasemapLeafletLayer(payload, renderer, zoom);
          if (!layer) return;
          layer.addTo(map);
          active.current.set(entry.file, {layer, key});
        })
        .catch(error => onError(error.message));
    });
    return () => { cancelled = true; };
  }, [manifest, zoom, showLabels, renderer, map, onError]);

  return null;
}

/** Local EV/gas facilities from `public/data`, filtered to the current viewport. */
export function FacilityMarkers({payload, kind, visible, onCounts}) {
  const map = useMap();
  const renderer = useMemo(() => L.canvas({padding:0.3}), []);
  const [bounds, setBounds] = useState(() => map.getBounds());
  const layerRef = useRef(null);

  useEffect(() => {
    const handle = () => setBounds(map.getBounds());
    map.on('moveend', handle);
    map.on('zoomend', handle);
    return () => {
      map.off('moveend', handle);
      map.off('zoomend', handle);
    };
  }, [map]);

  const inView = useMemo(() => stationsWithinBounds(payload ? payload.stations : [], {
    minLat:bounds.getSouth(), maxLat:bounds.getNorth(), minLng:bounds.getWest(), maxLng:bounds.getEast(),
  }), [payload, bounds]);

  useEffect(() => {
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }
    if (!payload) return () => {};
    if (!visible) {
      onCounts(kind, 0, payload.stations.length);
      return () => {};
    }
    const group = L.layerGroup();
    inView.forEach(station => {
      const marker = L.circleMarker([station.lat, station.lng], {
        renderer,
        radius:kind === 'chargers' ? 5 : 4,
        color:'#08110e',
        weight:1.4,
        fillColor:kind === 'chargers' ? '#4f9dff' : '#e08b3c',
        fillOpacity:0.95,
      });
      const rows = facilityRows(station, kind)
        .map(([label, amount]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(amount)}</td></tr>`)
        .join('');
      marker.bindPopup(`<b>${escapeHtml(facilityTitle(station))}</b><table class="popup-table">${rows}</table>`
        + `<small>${escapeHtml(station.osmId)} · local data, retrieved ${escapeHtml(station.retrievedAt || UNKNOWN)}</small>`);
      group.addLayer(marker);
    });
    group.addTo(map);
    layerRef.current = group;
    onCounts(kind, inView.length, payload.stations.length);
    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [payload, visible, inView, kind, map, renderer, onCounts]);

  return null;
}

/** Reports every map click with the raw Leaflet lat/lng. */
export function Clicker({onPick}) {
  const handle = useCallback(event => onPick(event.latlng), [onPick]);
  useMapEvents({click:handle});
  return null;
}

export function FlyTo({target}) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo([target.lat, target.lng], Math.max(map.getZoom(), 14), {duration:0.6});
  }, [map, target]);
  return null;
}

export function Attribution() {
  const map = useMap();
  useEffect(() => {
    map.attributionControl.setPrefix(false);
    map.attributionControl.addAttribution('Local OpenStreetMap extract (ODbL 1.0)');
  }, [map]);
  return null;
}
