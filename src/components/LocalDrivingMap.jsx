import {useCallback, useEffect, useMemo, useState} from 'react';
import {MapContainer, Marker, Polyline, Popup} from 'react-leaflet';
import L from 'leaflet';
import {loadManifest} from '../services/localMapData';
import {loadFacilityLayer, nearbyCount} from '../services/localFacilities';
import {routeOffline} from '../services/offlineRoutingService';
import {resolveAddress, describeAddressIndex} from '../services/offlineAddressService';
import {dailyDrivingMiles} from '../utils/distance';
import {DESTINATION_TYPES} from '../model/profile';
import {Attribution, BasemapLayers, Clicker, FacilityMarkers, FlyTo} from './MapLayers';
import PendingLocationPanel from './PendingLocationPanel';
import YourPlacesPanel from './YourPlacesPanel';

/**
 * Step 3 of the questionnaire: the fully offline San Jose driving simulator.
 *
 * Interaction model (nothing is saved until the user asks for it):
 *   click the map -> temporary pin -> offline reverse geocoding of that point -> "Selected
 *   Location" panel -> Save Location (Home, or a frequently visited place) -> the place appears
 *   in "Your Places", where it can be edited, moved or deleted.
 *
 * Home and every destination keep their own custom name, address, weekly round trips and weeks
 * per year, so editing or moving a place never loses the travel frequency that was already set.
 */

const DEFAULT_WEEKS = {School:40, Work:48, Shopping:52, Recreation:40, Other:40, Home:0};
const homeIcon = new L.DivIcon({className:'dna-pin home-pin', html:'<span></span>', iconSize:[24,24], iconAnchor:[12,24]});
const destinationIcon = new L.DivIcon({className:'dna-pin destination-pin', html:'<span></span>', iconSize:[24,24], iconAnchor:[12,24]});
const pendingIcon = new L.DivIcon({className:'dna-pin pending-pin', html:'<span></span>', iconSize:[26,26], iconAnchor:[13,26]});
const point = latlng => ({lat:+Number(latlng.lat).toFixed(6), lng:+Number(latlng.lng).toFixed(6)});
const statusLabel = status => ({
  idle:'Not calculated',
  loading:'Calculating…',
  ready:'Available',
  snap_failed:'Off the road network',
  no_path:'No road connection',
  local_data_missing:'Local data missing',
  unavailable:'Unavailable',
}[status] || status);

/** Coordinates only, for places whose address has not been resolved yet. */
const coordinatesOnly = value => ({lat:value.lat, lng:value.lng});

async function resolveAddressQuietly(value) {
  try {
    return await resolveAddress(value);
  } catch (error) {
    return {
      displayName:'Address unavailable', precision:'none', relation:'none',
      matchLabel:'Address unavailable', components:{}, distanceMetres:null, confidence:'none',
      source:'OpenStreetMap (ODbL 1.0)', sourceKind:'unavailable',
      detail:error.message, offline:true, resolvedAt:new Date().toISOString(),
    };
  }
}

export default function LocalDrivingMap({profile, setProfile}) {
  const [manifest, setManifest] = useState(null);
  const [dataError, setDataError] = useState('');
  const [facilityError, setFacilityError] = useState('');
  const [facilities, setFacilities] = useState({chargers:null, gas:null});
  const [viewCounts, setViewCounts] = useState({chargers:{inView:0, total:0}, gas:{inView:0, total:0}});
  const [layers, setLayers] = useState({routes:true, chargers:true, gas:true, labels:true});
  const [routes, setRoutes] = useState([]);
  const [routeStatus, setRouteStatus] = useState('idle');
  const [routeMessage, setRouteMessage] = useState('');
  const [fly, setFly] = useState(null);
  const [pending, setPending] = useState(null);
  const [manual, setManual] = useState({lat:'', lng:''});
  const [manualError, setManualError] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [movingId, setMovingId] = useState(null);
  const [moveStatus, setMoveStatus] = useState(null);
  const [notice, setNotice] = useState('');
  const [addressIndex, setAddressIndex] = useState(null);

  useEffect(() => {
    let cancelled = false;
    loadManifest()
      .then(payload => { if (!cancelled) setManifest(payload); })
      .catch(error => { if (!cancelled) setDataError(error.message); });
    loadFacilityLayer('chargers')
      .then(payload => { if (!cancelled) setFacilities(current => ({...current, chargers:payload})); })
      .catch(error => { if (!cancelled) setFacilityError(error.message); });
    loadFacilityLayer('gas')
      .then(payload => { if (!cancelled) setFacilities(current => ({...current, gas:payload})); })
      .catch(error => { if (!cancelled) setFacilityError(error.message); });
    describeAddressIndex()
      .then(payload => { if (!cancelled) setAddressIndex(payload); })
      .catch(() => { if (!cancelled) setAddressIndex({available:false}); });
    return () => { cancelled = true; };
  }, []);

  const handleCounts = useCallback((kind, inView, total) => {
    setViewCounts(current => (current[kind].inView === inView && current[kind].total === total
      ? current : {...current, [kind]:{inView, total}}));
  }, []);

  /* ---------------------------------------------------------------- address resolution */

  const pendingSignature = pending ? `${pending.lat}:${pending.lng}` : '';
  useEffect(() => {
    if (!pendingSignature) return undefined;
    let cancelled = false;
    resolveAddress({lat:pending.lat, lng:pending.lng})
      .then(address => {
        if (cancelled) return;
        setPending(current => (current ? {...current, status:'ready', address, addressError:''} : current));
      })
      .catch(error => {
        if (cancelled) return;
        setPending(current => (current ? {...current, status:'ready', address:null, addressError:error.message} : current));
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSignature]);


  /* ------------------------------------------------------------ offline road distances */

  const homeSignature = profile.homeLocation ? `${profile.homeLocation.lat}:${profile.homeLocation.lng}` : '';
  const destinationSignature = useMemo(
    () => profile.destinations.map(item => `${item.id}:${item.lat}:${item.lng}`).join('|'),
    [profile.destinations],
  );

  useEffect(() => {
    if (!profile.homeLocation || !profile.destinations.length) {
      setRoutes([]);
      setRouteStatus('idle');
      setRouteMessage('Set home and add at least one destination to calculate real road distances.');
      return undefined;
    }
    let cancelled = false;
    setRouteStatus('loading');
    setRouteMessage('Calculating on the local road network…');
    (async () => {
      const results = [];
      for (const destination of profile.destinations) {
        try {
          const route = await routeOffline(profile.homeLocation, destination);
          results.push({destinationId:destination.id, ...route});
        } catch (error) {
          results.push({destinationId:destination.id, status:error.code || 'unavailable', message:error.message});
        }
      }
      if (cancelled) return;
      setRoutes(results);
      const ready = results.filter(item => item.status === 'ready');
      setRouteStatus(ready.length ? 'ready' : 'unavailable');
      setRouteMessage(ready.length === results.length ? ''
        : `${results.length - ready.length} destination(s) could not be routed on the local road network.`);
      setProfile(current => {
        let changed = false;
        const destinations = current.destinations.map(destination => {
          const route = results.find(item => item.destinationId === destination.id && item.status === 'ready');
          if (!route) return destination;
          const distance = Number(route.distanceMiles.toFixed(3));
          if (destination.routeDistanceMiles === distance && destination.routeMethod === route.method) return destination;
          changed = true;
          return {...destination, routeDistanceMiles:distance, routeMethod:route.method, routeComputedAt:route.computedAt};
        });
        if (!changed) return current;
        return {...current, destinations, derivedData:{...(current.derivedData || {}), routing:{
          status:ready.length ? 'ready' : 'unavailable',
          method:'offline road network (A* search over the local OSM extract)',
          dataSource:'Local OpenStreetMap extract (ODbL 1.0)',
          onlyRealRoadDistances:true,
          routes:ready.map(route => ({
            destinationId:route.destinationId,
            distanceMiles:Number(route.distanceMiles.toFixed(3)),
            distanceMeters:Math.round(route.distanceMeters),
            streetNames:route.streetNames,
            snapMetres:route.snapMetres,
            nodesExpanded:route.nodesExpanded,
          })),
          dailyDrivingMiles:Math.round(dailyDrivingMiles(destinations)),
          computedAt:new Date().toISOString(),
        }}};
      });
    })();
    return () => { cancelled = true; };
  }, [homeSignature, destinationSignature, setProfile]);


  /* ------------------------------------------------------------------ place mutations */

  const updateHome = useCallback(patch => setProfile(current => ({
    ...current, homeLocation:{...(current.homeLocation || {}), ...patch},
  })), [setProfile]);
  const updateDestination = useCallback((id, patch) => setProfile(current => ({
    ...current,
    destinations:current.destinations.map(item => (item.id === id ? {...item, ...patch} : item)),
  })), [setProfile]);
  const removeDestination = useCallback(id => setProfile(current => ({
    ...current, destinations:current.destinations.filter(item => item.id !== id),
  })), [setProfile]);
  const addDestination = useCallback(entry => setProfile(current => ({
    ...current, destinations:[...current.destinations, entry],
  })), [setProfile]);

  const startPending = useCallback((value, patch = {}) => {
    setNotice('');
    setEditingId(null);
    setPending({
      lat:value.lat, lng:value.lng, status:'resolving', address:null,
      type: profile.homeLocation ? 'Other' : 'Home',
      customName:'', roundTripsPerWeek:1, weeksPerYear:DEFAULT_WEEKS.Other, error:'',
      ...patch,
    });
  }, [profile.homeLocation]);

  const applyMove = useCallback(async (value, target) => {
    setMovingId(null);
    setMoveStatus('resolving');
    const address = await resolveAddressQuietly(value);
    if (target === 'home') {
      updateHome({...value, address, addressResolvedAt:new Date().toISOString()});
      setNotice('Home moved: the address was resolved again and every route was recalculated.');
    } else {
      updateDestination(target, {...value, address, addressResolvedAt:new Date().toISOString()});
      setNotice('Place moved: address, road distance and annual miles were recalculated. Its trips per '
        + 'week, weeks per year and note were kept.');
    }
    setMoveStatus(null);
  }, [updateDestination, updateHome]);

  const handleMapClick = useCallback(latlng => {
    const value = point(latlng);
    if (movingId) {
      applyMove(value, movingId);
      return;
    }
    startPending(value);
  }, [applyMove, movingId, startPending]);

  /* ------------------------------------------- address backfill for migrated/legacy places ---- */

  const missingAddressSignature = useMemo(() => {
    const entries = [];
    if (profile.homeLocation && !profile.homeLocation.address) {
      entries.push(`home:${profile.homeLocation.lat}:${profile.homeLocation.lng}`);
    }
    profile.destinations.forEach(item => {
      if (!item.address) entries.push(`${item.id}:${item.lat}:${item.lng}`);
    });
    return entries.join('|');
  }, [profile.homeLocation, profile.destinations]);

  // A profile written before this feature existed has coordinates but no address. Resolving it
  // here keeps the migration lossless: names, trips and weeks are untouched, and only the address
  // that the local OpenStreetMap data actually proves is added.
  useEffect(() => {
    if (!missingAddressSignature) return undefined;
    let cancelled = false;
    (async () => {
      if (profile.homeLocation && !profile.homeLocation.address) {
        updateHome({address:await resolveAddressQuietly(profile.homeLocation)});
      }
      for (const destination of profile.destinations) {
        if (destination.address) continue;
        const address = await resolveAddressQuietly(destination);
        if (cancelled) return;
        updateDestination(destination.id, {address, addressResolvedAt:new Date().toISOString()});
      }
    })();
    return () => { cancelled = true; };
  }, [missingAddressSignature, profile.homeLocation, profile.destinations, updateDestination, updateHome]);

  const savePending = () => {
    if (!pending) return;
    const customName = pending.customName.trim();
    if (pending.type === 'Home') {
      const replacing = Boolean(profile.homeLocation);
      updateHome({
        lat:pending.lat, lng:pending.lng, customName, address:pending.address,
        addressResolvedAt:new Date().toISOString(),
      });
      setNotice(replacing
        ? 'Home replaced with the selected location.'
        : 'Home saved with its locally resolved address.');
    } else {
      const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID() : `destination_${Date.now()}`;
      addDestination({
        id, type:pending.type, customName, name:customName,
        lat:pending.lat, lng:pending.lng, address:pending.address,
        addressResolvedAt:new Date().toISOString(),
        roundTripsPerWeek:pending.roundTripsPerWeek,
        weeksPerYear:pending.weeksPerYear || DEFAULT_WEEKS[pending.type] || 40,
        routeDistanceMiles:null, routeMethod:null, routeComputedAt:null,
      });
      setNotice(`Saved as ${pending.type}${customName ? ` (${customName})` : ''}. The road distance and`
        + ' annual miles are measured on the local road network.');
    }
    setPending(null);
  };

  const applyManualCoordinates = () => {
    const lat = Number(manual.lat);
    const lng = Number(manual.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      setManualError('Enter decimal coordinates: latitude -90 to 90 and longitude -180 to 180.');
      return;
    }
    setManualError('');
    const value = {lat:+lat.toFixed(6), lng:+lng.toFixed(6)};
    setFly(value);
    startPending(value, {type:'Home'});
  };

  const beginMove = id => {
    setMovingId(id);
    setEditingId(null);
    setNotice(id === 'home'
      ? 'Move Home: click the map, or drag the Home pin, to place it again.'
      : 'Move this place: click the map, or drag its pin. Trips, weeks and note stay unchanged.');
  };

  const readyRoutes = routes.filter(route => route.status === 'ready' && route.geometry);
  const dailyMiles = Math.round(dailyDrivingMiles(profile.destinations));
  const located = profile.homeLocation ? {lat:profile.homeLocation.lat, lng:profile.homeLocation.lng} : null;
  const method = routes.find(route => route.method)?.method
    || 'offline road network (OpenStreetMap extract + A* search)';

  return (
    <div className="geo-workspace">
      <div className="map-tools">
        <span className="map-tools-hint" data-testid="map-hint">
          {movingId
            ? 'Click the map (or drag the pin) to move this place.'
            : 'Click anywhere on the local map to select a location, then save it as Home or as a place you visit often.'}
        </span>
        {movingId && (
          <button type="button" onClick={() => { setMovingId(null); setNotice('Move cancelled.'); }} data-testid="cancel-move">
            Cancel move
          </button>
        )}
      </div>
      {dataError && (
        <div className="service-note">
          Local map data could not be read: {dataError} Rebuild it with
          {' '}<code>python tools/build_local_map.py all</code>.
        </div>
      )}
      {facilityError && <div className="service-note">Local station data could not be read: {facilityError}</div>}
      {notice && <p className="place-notice" data-testid="place-notice">{notice}</p>}
      {manifest ? (
        <MapContainer
          className="map"
          center={[manifest.area.center.lat, manifest.area.center.lng]}
          zoom={manifest.area.defaultZoom}
          minZoom={manifest.area.minZoom}
          maxZoom={manifest.area.maxZoom}
          maxBounds={[
            [manifest.area.bounds.minLat - 0.03, manifest.area.bounds.minLon - 0.03],
            [manifest.area.bounds.maxLat + 0.03, manifest.area.bounds.maxLon + 0.03],
          ]}
          maxBoundsViscosity={1}
          scrollWheelZoom
        >
          <Attribution />
          <BasemapLayers manifest={manifest} showLabels={layers.labels} onError={setDataError} />
          <Clicker onPick={handleMapClick} />
          <FlyTo target={fly} />
          <FacilityMarkers payload={facilities.chargers} kind="chargers" visible={layers.chargers} onCounts={handleCounts} />
          <FacilityMarkers payload={facilities.gas} kind="gas" visible={layers.gas} onCounts={handleCounts} />
          {layers.routes && readyRoutes.map(route => (
            <Polyline
              key={route.destinationId}
              positions={route.geometry}
              pathOptions={{color:'#b8ff54', weight:5, opacity:0.85}}
            />
          ))}
          {profile.homeLocation && (
            <Marker
              icon={homeIcon}
              draggable
              position={[profile.homeLocation.lat, profile.homeLocation.lng]}
              eventHandlers={{dragend:event => applyMove(point(event.target.getLatLng()), 'home')}}
            >
              <Popup>
                <b>{profile.homeLocation.customName || 'Home'}</b><br />
                {profile.homeLocation.address
                  ? profile.homeLocation.address.displayName
                  : `${profile.homeLocation.lat}, ${profile.homeLocation.lng}`}
              </Popup>
            </Marker>
          )}
          {profile.destinations.map(destination => (
            <Marker
              key={destination.id}
              icon={destinationIcon}
              draggable
              position={[destination.lat, destination.lng]}
              eventHandlers={{dragend:event => applyMove(point(event.target.getLatLng()), destination.id)}}
            >
              <Popup>
                <b>{destination.customName || destination.type}</b><br />
                {destination.type}<br />
                {destination.address ? destination.address.displayName : 'Address unavailable'}<br />
                {destination.routeDistanceMiles
                  ? `${destination.routeDistanceMiles} mi one way (local road network)`
                  : 'road distance pending'}
              </Popup>
            </Marker>
          ))}
          {pending && (
            <Marker
              icon={pendingIcon}
              draggable
              position={[pending.lat, pending.lng]}
              eventHandlers={{
                dragend:event => {
                  const value = point(event.target.getLatLng());
                  setPending(current => (current ? {...current, ...value, status:'resolving', address:null} : current));
                },
              }}
            >
              <Popup>
                <b>Selected location (not saved yet)</b><br />
                {pending.lat}, {pending.lng}
              </Popup>
            </Marker>
          )}
        </MapContainer>
      ) : <div className="map-placeholder">Loading the local San Jose map…</div>}

      <div className="layer-controls">
        <label>
          <input type="checkbox" checked={layers.routes} onChange={event => setLayers({...layers, routes:event.target.checked})} />
          Routes
        </label>
        <label>
          <input type="checkbox" checked={layers.chargers} onChange={event => setLayers({...layers, chargers:event.target.checked})} />
          EV chargers
          <b data-testid="charger-count">
            {viewCounts.chargers.inView} in view / {viewCounts.chargers.total} local
          </b>
        </label>
        <label>
          <input type="checkbox" checked={layers.gas} onChange={event => setLayers({...layers, gas:event.target.checked})} />
          Gas stations
          <b data-testid="gas-count">
            {viewCounts.gas.inView} in view / {viewCounts.gas.total} local
          </b>
        </label>
        <label>
          <input type="checkbox" checked={layers.labels} onChange={event => setLayers({...layers, labels:event.target.checked})} />
          Neighbourhood labels
        </label>
      </div>
      <p className="map-attribution">
        Basemap, addresses, station positions and road distances all come from a local OpenStreetMap
        extract (© OpenStreetMap contributors, ODbL 1.0){manifest ? ` built ${manifest.generatedAt}` : ''}.
        This map requests no tiles and no geocoder: everything is drawn and matched from the files in
        <code> public/map</code> and <code>public/data</code>.
      </p>
      <PendingLocationPanel
        pending={pending}
        onUpdate={patch => setPending(current => (current ? {...current, ...patch} : current))}
        onSave={savePending}
        onCancel={() => setPending(null)}
        homeExists={Boolean(profile.homeLocation)}
        onSetHomeFromCoordinates={applyManualCoordinates}
        manual={manual}
        setManual={setManual}
        manualError={manualError}
      />
      <div className="driving-overview">
        <h3>Local driving summary</h3>
        <div className="status-grid">
          <article>
            <small>HOME</small>
            <b>{profile.homeLocation ? (profile.homeLocation.customName || 'Home') : 'Not set'}</b>
            <span data-testid="home-summary-address">
              {profile.homeLocation
                ? (profile.homeLocation.address ? profile.homeLocation.address.displayName
                  : `${profile.homeLocation.lat}, ${profile.homeLocation.lng}`)
                : 'No address yet — click the map and save Home'}
            </span>
          </article>
          <article>
            <small>FREQUENT DESTINATIONS</small>
            <b>{profile.destinations.length}</b>
            <span>pinned places with addresses</span>
          </article>
          <article>
            <small>ROUTES</small>
            <b>{routeStatus === 'ready' ? 'Available' : statusLabel(routeStatus)}</b>
            <span>offline A* on the local network</span>
          </article>
          <article>
            <small>DAILY DRIVING</small>
            <b data-testid="daily-miles">{dailyMiles.toLocaleString()} mi/year</b>
            <span>2 × road distance × round trips/week × weeks/year</span>
          </article>
        </div>
        {located && (
          <p className="method-note">
            Within 3 miles of Home: {nearbyCount(facilities.chargers, located, 3)} EV charger(s) and
            {' '}{nearbyCount(facilities.gas, located, 3)} gas station(s), counted from the local files
            (straight-line radius, not a driving distance).
          </p>
        )}
        <div className="route-list">
          {profile.destinations.map(destination => {
            const route = routes.find(item => item.destinationId === destination.id);
            const detail = route
              ? (route.status === 'ready'
                ? `${route.distanceMiles.toFixed(2)} mi one way`
                : statusLabel(route.status))
              : 'Calculating…';
            return (
              <p key={destination.id}>
                <span>{destination.customName || destination.type} · {destination.type}</span>
                <b>{detail}</b>
              </p>
            );
          })}
          {!profile.destinations.length && <p><span>No destinations yet</span><b>Add one on the map</b></p>}
        </div>
        {routeMessage && <p className="method-note">{routeMessage}</p>}
        <p className="method-note">
          Route method: {method}. Home and destinations snap to the closest road node in the local
          extract and the distance is then measured along the roads — never as a straight line.
        </p>
        <p className="method-note" data-testid="address-index-coverage">
          Offline address index: {addressIndex
            ? (addressIndex.available
              ? `${addressIndex.entries.toLocaleString()} mapped addresses (${addressIndex.addressBuildings.toLocaleString()} address buildings + ${addressIndex.addressNodes.toLocaleString()} address points, ${addressIndex.mergedDuplicates.toLocaleString()} duplicates merged) in ${addressIndex.shards} shards, ${addressIndex.streets.toLocaleString()} street names and ${addressIndex.postcodes.toLocaleString()} postcodes. A click reads one shard from public/map/addresses; addresses are matched within ${addressIndex.queryRadiusMetres} m, otherwise the nearest mapped road or area name is shown.`
              : 'unavailable in this build, so clicks fall back to the nearest mapped road or area name.')
            : 'loading…'}
        </p>
      </div>
      <YourPlacesPanel
        profile={profile}
        routes={routes}
        editingId={editingId}
        movingId={movingId}
        moveStatus={moveStatus}
        onEdit={setEditingId}
        onDone={() => setEditingId(null)}
        onMove={beginMove}
        onDelete={removeDestination}
        onUpdateDestination={updateDestination}
        onUpdateHome={updateHome}
        onShow={value => setFly({lat:value.lat, lng:value.lng})}
      />
      <p className="method-note">
        Local data only: the basemap, the address index, the station lists and the road distances all
        come from <code>public/map</code> and <code>public/data</code>. Nothing on this screen calls an
        online service, and no address or coordinate is ever sent anywhere.
      </p>
    </div>
  );
}

