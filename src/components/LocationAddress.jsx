/**
 * Renders the address that the offline reverse geocoder resolved for a point.
 *
 * The wording is deliberately careful: a mapped house number is never presented as *the*
 * address of the clicked point, only as the closest known one, with its distance and source.
 */

const PRECISION_LABEL = {
  house: 'House-number precision',
  street: 'Street precision',
  area: 'Area precision',
  none: 'No address data',
};

export function addressSummary(address) {
  if (!address) return 'Address unavailable';
  return address.displayName || 'Address unavailable';
}

export default function LocationAddress({address, status, placeholder, testId, hideDetail}) {
  if (status === 'resolving') {
    return (
      <p className="address-line address-resolving" data-testid={testId}>
        <b data-testid={testId ? `${testId}-status` : undefined}>Resolving location…</b>
        <small>Matching the point against the local OpenStreetMap address index. Nothing is sent anywhere.</small>
      </p>
    );
  }
  if (!address) {
    return (
      <p className="address-line address-unavailable" data-testid={testId}>
        <b>Address unavailable</b>
        <small>{placeholder || 'No address has been resolved for this location yet.'}</small>
      </p>
    );
  }
  const parts = [];
  if (address.precision) parts.push(PRECISION_LABEL[address.precision] || address.precision);
  if (address.distanceMetres !== null && address.distanceMetres !== undefined) {
    parts.push(`${Math.round(address.distanceMetres)} m away`);
  }
  if (address.components && address.components.postcode) parts.push(`postcode ${address.components.postcode}`);
  if (address.confidence) parts.push(`${address.confidence} confidence`);
  parts.push(address.source || 'OpenStreetMap (ODbL 1.0)');
  return (
    <div className={`address-line address-${address.precision}`} data-testid={testId}>
      <span className="address-label" data-testid={testId ? `${testId}-label` : undefined}>
        {address.matchLabel || 'Address'}
      </span>
      <b data-testid={testId ? `${testId}-text` : undefined}>{address.displayName || 'Address unavailable'}</b>
      <small>{parts.join(' · ')}</small>
      {!hideDetail && address.detail && <small className="address-detail">{address.detail}</small>}
    </div>
  );
}
