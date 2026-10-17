import {longDistanceMiles} from '../utils/distance';

/**
 * Long-Distance Driving module.
 *
 * The user supplies both numbers; the annual total is their product. No destination has to
 * be picked on the map and nothing is estimated on the user's behalf.
 */
export default function LongDistanceDriving({profile, set, errors}) {
  const trips = profile.longDistanceTripsPerYear;
  const perTrip = profile.longDistanceRoundTripMiles;
  const complete = trips !== '' && perTrip !== '' && Number.isFinite(+trips) && Number.isFinite(+perTrip);
  const total = longDistanceMiles(trips, perTrip);

  return (
    <>
      <h2>Long-Distance Driving</h2>
      <p className="lead">
        Count the trips that leave your normal routine. You enter both numbers yourself, so nothing
        is guessed; no map selection is required here.
      </p>
      <div className="two">
        <label>Long-distance trips per year
          <input
            type="number" min="0" max="1000" value={trips} placeholder="4"
            onChange={event => set('longDistanceTripsPerYear', event.target.value)}
          />
          {errors.longDistanceTripsPerYear && <em>{errors.longDistanceTripsPerYear}</em>}
        </label>
        <label>Typical miles per round trip
          <input
            type="number" min="0" max="20000" value={perTrip} placeholder="600"
            onChange={event => set('longDistanceRoundTripMiles', event.target.value)}
          />
          {errors.longDistanceRoundTripMiles && <em>{errors.longDistanceRoundTripMiles}</em>}
        </label>
      </div>
      <div className="formula-note" data-testid="long-distance-miles">
        <b>Annual Long-Distance Miles = Trips Per Year × Miles Per Round Trip</b>
        <span>
          {complete
            ? `${Number(trips).toLocaleString()} trips × ${Number(perTrip).toLocaleString()} mi = ${Math.round(total).toLocaleString()} miles per year`
            : 'Enter both values to see the annual long-distance total. Nothing is filled in for you.'}
        </span>
      </div>
    </>
  );
}
