/**
 * Display helpers for local facility records.
 *
 * Every value that is not present in the OpenStreetMap source is rendered as "Unknown".
 * Nothing is estimated: no connector type, no power rating, no price and no live
 * availability is ever inferred from another field.
 */

export const UNKNOWN = 'Unknown';
export const NOT_CLAIMED = 'Not reported by the data source — never claimed here.';

const value = input => (input === null || input === undefined || input === '' ? UNKNOWN : input);

const list = input => (Array.isArray(input) && input.length ? input.join(' · ') : UNKNOWN);

const power = input => {
  const entries = Object.entries(input || {});
  return entries.length ? entries.map(([key, amount]) => `${key}: ${amount}`).join(' · ') : UNKNOWN;
};

const count = (input, suffix) => (Number.isFinite(Number(input)) && input !== null && input !== ''
  ? `${Number(input)} ${suffix}` : UNKNOWN);

export function chargingRows(station) {
  return [
    ['Operator', value(station.operator)],
    ['Network', value(station.network)],
    ['Address', value(station.address)],
    ['Connectors recorded', list(station.connectors)],
    ['Power recorded', power(station.reportedPower)],
    ['Capacity recorded', count(station.capacity, 'vehicles')],
    ['Opening hours', value(station.openingHours)],
    ['Access', value(station.access)],
    ['Fee', value(station.fee)],
    ['Live availability', NOT_CLAIMED],
    ['Source', value(station.source)],
    ['Retrieved', value(station.retrievedAt)],
  ];
}

export function gasRows(station) {
  return [
    ['Brand', value(station.brand)],
    ['Operator', value(station.operator)],
    ['Address', value(station.address)],
    ['Fuel types', value(station.fuelTypes)],
    ['Opening hours', value(station.openingHours)],
    ['Fuel prices', NOT_CLAIMED],
    ['Live status', NOT_CLAIMED],
    ['Source', value(station.source)],
    ['Retrieved', value(station.retrievedAt)],
  ];
}

export function facilityRows(station, kind) {
  return kind === 'chargers' ? chargingRows(station) : gasRows(station);
}

export function facilityTitle(station) {
  return station.name || station.brand || station.operator || `${station.type || 'Facility'} (no name recorded)`;
}
