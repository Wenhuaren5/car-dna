/**
 * VehicleView adapter — one normalized, read-only view of a Car DNA database record.
 *
 * The database in `src/data/carDatabase.json` stores most measurements as
 * `{value, unit, status}` objects, mixes NEW and USED records, and leaves many optional fields
 * empty. The recommendation pipeline must never read those raw objects directly: a missing value
 * must stay unknown, a status must stay visible and a unit must never be guessed.
 *
 * `adaptVehicle(record)` therefore:
 *   - resolves the identity, condition, powertrain, body type and seating capacity;
 *   - resolves the purchase price and the observed price band without inventing a transaction price;
 *   - resolves MPG, kWh/100 mi, MPGe, electric range and total range with their source status;
 *   - keeps charging power, battery capacity and cargo volume as null when the database has none;
 *   - records the provenance and the fields that were missing, estimated or not applicable.
 *
 * Nothing is fetched, nothing is mutated and no field is filled with 0. The adapter is pure, so
 * adapting the same database always returns the same views.
 */

export const VEHICLE_ADAPTER_VERSION = '1.0';

const POWERTRAIN_VALUES = ['ICE', 'HEV', 'PHEV', 'EV'];
const CONDITION_VALUES = ['NEW', 'USED'];

/**
 * Cargo is not recorded anywhere in the current database (`dimensions.cargoVolume` is null on all
 * 100 records). A body type is therefore the only available cargo evidence. The rank is an
 * ordinal proxy for relative space, never a litre or cubic-foot number.
 */
export const CARGO_PROXY_BY_BODY_TYPE = {
  Hatchback: {classKey: 'compact', rank: 1, label: 'Compact body-type proxy'},
  Sedan: {classKey: 'medium', rank: 2, label: 'Medium body-type proxy'},
  'SUV / Crossover': {classKey: 'large', rank: 3, label: 'Large body-type proxy'},
  'Minivan (MPV)': {classKey: 'very-large', rank: 4, label: 'Very large body-type proxy'},
  'Pickup Truck': {classKey: 'very-large', rank: 4, label: 'Very large open-bed body-type proxy'},
  'Sports Car': {classKey: 'compact', rank: 1, label: 'Compact body-type proxy'},
};

const BODY_TYPE_ALIASES = {
  SUV: 'SUV / Crossover',
  Pickup: 'Pickup Truck',
  Minivan: 'Minivan (MPV)',
};

const normaliseStatus = status => (typeof status === 'string' && status.trim() ? status.trim().toUpperCase() : 'UNKNOWN');

const finitePositive = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

/**
 * Read one `{value, unit, status}` measurement without guessing.
 *
 * - A null/blank value, an unreadable value or a MISSING/NOT_APPLICABLE status means "unknown"
 *   and returns `value: null`.
 * - A unit that is present and differs from the expected unit means "unreadable" and returns
 *   `value: null`, so a value in the wrong unit can never enter a score.
 * - The original status and unit are always preserved on the result.
 */
export function readMeasure(node, expectedUnit = null) {
  if (!node || typeof node !== 'object') {
    return {value: null, unit: null, status: 'MISSING', reason: 'field-not-recorded'};
  }
  const unit = typeof node.unit === 'string' ? node.unit : null;
  const status = normaliseStatus(node.status);
  const raw = node.value;
  if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) {
    return {value: null, unit, status, reason: status === 'NOT_APPLICABLE' ? 'not-applicable' : 'missing'};
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return {value: null, unit, status, reason: 'not-a-number'};
  }
  if (status === 'MISSING' || status === 'NOT_APPLICABLE' || status === 'UNKNOWN') {
    return {value: null, unit, status, reason: `status-${status.toLowerCase()}`};
  }
  if (expectedUnit && unit && unit !== expectedUnit) {
    return {value: null, unit, status, reason: `unit-mismatch:${unit}!=${expectedUnit}`};
  }
  return {value: parsed, unit, status, reason: null};
}

const measureIsKnown = measure => measure && Number.isFinite(measure.value);

/** Resolve the record's own condition without turning an unknown value into NEW. */
function readCondition(record, issues) {
  const raw = typeof record?.identity?.condition === 'string' ? record.identity.condition.trim().toUpperCase() : '';
  if (CONDITION_VALUES.includes(raw)) return raw;
  if (raw) issues.push(`Unrecognised condition "${record.identity.condition}" kept as UNKNOWN.`);
  else issues.push('No vehicle condition is recorded; it stays UNKNOWN.');
  return 'UNKNOWN';
}

function readPowertrain(record, issues) {
  const raw = typeof record?.identity?.powertrain === 'string' ? record.identity.powertrain.trim().toUpperCase() : '';
  if (POWERTRAIN_VALUES.includes(raw)) return raw;
  if (raw) issues.push(`Unrecognised powertrain "${record.identity.powertrain}" kept as UNKNOWN.`);
  else issues.push('No powertrain is recorded; it stays UNKNOWN.');
  return 'UNKNOWN';
}

function readBodyType(record, issues) {
  const stored = typeof record?.identity?.bodyType === 'string' ? record.identity.bodyType.trim() : '';
  const bodyType = BODY_TYPE_ALIASES[stored] || stored;
  if (!bodyType) {
    issues.push('No body type is recorded; the cargo proxy stays unknown.');
    return {bodyType: null, proxy: null};
  }
  const proxy = CARGO_PROXY_BY_BODY_TYPE[bodyType] || null;
  if (!proxy) issues.push(`No cargo proxy exists for body type "${bodyType}".`);
  return {bodyType, proxy};
}

const OFFICIAL_LINK_SCOPES = ['MODEL_FAMILY', 'MODEL_YEAR_USED_LISTINGS'];

/**
 * Pass through a vehicle's external reference only when it is a complete HTTPS URL.
 * HTTP, malformed and missing URLs remain null so the UI cannot render an unsafe link.
 * The scope/note are retained so used-marketplace listings are never described as a
 * manufacturer website.
 */
function readOfficialWebsite(record) {
  const raw = typeof record?.officialWebsite === 'string' ? record.officialWebsite.trim() : '';
  if (!raw) return {officialWebsite: null, officialWebsiteInfo: null};
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return {officialWebsite: null, officialWebsiteInfo: null};
  }
  if (parsed.protocol !== 'https:' || !parsed.hostname) {
    return {officialWebsite: null, officialWebsiteInfo: null};
  }
  const info = record?.officialWebsiteInfo && typeof record.officialWebsiteInfo === 'object'
    ? record.officialWebsiteInfo
    : {};
  return {
    officialWebsite: parsed.href,
    officialWebsiteInfo: {
      scope: OFFICIAL_LINK_SCOPES.includes(info.scope) ? info.scope : 'UNKNOWN',
      note: typeof info.note === 'string' && info.note.trim() ? info.note.trim() : null,
    },
  };
}

/**
 * Price is the estimated purchase price for the condition:
 * NEW records use the estimated purchase price (falling back to the estimated MSRP), USED records
 * use the estimated purchase price (falling back to the estimated asking price). The field that was
 * actually read is recorded, and the price type/status/confidence are never upgraded.
 */
function readPrice(record) {
  const pricing = record?.pricing && typeof record.pricing === 'object' ? record.pricing : {};
  const preferredKeys = record?.identity?.condition === 'USED'
    ? ['estimatedPurchasePrice', 'usedAskingPrice', 'msrp']
    : ['estimatedPurchasePrice', 'msrp', 'usedAskingPrice'];
  const field = preferredKeys.find(key => measureIsKnown(readMeasure(pricing[key], 'USD'))) || preferredKeys[0];
  const measure = readMeasure(pricing[field], 'USD');
  const low = finitePositive(pricing?.priceBandUSD?.low);
  const high = finitePositive(pricing?.priceBandUSD?.high);
  const bandValid = low !== null && high !== null && low <= high;
  return {
    estimatedUSD: measure.value,
    field,
    unit: measure.unit,
    status: measure.status,
    statusReason: measure.reason,
    priceType: typeof pricing.priceType === 'string' ? pricing.priceType : null,
    priceSource: typeof pricing.priceSource === 'string' ? pricing.priceSource : null,
    priceBasis: typeof pricing.priceBasis === 'string' ? pricing.priceBasis : null,
    observationDate: typeof pricing.priceObservationDate === 'string' ? pricing.priceObservationDate : null,
    confidence: typeof pricing.priceConfidence === 'string' ? pricing.priceConfidence.toUpperCase() : 'UNKNOWN',
    budgetFilterEligible: pricing.budgetFilterEligible === true,
    bandUSD: bandValid ? {low, high} : null,
    bandStatus: bandValid ? 'RECORDED' : 'MISSING',
    isEstimate: measure.status !== 'VERIFIED',
  };
}

function readEfficiency(record, powertrain) {
  const efficiency = record?.efficiency && typeof record.efficiency === 'object' ? record.efficiency : {};
  const battery = record?.batteryCharging && typeof record.batteryCharging === 'object' ? record.batteryCharging : {};
  const mpg = readMeasure(efficiency.combinedMpg, 'mpg');
  const cityMpg = readMeasure(efficiency.cityMpg, 'mpg');
  const highwayMpg = readMeasure(efficiency.highwayMpg, 'mpg');
  const mpge = readMeasure(efficiency.mpge, 'MPGe');
  const kwh = readMeasure(efficiency.kwhPer100Miles, 'kWh/100 mi');
  const annualCost = readMeasure(efficiency.epaAnnualFuelCost, 'USD/year');
  const electricRange = readMeasure(battery.electricRange, 'mile');
  const totalRange = readMeasure(battery.totalDrivingRange, 'mile');

  // An EV has no combined MPG by definition and a non-plug-in has no MPGe; those are
  // not-applicable values, not gaps. PHEV carries both because it burns fuel and electricity.
  const mpgExpected = powertrain === 'ICE' || powertrain === 'HEV' || powertrain === 'PHEV';
  const kwhExpected = powertrain === 'EV' || powertrain === 'PHEV';
  const electricRangeExpected = powertrain === 'EV' || powertrain === 'PHEV';

  let totalRangeFallback = null;
  if (!measureIsKnown(totalRange) && powertrain === 'EV' && measureIsKnown(electricRange)) {
    // For a battery-electric vehicle the total driving range is the electric range. Reusing the
    // recorded electric range is a documented identity, not an invented number.
    totalRangeFallback = {
      value: electricRange.value,
      unit: electricRange.unit,
      status: electricRange.status,
      reason: 'electric-range-used-as-total-range',
    };
  }

  return {
    combinedMpg: mpg,
    cityMpg,
    highwayMpg,
    mpge,
    kwhPer100Miles: kwh,
    epaAnnualFuelCostUSD: annualCost,
    electricRangeMiles: electricRange,
    totalRangeMiles: totalRangeFallback || totalRange,
    totalRangeFallbackUsed: Boolean(totalRangeFallback),
    expected: {mpg: mpgExpected, kwh: kwhExpected, electricRange: electricRangeExpected},
    energyDataComplete: (!mpgExpected || measureIsKnown(mpg))
      && (!kwhExpected || measureIsKnown(kwh))
      && measureIsKnown(annualCost),
    fuelType: typeof record?.powertrain?.fuelType === 'string' ? record.powertrain.fuelType : null,
    fuelType2: typeof record?.powertrain?.fuelType2 === 'string' ? record.powertrain.fuelType2 : null,
  };
}

function readCharging(record, powertrain) {
  const battery = record?.batteryCharging && typeof record.batteryCharging === 'object' ? record.batteryCharging : {};
  const batteryCapacity = readMeasure(battery.batteryCapacity, 'kWh');
  const acPower = readMeasure(battery.acChargingPower, 'kW');
  const dcPower = readMeasure(battery.dcFastChargingPeak, 'kW');
  const chargingTime = readMeasure(battery.chargingTime, 'hour');
  const connector = battery.connector && typeof battery.connector === 'object' ? battery.connector : null;
  const connectorValue = connector && typeof connector.value === 'string' && connector.value.trim() ? connector.value.trim() : null;
  const connectorStatus = connector ? normaliseStatus(connector.status) : 'MISSING';
  const plugIn = powertrain === 'EV' || powertrain === 'PHEV';
  return {
    plugIn,
    batteryKWh: batteryCapacity,
    acKW: acPower,
    dcFastKW: dcPower,
    chargingTimeHours: chargingTime,
    connector: connectorValue,
    connectorStatus,
    // Null means unknown. It is never read as "no fast charging" or "0 kW".
    acKnown: measureIsKnown(acPower),
    dcFastKnown: measureIsKnown(dcPower),
    batteryKnown: measureIsKnown(batteryCapacity),
    chargingCapabilityKnown: measureIsKnown(acPower) || measureIsKnown(dcPower) || measureIsKnown(batteryCapacity),
  };
}


function readDimensions(record, bodyProxy) {
  const dimensions = record?.dimensions && typeof record.dimensions === 'object' ? record.dimensions : {};
  const cargoVolume = finitePositive(dimensions.cargoVolume);
  const maximumCargoVolume = finitePositive(dimensions.maximumCargoVolume);
  return {
    cargoVolumeCubicFeet: cargoVolume,
    maximumCargoVolumeCubicFeet: maximumCargoVolume,
    cargoVolumeStatus: cargoVolume === null ? 'MISSING' : 'RECORDED',
    // A body-type proxy is the only cargo evidence when no measured volume exists. It is
    // deliberately ordinal and explicitly labelled; no litre or cubic-foot value is fabricated.
    cargoProxy: bodyProxy
      ? {
        classKey: bodyProxy.classKey,
        rank: bodyProxy.rank,
        label: bodyProxy.label,
        basis: 'body-type-only',
        note: 'Cargo volume is not recorded for this vehicle. The body type is used as a labelled ordinal proxy, not as a measured cargo capacity.',
      }
      : null,
  };
}

function collectMissingFields({price, efficiency, charging, dimensions, bodyType, seats, powertrain}) {
  const missing = [];
  if (price.estimatedUSD === null) missing.push('pricing.estimatedPurchasePrice');
  if (price.bandUSD === null) missing.push('pricing.priceBandUSD');
  if (!bodyType) missing.push('identity.bodyType');
  if (seats === null) missing.push('identity.seatingCapacity');
  if (powertrain === 'ICE' || powertrain === 'HEV' || powertrain === 'PHEV') {
    if (efficiency.combinedMpg.value === null) missing.push('efficiency.combinedMpg');
  }
  if (powertrain === 'EV' || powertrain === 'PHEV') {
    if (efficiency.kwhPer100Miles.value === null) missing.push('efficiency.kwhPer100Miles');
    if (efficiency.electricRangeMiles.value === null) missing.push('batteryCharging.electricRange');
  }
  if (efficiency.epaAnnualFuelCostUSD.value === null) missing.push('efficiency.epaAnnualFuelCost');
  if (efficiency.totalRangeMiles.value === null) missing.push('batteryCharging.totalDrivingRange');
  if (dimensions.cargoVolumeCubicFeet === null) missing.push('dimensions.cargoVolume');
  if (charging.plugIn) {
    if (!charging.acKnown) missing.push('batteryCharging.acChargingPower');
    if (!charging.dcFastKnown) missing.push('batteryCharging.dcFastChargingPeak');
    if (!charging.batteryKnown) missing.push('batteryCharging.batteryCapacity');
    if (charging.connector === null) missing.push('batteryCharging.connector');
  }
  return missing;
}

function coreCoverage({price, efficiency, charging, bodyType, seats}) {
  const checks = [
    price.estimatedUSD !== null,
    price.bandUSD !== null,
    bodyType !== null,
    seats !== null,
    efficiency.totalRangeMiles.value !== null,
    efficiency.epaAnnualFuelCostUSD.value !== null,
  ];
  if (efficiency.expected.mpg) checks.push(efficiency.combinedMpg.value !== null);
  if (efficiency.expected.kwh) checks.push(efficiency.kwhPer100Miles.value !== null);
  if (efficiency.expected.electricRange) checks.push(efficiency.electricRangeMiles.value !== null);
  if (charging.plugIn) checks.push(charging.chargingCapabilityKnown);
  return checks.filter(Boolean).length / checks.length;
}

function confidenceFor({price, efficiency, charging, bodyType, seats, missing}) {
  if (price.estimatedUSD === null || seats === null || bodyType === null) return 'LOW';
  if (price.confidence === 'LOW') return 'LOW';
  if (!efficiency.energyDataComplete) return 'LOW';
  if (charging.plugIn && !charging.chargingCapabilityKnown) return 'MEDIUM';
  if (missing.some(item => item === 'efficiency.combinedMpg' || item === 'efficiency.kwhPer100Miles')) return 'LOW';
  return price.confidence === 'HIGH' ? 'MEDIUM' : 'MEDIUM';
}

function provenanceFor(record) {
  const sources = Array.isArray(record?.sources) ? record.sources : [];
  return {
    sourceCount: sources.length,
    sources: sources.map(source => ({
      type: typeof source?.type === 'string' ? source.type : null,
      url: typeof source?.url === 'string' ? source.url : null,
      note: typeof source?.note === 'string' ? source.note : null,
    })),
    databaseStatus: {
      identity: record?.dataQuality?.identityStatus || null,
      trim: record?.dataQuality?.trimStatus || null,
      pricing: record?.dataQuality?.pricingStatus || null,
      efficiency: record?.dataQuality?.efficiencyStatus || null,
      range: record?.dataQuality?.rangeStatus || null,
      sourceCoverage: record?.dataQuality?.sourceCoverage || null,
    },
  };
}


/**
 * Adapt one database record into a VehicleView.
 *
 * @param {object} record one entry of `carDatabase.vehicles`.
 * @returns {object} a plain, JSON-serializable view. `__vehicleView: true` marks it as adapted.
 */
export function adaptVehicle(record) {
  const issues = [];
  if (!record || typeof record !== 'object') {
    return {
      __vehicleView: true,
      adapterVersion: VEHICLE_ADAPTER_VERSION,
      vehicleId: null,
      valid: false,
      issues: ['The vehicle record is not an object.'],
    };
  }

  const vehicleId = typeof record.vehicleId === 'string' && record.vehicleId.trim() ? record.vehicleId.trim() : null;
  if (!vehicleId) issues.push('No vehicleId is recorded.');

  const condition = readCondition(record, issues);
  const powertrain = readPowertrain(record, issues);
  const {bodyType, proxy} = readBodyType(record, issues);
  const rawSeats = Number(record?.identity?.seatingCapacity);
  const seats = Number.isFinite(rawSeats) && rawSeats >= 1 ? Math.round(rawSeats) : null;
  if (seats === null) issues.push('No usable seating capacity is recorded.');

  const price = readPrice(record);
  const efficiency = readEfficiency(record, powertrain);
  const charging = readCharging(record, powertrain);
  const dimensions = readDimensions(record, proxy);
  const {officialWebsite, officialWebsiteInfo} = readOfficialWebsite(record);
  const missingFields = collectMissingFields({price, efficiency, charging, dimensions, bodyType, seats, powertrain});
  const estimatedFields = [];
  if (price.estimatedUSD !== null && price.isEstimate) estimatedFields.push('pricing.estimatedPurchasePrice');
  if (efficiency.totalRangeFallbackUsed) estimatedFields.push('batteryCharging.totalDrivingRange');

  const identity = record.identity && typeof record.identity === 'object' ? record.identity : {};
  return {
    __vehicleView: true,
    adapterVersion: VEHICLE_ADAPTER_VERSION,
    valid: Boolean(vehicleId) && POWERTRAIN_VALUES.includes(powertrain) && seats !== null && price.estimatedUSD !== null,
    vehicleId,
    displayName: typeof identity.displayName === 'string' && identity.displayName.trim() ? identity.displayName.trim() : vehicleId,
    brand: typeof identity.brand === 'string' ? identity.brand : null,
    model: typeof identity.model === 'string' ? identity.model : null,
    modelYear: Number.isFinite(Number(identity.modelYear)) ? Number(identity.modelYear) : null,
    trim: typeof identity.trim === 'string' ? identity.trim : null,
    condition,
    powertrain,
    isPlugIn: charging.plugIn,
    bodyType,
    vehicleClass: typeof identity.vehicleClass === 'string' ? identity.vehicleClass : null,
    drivetrain: typeof identity.drivetrain === 'string' ? identity.drivetrain : null,
    seats,
    officialWebsite,
    officialWebsiteInfo,
    price,
    efficiency,
    charging,
    dimensions,
    dataQuality: {
      missingFields,
      estimatedFields,
      notApplicableFields: [
        powertrain === 'EV' ? 'efficiency.combinedMpg' : null,
        powertrain === 'ICE' || powertrain === 'HEV' ? 'efficiency.kwhPer100Miles' : null,
        powertrain === 'ICE' || powertrain === 'HEV' ? 'batteryCharging.electricRange' : null,
        powertrain === 'ICE' || powertrain === 'HEV' ? 'batteryCharging.acChargingPower' : null,
      ].filter(Boolean),
      priceConfidence: price.confidence,
      confidence: confidenceFor({price, efficiency, charging, bodyType, seats, missing: missingFields}),
      coreFieldCoverage: Math.round(coreCoverage({price, efficiency, charging, bodyType, seats}) * 100) / 100,
      recommendationEligible: record?.dataQuality?.recommendationEligible !== false,
      issues,
      notes: [
        'Prices in the current database are estimates, not verified transaction prices. The adapter never upgrades an ESTIMATED value to VERIFIED.',
        'Cargo volume is absent for this database. Only a labelled body-type proxy is available; it is not a measured cargo capacity.',
        'Charging power, battery capacity and connector are kept null when the database does not record them. Null means unknown, not 0.',
      ],
    },
    provenance: provenanceFor(record),
  };
}


/** Adapt every record of a database object or a raw array. */
export function adaptVehicles(database) {
  const records = Array.isArray(database) ? database : database?.vehicles;
  if (!Array.isArray(records)) throw new TypeError('adaptVehicles expects carDatabase.vehicles or an array of vehicle records.');
  return records.map(adaptVehicle);
}

/**
 * Validate the adapted views. This is the guard used by Checkpoint A and by the pipeline, so a
 * broken adaptation cannot silently reach the matcher.
 */
export function validateVehicleViews(views, expectedCount = null) {
  const errors = [];
  const warnings = [];
  if (!Array.isArray(views)) {
    return {ok: false, count: 0, errors: ['The adapted vehicle list is not an array.'], warnings};
  }
  if (expectedCount !== null && views.length !== expectedCount) {
    errors.push(`Expected ${expectedCount} adapted vehicles, received ${views.length}.`);
  }
  const seen = new Set();
  views.forEach((view, index) => {
    const at = `views[${index}]`;
    if (!view || view.__vehicleView !== true) errors.push(`${at} is not a VehicleView.`);
    if (!view?.vehicleId) errors.push(`${at} has no vehicleId.`);
    else if (seen.has(view.vehicleId)) errors.push(`${at} repeats vehicleId ${view.vehicleId}.`);
    else seen.add(view.vehicleId);
    if (!POWERTRAIN_VALUES.includes(view?.powertrain)) errors.push(`${at} has powertrain ${view?.powertrain}.`);
    if (!CONDITION_VALUES.includes(view?.condition)) errors.push(`${at} has condition ${view?.condition}.`);
    if (!Number.isInteger(view?.seats) || view.seats < 1) errors.push(`${at} has no positive integer seat count.`);
    if (view?.price?.estimatedUSD === null || view?.price?.estimatedUSD === undefined) errors.push(`${at} has no usable price.`);
    if (!view?.bodyType) errors.push(`${at} has no body type.`);
    if (view?.price?.bandUSD === null) warnings.push(`${at} has no price band.`);
    if (!view?.dimensions?.cargoVolumeCubicFeet && !view?.dimensions?.cargoProxy) warnings.push(`${at} has no cargo evidence.`);
    if (view?.powertrain === 'EV' || view?.powertrain === 'PHEV') {
      if (!view?.charging?.chargingCapabilityKnown) warnings.push(`${at} has no recorded charging power or battery capacity.`);
    }
  });
  return {ok: errors.length === 0, count: views.length, errors, warnings};
}

