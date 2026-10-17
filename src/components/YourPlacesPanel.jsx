import {LOCATION_TYPES, TRIPS_PER_WEEK_LIMITS, WEEKS_PER_YEAR_LIMITS} from '../model/profile';
import {destinationAnnualMiles} from '../utils/distance';
import CountInput from './CountInput';
import LocationAddress from './LocationAddress';

const routeLabel = (destination, route) => {
  if (route && route.status === 'ready') return `${route.distanceMiles.toFixed(2)} mi one way`;
  if (destination.routeDistanceMiles) return `${destination.routeDistanceMiles} mi one way`;
  if (route && route.message) return route.message;
  return 'road distance pending';
};

/** Home plus every saved frequent destination, with edit / move / delete for each of them. */
export default function YourPlacesPanel({
  profile, routes, editingId, movingId, onEdit, onMove, onDelete, onDone,
  onUpdateDestination, onUpdateHome, onShow, moveStatus,
}) {
  const home = profile.homeLocation;
  return (
    <section className="places-panel" data-testid="places-panel">
      <header>
        <h3>Your Places</h3>
        <span>{profile.destinations.length} frequent destination{profile.destinations.length === 1 ? '' : 's'}</span>
      </header>

      <div className="place-group">
        <h4>Home</h4>
        {home ? (
          <article className={`place-row home-row${movingId === 'home' ? ' moving' : ''}`} data-testid="home-row">
            {editingId === 'home' ? (
              <label>Custom name
                <input value={home.customName || ''} aria-label="Home custom name" data-testid="home-name"
                  placeholder="Home" onChange={event => onUpdateHome({customName:event.target.value})} />
              </label>
            ) : (
              <b className="place-name" data-testid="home-name-text">{home.customName || 'Home'}</b>
            )}
            <LocationAddress address={home.address} status={movingId === 'home' ? moveStatus : null} hideDetail
              placeholder="No address resolved for Home yet — use Move to resolve one."
              testId="home-address" />
            <span className="place-meta">{home.lat}, {home.lng}</span>
            <div className="place-actions">
              {editingId === 'home'
                ? <button type="button" onClick={() => onDone()}>Done</button>
                : <button type="button" onClick={() => onEdit('home')}>Edit</button>}
              <button type="button" onClick={() => onMove('home')} data-testid="home-move">
                {movingId === 'home' ? 'Click the map…' : 'Move'}
              </button>
              <button type="button" onClick={() => onShow(home)}>Show</button>
            </div>
          </article>
        ) : <p className="empty-row">No Home yet — click the map, choose Home, then Save Location.</p>}
      </div>

      <div className="place-group">
        <h4>Frequent Destinations</h4>
        <ul className="place-list">
          {profile.destinations.map((destination, index) => {
            const route = routes.find(item => item.destinationId === destination.id);
            const editing = editingId === destination.id;
            const moving = movingId === destination.id;
            return (
              <li key={destination.id} className={`place-row${moving ? ' moving' : ''}`} data-testid="destination-row">
                {editing ? (
                  <div className="place-edit">
                    <label>Location Type
                      <select value={destination.type} aria-label={`Destination type ${index + 1}`}
                        onChange={event => onUpdateDestination(destination.id, {type:event.target.value})}>
                        {LOCATION_TYPES.filter(type => type !== 'Home').map(type => <option key={type}>{type}</option>)}
                      </select>
                    </label>
                    <label>Custom name
                      <input value={destination.customName} aria-label={`Destination name ${index + 1}`}
                        onChange={event => onUpdateDestination(destination.id, {customName:event.target.value})} />
                    </label>
                    <CountInput label="Trips per week" value={destination.roundTripsPerWeek}
                      limits={TRIPS_PER_WEEK_LIMITS} ariaLabel={`Trips per week ${index + 1}`}
                      hint="Round trips per week, 0–21." testId={`trips-${index + 1}`}
                      onChange={value => onUpdateDestination(destination.id, {roundTripsPerWeek:value})} />
                    <CountInput label="Weeks per year" value={destination.weeksPerYear}
                      limits={WEEKS_PER_YEAR_LIMITS} ariaLabel={`Weeks per year ${index + 1}`}
                      hint="Weeks per year, 1–52." testId={`weeks-${index + 1}`}
                      onChange={value => onUpdateDestination(destination.id, {weeksPerYear:value})} />
                  </div>
                ) : (
                  <div className="place-summary">
                    <b className="place-name">{destination.customName}</b>
                    <span className="place-type">{destination.type}</span>
                    <span className="place-meta">
                      {destination.roundTripsPerWeek} round trip(s)/week · {destination.weeksPerYear} weeks/year
                    </span>
                    <span className="place-meta">
                      {routeLabel(destination, route)} · {Math.round(destinationAnnualMiles(destination)).toLocaleString()} mi/year
                    </span>
                  </div>
                )}
                <LocationAddress address={destination.address} status={moving ? moveStatus : null} hideDetail
                  placeholder="No address resolved for this place yet — use Move to resolve one."
                  testId={`destination-address-${index}`} />
                <div className="place-actions">
                  {editing
                    ? <button type="button" onClick={() => onDone()}>Done</button>
                    : <button type="button" onClick={() => onEdit(destination.id)}>Edit</button>}
                  <button type="button" onClick={() => onMove(destination.id)}>
                    {moving ? 'Click the map…' : 'Move'}
                  </button>
                  <button type="button" onClick={() => onShow(destination)}>Show</button>
                  <button type="button" onClick={() => onDelete(destination.id)}>Delete</button>
                </div>
              </li>
            );
          })}
          {!profile.destinations.length && (
            <li className="empty-row">Click the map, pick a type and Save Location to add a frequent destination.</li>
          )}
        </ul>
      </div>
    </section>
  );
}
