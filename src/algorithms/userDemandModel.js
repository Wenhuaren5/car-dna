import {CHARGING_POWERTRAINS, POWERTRAIN_VALUES, chargingDemand, normalizeBodyTypes, normalizePowertrains, normalizePriorities, normalizeProfile, priorityDemand} from '../model/profile.js';
import {PROFILE_SCHEMA_VERSION} from '../storage/profileStorage.js';
import {dailyDrivingMiles, destinationAnnualMiles, longDistanceMiles} from '../utils/distance.js';

/**
 * Algorithm 1 — User Demand Modeling.
 *
 * `buildDemandModel(profile)` turns the stored, already validated UserDemandProfile
 * (schema 7.0, normalized by `src/model/profile.js`) into one stable, JSON-serializable demand
 * model that Algorithm 2 (vehicle DNA evolution) and Algorithm 3 (real-vehicle matching) read.
 *
 * It is a pure function. The input is never mutated, no timestamp is added (the same profile
 * always produces the same object) and nothing is fetched from the network.
 *
 * What Algorithm 1 decides:
 *   - the hard constraints: price ceiling, minimum seats, accepted powertrains, New/Used, and the
 *     questionnaire body-style set from which the Studio confirms one final body style;
 *   - the usage numbers: ownership horizon and annual mileage, re-measured from the current
 *     `destinations[]` instead of the possibly stale `derivedData.routing` snapshot;
 *   - the four preference weights derived from every entry of `selectedPriorities`;
 *   - the effective charging conditions and the risks that follow from them.
 *
 * What it deliberately never does: invent a vehicle price, a fuel or electricity price, an
 * insurance, maintenance or depreciation figure, an emission value, a TCO or a fitness score.
 * Those belong to the vehicle-side model of Algorithm 2.
 */
export const DEMAND_MODEL_SCHEMA_VERSION = '1.0';

/** Selected Step 5 priority -> the weighting key Algorithm 2 reads. */
const PRIORITY_WEIGHT_KEYS = {save_money:'cost', save_time:'time', environment:'emissions', comfort_space:'comfortSpace'};
const WEIGHT_ORDER = ['cost', 'time', 'emissions', 'comfortSpace'];
const WEIGHT_SCALE = 1e6;
const VEHICLE_CONDITIONS = ['New', 'Used', 'Either'];
const HOME_CHARGING_VALUES = ['Level 2', 'Regular outlet', 'Can install', 'Unavailable', 'Unsure'];
const WORKPLACE_CHARGING_VALUES = ['Yes', 'No', 'Unsure'];
const PARKING_VALUES = ['Private garage', 'Shared parking', 'Street parking'];
const ROAD_TRIP_FREQUENCY_VALUES = ['Rarely', 'Occasionally', 'Frequently'];

const mark = (code, severity, message) => ({code, severity, message});
const round6 = value => Math.round(value * WEIGHT_SCALE) / WEIGHT_SCALE;
const textOrNull = value => (typeof value === 'string' && value.trim() ? value.trim() : null);
const isBlank = value => value === null || value === undefined || (typeof value === 'string' && value.trim() === '');

/** `''` / `null` mean "not answered", while `0` and `'0'` stay a real, explicit zero. */
const typedNumber = value => {
  if (isBlank(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const typedWholeNumber = value => {
  const parsed = typedNumber(value);
  return parsed === null ? null : Math.round(parsed);
};
/** Canonical spelling when the stored answer is one of the questionnaire options, else null. */
const fromOptions = (value, options) => {
  const text = textOrNull(value);
  if (!text) return null;
  return options.find(option => option.toLowerCase() === text.toLowerCase()) || null;
};
const anyText = (value, options) => fromOptions(value, options) || textOrNull(value);

/* ------------------------------------------------------------------ hard constraints */

function buildConstraints(profile, emit) {
  const accepted = normalizePowertrains(profile.acceptablePowertrains);
  const acceptableBodyTypes = normalizeBodyTypes(
    Array.isArray(profile.acceptableBodyTypes) || typeof profile.acceptableBodyTypes === 'string'
      ? profile.acceptableBodyTypes
      : profile.preferredBodyType,
  );
  if (!acceptableBodyTypes.length) {
    emit.warn('no-body-style-accepted', 'The profile accepts no body style, so the DNA Studio cannot offer a final body style. Step 2 must keep at least one database-supported body style selected.');
  }
  const rawBudget = typedNumber(profile.budget);
  const maxPurchasePriceUSD = rawBudget !== null && rawBudget > 0 ? rawBudget : null;
  if (rawBudget === null) {
    emit.warn('budget-missing', 'The profile carries no usable purchase budget, so maxPurchasePriceUSD is null and no price ceiling can be enforced. A lease or rental budget is not a purchase ceiling, and a missing ceiling is never replaced by an invented one.');
  } else if (maxPurchasePriceUSD === null) {
    emit.warn('budget-not-a-ceiling', `The stored budget "${profile.budget}" is not a positive amount, so maxPurchasePriceUSD is null instead of an unusable ceiling.`);
  }

  const rawSeats = typedWholeNumber(profile.minimumSeats);
  const minimumSeats = rawSeats !== null && rawSeats >= 1 ? rawSeats : null;
  if (minimumSeats === null) {
    emit.warn('minimum-seats-missing', 'No usable seat requirement is stored, so minimumSeats is null; the seat count must be treated as unconstrained instead of guessed.');
  }

  if (!accepted.length) {
    emit.warn('no-powertrain-accepted', 'The stored profile accepts no powertrain at all (Step 4 blocks this), so acceptablePowertrains is empty and there is no powertrain Algorithm 2 may generate.');
  }

  const storedCondition = textOrNull(profile.vehicleCondition);
  const condition = fromOptions(storedCondition, VEHICLE_CONDITIONS);
  if (storedCondition && !condition) {
    emit.warn('vehicle-condition-unrecognised', `The stored vehicle condition "${storedCondition}" is not New, Used or Either, so it is read as Either, which adds no restriction.`);
    emit.assume('vehicleCondition', 'Either', 'The stored condition was unusable, so the unrestricted value is used.');
  }

  return {
    maxPurchasePriceUSD,
    minimumSeats,
    acceptablePowertrains: accepted,
    excludedPowertrains: POWERTRAIN_VALUES.filter(item => !accepted.includes(item)),
    vehicleCondition: condition || 'Either',
    acceptableBodyTypes,
    allowedBodyTypes: acceptableBodyTypes,
    finalBodyStyle: null,
    purchaseMode: 'buy',
    hardRules: [
      'Purchase price must not exceed maxPurchasePriceUSD.',
      'Seat count must be at least minimumSeats.',
      'Powertrain must be one of acceptablePowertrains.',
      'Vehicle condition must match vehicleCondition; Either adds no restriction.',
      'The final body style chosen in the DNA Studio must be one of acceptableBodyTypes.',
    ],
    softPreferences: {
      preferredBodyType: acceptableBodyTypes.length === 1 ? acceptableBodyTypes[0] : 'No Preference',
      cargoNeeds: textOrNull(profile.cargoNeeds),
      role: textOrNull(profile.role),
      enforcement: 'Soft preference: the cargo need and the role are ranking hints. The questionnaire body-style set defines the Studio options, and the final body style becomes a hard matcher filter.',
    },
    enforcement: 'Algorithm 2 may only generate a vehicle DNA inside these limits and Algorithm 3 may only recommend a real vehicle inside them. Once the DNA Studio confirms a final body style, that body style is a hard constraint. Budget, seats, powertrain and condition remain hard constraints.',
  };
}

/* ------------------------------------------------------------------ usage */

function buildUsage(profile, emit) {
  const months = typedWholeNumber(profile.ownershipDurationMonths);
  const ownershipMonths = months !== null && months > 0 ? months : null;
  const ownershipYears = ownershipMonths === null ? null : ownershipMonths / 12;
  if (ownershipMonths === null) {
    emit.warn('ownership-duration-missing', 'No usable ownership duration is stored, so ownershipMonths and ownershipYears are null; a total cost of ownership needs that horizon.');
  }

  // Every destination is re-measured from the profile as it is right now. derivedData.routing is
  // deliberately not read: it is a snapshot of an earlier routing pass and may be stale.
  const destinations = (Array.isArray(profile.destinations) ? profile.destinations : []).map(destination => {
    const oneWay = Number(destination.routeDistanceMiles);
    const routed = Number.isFinite(oneWay) && oneWay > 0;
    return {
      id: textOrNull(destination.id),
      type: textOrNull(destination.type),
      customName: textOrNull(destination.customName),
      routeDistanceMiles: routed ? oneWay : null,
      roundTripsPerWeek: typedNumber(destination.roundTripsPerWeek),
      weeksPerYear: typedNumber(destination.weeksPerYear),
      annualMiles: routed ? destinationAnnualMiles(destination) : null,
      routed,
    };
  });
  const routedDestinations = destinations.filter(item => item.routed);
  const missingDestinations = destinations.filter(item => !item.routed);
  const coverageStatus = !destinations.length ? 'none'
    : missingDestinations.length ? (routedDestinations.length ? 'partial' : 'missing') : 'complete';
  const routeCoverage = {
    status: coverageStatus,
    totalDestinations: destinations.length,
    routedDestinations: routedDestinations.length,
    missingDestinations: missingDestinations.length,
    missingDestinationIds: missingDestinations.map(item => item.id).filter(Boolean),
    measuredRoutedAnnualMiles: routedDestinations.length ? dailyDrivingMiles(routedDestinations) : null,
    method: '2 × routeDistanceMiles × roundTripsPerWeek × weeksPerYear for each destination, using the road distances stored on the current destinations',
    routingSnapshotUsed: false,
  };
  if (coverageStatus === 'partial') {
    emit.warn('routes-partial', `${routeCoverage.missingDestinations} of ${routeCoverage.totalDestinations} destinations still have no measured road distance, so daily mileage is reported as unknown (null) and the measured part stays in usage.routeCoverage.measuredRoutedAnnualMiles. A missing route is never counted as 0 miles.`);
  } else if (coverageStatus === 'missing') {
    emit.warn('routes-missing', 'Destinations are stored but none of them has a measured road distance, so daily mileage is unknown (null) instead of 0 miles.');
  } else if (coverageStatus === 'none') {
    emit.warn('routes-missing', 'The stored profile has no frequent destination, so no daily mileage can be measured and dailyAnnualMiles is null instead of 0 miles.');
  }

  const tripsPerYear = typedNumber(profile.longDistanceTripsPerYear);
  const roundTripMiles = typedNumber(profile.longDistanceRoundTripMiles);
  const longDistanceAnswered = tripsPerYear !== null && roundTripMiles !== null
    && tripsPerYear >= 0 && roundTripMiles >= 0;
  const longDistanceAnnualMiles = longDistanceAnswered
    ? longDistanceMiles(tripsPerYear, roundTripMiles) : null;
  if (!longDistanceAnswered) {
    emit.warn('long-distance-incomplete', 'The long-distance answers are incomplete (trips per year and miles per round trip are both required), so longDistanceAnnualMiles is null and the total annual mileage cannot be formed from the measured part.');
  }

  const manualOptedIn = profile.estimateMileageLater === true;
  const manualTyped = !isBlank(profile.annualMileage);
  const manualValue = typedNumber(profile.annualMileage);
  const manualUsable = manualOptedIn && manualValue !== null && manualValue >= 0;
  const routesComplete = coverageStatus === 'complete';
  const useManualTotal = !routesComplete && manualUsable;

  const dailyAnnualMiles = routesComplete ? routeCoverage.measuredRoutedAnnualMiles : null;
  const totalAnnualMiles = useManualTotal ? manualValue
    : routesComplete && longDistanceAnnualMiles !== null ? dailyAnnualMiles + longDistanceAnnualMiles : null;
  const mileageStatus = totalAnnualMiles !== null ? 'complete'
    : dailyAnnualMiles !== null || longDistanceAnnualMiles !== null ? 'partial' : 'missing';
  const mileageSource = useManualTotal ? 'manual-annual-mileage' : routesComplete ? 'routes' : 'none';

  const manualReason = useManualTotal
    ? 'The measured routes are incomplete, so the annual mileage the user typed is used as the trip total; the long-distance product is reported separately and is not added on top of it.'
    : !manualTyped ? 'No own annual mileage figure is stored.'
      : manualValue === null ? 'The stored annual mileage is not a usable number.'
        : !manualOptedIn ? 'A figure is stored but the profile does not mark it as the estimate the user chose, so it is not used as a fallback.'
          : 'The measured routes are complete, so the measured mileage is used and this separate reference figure is never added to it.';
  const manualAnnualMileage = {
    optedIn: manualOptedIn,
    typed: manualTyped,
    value: manualValue,
    explicitZero: manualValue === 0,
    used: useManualTotal,
    reason: manualReason,
  };

  if (!routesComplete && !useManualTotal) {
    emit.warn('annual-mileage-missing', `The measured routes are ${coverageStatus} and ${manualOptedIn ? 'the own annual mileage field is empty or unusable' : 'no own annual mileage fallback is available'}, so dailyAnnualMiles and totalAnnualMiles stay null instead of being reported as 0 miles.`);
  }
  if (manualTyped && !manualOptedIn) {
    emit.info('manual-mileage-not-opted-in', 'A separate annual mileage figure is stored but the profile does not mark it as the chosen estimate, so Algorithm 1 does not use it as a fallback.');
  }
  if (totalAnnualMiles === null) {
    emit.warn('total-annual-miles-unknown', 'totalAnnualMiles is null because at least one part of the annual driving is unknown; the known parts stay in this block and a missing part must never be read as 0 miles.');
  }

  return {
    ownershipMonths,
    ownershipYears,
    dailyAnnualMiles,
    longDistanceAnnualMiles,
    totalAnnualMiles,
    longDistanceTripsPerYear: tripsPerYear,
    longDistanceRoundTripMiles: roundTripMiles,
    roadTripFrequency: anyText(profile.roadTripFrequency, ROAD_TRIP_FREQUENCY_VALUES),
    mileageSource,
    mileageStatus,
    mileageSources: {
      dailyAnnualMiles: dailyAnnualMiles === null ? 'unknown' : 'routes',
      longDistanceAnnualMiles: longDistanceAnnualMiles === null ? 'missing' : 'user-answers',
      totalAnnualMiles: useManualTotal ? 'manual-annual-mileage' : totalAnnualMiles === null ? 'unknown' : 'routes+long-distance',
    },
    routeCoverage,
    manualAnnualMileage,
    destinations,
    method: 'Ownership months come from the profile, daily mileage is re-measured from the current destinations[] with 2 × routeDistanceMiles × roundTripsPerWeek × weeksPerYear, and long-distance mileage is longDistanceTripsPerYear × longDistanceRoundTripMiles.',
    notes: [
      'Daily mileage is re-measured on every call from the current destinations[]. The derivedData.routing snapshot is never read, so a stale snapshot cannot change the result.',
      'A destination without a measured road distance is reported as null (unknown), never as 0 miles. A round-trip count of 0 is a real zero and is kept as 0.',
      "annualMileage is the user's own reference figure. It is never added to the measured mileage; it only replaces the total when the measured routes are incomplete.",
      'Zero miles is only ever reported when the value really is zero, for example a destination with 0 round trips per week or an own annual mileage of 0 that the user typed.',
    ],
  };
}

/* ------------------------------------------------------------------ preferences */

/**
 * `weight = (1 + 2 * selected) / (4 + 2 * k)`: every unselected goal starts at 1, every selected
 * goal is tripled, and the whole set is divided by 4 + 2k so the four weights always sum to 1.
 * Balanced (or a profile with no priority at all) gives all four goals 0.25.
 */
function weightSelection(demand) {
  const weights = {cost: 0, time: 0, emissions: 0, comfortSpace: 0};
  const selectedKeys = demand.concretePriorities.map(item => PRIORITY_WEIGHT_KEYS[item]).filter(Boolean);
  if (demand.isBalanced || !selectedKeys.length) {
    WEIGHT_ORDER.forEach(key => { weights[key] = 0.25; });
    return {weights, mode: demand.isBalanced ? 'balanced' : 'default-equal', selectedCount: selectedKeys.length, denominator: 4};
  }
  const denominator = 4 + 2 * selectedKeys.length;
  WEIGHT_ORDER.forEach(key => { weights[key] = round6((selectedKeys.includes(key) ? 3 : 1) / denominator); });
  // The exact fractions sum to 1, so the small rounding residue is carried by the last weight
  // instead of touching a selected weight.
  const residue = round6(1 - WEIGHT_ORDER.reduce((sum, key) => sum + weights[key], 0));
  if (residue) {
    const last = WEIGHT_ORDER[WEIGHT_ORDER.length - 1];
    weights[last] = round6(weights[last] + residue);
  }
  return {weights, mode: 'combined', selectedCount: selectedKeys.length, denominator};
}

function buildPreferences(profile, emit) {
  const demand = priorityDemand(profile);
  const selection = weightSelection(demand);
  const weightSum = WEIGHT_ORDER.reduce((sum, key) => sum + selection.weights[key], 0);
  if (!demand.selectedPriorities.length) {
    emit.warn('priorities-missing', 'The stored profile selects no priority at all (Step 5 blocks this), so Algorithm 1 falls back to equal weights for the four goals instead of guessing an order.');
    emit.assume('preferenceWeights', selection.weights, 'No priority is stored, so every goal receives the same weight.');
  }

  return {
    selectedPriorities: demand.selectedPriorities,
    concretePriorities: demand.concretePriorities,
    isBalanced: demand.isBalanced,
    mode: selection.mode,
    selectedCount: selection.selectedCount,
    weights: selection.weights,
    weightSum,
    weightRule: 'weight = (1 + 2 * selected) / (4 + 2 * k), where k is the number of selected specific priorities: every selected goal counts 3, every unselected goal counts 1, and the result is scaled so the four weights sum to 1.',
    method: selection.mode === 'combined'
      ? `${selection.selectedCount} specific priorities were combined and each one is weighted above the unselected goals (denominator ${selection.denominator}).`
      : selection.mode === 'balanced' ? 'The profile chose Balanced, so all four goals carry the same weight.' : 'No priority was stored, so all four goals were given the same weight as a documented fallback.',
    notes: [
      'Every entry of selectedPriorities is kept; a later click never drops an earlier one. Balanced is reported as even weighting and is never combined with the four specific priorities.',
      'The weights are normalized to sum to 1 and rounded to 6 decimals; the rounding residue is carried by the last weight (comfortSpace).',
      'No fitness is computed here. Cost (USD), time (hours) and emissions (grams) are different units and must not be added together; Algorithm 2 normalizes each goal first and then applies these weights.',
    ],
  };
}

/* ------------------------------------------------------------------ charging */

function buildCharging(profile, emit) {
  const demand = chargingDemand(profile);
  const chargingApplicable = demand.chargingApplicable;
  const homeCharging = chargingApplicable ? anyText(demand.effective.homeCharging, HOME_CHARGING_VALUES) : null;
  const workplaceCharging = chargingApplicable ? anyText(demand.effective.workplaceCharging, WORKPLACE_CHARGING_VALUES) : null;
  const parking = anyText(demand.parking, PARKING_VALUES);

  const riskFlags = [];
  if (chargingApplicable) {
    if (homeCharging === 'Unavailable') riskFlags.push(mark('home-charging-unavailable', 'risk', 'Home charging is unavailable, so an EV or PHEV would depend on public or workplace charging. Algorithm 2 must model the extra charging time and cost and must not remove the plug-in powertrains from acceptablePowertrains.'));
    if (homeCharging === 'Unsure') riskFlags.push(mark('home-charging-unsure', 'risk', 'Home charging is unknown, so how much energy can be replaced at home is uncertain. The plug-in powertrains stay accepted and the uncertainty is passed to Algorithm 2.'));
    if (homeCharging === 'Regular outlet') riskFlags.push(mark('home-charging-basic', 'risk', 'A regular outlet is the slowest way to charge, which limits the energy that can be replaced overnight.'));
    if (homeCharging === 'Can install') riskFlags.push(mark('home-charging-not-installed', 'risk', 'Home charging would still have to be installed, so it is not available today.'));
    if (homeCharging === null) riskFlags.push(mark('home-charging-unknown', 'risk', 'No home charging answer is recorded, so the charging situation is unknown.'));
    if (workplaceCharging === 'No') riskFlags.push(mark('workplace-charging-none', 'info', 'No workplace or school charging is available, so charging has to happen at home or in public.'));
    if (workplaceCharging === 'Unsure') riskFlags.push(mark('workplace-charging-unsure', 'risk', 'Workplace charging is unknown, so a weekday charging opportunity cannot be assumed.'));
    if (parking === 'Street parking') riskFlags.push(mark('parking-no-private-outlet', 'risk', 'Street parking means there is no dependable private overnight outlet.'));
    else if (parking === 'Shared parking') riskFlags.push(mark('parking-shared', 'info', 'Shared parking means access to an outlet is not guaranteed.'));
    if (homeCharging === null && workplaceCharging === null) {
      emit.info('charging-answers-missing', 'The profile accepts a plug-in powertrain but records no charging answer, so the charging situation is unknown rather than unavailable.');
    }
  }

  return {
    chargingApplicable,
    homeCharging,
    workplaceCharging,
    parking,
    acceptedPowertrainsRequiringCharging: demand.acceptablePowertrains.filter(item => CHARGING_POWERTRAINS.includes(item)),
    excludedPowertrains: demand.excludedPowertrains,
    powertrainsFilteredByCharging: false,
    publicChargingDependency: chargingApplicable
      && (homeCharging === null || homeCharging === 'Unavailable' || homeCharging === 'Unsure'),
    relation: demand.relation,
    reason: demand.reason,
    riskFlags,
    notes: [
      chargingApplicable
        ? 'At least one accepted powertrain (PHEV or EV) can be charged externally, so both answers are the effective charging demand.'
        : 'No accepted powertrain needs external charging (ICE and non-plug-in hybrid only), so both effective charging fields are null. An answer typed while the questions were hidden stays stored on the profile and is deliberately not part of this model.',
      'The charging flags are risks for Algorithm 2, not filters for Algorithm 3: they never change acceptablePowertrains.',
    ],
    enforcement: 'Charging never adds or removes a powertrain. acceptablePowertrains stays the only powertrain list, and a difficult charging situation must be priced by Algorithm 2 instead of dropping EV and PHEV.',
  };
}

/* ------------------------------------------------------------------ warnings, assumptions, data quality */

/** Collects the warnings and the documented assumptions. The same code is only reported once. */
function createRecorder() {
  const warnings = [];
  const assumptions = [];
  const seen = new Set();
  const record = (severity, code, message) => {
    if (!code || seen.has(code)) return;
    seen.add(code);
    warnings.push({code, severity, message});
  };
  return {
    warn: (code, message) => record('warning', code, message),
    info: (code, message) => record('info', code, message),
    assume: (path, value, reason) => {
      const key = `assumption:${path}`;
      if (seen.has(key)) return;
      seen.add(key);
      assumptions.push({path, value, reason});
    },
    warnings,
    assumptions,
  };
}

/**
 * The stored, validated profile wins every level conflict and the conflict is reported, so
 * Algorithm 2 never has to guess which of two values was meant.
 */
function detectLevelConflicts(raw, normalized, emit) {
  const intention = textOrNull(raw.purchaseIntention);
  if (intention && intention.toLowerCase() !== 'buy') {
    emit.warn('purchase-intention-forced', `The stored profile asks for "${intention}", but only buying is modelled, so purchaseMode stays buy and a lease or rental budget is not read as a purchase ceiling.`);
    emit.assume('constraints.purchaseMode', 'buy', 'Leasing and renting are outside the accepted pipeline, so only the purchase path is modelled.');
  }

  const rawPowertrains = Array.isArray(raw.acceptablePowertrains) ? raw.acceptablePowertrains : [];
  if (rawPowertrains.length && rawPowertrains.length !== normalizePowertrains(rawPowertrains).length) {
    emit.warn('powertrain-values-normalised', 'One or more stored powertrain values were not one of ICE, HEV, PHEV or EV, so the normalised list is used.');
  }

  const rawPriorities = Array.isArray(raw.selectedPriorities) ? raw.selectedPriorities : [];
  if (rawPriorities.length > normalizePriorities(rawPriorities).length) {
    emit.warn('priority-values-normalised', 'The stored priority selection held Balanced together with specific priorities, or an unusable entry, so the normalised selection is used: Balanced wins and is never combined with the four specific priorities.');
  }
  if (!Array.isArray(raw.selectedPriorities) && raw.priority !== undefined && raw.priority !== null) {
    emit.info('legacy-priority-field', 'A legacy single priority field was found, so it is read as the priority selection and mirrored into selectedPriorities.');
  }

  if (raw.chargingApplicable !== undefined && raw.chargingApplicable !== null
    && Boolean(raw.chargingApplicable) !== normalized.chargingApplicable) {
    emit.warn('charging-applicability-derived', 'The stored chargingApplicable flag disagrees with acceptablePowertrains; the derived value wins, because the charging questions only apply when PHEV or EV is accepted.');
  }
}

/** Unknown inputs, listed so Algorithm 2 can widen its search instead of substituting a number. */
function buildDataQuality({constraints, usage, preferences, charging, warnings}) {
  const missingInputs = [];
  const add = (path, reason) => missingInputs.push({path, reason});

  if (constraints.maxPurchasePriceUSD === null) add('budget', 'No usable purchase budget is stored, so the price ceiling is unknown and no vehicle price may be invented to fill the gap.');
  if (constraints.minimumSeats === null) add('minimumSeats', 'No usable seat requirement is stored, so the seat count has to be treated as unconstrained.');
  if (!constraints.acceptablePowertrains.length) add('acceptablePowertrains', 'No powertrain is accepted, so no demand can be satisfied.');
  if (usage.ownershipMonths === null) add('ownershipDurationMonths', 'No usable ownership horizon is stored, so a total cost of ownership has no period to run over.');
  if (usage.dailyAnnualMiles === null) add('destinations[].routeDistanceMiles', `Daily mileage cannot be measured: ${usage.routeCoverage.missingDestinations} of ${usage.routeCoverage.totalDestinations} destinations have no offline road distance yet.`);
  if (usage.longDistanceAnnualMiles === null) add('longDistanceTripsPerYear / longDistanceRoundTripMiles', 'The long-distance answers are incomplete, so long-distance mileage is unknown.');
  if (usage.totalAnnualMiles === null) add('totalAnnualMiles', 'At least one part of the annual driving is unknown, so the total stays null instead of being read as 0 miles.');
  if (!preferences.selectedPriorities.length) add('selectedPriorities', 'No priority is stored, so the four weights fall back to equal.');
  if (charging.chargingApplicable && charging.homeCharging === null) add('homeCharging', 'A plug-in powertrain is accepted but home charging is unknown, so charging time and cost carry extra uncertainty.');
  if (charging.chargingApplicable && charging.workplaceCharging === null) add('workplaceCharging', 'A plug-in powertrain is accepted but workplace charging is unknown, so a weekday charging opportunity cannot be assumed.');

  const hardConstraintsKnown = constraints.maxPurchasePriceUSD !== null
    && constraints.minimumSeats !== null && constraints.acceptablePowertrains.length > 0;
  const status = !missingInputs.length ? 'complete'
    : hardConstraintsKnown && usage.ownershipMonths !== null ? 'usable-with-gaps' : 'incomplete';

  return {
    status,
    missingInputs,
    missingInputCount: missingInputs.length,
    warningCount: warnings.filter(item => item.severity === 'warning').length,
    infoCount: warnings.filter(item => item.severity === 'info').length,
    notes: [
      'Steps 1-5 of the questionnaire allow several answers to stay unknown, so a gap here is an allowed unknown value and not a broken profile.',
      'Algorithm 2 must widen or skip the affected part of the search for every entry in missingInputs. A null mileage must never be read as 0 miles and a null price ceiling must never be replaced by a guessed price.',
      'This block describes what is unknown about the demand, not the quality of the user.',
    ],
  };
}

/* ------------------------------------------------------------------ Algorithm 1 */

/**
 * Algorithm 1 entry point.
 *
 * @param {object} profile the stored UserDemandProfile (schema 7.0). It is normalized inside, so a
 *   legacy or partially filled object is accepted as well. The argument is never mutated.
 * @returns {object} a plain, JSON-serializable demand model:
 *   `{schemaVersion, profileSchemaVersion, source, constraints, usage, preferences, charging,
 *     assumptions, dataQuality, warnings, handoff}`.
 */
export function buildDemandModel(profile) {
  const raw = profile && typeof profile === 'object' ? profile : {};
  const normalized = normalizeProfile(raw);
  const emit = createRecorder();
  detectLevelConflicts(raw, normalized, emit);

  const constraints = buildConstraints(normalized, emit);
  const usage = buildUsage(normalized, emit);
  const preferences = buildPreferences(normalized, emit);
  const charging = buildCharging(normalized, emit);
  const dataQuality = buildDataQuality({constraints, usage, preferences, charging, warnings: emit.warnings});

  return {
    schemaVersion: DEMAND_MODEL_SCHEMA_VERSION,
    profileSchemaVersion: PROFILE_SCHEMA_VERSION,
    source: {
      generator: 'src/algorithms/userDemandModel.js',
      entry: 'buildDemandModel(profile)',
      input: `UserDemandProfile schema ${PROFILE_SCHEMA_VERSION}, the same object Steps 1-5 of the questionnaire validate and store`,
      purity: 'Pure and deterministic: the input profile is never mutated and no clock, random value, network call or storage access is used, so the same profile always produces the same JSON.',
    },
    constraints,
    usage,
    preferences,
    charging,
    assumptions: {
      list: emit.assumptions,
      rules: [
        'Only values that are stored in the profile are used. No price, fuel economy, electricity price, emission factor, insurance, maintenance, depreciation or resale value is invented here.',
        'Every conflict between a stored value and a value that can be derived from the profile is resolved in favour of the stored, validated profile, and the conflict is reported in warnings.',
        'A missing value stays null or empty. It is never silently replaced by 0, by a default vehicle or by an average.',
      ],
    },
    dataQuality,
    warnings: emit.warnings,
    handoff: {
      algorithm2: 'Evolve a vehicle DNA only inside constraints (price <= maxPurchasePriceUSD, seats >= minimumSeats, powertrain in acceptablePowertrains, condition matching vehicleCondition), score it with preferences.weights after normalizing each goal, size the annual energy need with usage.totalAnnualMiles and treat charging.riskFlags as extra cost and time to model.',
      algorithm3: 'Match and rank real vehicles with the same four constraints, the same preference weights and the same annual mileage, and never recommend a vehicle that breaks a hard rule.',
      notModeled: 'Vehicle prices, fuel economy, electricity prices, emissions, insurance, maintenance, depreciation, resale value, total cost of ownership and fitness are outside Algorithm 1; they belong to the vehicle-side model of Algorithm 2 and Algorithm 3.',
    },
  };
}

