/**
 * Algorithm 2a — Ideal Car DNA.
 *
 * The ideal DNA is a small set of *targets* derived from the user's hard constraints and from the
 * observed distribution of real, adapted cars. It is not a fictional vehicle:
 *
 *   - every target comes from the user's answers (budget, seats, cargo need, trips, mileage) and
 *     from percentiles of real database records that satisfy the hard constraints;
 *   - the target price is capped by the user's budget and is never below an observed price band;
 *   - an empty market is reported as empty, not filled with an invented benchmark;
 *   - every target carries its basis, sample count and uncertainty;
 *   - cargo has no measured volume in this database, so the DNA uses a labelled ordinal body-type
 *     proxy and states that limitation instead of inventing cubic feet.
 *
 * Six display axes are produced for the radar chart. They roll up into the four demand weights:
 * cost (price + energy cost), time (range + charging/refuelling), emissions and comfort/space
 * (seats + cargo).
 */

import {computeVehicleMetrics, METRIC_ASSUMPTIONS} from './vehicleMetrics.js';

export const IDEAL_DNA_SCHEMA_VERSION = '1.0';

const CARGO_NEED_RANK = {
  small: 1,
  medium: 2,
  large: 3,
  'extra large': 4,
  xl: 4,
  maximum: 4,
};

const BODY_TYPE_FALLBACK_RANK = {
  Hatchback: 1,
  Sedan: 2,
  'Sports Car': 1,
  'SUV / Crossover': 3,
  'Minivan (MPV)': 4,
  'Pickup Truck': 4,
};

const round = (value, step = 1) => (Number.isFinite(value) ? Math.round(value / step) * step : null);
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/** Linear-interpolated percentile. Returns null for an empty sample. */
export function percentile(values, fraction) {
  const sorted = (Array.isArray(values) ? values : [])
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const position = clamp(fraction, 0, 1) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export function describeSample(values) {
  const numbers = (Array.isArray(values) ? values : []).map(Number).filter(Number.isFinite);
  return {
    count: numbers.length,
    min: numbers.length ? Math.min(...numbers) : null,
    p25: percentile(numbers, 0.25),
    median: percentile(numbers, 0.5),
    p75: percentile(numbers, 0.75),
    max: numbers.length ? Math.max(...numbers) : null,
  };
}

const conditionAccepts = (view, wanted) => {
  if (wanted === 'New') return view.condition === 'NEW';
  if (wanted === 'Used') return view.condition === 'USED';
  return true;
};

/**
 * Split the market into the hard-constraint pool and the preferred-body-type sample.
 *
 * The hard pool applies seats, powertrain, condition and recommendation eligibility. Price is
 * handled separately because a price band can straddle the budget: those cars are *conditionally*
 * affordable and must not disappear silently.
 */
export function selectMarketSample(views, demand) {
  const constraints = demand?.constraints || {};
  const budget = Number(constraints.maxPurchasePriceUSD);
  const minimumSeats = Number(constraints.minimumSeats) || 1;
  const powertrains = Array.isArray(constraints.acceptablePowertrains) ? constraints.acceptablePowertrains : [];
  const condition = constraints.vehicleCondition || 'Either';
  const bodyPreference = constraints.softPreferences?.preferredBodyType || 'No Preference';

  const hardPool = views.filter(view => view.valid !== false
    && view.dataQuality?.recommendationEligible !== false
    && Number(view.seats) >= minimumSeats
    && (!powertrains.length || powertrains.includes(view.powertrain))
    && conditionAccepts(view, condition));

  const withinBudget = hardPool.filter(view => {
    if (!Number.isFinite(budget)) return true;
    const low = view.price?.bandUSD?.low;
    const point = view.price?.estimatedUSD;
    return Number.isFinite(low) ? low <= budget : Number.isFinite(point) && point <= budget;
  });
  const missingPrice = hardPool.filter(view => !Number.isFinite(view.price?.estimatedUSD));

  const affordablePool = withinBudget.length ? withinBudget : hardPool;
  const preferredPool = bodyPreference !== 'No Preference'
    ? affordablePool.filter(view => view.bodyType === bodyPreference)
    : [];
  const usedPreferredBody = preferredPool.length >= 3;
  const samplePool = usedPreferredBody ? preferredPool : affordablePool;

  return {
    samplePool,
    usedPreferredBody,
    bodyPreference,
    condition,
    budget: Number.isFinite(budget) ? budget : null,
    counts: {
      total: views.length,
      hardPool: hardPool.length,
      withinBudget: withinBudget.length,
      preferredBody: preferredPool.length,
      sample: samplePool.length,
      missingPrice: missingPrice.length,
    },
  };
}

function target({key, label, unit, direction, ideal, acceptableMin = null, acceptableMax = null, hardMin = null, hardMax = null, observed, basis, source, uncertainty}) {
  return {
    key,
    label,
    unit,
    direction,
    ideal: Number.isFinite(ideal) ? ideal : null,
    acceptableMin: Number.isFinite(acceptableMin) ? acceptableMin : null,
    acceptableMax: Number.isFinite(acceptableMax) ? acceptableMax : null,
    hardMin: Number.isFinite(hardMin) ? hardMin : null,
    hardMax: Number.isFinite(hardMax) ? hardMax : null,
    observed: observed || {count: 0},
    basis,
    source,
    uncertainty: uncertainty || {level: 'MEDIUM', note: 'Derived from the observed sample.'},
  };
}

const knownNumber = value => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

function resolveAnnualMiles(demand, options) {
  const provided = knownNumber(options.annualMiles);
  if (provided !== null && provided >= 0) {
    return {annualMiles: provided, source: options.annualMilesSource || 'caller-provided'};
  }
  const total = knownNumber(demand?.usage?.totalAnnualMiles);
  if (total !== null && total >= 0) {
    return {annualMiles: total, source: 'demand-model-totalAnnualMiles'};
  }
  return {
    annualMiles: METRIC_ASSUMPTIONS.defaultAnnualMiles,
    source: 'placeholder-12000-mi',
    isPlaceholder: true,
  };
}

function resolveDailyMiles(demand, annualMiles) {
  const daily = knownNumber(demand?.usage?.dailyAnnualMiles);
  if (daily !== null && daily > 0) return daily / 260;
  const total = knownNumber(demand?.usage?.totalAnnualMiles);
  if (total !== null && total > 0) return total / 365;
  return Number.isFinite(annualMiles) && annualMiles > 0 ? annualMiles / 365 : null;
}

function sampleMetrics(views, {annualMiles, dailyMiles}) {
  return views.map(view => ({
    view,
    metrics: computeVehicleMetrics(view, {annualMiles, dailyMiles, annualMilesSource: 'ideal-dna-targets'}),
  }));
}

function buildTargets({sample, metrics, demand, annualMiles, mileageSource}) {
  const constraints = demand?.constraints || {};
  const usage = demand?.usage || {};
  const budget = Number(constraints.maxPurchasePriceUSD);
  const minimumSeats = Number(constraints.minimumSeats) || 1;
  const priceStats = describeSample(sample.map(view => view.price?.estimatedUSD));
  const costStats = describeSample(metrics.map(item => item.metrics.cost.annualUSD));
  const emissionStats = describeSample(metrics.map(item => item.metrics.emissions.gramsCO2PerMile));
  const rangeStats = describeSample(sample.map(view => view.efficiency?.totalRangeMiles?.value));
  const seatStats = describeSample(sample.map(view => view.seats));
  const cargoStats = describeSample(sample.map(view => view.dimensions?.cargoProxy?.rank));

  const empiricalPrice = Number.isFinite(priceStats.p25) ? priceStats.p25 : null;
  const cappedPrice = Number.isFinite(budget)
    ? (empiricalPrice === null ? budget : Math.min(empiricalPrice, budget))
    : empiricalPrice;
  const idealPrice = round(cappedPrice, 500);
  const priceSource = empiricalPrice !== null ? 'observed-p25-capped-by-budget' : 'budget-only-no-sample';
  const longTrips = Number(usage.longDistanceTripsPerYear) || 0;
  const tripMiles = Number(usage.longDistanceRoundTripMiles) || 0;
  const roadTripNeed = longTrips > 0 && tripMiles > 0 ? tripMiles + 50 : 0;
  const frequencyFloor = usage.roadTripFrequency === 'Frequently' ? 350 : usage.roadTripFrequency === 'Occasionally' ? 275 : 225;
  const observedRangeFloor = Number.isFinite(rangeStats.p25) ? rangeStats.p25 : 0;
  const idealRange = round(Math.max(frequencyFloor, roadTripNeed, observedRangeFloor), 25);
  const minimumRange = round(Math.max(150, longTrips > 0 && tripMiles > 0 ? tripMiles + 25 : frequencyFloor * 0.7), 25);

  const cargoNeed = String(constraints.softPreferences?.cargoNeeds || '').trim().toLowerCase();
  const bodyType = constraints.softPreferences?.preferredBodyType || '';
  const cargoTarget = CARGO_NEED_RANK[cargoNeed] || BODY_TYPE_FALLBACK_RANK[bodyType] || 2;
  const seatAspiration = Math.min(8, minimumSeats + 2);
  const cargoAspiration = Math.min(4, cargoTarget + 1);

  return {
    purchasePriceUSD: target({
      key: 'purchasePriceUSD',
      label: 'Purchase price',
      unit: 'USD',
      direction: 'lower',
      ideal: idealPrice,
      acceptableMax: Number.isFinite(budget) ? budget : null,
      hardMax: Number.isFinite(budget) ? budget : null,
      observed: priceStats,
      basis: empiricalPrice === null
        ? 'The user budget is the only defensible target because no adapted vehicle matched the hard constraints.'
        : `25th percentile of ${priceStats.count} affordable, hard-constraint-matching vehicles, capped at the user budget.`,
      source: priceSource,
      uncertainty: priceStats.count === 0
        ? {level: 'HIGH', note: 'No affordable sample matched the hard constraints, so the price target is the user budget itself.'}
        : {level: 'HIGH', note: 'Every database price is an ESTIMATED value; the target is a percentile of estimates, not an observed transaction price.'},
    }),
    annualEnergyCostUSD: target({
      key: 'annualEnergyCostUSD',
      label: 'Annual energy cost',
      unit: 'USD/year',
      direction: 'lower',
      ideal: round(costStats.p25, 10),
      acceptableMax: round(costStats.p75, 10),
      observed: {...costStats, annualMiles, mileageSource},
      basis: `25th percentile of derived annual energy cost at ${annualMiles.toLocaleString()} miles/year; the 75th percentile is the acceptable ceiling.`,
      source: costStats.count ? 'observed-p25-p75' : 'no-sample',
      uncertainty: {
        level: mileageSource === 'placeholder-12000-mi' ? 'HIGH' : 'MEDIUM',
        note: mileageSource === 'placeholder-12000-mi'
          ? 'Annual mileage is unknown, so a 12,000-mile placeholder was used for target-setting and scoring. This is not the user\'s measured mileage.'
          : 'Derived from one documented fuel price, electricity price and PHEV electric-share model; not a utility bill.',
      },
    }),

    emissionsGramsPerMile: target({
      key: 'emissionsGramsPerMile',
      label: 'Well-to-wheel proxy emissions',
      unit: 'g CO2/mi',
      direction: 'lower',
      ideal: round(emissionStats.p25, 1),
      acceptableMax: round(emissionStats.p75, 1),
      observed: emissionStats,
      basis: '25th percentile of derived tailpipe + grid emissions at the current annual mileage; the 75th percentile is the acceptable ceiling.',
      source: emissionStats.count ? 'observed-p25-p75' : 'no-sample',
      uncertainty: {
        level: 'MEDIUM',
        note: 'Tailpipe and grid factors are documented averages, not a lifecycle assessment; the same factors are applied to every vehicle.',
      },
    }),
    rangeMiles: target({
      key: 'rangeMiles',
      label: 'Driving range',
      unit: 'mi',
      direction: 'higher',
      ideal: idealRange,
      acceptableMin: minimumRange,
      observed: rangeStats,
      basis: `Maximum of the road-trip need (${Math.round(roadTripNeed)} mi), the ${usage.roadTripFrequency || 'Occasional'} road-trip floor and the observed 25th percentile.`,
      source: 'user-trips-and-observed-p25',
      uncertainty: {
        level: 'LOW',
        note: 'Ranges are recorded by the database; the target is a planning floor, not a guarantee for every route, temperature or load.',
      },
    }),
    seats: target({
      key: 'seats',
      label: 'Seating capacity',
      unit: 'seats',
      direction: 'higher',
      ideal: minimumSeats,
      acceptableMin: minimumSeats,
      hardMin: minimumSeats,
      observed: seatStats,
      basis: 'The user minimum seat count is the target. Larger vehicles score no better, because extra seats are not automatically a benefit.',
      source: 'user-hard-constraint',
      uncertainty: {level: 'LOW', note: 'Recorded seating capacity is a hard constraint and is present on every adapted vehicle.'},
    }),
    cargoRank: target({
      key: 'cargoRank',
      label: 'Cargo / space proxy',
      unit: 'rank (1–4)',
      direction: 'higher',
      ideal: cargoTarget,
      acceptableMin: Math.max(1, cargoTarget - 1),
      observed: cargoStats,
      basis: `The cargo-need answer maps to ordinal rank ${cargoTarget}. Measured cargo volume is absent in the database, so this is a labelled body-type proxy.`,
      source: 'cargo-need-and-body-type-proxy',
      uncertainty: {
        level: 'HIGH',
        note: 'No vehicle records a cargo volume. The rank is an ordinal body-type proxy, not cubic feet or litres.',
      },
    }),
    _aspirational: {
      priceUSD: Number.isFinite(budget) ? budget : null,
      seats: seatAspiration,
      cargoRank: cargoAspiration,
      rangeMiles: round(rangeStats.p75, 25),
      annualEnergyCostUSD: round(costStats.min, 10),
      emissionsGramsPerMile: round(emissionStats.min, 1),
      note: 'Stretch values are informational only and are not used by the score.',
    },
  };
}


function buildUncertainty({demand, sample, mileageSource, counts, samplePool, priceStats}) {
  const items = [];
  const add = (code, severity, message, affects) => items.push({code, severity, message, affects});
  if (mileageSource === 'placeholder-12000-mi') {
    add('annual-mileage-placeholder', 'HIGH', 'Annual mileage is unknown. Energy cost and emissions targets use a 12,000 mi/yr placeholder, not the user\'s measured mileage.', ['annualEnergyCostUSD', 'emissionsGramsPerMile', 'score']);
  }
  if (priceStats.count > 0) {
    add('estimated-prices', 'HIGH', 'All database prices are ESTIMATED. A price target is a percentile of estimates and cannot be treated as a negotiated out-the-door price.', ['purchasePriceUSD', 'score']);
  }
  add('cargo-proxy', 'HIGH', 'Cargo volume is missing for every vehicle. Comfort/space uses a labelled body-type proxy, not measured cargo volume.', ['cargoRank', 'comfortSpace']);
  if (!counts.sample) {
    add('empty-market-sample', 'HIGH', 'No vehicle matched all hard constraints and the budget. The DNA can still describe the demand, but it has no empirical market anchor.', ['all-targets']);
  } else if (counts.sample < 5) {
    add('small-sample', 'MEDIUM', `Only ${counts.sample} vehicle${counts.sample === 1 ? '' : 's'} matched the hard constraints. Percentile targets are sensitive to one record.`, ['all-targets']);
  }
  if (counts.preferredBody < 3 && counts.bodyPreference !== 'No Preference') {
    add('body-preference-not-represented', 'MEDIUM', `Fewer than three affordable ${counts.bodyPreference} vehicles matched, so the empirical sample falls back to all body types.`, ['all-targets']);
  }
  const plugInSample = sample.filter(view => view.powertrain === 'EV' || view.powertrain === 'PHEV');
  const missingCharging = plugInSample.filter(view => !view.charging?.chargingCapabilityKnown).length;
  if (missingCharging > 0) {
    add('charging-data-missing', 'MEDIUM', `${missingCharging} of ${plugInSample.length} plug-in sample vehicles have no recorded charging power or battery capacity. Charging convenience cannot be verified for them.`, ['range', 'time']);
  }
  if (demand?.dataQuality?.missingInputs?.length) {
    demand.dataQuality.missingInputs.forEach(input => {
      add(`demand-gap:${input.path}`, 'MEDIUM', input.reason, ['demand-model']);
    });
  }
  return items;
}

function buildDisplayAxes() {
  return [
    {
      key: 'priceFit',
      label: 'Price fit',
      shortLabel: 'Price',
      dimension: 'cost',
      weightWithinDimension: 0.55,
      targetKey: 'purchasePriceUSD',
      direction: 'lower',
      description: 'How close the estimated purchase price is to the observed, budget-capped target.',
    },
    {
      key: 'energyCost',
      label: 'Energy cost',
      shortLabel: 'Energy',
      dimension: 'cost',
      weightWithinDimension: 0.45,
      targetKey: 'annualEnergyCostUSD',
      direction: 'lower',
      description: 'Derived annual fuel + electricity cost at the user\'s annual mileage.',
    },
    {
      key: 'emissions',
      label: 'Emissions',
      shortLabel: 'CO₂',
      dimension: 'emissions',
      weightWithinDimension: 1,
      targetKey: 'emissionsGramsPerMile',
      direction: 'lower',
      description: 'Derived tailpipe + grid CO₂ proxy per mile. Not a lifecycle assessment.',
    },
    {
      key: 'range',
      label: 'Range',
      shortLabel: 'Range',
      dimension: 'time',
      weightWithinDimension: 1,
      targetKey: 'rangeMiles',
      direction: 'higher',
      description: 'Recorded total driving range against the user\'s road-trip need.',
    },
    {
      key: 'seats',
      label: 'Seating',
      shortLabel: 'Seats',
      dimension: 'comfortSpace',
      weightWithinDimension: 0.45,
      targetKey: 'seats',
      direction: 'higher',
      description: 'Recorded seating capacity against the hard minimum.',
    },
    {
      key: 'cargo',
      label: 'Cargo / space',
      shortLabel: 'Space',
      dimension: 'comfortSpace',
      weightWithinDimension: 0.55,
      targetKey: 'cargoRank',
      direction: 'higher',
      description: 'Labelled body-type cargo proxy. Measured cargo volume is unavailable.',
    },
  ];
}


function normaliseWeights(demand) {
  const source = demand?.preferences?.weights || {};
  const order = ['cost', 'time', 'emissions', 'comfortSpace'];
  const raw = order.map(key => Number(source[key]));
  const valid = raw.every(value => Number.isFinite(value) && value >= 0);
  const total = valid ? raw.reduce((sum, value) => sum + value, 0) : 0;
  const weights = valid && Math.abs(total - 1) < 1e-6
    ? Object.fromEntries(order.map((key, index) => [key, raw[index]]))
    : {cost: 0.25, time: 0.25, emissions: 0.25, comfortSpace: 0.25};
  return {
    weights,
    source: valid && Math.abs(total - 1) < 1e-6 ? 'demand-model-normalized-weights' : 'equal-weights-fallback',
    selectedPriorities: demand?.preferences?.selectedPriorities || [],
    weightRule: demand?.preferences?.weightRule || null,
    labels: {
      cost: 'Save money',
      time: 'Save time',
      emissions: 'Environment',
      comfortSpace: 'Comfort & space',
    },
  };
}

/**
 * Build the Ideal Car DNA from a demand model and the adapted vehicle pool.
 *
 * @param {object} demand result of `buildDemandModel(profile)`.
 * @param {object[]} views adapted VehicleViews.
 * @param {object} [options] optional annualMiles/dailyMiles and infrastructure evidence.
 * @returns {object} a plain, JSON-serializable ideal DNA. No vehicle is created here.
 */
export function generateIdealDna(demand, views, options = {}) {
  if (!demand || typeof demand !== 'object' || !demand.constraints) {
    throw new TypeError('generateIdealDna expects the demand model returned by buildDemandModel(profile).');
  }
  if (!Array.isArray(views)) throw new TypeError('generateIdealDna expects an array of adapted VehicleViews.');

  const market = selectMarketSample(views, demand);
  const mileage = resolveAnnualMiles(demand, options);
  const dailyMiles = resolveDailyMiles(demand, mileage.annualMiles);
  const metrics = sampleMetrics(market.samplePool, {annualMiles: mileage.annualMiles, dailyMiles});
  const rawTargets = buildTargets({
    sample: market.samplePool,
    metrics,
    demand,
    annualMiles: mileage.annualMiles,
    mileageSource: mileage.source,
  });
  const {_aspirational: aspirational, ...targets} = rawTargets;
  const uncertainty = buildUncertainty({
    demand,
    sample: market.samplePool,
    mileageSource: mileage.source,
    counts: {...market.counts, bodyPreference: market.bodyPreference},
    samplePool: market.samplePool,
    priceStats: targets.purchasePriceUSD.observed,
  });
  const weightModel = normaliseWeights(demand);
  const missingTargets = Object.entries(targets)
    .filter(([, value]) => value && typeof value === 'object' && 'ideal' in value && value.ideal === null)
    .map(([key]) => key);
  const highUncertainty = uncertainty.filter(item => item.severity === 'HIGH');

  return {
    schemaVersion: IDEAL_DNA_SCHEMA_VERSION,
    source: {
      generator: 'src/algorithms/idealDnaGenerator.js',
      entry: 'generateIdealDna(demand, views, options)',
      purity: 'Pure and deterministic: views are read-only, no clock or random value is used and no vehicle is invented.',
      targetMethod: 'Empirical percentile targets from adapted vehicles that satisfy the hard constraints, plus explicit user-derived targets.',
    },
    usage: {
      annualMiles: mileage.annualMiles,
      annualMilesSource: mileage.source,
      annualMilesKnown: mileage.source !== 'placeholder-12000-mi',
      dailyMiles,
      ownershipYears: Number(demand.usage?.ownershipYears) || null,
      dailyAnnualMiles: demand.usage?.dailyAnnualMiles ?? null,
      longDistanceAnnualMiles: demand.usage?.longDistanceAnnualMiles ?? null,
      longDistanceTripsPerYear: demand.usage?.longDistanceTripsPerYear ?? null,
      longDistanceRoundTripMiles: demand.usage?.longDistanceRoundTripMiles ?? null,
    },
    constraints: demand.constraints,
    weights: weightModel.weights,
    weightModel,
    targets,
    aspirational,
    displayAxes: buildDisplayAxes(),
    contextual: {
      role: demand.constraints?.softPreferences?.role || null,
      preferredBodyType: market.bodyPreference,
      cargoNeeds: demand.constraints?.softPreferences?.cargoNeeds || null,
      ownershipYears: Number(demand.usage?.ownershipYears) || null,
      roadTripFrequency: demand.usage?.roadTripFrequency || null,
      charging: {
        applicable: demand.charging?.chargingApplicable === true,
        home: demand.charging?.homeCharging || null,
        workplace: demand.charging?.workplaceCharging || null,
        publicDependency: demand.charging?.publicChargingDependency === true,
        riskFlags: demand.charging?.riskFlags || [],
      },
      infrastructureEvidence: options.infrastructure || null,
      note: 'Context is shown to the user and can add caveats; it does not silently change the four hard constraints.',
    },
    marketSummary: {
      ...market.counts,
      usedPreferredBodySample: market.usedPreferredBody,
      bodyPreference: market.bodyPreference,
      condition: market.condition,
      budget: market.budget,
      sampleVehicleIds: market.samplePool.map(view => view.vehicleId),
      price: targets.purchasePriceUSD.observed,
      range: targets.rangeMiles.observed,
    },
    uncertainty,
    dataQuality: {
      status: market.counts.sample === 0 ? 'no-market-sample' : highUncertainty.length ? 'usable-with-gaps' : 'usable',
      confidence: market.counts.sample >= 5 && mileage.source !== 'placeholder-12000-mi' ? 'MEDIUM' : 'LOW',
      sampleSize: market.counts.sample,
      highUncertaintyCount: highUncertainty.length,
      missingTargets,
      notes: [
        'The ideal DNA is a set of targets, not a vehicle. Every target lists its basis and observed sample.',
        'No target is filled with a fabricated vehicle price. When the sample is empty, the price target is the user budget and the DNA says so.',
        'Cargo is an ordinal body-type proxy because the database has no measured cargo volume.',
      ],
    },
    assumptions: {
      list: [
        `Fuel price ${METRIC_ASSUMPTIONS.fuelPriceUSDPerGallon.toFixed(2)} USD/gal; home electricity ${METRIC_ASSUMPTIONS.electricityUSDPerKWh.toFixed(2)} USD/kWh plus a ${METRIC_ASSUMPTIONS.publicChargingPremiumUSDPerKWh.toFixed(2)} USD/kWh public-charging premium.`,
        `Gasoline tailpipe factor ${METRIC_ASSUMPTIONS.gasolineKgCO2PerGallon} kg CO2/gal; grid factor ${METRIC_ASSUMPTIONS.gridKgCO2PerKWh} kg CO2/kWh.`,
        'PHEV electric share is derived from the recorded electric range and the user\'s daily mileage; long-distance miles are treated as gasoline miles.',
        'The same assumptions are applied to every vehicle, so comparisons are internally consistent but are not a quote or a lifecycle study.',
      ],
    },
    provenance: {
      generator: 'idealDnaGenerator',
      databaseRecords: views.length,
      hardConstraintPool: market.counts.hardPool,
      affordablePool: market.counts.withinBudget,
      sampleSize: market.counts.sample,
      preferredBodySampleSize: market.counts.preferredBody,
      percentileMethod: 'Linear interpolation between the two nearest ordered observations (p25 / p50 / p75).',
      priceMode: targets.purchasePriceUSD.source,
      sampleVehicleIds: market.samplePool.map(view => view.vehicleId),
      sampleBodies: [...new Set(market.samplePool.map(view => view.bodyType))],
      samplePowertrains: [...new Set(market.samplePool.map(view => view.powertrain))],
      notInvented: [
        'No vehicle price, MPG, range, charging power or cargo volume is synthesized.',
        'Missing target values stay null and are reported in dataQuality.missingTargets.',
      ],
    },
    handoff: {
      matching: 'Apply constraints as hard filters, then score only with the four demand weights. Rank on the conservative lower bound and show the point estimate plus its uncertainty.',
      price: 'Use the recorded price band to distinguish a strict budget match from a conditional one. Never present an ESTIMATED price as a verified transaction price.',
      dna: 'Satisfaction is measured against targets.*; the aspirational block is informational only.',
      notModeled: 'Insurance, maintenance, depreciation, financing, resale value and a full total cost of ownership are outside this DNA.',
    },
  };
}

