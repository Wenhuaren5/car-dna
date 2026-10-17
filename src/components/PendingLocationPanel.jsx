import {LOCATION_TYPES, TRIPS_PER_WEEK_LIMITS} from '../model/profile';
import CountInput from './CountInput';
import LocationAddress from './LocationAddress';

/**
 * Temporary selection panel: everything the user needs to decide about a freshly clicked point
 * before anything is written to the profile. "Save Location" is the only way a place is created.
 */
export default function PendingLocationPanel({pending, onUpdate, onSave, onCancel, homeExists, onSetHomeFromCoordinates, manual, setManual, manualError}) {
  if (!pending) return null;
  const isHome = pending.type === 'Home';
  const saveLabel = isHome ? (homeExists ? 'Replace Home' : 'Save as Home') : 'Save Location';
  const disabled = pending.status === 'resolving' || Boolean(pending.error);
  return (
    <section className="pending-selection" data-testid="pending-selection">
      <header>
        <h3>Selected Location</h3>
        <span className="pending-drag-note">Drag the marker on the map to adjust the point.</span>
      </header>
      <div className="pending-grid">
        <div className="pending-address-cell">
          <LocationAddress address={pending.address} status={pending.status} testId="pending-address" />
        </div>
        <p className="pending-coordinates">
          <small>Coordinates</small>
          <b data-testid="pending-coordinates">{pending.lat}, {pending.lng}</b>
        </p>
        <label className="pending-field">Location Type
          <select value={pending.type} aria-label="Location type" data-testid="pending-type"
            onChange={event => onUpdate({type:event.target.value})}>
            {LOCATION_TYPES.map(type => <option key={type}>{type}</option>)}
          </select>
        </label>
        <label className="pending-field">Custom Name
          <input value={pending.customName} aria-label="Custom name" data-testid="pending-name"
            placeholder={isHome ? 'Home' : 'De Anza College'} onChange={event => onUpdate({customName:event.target.value})} />
        </label>
        {isHome ? (
          <p className="pending-field pending-note">
            <small>Home needs no weekly round trips.</small>
            <small>{homeExists ? 'Saving replaces the Home you already have.' : 'Home is stored as your one home location.'}</small>
          </p>
        ) : (
          <CountInput label="Trips Per Week" value={pending.roundTripsPerWeek} limits={TRIPS_PER_WEEK_LIMITS}
            ariaLabel="Trips per week" testId="pending-trips" hint="Round trips per week, 0–21."
            onChange={value => onUpdate({roundTripsPerWeek:value})} />
        )}
        <p className="pending-field pending-note">
          <small>
            Yearly weeks: {isHome ? 'not used for Home' : `${pending.weeksPerYear} weeks/year (editable after saving)`}
          </small>
          <small>
            {pending.status === 'ready' && pending.address && pending.address.precision !== 'none'
              ? `Address source: ${pending.address.source}`
              : 'Saving is allowed even without a house number.'}
          </small>
        </p>
      </div>
      {!isHome && (
        <p className="method-note">
          The one-way road distance and the annual miles for this place are measured right after saving, on the local road
          network, from the Home you have already set.
        </p>
      )}
      {pending.error && <p className="service-note" data-testid="pending-error">{pending.error}</p>}
      <div className="pending-actions">
        <button type="button" className="primary" data-testid="save-location" disabled={disabled} onClick={onSave}>
          {saveLabel}
        </button>
        <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
      </div>
      <details className="manual-coordinates">
        <summary>Set Home from typed coordinates</summary>
        <div className="manual">
          <label>Latitude
            <input value={manual.lat} aria-label="Home latitude" placeholder="37.3352"
              onChange={event => setManual({...manual, lat:event.target.value})} />
          </label>
          <label>Longitude
            <input value={manual.lng} aria-label="Home longitude" placeholder="-121.8811"
              onChange={event => setManual({...manual, lng:event.target.value})} />
          </label>
          <button type="button" onClick={onSetHomeFromCoordinates}>Use typed coordinates</button>
          {manualError && <em className="field-error">{manualError}</em>}
        </div>
      </details>
    </section>
  );
}
