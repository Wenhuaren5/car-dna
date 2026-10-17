import {dailyDrivingMiles, longDistanceMiles} from '../utils/distance';

/**
 * Annual Mileage Summary.
 *
 * Daily driving comes from real road distances measured on the local San Jose network.
 * Long-distance miles come from the two values the user typed. Both parts are stored on the
 * UserDemandProfile (dailyDrivingMiles, longDistanceMiles, totalAnnualMiles) for Algorithm 1.
 */
export default function AnnualMileageSummary({profile}) {
  const destinations = profile.destinations || [];
  const daily = Math.round(dailyDrivingMiles(destinations));
  const longDistance = Math.round(longDistanceMiles(
    profile.longDistanceTripsPerYear, profile.longDistanceRoundTripMiles,
  ));
  const total = daily + longDistance;
  const routed = destinations.filter(item => Number(item.routeDistanceMiles) > 0).length;
  const pending = destinations.length - routed;

  return (
    <section className="mileage-summary">
      <h2>Annual Mileage Summary</h2>
      <p className="lead">
        Daily driving is measured on the local road network; long-distance mileage is what you
        entered. The two parts are kept separate so Algorithm 1 can weigh them independently.
      </p>
      <div className="status-grid">
        <article>
          <small>DAILY DRIVING</small>
          <b data-testid="summary-daily">{daily.toLocaleString()} mi</b>
          <span>{routed} routed destination{routed === 1 ? '' : 's'} · 2 × road distance × trips/week × weeks/year</span>
        </article>
        <article>
          <small>LONG-DISTANCE</small>
          <b data-testid="summary-long">{longDistance.toLocaleString()} mi</b>
          <span>trips per year × miles per round trip (your input)</span>
        </article>
        <article>
          <small>TOTAL ANNUAL MILES</small>
          <b data-testid="summary-total">{total.toLocaleString()} mi</b>
          <span>daily driving + long-distance driving</span>
        </article>
      </div>
      {pending > 0 && (
        <p className="method-note">
          {pending} destination{pending === 1 ? '' : 's'} still have no road distance and therefore add
          0 miles. Reopen Step 3 and wait until every pin shows a distance.
        </p>
      )}
      {profile.estimateMileageLater && (
        <p className="method-note">
          Your own mileage entry is kept separately in <code>annualMileage</code>
          {profile.annualMileage !== '' ? ` (${Number(profile.annualMileage).toLocaleString()} mi)` : ''} and is
          never overwritten by this calculation.
        </p>
      )}
      {!destinations.length && (
        <p className="method-note">No destinations yet: daily driving is currently 0 miles.</p>
      )}
    </section>
  );
}
