/**
 * Editable Ideal DNA - Checkpoint E.
 *
 * The generated DNA remains the source of truth. This module wraps it in a small, validated
 * editing model so a user can tighten hard limits and move soft targets without ever changing the
 * four-dimension scoring formula in dnaScoring.js:
 *
 *   - hard: budget ceiling, minimum seats, allowed powertrains, condition, the questionnaire body
 *     set and the single final body style confirmed by the user;
 *   - soft: range, efficiency, refuelling convenience, space preference and environmental
 *     preference. Seats are read-only in the Studio; the questionnaire minimum remains a hard filter.
 *
 * The final body style is a hard constraint in `hardRejection`, not a ranking hint. Switching it
 * changes only that constraint and the 3D study; every edited target is preserved.
 *   - efficiency is converted to the existing annualEnergyCostUSD target, which is the value the
 *     matcher already scores. No second ranking formula is introduced.
 *
 * Missing observations stay null. The module never invents a vehicle price, and every derived
 * number records the assumptions used to obtain it.
 */

import {METRIC_ASSUMPTIONS, computeVehicleMetrics, phevElectricShare} from './vehicleMetrics.js';
import {hardRejection} from './vehicleMatcher.js';
import {DATABASE_BODY_TYPE_VALUES, normalizeBodyTypes} from '../model/profile.js';

export const EDITABLE_DNA_SCHEMA_VERSION = 'editable-dna/1.1';

export const EDITABLE_POWERTRAINS = ['ICE', 'HEV', 'PHEV', 'EV'];
export const EDITABLE_BODY_TYPES = [
  'Sedan',
  'Hatchback',
  'SUV / Crossover',
  'Minivan (MPV)',
  'Pickup Truck',
  'Sports Car',
  'No Preference',
];

export const SPACE_LABELS = {
  1: 'Small',
  2: 'Medium',
  3: 'Large',
  4: 'Extra large',
};

export const EDITOR_LIMITS = {
  budgetUSD: {min: 1000, max: 10000000, step: 500},
  seats: {min: 1, max: 15, step: 1},
  rangeMiles: {min: 50, max: 600, step: 25},
  mpg: {min: 5, max: 150, step: 1},
  kwhPer100Miles: {min: 5, max: 100, step: 0.1},
  phevElectricRangeMiles: {min: 5, max: 100, step: 1},
  maxRefuelingStopsPerYear: {min: 2, max: 60, step: 1},
  spacePreference: {min: 1, max: 4, step: 1},
  environmentalPreference: {min: 0, max: 100, step: 1},
};

const EPSILON = 1e-6;
const number = value => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const round = (value, step = 1) => (Number.isFinite(value) ? Number((Math.round(value / step) * step).toFixed(6)) : null);
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const median = values => {
  const sorted = (Array.isArray(values) ? values : []).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

function canonical(value, options) {
  const text = typeof value === 'string' ? value.trim() : '';
  return options.includes(text) ? text : null;
}

/**
 * The questionnaire body set is authoritative. `hard.allowedBodyTypes` is only a backward-compatible
 * fallback for an editor payload whose demand model is unavailable; an explicitly empty demand set
 * is never replaced by "all styles".
 */
function allowedBodyTypesFor({profile = null, constraints = {}, input = null} = {}) {
  if (Array.isArray(constraints?.acceptableBodyTypes)) {
    return normalizeBodyTypes(constraints.acceptableBodyTypes);
  }
  if (Array.isArray(input?.hard?.allowedBodyTypes)) {
    return normalizeBodyTypes(input.hard.allowedBodyTypes);
  }
  const source = profile && (Array.isArray(profile.acceptableBodyTypes) || typeof profile.acceptableBodyTypes === 'string')
    ? profile.acceptableBodyTypes
    : profile?.preferredBodyType;
  return normalizeBodyTypes(source).filter(body => DATABASE_BODY_TYPE_VALUES.includes(body));
}

/**
 * Stable fingerprint of the demand-relevant profile fields. A changed budget, seat minimum,
 * powertrain set, priority selection or mileage invalidates a previously confirmed DNA even when
 * the user reloads the page.
 */
export function profileFingerprint(profile) {
  const source = profile && typeof profile === 'object' ? profile : {};
  const relevant = {
    budget: String(source.budget ?? ''),
    vehicleCondition: source.vehicleCondition || 'Either',
    minimumSeats: String(source.minimumSeats ?? ''),
    acceptablePowertrains: Array.isArray(source.acceptablePowertrains) ? source.acceptablePowertrains : [],
    selectedPriorities: Array.isArray(source.selectedPriorities) ? source.selectedPriorities : [],
    acceptableBodyTypes: normalizeBodyTypes(
      Array.isArray(source.acceptableBodyTypes) || typeof source.acceptableBodyTypes === 'string'
        ? source.acceptableBodyTypes
        : source.preferredBodyType,
    ),
    preferredBodyType: source.preferredBodyType || 'No Preference',
    cargoNeeds: source.cargoNeeds || '',
    role: source.role || '',
    dailyDrivingMiles: source.dailyDrivingMiles ?? null,
    longDistanceMiles: source.longDistanceMiles ?? null,
    totalAnnualMiles: source.totalAnnualMiles ?? null,
    longDistanceTripsPerYear: source.longDistanceTripsPerYear ?? '',
    longDistanceRoundTripMiles: source.longDistanceRoundTripMiles ?? '',
    annualMileage: source.estimateMileageLater ? source.annualMileage ?? '' : '',
    roadTripFrequency: source.roadTripFrequency || 'Occasionally',
    homeCharging: source.homeCharging || 'Unsure',
    workplaceCharging: source.workplaceCharging || 'Unsure',
    parking: source.parking || 'Private garage',
  };
  let hash = 2166136261;
  const text = JSON.stringify(relevant);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function efficiencyFieldDefinitions(reference) {
  if (reference === 'EV') {
    return [{key: 'kwhPer100Miles', label: 'Target efficiency', unit: 'kWh/100 mi', direction: 'lower'}];
  }
  if (reference === 'PHEV') {
    return [
      {key: 'kwhPer100Miles', label: 'Electric mode', unit: 'kWh/100 mi', direction: 'lower'},
      {key: 'mpg', label: 'Gasoline mode', unit: 'MPG', direction: 'higher'},
      {key: 'phevElectricRangeMiles', label: 'Electric-only range', unit: 'mi', direction: 'higher'},
    ];
  }
  return [{
    key: 'mpg',
    label: reference === 'HEV' ? 'Target efficiency (hybrid)' : 'Target efficiency',
    unit: 'MPG',
    direction: 'higher',
  }];
}

export function efficiencySummary(values) {
  const reference = values?.efficiencyReference;
  if (reference === 'EV') return `${number(values.kwhPer100Miles) ?? 'Unknown'} kWh/100 mi`;
  if (reference === 'PHEV') {
    return `${number(values.kwhPer100Miles) ?? 'Unknown'} kWh/100 mi electric · ${number(values.mpg) ?? 'Unknown'} MPG gasoline`;
  }
  return `${number(values.mpg) ?? 'Unknown'} MPG`;
}

/**
 * Build the editable view of a generated DNA. Calling this function never mutates the DNA and no
 * target is guessed when the underlying evidence is absent.
 */
export function createEditableDna(generatedDna, {profile, demand, views = []} = {}) {
  if (!generatedDna?.targets) throw new TypeError('createEditableDna expects a generated ideal DNA.');
  const constraints = demand?.constraints || generatedDna.constraints || {};
  const allowed = (Array.isArray(constraints.acceptablePowertrains) ? constraints.acceptablePowertrains : [])
    .filter(powertrain => EDITABLE_POWERTRAINS.includes(powertrain));
  if (!allowed.length) throw new TypeError('The demand model accepts no powertrain, so no editable DNA can be built.');
  const allowedBodyTypes = allowedBodyTypesFor({profile, constraints});
  if (!allowedBodyTypes.length) throw new TypeError('The demand model accepts no body style, so no editable DNA can be built.');
  const minimumSeats = Math.max(1, Math.round(number(constraints.minimumSeats) ?? 1));
  const hardBudget = number(constraints.maxPurchasePriceUSD);
  const priceTarget = generatedDna.targets.purchasePriceUSD;
  const baseCost = number(generatedDna.targets.annualEnergyCostUSD?.ideal);
  const annualMiles = number(generatedDna.usage?.annualMiles) ?? METRIC_ASSUMPTIONS.defaultAnnualMiles;
  const dailyMiles = number(generatedDna.usage?.dailyMiles);
  const reference = marketMode(views, allowed);
  const efficiency = seedEfficiency(reference, {baseCost, annualMiles, dailyMiles, views});
  const range = clamp(Math.round(number(generatedDna.targets.rangeMiles?.ideal) ?? 300),
    EDITOR_LIMITS.rangeMiles.min, EDITOR_LIMITS.rangeMiles.max);
  const stops = clamp(Math.round(annualMiles / Math.max(range, 1)),
    EDITOR_LIMITS.maxRefuelingStopsPerYear.min, EDITOR_LIMITS.maxRefuelingStopsPerYear.max);
  const seed = environmentSeed(generatedDna.targets.emissionsGramsPerMile);
  const spacePreference = clamp(Math.round(number(generatedDna.targets.cargoRank?.ideal) ?? 2), 1, 4);
  const seats = clamp(Math.round(number(generatedDna.targets.seats?.ideal) ?? minimumSeats),
    minimumSeats, EDITOR_LIMITS.seats.max);
  const budgetCeilingUSD = clamp(Math.round(hardBudget ?? number(priceTarget?.acceptableMax) ?? number(priceTarget?.ideal) ?? 50000),
    EDITOR_LIMITS.budgetUSD.min, EDITOR_LIMITS.budgetUSD.max);

  return {
    schemaVersion: EDITABLE_DNA_SCHEMA_VERSION,
    profileFingerprint: profileFingerprint(profile),
    hard: {
      budgetCeilingUSD: hardBudget,
      minimumSeats,
      allowedPowertrains: allowed,
      allowedBodyTypes,
      vehicleCondition: constraints.vehicleCondition || 'Either',
    },
    values: {
      budgetCeilingUSD,
      powertrainMode: allowed.length === 1 ? allowed[0] : 'ANY',
      efficiencyReference: reference,
      finalBodyStyle: allowedBodyTypes[0],
      bodyType: allowedBodyTypes[0],
      seats,
      rangeMiles: range,
      mpg: efficiency.mpg,
      kwhPer100Miles: efficiency.kwhPer100Miles,
      phevElectricRangeMiles: efficiency.phevElectricRangeMiles,
      maxRefuelingStopsPerYear: stops,
      spacePreference,
      environmentalPreference: seed.preference,
    },
    seed: {
      generator: 'editableIdealDna.createEditableDna',
      generatedSchemaVersion: generatedDna.schemaVersion || null,
      annualMiles,
      dailyMiles,
      generatedAnnualEnergyCostUSD: baseCost,
      efficiencyBasis: efficiency.basis,
      environmentalBasis: seed.basis,
      environmentalObserved: seed.observed,
      finalBodyStyle: allowedBodyTypes[0],
      allowedBodyTypes,
      note: 'The generated DNA is authoritative. Reset restores these values and the first questionnaire body style; it does not generate a new target set.',
    },
  };
}

/**
 * The same electricity-cost assumption as computeVehicleMetrics: home price plus the public
 * charging premium. Keeping one conversion means an edited efficiency is scored exactly like the
 * original generated target.
 */
function eligibleMarketViews(views) {
  return (Array.isArray(views) ? views : []).filter(view => view
    && view.valid !== false
    && view.dataQuality?.recommendationEligible !== false);
}

function marketMode(views, allowed) {
  const counts = new Map();
  eligibleMarketViews(views).forEach(view => {
    if (!allowed.includes(view.powertrain)) return;
    counts.set(view.powertrain, (counts.get(view.powertrain) || 0) + 1);
  });
  const ordered = EDITABLE_POWERTRAINS
    .filter(powertrain => allowed.includes(powertrain))
    .map(powertrain => ({powertrain, count: counts.get(powertrain) || 0}))
    .sort((a, b) => b.count - a.count || EDITABLE_POWERTRAINS.indexOf(a.powertrain) - EDITABLE_POWERTRAINS.indexOf(b.powertrain));
  return ordered[0]?.powertrain || allowed[0] || null;
}

function marketMedian(views, powertrains, readValue) {
  return median(eligibleMarketViews(views)
    .filter(view => powertrains.includes(view.powertrain))
    .map(view => readValue(view)));
}

function environmentSeed(target) {
  const p75 = number(target?.observed?.p75);
  const low = number(target?.observed?.min);
  const ideal = number(target?.ideal);
  if (p75 === null || low === null || ideal === null || p75 - low <= EPSILON) {
    return {
      preference: 50,
      basis: 'No observed emission spread; the generated target is retained until the user edits the preference.',
      observed: target?.observed || null,
    };
  }
  const preference = clamp((p75 - ideal) / (p75 - low) * 100, 0, 100);
  return {
    preference: Math.round(preference),
    basis: 'Inverse of the generated p25 target between the observed p75 (0) and the cleanest observed car (100).',
    observed: target.observed,
  };
}

function seedEfficiency(reference, {baseCost, annualMiles, dailyMiles, views}) {
  const marketMpg = marketMedian(views, ['ICE', 'HEV', 'PHEV'], view => view.efficiency?.combinedMpg?.value);
  const marketKwh = marketMedian(views, ['EV', 'PHEV'], view => view.efficiency?.kwhPer100Miles?.value);
  const marketPhevRange = marketMedian(views, ['PHEV'], view => view.efficiency?.electricRangeMiles?.value);
  const consumption = METRIC_ASSUMPTIONS.electricityUSDPerKWh + METRIC_ASSUMPTIONS.publicChargingPremiumUSDPerKWh;
  const gasMpgForCost = annualMiles > 0 && baseCost > 0
    ? annualMiles * METRIC_ASSUMPTIONS.fuelPriceUSDPerGallon / baseCost
    : null;
  const evKwhForCost = annualMiles > 0 && baseCost > 0
    ? baseCost * 100 / (annualMiles * consumption)
    : null;
  const mpg = clamp(round(gasMpgForCost ?? marketMpg ?? 30, 1), EDITOR_LIMITS.mpg.min, EDITOR_LIMITS.mpg.max);
  const kwh = clamp(round(evKwhForCost ?? marketKwh ?? 30, 0.1), EDITOR_LIMITS.kwhPer100Miles.min, EDITOR_LIMITS.kwhPer100Miles.max);
  const phevRange = clamp(round(marketPhevRange ?? 30, 1), EDITOR_LIMITS.phevElectricRangeMiles.min, EDITOR_LIMITS.phevElectricRangeMiles.max);

  if (reference === 'PHEV' && baseCost > 0) {
    const share = phevElectricShare({electricRangeMiles: phevRange, dailyMiles, annualMiles});
    const electricMiles = annualMiles * (share.share ?? 0);
    const gasolineMiles = annualMiles - electricMiles;
    const seedCost = gasolineMiles / Math.max(mpg, EPSILON) * METRIC_ASSUMPTIONS.fuelPriceUSDPerGallon
      + electricMiles / 100 * kwh * consumption;
    if (seedCost > 0) {
      const scale = seedCost / baseCost;
      return {
        mpg: clamp(round(mpg * scale, 1), EDITOR_LIMITS.mpg.min, EDITOR_LIMITS.mpg.max),
        kwhPer100Miles: clamp(round(kwh * scale, 0.1), EDITOR_LIMITS.kwhPer100Miles.min, EDITOR_LIMITS.kwhPer100Miles.max),
        phevElectricRangeMiles: phevRange,
        basis: 'Market median PHEV efficiencies scaled together so the initial annual-energy target reproduces the generated DNA.',
      };
    }
  }
  return {
    mpg,
    kwhPer100Miles: kwh,
    phevElectricRangeMiles: phevRange,
    basis: reference === 'EV'
      ? 'kWh/100 mi reverse-derived from the generated annual-energy target; market median is used only when the target is unavailable.'
      : reference === 'PHEV'
        ? 'PHEV electric and gasoline efficiency seeds from market medians, adjusted to the generated annual-energy target.'
        : 'MPG reverse-derived from the generated annual-energy target; the market median is used only when the target is unavailable.',
  };
}

/**
 * Convert an edited efficiency target to the existing annualEnergyCostUSD target. The electricity
 * price includes the same public-charging premium used by computeVehicleMetrics, so the number is
 * comparable with every car already in the database.
 */
export function annualEnergyCostForEfficiency(values, {annualMiles, dailyMiles} = {}) {
  const annual = number(annualMiles);
  if (annual === null || annual <= 0) return null;
  const consumption = METRIC_ASSUMPTIONS.electricityUSDPerKWh + METRIC_ASSUMPTIONS.publicChargingPremiumUSDPerKWh;
  const reference = values?.efficiencyReference;
  if (reference === 'EV') {
    const kwh = number(values.kwhPer100Miles);
    return kwh === null ? null : annual / 100 * kwh * consumption;
  }
  if (reference === 'PHEV') {
    const mpg = number(values.mpg);
    const kwh = number(values.kwhPer100Miles);
    const electricRange = number(values.phevElectricRangeMiles);
    if (mpg === null || kwh === null) return null;
    const split = phevElectricShare({electricRangeMiles: electricRange, dailyMiles, annualMiles: annual});
    const electricShare = split.share ?? 0;
    const electricMiles = annual * electricShare;
    const gasolineMiles = annual - electricMiles;
    return gasolineMiles / mpg * METRIC_ASSUMPTIONS.fuelPriceUSDPerGallon
      + electricMiles / 100 * kwh * consumption;
  }
  const mpg = number(values.mpg);
  return mpg === null ? null : annual / mpg * METRIC_ASSUMPTIONS.fuelPriceUSDPerGallon;
}

function checkNumber(errors, values, field, label, limits, {integer = false, required = true} = {}) {
  const parsed = number(values?.[field]);
  if (parsed === null) {
    if (required) errors[field] = `${label} must be a finite number.`;
    return null;
  }
  if (!Number.isFinite(parsed)) {
    errors[field] = `${label} must be finite; NaN and Infinity are not allowed.`;
    return null;
  }
  if (integer && !Number.isInteger(parsed)) {
    errors[field] = `${label} must be a whole number.`;
    return null;
  }
  if (parsed < limits.min - EPSILON || parsed > limits.max + EPSILON) {
    errors[field] = `${label} must be between ${limits.min} and ${limits.max}.`;
    return null;
  }
  return parsed;
}

/**
 * Validate an editable DNA against the profile's hard limits and the technical editor ranges.
 * The function is deliberately strict: a negative, NaN, Infinity, out-of-market or
 * hard-constraint-breaking value is reported instead of being silently clamped.
 */
export function validateEditableDna(input, {profile = null, demand = null, generatedDna = null} = {}) {
  const source = input?.values || input;
  const errors = {};
  if (!source || typeof source !== 'object') {
    return {ok: false, errors: {form: 'The editable DNA payload is missing.'}, sanitized: null, hard: null};
  }
  if (input?.schemaVersion && input.schemaVersion !== EDITABLE_DNA_SCHEMA_VERSION) {
    errors.form = `Unsupported editable DNA schema version "${input.schemaVersion}".`;
  }

  const constraints = demand?.constraints || generatedDna?.constraints || {};
  const allowedSource = Array.isArray(constraints.acceptablePowertrains)
    ? constraints.acceptablePowertrains
    : Array.isArray(input?.hard?.allowedPowertrains) ? input.hard.allowedPowertrains : [];
  const allowed = allowedSource
    .filter(powertrain => EDITABLE_POWERTRAINS.includes(powertrain));
  const minimumSeats = Math.max(1, Math.round(number(constraints.minimumSeats) ?? number(input?.hard?.minimumSeats) ?? 1));
  const hardBudget = number(constraints.maxPurchasePriceUSD) ?? number(input?.hard?.budgetCeilingUSD);
  const fingerprint = input?.profileFingerprint || null;
  if (profile && fingerprint && fingerprint !== profileFingerprint(profile)) {
    errors.form = 'This editable DNA belongs to an older questionnaire profile. Reset or regenerate it before matching.';
  }

  const budget = checkNumber(errors, source, 'budgetCeilingUSD', 'Budget ceiling', EDITOR_LIMITS.budgetUSD);
  if (budget !== null && hardBudget !== null && budget > hardBudget + EPSILON) {
    errors.budgetCeilingUSD = `The budget ceiling cannot exceed your questionnaire hard limit of $${Math.round(hardBudget).toLocaleString()}.`;
  }
  const seats = checkNumber(errors, source, 'seats', 'Target seats', EDITOR_LIMITS.seats, {integer: true});
  if (seats !== null && seats < minimumSeats) {
    errors.seats = `The target cannot be below your hard minimum of ${minimumSeats} seats.`;
  }
  const rangeMiles = checkNumber(errors, source, 'rangeMiles', 'Target range', EDITOR_LIMITS.rangeMiles);
  const stops = checkNumber(errors, source, 'maxRefuelingStopsPerYear', 'Maximum refuelling stops per year', EDITOR_LIMITS.maxRefuelingStopsPerYear, {integer: true});
  const space = checkNumber(errors, source, 'spacePreference', 'Space preference', EDITOR_LIMITS.spacePreference, {integer: true});
  const environmental = checkNumber(errors, source, 'environmentalPreference', 'Environmental preference', EDITOR_LIMITS.environmentalPreference, {integer: true});

  const powertrainMode = source.powertrainMode === 'ANY' ? 'ANY' : canonical(source.powertrainMode, allowed);
  if (!powertrainMode) {
    errors.powertrainMode = allowed.length
      ? `Choose an allowed powertrain (${allowed.join(', ')}) or All allowed.`
      : 'The questionnaire allows no powertrain.';
  }
  const reference = canonical(source.efficiencyReference, allowed);
  if (!reference) {
    errors.efficiencyReference = allowed.length
      ? `Efficiency must use one of the allowed powertrains (${allowed.join(', ')}).`
      : 'No powertrain is available for the efficiency target.';
  }
  const allowedBodyTypes = allowedBodyTypesFor({profile, constraints, input});
  if (!allowedBodyTypes.length) {
    errors.finalBodyStyle = 'The questionnaire accepts no body style. Choose at least one body style before editing the DNA.';
  }
  const finalBodyStyle = canonical(source.finalBodyStyle ?? source.bodyType, allowedBodyTypes);
  if (!finalBodyStyle && allowedBodyTypes.length) {
    errors.finalBodyStyle = `Choose a final body style from the questionnaire set (${allowedBodyTypes.join(', ')}).`;
  }

  let mpg = null;
  let kwh = null;
  let phevRange = null;
  if (reference === 'ICE' || reference === 'HEV') {
    mpg = checkNumber(errors, source, 'mpg', 'Target efficiency', EDITOR_LIMITS.mpg);
  } else if (reference === 'EV') {
    kwh = checkNumber(errors, source, 'kwhPer100Miles', 'Target efficiency', EDITOR_LIMITS.kwhPer100Miles);
  } else if (reference === 'PHEV') {
    mpg = checkNumber(errors, source, 'mpg', 'Gasoline-mode efficiency', EDITOR_LIMITS.mpg);
    kwh = checkNumber(errors, source, 'kwhPer100Miles', 'Electric-mode efficiency', EDITOR_LIMITS.kwhPer100Miles);
    phevRange = checkNumber(errors, source, 'phevElectricRangeMiles', 'PHEV electric-only range', EDITOR_LIMITS.phevElectricRangeMiles);
  }

  const sanitized = {
    schemaVersion: EDITABLE_DNA_SCHEMA_VERSION,
    profileFingerprint: fingerprint || profileFingerprint(profile),
    hard: {
      budgetCeilingUSD: hardBudget,
      minimumSeats,
      allowedPowertrains: allowed,
      allowedBodyTypes,
      vehicleCondition: constraints.vehicleCondition || input?.hard?.vehicleCondition || 'Either',
    },
    values: {
      budgetCeilingUSD: budget,
      powertrainMode,
      efficiencyReference: reference,
      finalBodyStyle,
      bodyType: finalBodyStyle,
      seats,
      rangeMiles,
      mpg,
      kwhPer100Miles: kwh,
      phevElectricRangeMiles: phevRange,
      maxRefuelingStopsPerYear: stops,
      spacePreference: space,
      environmentalPreference: environmental,
    },
    seed: input?.seed || null,
  };
  const ok = Object.keys(errors).length === 0;
  return {ok, errors, sanitized: ok ? sanitized : null, hard: sanitized.hard};
}

function emissionsTargetForPreference(preference, fallbackIdeal, observed) {
  const cleanest = number(observed?.min);
  const acceptable = number(observed?.p75);
  const fallback = number(fallbackIdeal);
  if (cleanest === null || acceptable === null || acceptable - cleanest <= EPSILON) {
    const base = fallback ?? cleanest ?? null;
    return {
      ideal: base === null ? null : round(base * (1.5 - preference / 100), 1),
      acceptableMax: base === null ? null : round(base * 1.5, 1),
      basis: 'No observed emission spread; the preference scales the generated target by a documented factor of 0.5 to 1.5.',
    };
  }
  const ideal = round(acceptable - (acceptable - cleanest) * (preference / 100), 1);
  const observedMax = number(observed?.max);
  const acceptableMax = round(Math.max(acceptable, ideal * 1.2, observedMax ?? ideal), 1);
  return {
    ideal,
    acceptableMax,
    basis: `Environmental preference ${preference}/100 interpolates from the observed p75 (${round(acceptable, 1)} g/mi) toward the cleanest observed car (${round(cleanest, 1)} g/mi).`,
  };
}

/**
 * Apply edited values to the generated DNA and demand. The returned DNA still contains exactly the
 * same six scoring axes and four dimension weights; only target values and the hard powertrain
 * subset can change.
 */
export function materializeEditableDna(generatedDna, editable, {profile = null, demand = null} = {}) {
  if (!generatedDna?.targets) throw new TypeError('materializeEditableDna expects a generated ideal DNA.');
  const validation = validateEditableDna(editable, {profile, demand, generatedDna});
  if (!validation.ok) {
    const error = new TypeError(`Editable DNA rejected: ${Object.values(validation.errors).join(' ')}`);
    error.code = 'INVALID_EDITABLE_DNA';
    error.validation = validation;
    throw error;
  }
  const values = validation.sanitized.values;
  const baseDemand = demand || {constraints: generatedDna.constraints || {}};
  const hardConstraints = baseDemand.constraints || {};
  const allowed = validation.hard.allowedPowertrains.length
    ? validation.hard.allowedPowertrains
    : hardConstraints.acceptablePowertrains || [];
  const acceptedPowertrains = values.powertrainMode === 'ANY' ? allowed : [values.powertrainMode];
  const finalBodyStyle = values.finalBodyStyle;
  const allowedBodyTypes = validation.hard.allowedBodyTypes;
  const effectiveDemand = {
    ...baseDemand,
    constraints: {
      ...hardConstraints,
      maxPurchasePriceUSD: values.budgetCeilingUSD,
      acceptablePowertrains: acceptedPowertrains,
      acceptableBodyTypes: allowedBodyTypes,
      allowedBodyTypes,
      finalBodyStyle,
      hardRules: [
        ...(Array.isArray(hardConstraints.hardRules) ? hardConstraints.hardRules : []),
        `Final body style must equal ${finalBodyStyle}; body type is enforced before scoring.`,
      ],
      softPreferences: {
        ...(hardConstraints.softPreferences || {}),
        preferredBodyType: finalBodyStyle,
        cargoNeeds: SPACE_LABELS[values.spacePreference] || hardConstraints.softPreferences?.cargoNeeds || null,
      },
    },
  };
  const annualMiles = number(generatedDna.usage?.annualMiles) ?? METRIC_ASSUMPTIONS.defaultAnnualMiles;
  const dailyMiles = number(generatedDna.usage?.dailyMiles);
  const base = generatedDna.targets;
  const energyTarget = annualEnergyCostForEfficiency(values, {annualMiles, dailyMiles});
  const baseEnergyIdeal = number(base.annualEnergyCostUSD?.ideal);
  const baseEnergyMax = number(base.annualEnergyCostUSD?.acceptableMax);
  const energyRatio = baseEnergyIdeal > 0 && baseEnergyMax > baseEnergyIdeal ? baseEnergyMax / baseEnergyIdeal : 1.45;
  const energyIdeal = energyTarget === null ? baseEnergyIdeal : round(energyTarget, 10);
  const basePurchaseIdeal = number(base.purchasePriceUSD?.ideal);
  // The budget is a hard ceiling, not the price of the theoretical car. Keep the observed
  // affordable target and let classifyBudget enforce the ceiling.
  const purchaseIdeal = basePurchaseIdeal ?? values.budgetCeilingUSD;
  const rangeIdeal = values.rangeMiles;
  const baseRangeIdeal = number(base.rangeMiles?.ideal);
  const baseRangeMin = number(base.rangeMiles?.acceptableMin);
  const rangeRatio = baseRangeIdeal > 0 && baseRangeMin !== null && baseRangeMin > 0 ? baseRangeMin / baseRangeIdeal : 0.65;
  const emission = emissionsTargetForPreference(values.environmentalPreference, base.emissionsGramsPerMile?.ideal, base.emissionsGramsPerMile?.observed);
  const seatsFloor = validation.hard.minimumSeats;

  const targets = {
    ...base,
    purchasePriceUSD: {
      ...base.purchasePriceUSD,
      ideal: purchaseIdeal,
      acceptableMax: values.budgetCeilingUSD,
      hardMax: values.budgetCeilingUSD,
      basis: `${base.purchasePriceUSD?.basis || ''} The editable budget ceiling is $${Math.round(values.budgetCeilingUSD).toLocaleString()} and remains a hard maximum; it is not the theoretical car's price.`,
      source: 'edited-budget-ceiling',
    },
    annualEnergyCostUSD: {
      ...base.annualEnergyCostUSD,
      ideal: energyIdeal,
      acceptableMax: energyIdeal === null ? baseEnergyMax : round(Math.max(energyIdeal + 1, energyIdeal * energyRatio), 10),
      basis: `Converted from ${values.efficiencyReference} efficiency (${efficiencySummary(values)}) using the same documented fuel, electricity and public-charging assumptions as every vehicle.`,
      source: 'edited-efficiency-target',
    },
    emissionsGramsPerMile: {
      ...base.emissionsGramsPerMile,
      ideal: emission.ideal,
      acceptableMax: emission.acceptableMax,
      basis: emission.basis,
      source: 'edited-environmental-preference',
    },
    rangeMiles: {
      ...base.rangeMiles,
      ideal: rangeIdeal,
      acceptableMin: round(Math.max(25, rangeIdeal * rangeRatio), 25),
      basis: `Edited planning range target. The acceptable floor keeps the generated DNA's ${Math.round(rangeRatio * 100)}% tolerance.`,
      source: 'edited-range-target',
    },
    seats: {
      ...base.seats,
      ideal: values.seats,
      acceptableMin: seatsFloor,
      hardMin: seatsFloor,
      basis: `Target seating is ${values.seats}; the questionnaire hard minimum of ${seatsFloor} seats is still enforced before scoring.`,
      source: 'edited-seat-target',
    },
    cargoRank: {
      ...base.cargoRank,
      ideal: values.spacePreference,
      acceptableMin: Math.max(1, values.spacePreference - 1),
      basis: `Space preference maps to ordinal rank ${values.spacePreference} (${SPACE_LABELS[values.spacePreference]}); measured cargo volume is still missing.`,
      source: 'edited-space-preference',
    },
  };

  const editedDna = {
    ...generatedDna,
    constraints: effectiveDemand.constraints,
    targets,
    contextual: {
      ...(generatedDna.contextual || {}),
      preferredBodyType: finalBodyStyle,
      finalBodyStyle,
      allowedBodyTypes,
      cargoNeeds: effectiveDemand.constraints.softPreferences.cargoNeeds,
      powertrainReference: values.efficiencyReference,
      acceptedPowertrains,
    },
    marketSummary: {
      ...(generatedDna.marketSummary || {}),
      bodyPreference: finalBodyStyle,
      allowedBodyTypes,
      budget: values.budgetCeilingUSD,
    },
    uncertainty: [
      ...(generatedDna.uncertainty || []),
      {
        code: 'edited-ideal-dna',
        severity: 'INFO',
        message: 'Soft targets were edited after generation. The four scoring dimensions and their weights are unchanged; only target values and the allowed powertrain subset changed.',
        affects: ['targets', 'constraints'],
      },
    ],
    editor: {
      schemaVersion: EDITABLE_DNA_SCHEMA_VERSION,
      applied: true,
      profileFingerprint: validation.sanitized.profileFingerprint,
      values,
      derived: {
        annualEnergyCostUSD: energyIdeal,
        purchasePriceTargetUSD: purchaseIdeal,
        emissionsGramsPerMile: emission.ideal,
        acceptedPowertrains,
        powertrainMode: values.powertrainMode,
        efficiencyReference: values.efficiencyReference,
        finalBodyStyle,
        allowedBodyTypes,
      },
      source: 'materializeEditableDna',
    },
  };

  return {
    dna: editedDna,
    demand: effectiveDemand,
    validation,
    values,
    derived: editedDna.editor.derived,
  };
}

function budgetTier(view, budget) {
  if (!Number.isFinite(budget)) return 'no-budget';
  const low = number(view?.price?.bandUSD?.low);
  const high = number(view?.price?.bandUSD?.high);
  const point = number(view?.price?.estimatedUSD);
  if (low !== null && high !== null && low <= high) {
    if (high <= budget) return 'strict';
    if (low <= budget) return 'conditional';
    return 'over';
  }
  if (point !== null && point <= budget) return 'conditional';
  return point === null ? 'unknown-price' : 'over';
}

function refuelingStops(view, metrics, annualMiles) {
  const range = number(metrics?.energy?.totalRangeMiles) ?? number(view?.efficiency?.totalRangeMiles?.value);
  if (range === null || range <= 0 || annualMiles <= 0) return null;
  return annualMiles / range;
}

function marketRange(values) {
  const known = values.map(Number).filter(Number.isFinite);
  if (!known.length) return {min: null, max: null, count: 0};
  return {min: Math.min(...known), max: Math.max(...known), count: known.length};
}

/**
 * Live feasibility check for the builder. It distinguishes a soft target that reaches beyond the
 * affordable market (Aspirational) from a hard-constraint set with no car at all (No Known Match).
 * The budget is always applied before any target is compared.
 */
export function evaluateFeasibility({views = [], demand, dna, annualMiles = null} = {}) {
  if (!demand?.constraints) throw new TypeError('evaluateFeasibility expects the effective demand model.');
  if (!dna?.targets) throw new TypeError('evaluateFeasibility expects the materialized ideal DNA.');
  const records = Array.isArray(views) ? views : [];
  const budget = number(demand.constraints.maxPurchasePriceUSD);
  const miles = number(annualMiles) ?? number(dna.usage?.annualMiles) ?? METRIC_ASSUMPTIONS.defaultAnnualMiles;
  const rejectedBy = {'not-eligible': 0, seats: 0, powertrain: 0, condition: 0, 'body-style': 0, 'over-budget': 0, 'price-unknown': 0};
  const pool = [];
  let strict = 0;
  let conditional = 0;

  records.forEach(view => {
    const rejection = hardRejection(view, demand);
    if (rejection) {
      rejectedBy[rejection] = (rejectedBy[rejection] || 0) + 1;
      return;
    }
    const tier = budgetTier(view, budget);
    if (tier === 'over') {
      rejectedBy['over-budget'] += 1;
      return;
    }
    if (tier === 'unknown-price') {
      rejectedBy['price-unknown'] += 1;
      return;
    }
    if (tier === 'strict') strict += 1;
    if (tier === 'conditional') conditional += 1;
    const metrics = computeVehicleMetrics(view, {
      annualMiles: miles,
      dailyMiles: dna.usage?.dailyMiles,
      annualMilesSource: dna.usage?.annualMilesSource,
    });
    pool.push({view, metrics, tier});
  });

  const target = key => dna.targets?.[key]?.ideal ?? null;
  const finalBodyStyle = demand.constraints.finalBodyStyle || null;
  const strictPool = pool.filter(item => item.tier === 'strict');
  const comparisonPool = strictPool;
  const checks = [
    {
      key: 'priceAffordability',
      label: 'Budget ceiling',
      kind: 'hard',
      target: budget,
      unit: 'USD',
      direction: 'lower',
      values: [],
      meet: () => true,
      note: 'Hard ceiling. Every car above the cap is rejected before scoring.',
    },
    {
      key: 'finalBodyStyle',
      label: 'Final body style',
      kind: 'hard',
      target: finalBodyStyle,
      unit: null,
      direction: null,
      values: [],
      meet: () => true,
      note: finalBodyStyle
        ? `${finalBodyStyle} is enforced before scoring. Conditional-budget records are not counted as strict candidates.`
        : 'No final body style has been confirmed yet.',
    },
    {
      key: 'rangeMiles',
      label: 'Target range',
      kind: 'soft',
      target: target('rangeMiles'),
      unit: 'mi',
      direction: 'higher',
      values: comparisonPool.map(item => item.metrics.energy.totalRangeMiles),
      meet: item => number(item.metrics.energy.totalRangeMiles) !== null
        && number(item.metrics.energy.totalRangeMiles) >= number(target('rangeMiles')),
    },
    {
      key: 'annualEnergyCostUSD',
      label: 'Target efficiency (annual energy cost)',
      kind: 'soft',
      target: target('annualEnergyCostUSD'),
      unit: 'USD/year',
      direction: 'lower',
      values: comparisonPool.map(item => item.metrics.cost.annualUSD),
      meet: item => number(item.metrics.cost.annualUSD) !== null
        && number(item.metrics.cost.annualUSD) <= number(target('annualEnergyCostUSD')),
    },
    {
      key: 'emissionsGramsPerMile',
      label: 'Environmental preference',
      kind: 'soft',
      target: target('emissionsGramsPerMile'),
      unit: 'g CO2/mi',
      direction: 'lower',
      values: comparisonPool.map(item => item.metrics.emissions.gramsCO2PerMile),
      meet: item => number(item.metrics.emissions.gramsCO2PerMile) !== null
        && number(item.metrics.emissions.gramsCO2PerMile) <= number(target('emissionsGramsPerMile')),
    },
    {
      key: 'seats',
      label: 'Target seats',
      kind: 'soft',
      target: target('seats'),
      unit: 'seats',
      direction: 'higher',
      values: comparisonPool.map(item => item.view.seats),
      meet: item => number(item.view.seats) !== null && number(item.view.seats) >= number(target('seats')),
    },
    {
      key: 'cargoRank',
      label: 'Space preference',
      kind: 'soft',
      target: target('cargoRank'),
      unit: 'rank 1-4',
      direction: 'higher',
      values: comparisonPool.map(item => item.view.dimensions?.cargoProxy?.rank),
      meet: item => number(item.view.dimensions?.cargoProxy?.rank) !== null
        && number(item.view.dimensions?.cargoProxy?.rank) >= number(target('cargoRank')),
    },
    {
      key: 'maxRefuelingStopsPerYear',
      label: 'Refuelling convenience',
      kind: 'soft',
      target: dna.editor?.values?.maxRefuelingStopsPerYear ?? null,
      unit: 'stops/year',
      direction: 'lower',
      values: comparisonPool.map(item => refuelingStops(item.view, item.metrics, miles)),
      meet: item => {
        const stops = refuelingStops(item.view, item.metrics, miles);
        return stops !== null && stops <= number(dna.editor?.values?.maxRefuelingStopsPerYear);
      },
    },
  ];

  const publicChecks = checks.map(check => {
    const metCount = check.kind === 'hard' ? comparisonPool.length : comparisonPool.filter(check.meet).length;
    const numeric = check.direction === 'higher' || check.direction === 'lower';
    const range = numeric ? marketRange(check.values) : {min: null, max: null, count: check.values.length};
    let marketStatus = 'unknown';
    if (check.kind === 'soft' && comparisonPool.length) {
      if (check.key === 'bodyType') {
        marketStatus = check.target === 'No Preference' || check.values.includes(check.target) ? 'within' : 'aspirational';
      } else if (numeric && number(check.target) !== null && range.count) {
        const outside = check.direction === 'higher'
          ? number(check.target) > range.max
          : number(check.target) < range.min;
        marketStatus = outside ? 'aspirational' : 'within';
      }
    }
    return {
      key: check.key,
      label: check.label,
      kind: check.kind,
      target: check.target,
      unit: check.unit,
      direction: check.direction,
      metCount,
      total: comparisonPool.length,
      observedMin: range.min,
      observedMax: range.max,
      observedCount: range.count,
      marketStatus,
      note: check.note || null,
    };
  });

  const softChecks = checks.filter(check => check.kind === 'soft');
  const allSoftMet = comparisonPool.filter(item => softChecks.every(check => check.meet(item))).length;
  const beyondMarket = publicChecks.filter(check => check.marketStatus === 'aspirational');
  const status = strict === 0
    ? (conditional > 0 ? 'no-strict-match' : 'no-known-match')
    : beyondMarket.length || allSoftMet === 0 ? 'aspirational' : 'within-market-range';
  const statusLabel = {
    'within-market-range': 'Within Market Range',
    aspirational: 'Aspirational',
    'no-strict-match': 'No Strict Matches',
    'no-known-match': 'No Known Match',
  }[status];
  const closest = strictPool
    .map(item => {
      const met = softChecks.filter(check => check.meet(item)).length;
      return {
        vehicleId: item.view.vehicleId,
        displayName: item.view.displayName,
        met,
        total: softChecks.length,
        priceUSD: number(item.view.price?.estimatedUSD),
      };
    })
    .sort((a, b) => b.met - a.met || (a.priceUSD ?? Infinity) - (b.priceUSD ?? Infinity))
    .slice(0, 3);
  const beyondLabels = beyondMarket.map(check => check.label);
  const summary = status === 'no-known-match'
    ? `No ${finalBodyStyle || 'eligible'} record passes the current hard constraints. ${records.length} records checked; ${rejectedBy['body-style'] || 0} failed the final body style, ${rejectedBy['over-budget']} exceeded the budget, ${rejectedBy.seats} missed the seat minimum, ${rejectedBy.powertrain} missed the powertrain set. Soft targets are not the blocker.`
    : status === 'no-strict-match'
      ? `No ${finalBodyStyle || 'eligible'} record fits the strict budget. ${conditional} budget-conditional car${conditional === 1 ? '' : 's'} exist and are shown separately; they cannot enter the Strict Top 3.`
      : status === 'aspirational'
        ? `The hard constraints leave ${strict} strict-budget ${finalBodyStyle || 'eligible'} car${strict === 1 ? '' : 's'}, but ${beyondLabels.length ? `${beyondLabels.join(', ')} reach${beyondLabels.length === 1 ? 'es' : ''} beyond the current affordable market` : 'no single record meets every soft target'}. Your target is kept; matching will return the closest feasible cars.`
        : `The hard constraints leave ${strict} strict-budget ${finalBodyStyle || 'eligible'} car${strict === 1 ? '' : 's'}, and ${allSoftMet} already meet${allSoftMet === 1 ? 's' : ''} every soft target.`;

  return {
    status,
    statusLabel,
    summary,
    checks: publicChecks,
    counts: {
      database: records.length,
      hardPassing: pool.length,
      strictCandidates: strict,
      strict,
      conditional,
      allSoftMet,
      softTargetCount: softChecks.length,
    },
    bodyStyle: {
      finalBodyStyle,
      allowedBodyTypes: Array.isArray(demand.constraints.acceptableBodyTypes) ? demand.constraints.acceptableBodyTypes : [],
      strictCandidates: strict,
      conditionalCandidates: conditional,
      zeroStrictCandidates: strict === 0,
      note: 'Counts use the same hard filters and strict budget rule as the matcher. Conditional budget bands are excluded.',
    },
    rejectedBy,
    closest,
    budget: {
      ceilingUSD: budget,
      isHard: true,
      overBudget: rejectedBy['over-budget'],
      priceUnknown: rejectedBy['price-unknown'],
      note: 'Budget is always a hard ceiling. It is never presented as the price of the theoretical ideal car.',
    },
    source: {
      module: 'editableIdealDna.evaluateFeasibility',
      sample: 'Every adapted database record is checked; only hard-constraint-passing, within-budget cars contribute to the target comparison.',
      annualMiles: miles,
    },
  };
}
