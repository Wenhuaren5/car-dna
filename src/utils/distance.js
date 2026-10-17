const EARTH_RADIUS_MILES = 3958.7613;

export function haversineMiles(a, b) {
  const rad = value => (value * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(x));
}

const toNumber = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Annual daily-driving miles for one destination:
 * 2 x one-way road distance x round trips per week x weeks per year.
 * Only real road distances produced by the offline router are counted.
 */
export function destinationAnnualMiles(destination) {
  const oneWay = toNumber(destination.routeDistanceMiles);
  if (oneWay <= 0) return 0;
  const roundTrips = Math.min(21, Math.max(0, toNumber(destination.roundTripsPerWeek)));
  const weeks = Math.min(52, Math.max(0, toNumber(destination.weeksPerYear)));
  return oneWay * 2 * roundTrips * weeks;
}

export function dailyDrivingMiles(destinations) {
  return destinations.reduce((total, destination) => total + destinationAnnualMiles(destination), 0);
}

export function longDistanceMiles(tripsPerYear, milesPerRoundTrip) {
  const trips = Math.max(0, toNumber(tripsPerYear));
  const distance = Math.max(0, toNumber(milesPerRoundTrip));
  return trips * distance;
}

export function totalAnnualMiles(daily, longDistance) {
  return toNumber(daily) + toNumber(longDistance);
}

export function countWithinRadiusMiles(items, point, radiusMiles) {
  if (!point) return 0;
  return items.filter(item => haversineMiles(point, item) <= radiusMiles).length;
}
