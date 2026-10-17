/**
 * DNA scoring — six DNA axes rolled up into the user's four demand dimensions.
 *
 * The formula is deliberately explicit:
 *
 *   axis satisfaction  = 1 at (or better than) the ideal target, falling linearly to 0 at the
 *                        acceptable limit, and clamped to [0, 1];
 *   dimension value    = weighted mean of its axes (price 55% + energy 45% for cost,
 *                        seats 45% + cargo 55% for comfort/space);
 *   Score              = 100 × Σ demandWeight × dimensionSatisfaction.
 *
 * Unknown values are never zero-filled. They score 0.5 in the point estimate, 0 in the
 * conservative lower bound and 1 in the upper bound; the coverage and the caveat list make that
 * uncertainty visible. Cars are ranked on the conservative lower bound.
 */

const clamp01 = value => Math.min(1, Math.max(0, value));
const round1 = value => Math.round(value * 10) / 10;

/**
 * Satisfaction of one measured value against one target.
 * Returns `null` when the value is unknown, so an absent field cannot become a perfect or a zero score.
 */
export function satisfactionFor(target, value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!target || !Number.isFinite(number) || target.ideal === null || target.ideal === undefined) {
    return null;
  }
  const ideal = Number(target.ideal);
  if (!Number.isFinite(ideal)) return null;

  if (target.direction === 'lower') {
    const max = Number.isFinite(target.acceptableMax) ? target.acceptableMax : target.hardMax;
    if (number <= ideal) return 1;
    if (!Number.isFinite(max) || max <= ideal) return 0;
    if (number >= max) return 0;
    return clamp01(1 - (number - ideal) / (max - ideal));
  }

  // higher-is-better
  const min = Number.isFinite(target.acceptableMin) ? target.acceptableMin : target.hardMin;
  if (number >= ideal) return 1;
  if (!Number.isFinite(min) || min >= ideal) return 0;
  if (number <= min) return 0;
  return clamp01((number - min) / (ideal - min));
}

/**
 * Strict vs conditional budget matching from the recorded price band.
 *
 * - strict: the whole recorded band is inside the budget.
 * - conditional: the band straddles the budget, so the car may or may not fit.
 * - over: even the low end is above budget.
 * - unverified: no band; a point estimate at or below budget is only conditional evidence.
 */
export function classifyBudget(view, budget) {
  const read = value => value === null || value === undefined || value === '' ? null : Number(value);
  const cap = read(budget);
  const rawPoint = read(view?.price?.estimatedUSD);
  const rawLow = read(view?.price?.bandUSD?.low);
  const rawHigh = read(view?.price?.bandUSD?.high);
  const point = Number.isFinite(rawPoint) ? rawPoint : null;
  const low = Number.isFinite(rawLow) ? rawLow : null;
  const high = Number.isFinite(rawHigh) ? rawHigh : null;
  if (!Number.isFinite(cap)) {
    return {status: 'unknown-budget', label: 'No budget constraint', withinBudget: null, reason: 'The profile has no usable budget.'};
  }
  if (Number.isFinite(low) && Number.isFinite(high) && low <= high) {
    if (high <= cap) {
      return {status: 'strict', label: 'Within budget (strict)', withinBudget: true, low, high, budget: cap, reason: `The recorded band $${Math.round(low).toLocaleString()}–$${Math.round(high).toLocaleString()} is fully inside the budget.`};
    }
    if (low <= cap) {
      return {status: 'conditional', label: 'Budget-conditional', withinBudget: null, low, high, budget: cap, reason: `The recorded band $${Math.round(low).toLocaleString()}–$${Math.round(high).toLocaleString()} straddles the budget; only a negotiated price at or below the cap would qualify.`};
    }
    return {status: 'over', label: 'Over budget', withinBudget: false, low, high, budget: cap, reason: 'Even the low end of the recorded band is above the budget.'};
  }
  if (Number.isFinite(point)) {
    if (point <= cap) {
      return {status: 'conditional', label: 'Within budget (estimate only)', withinBudget: null, point, budget: cap, reason: 'No price band is recorded, so only the estimated price supports affordability.'};
    }
    return {status: 'over', label: 'Over budget', withinBudget: false, point, budget: cap, reason: 'The estimated price is above the budget and no band contradicts it.'};
  }
  return {status: 'unknown', label: 'Price unknown', withinBudget: null, reason: 'No usable price is recorded.'};
}

function axis({key, label, target, value, unit, source, note}) {
  const satisfaction = satisfactionFor(target, value);
  const known = value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  return {
    key,
    label,
    unit: unit || target?.unit || null,
    targetKey: target?.key || null,
    ideal: target?.ideal ?? null,
    acceptableMin: target?.acceptableMin ?? null,
    acceptableMax: target?.acceptableMax ?? null,
    value: known ? Number(value) : null,
    satisfaction: satisfaction === null ? null : Math.round(satisfaction * 1000) / 1000,
    status: satisfaction === null ? 'unknown' : 'known',
    source: source || null,
    note: note || (satisfaction === null ? 'No usable vehicle value; scored neutrally in the point estimate and 0 in the lower bound.' : null),
  };
}

function dimension({key, label, weight, axes, notes = []}) {
  const totalWeight = axes.reduce((sum, item) => sum + item.weightWithin, 0);
  const known = axes.filter(item => item.axis.satisfaction !== null);
  const point = totalWeight > 0
    ? axes.reduce((sum, item) => sum + item.weightWithin * (item.axis.satisfaction ?? 0.5), 0) / totalWeight
    : 0.5;
  const lowerBound = totalWeight > 0
    ? axes.reduce((sum, item) => sum + item.weightWithin * (item.axis.satisfaction ?? 0), 0) / totalWeight
    : 0;
  const upperBound = totalWeight > 0
    ? axes.reduce((sum, item) => sum + item.weightWithin * (item.axis.satisfaction ?? 1), 0) / totalWeight
    : 1;
  return {
    key,
    label,
    weight,
    satisfaction: Math.round(point * 1000) / 1000,
    lowerBound: Math.round(lowerBound * 1000) / 1000,
    upperBound: Math.round(upperBound * 1000) / 1000,
    coverage: totalWeight > 0 ? known.reduce((sum, item) => sum + item.weightWithin, 0) / totalWeight : 0,
    knownAxes: known.map(item => item.axis.key),
    unknownAxes: axes.filter(item => item.axis.satisfaction === null).map(item => item.axis.key),
    axes: axes.map(item => ({...item.axis, weightWithinDimension: item.weightWithin, dimension: key})),
    notes,
  };
}


/**
 * Score one adapted vehicle against an ideal DNA.
 *
 * @param {object} view adapted VehicleView.
 * @param {object} metrics `computeVehicleMetrics(view, same mileage)`.
 * @param {object} dna result of `generateIdealDna(...)`.
 * @returns {object} dimension/axis breakdown, weighted score, conservative bound and caveats.
 */
export function scoreVehicle(view, metrics, dna) {
  const targets = dna?.targets || {};
  const weights = dna?.weights || {cost: 0.25, time: 0.25, emissions: 0.25, comfortSpace: 0.25};
  const budget = classifyBudget(view, dna?.constraints?.maxPurchasePriceUSD);

  const priceAxis = axis({
    key: 'priceFit',
    label: 'Purchase price',
    target: targets.purchasePriceUSD,
    value: view?.price?.estimatedUSD,
    unit: 'USD',
    source: view?.price?.status === 'ESTIMATED' ? 'database estimate' : view?.price?.status || null,
  });
  const energyAxis = axis({
    key: 'energyCost',
    label: 'Annual energy cost',
    target: targets.annualEnergyCostUSD,
    value: metrics?.cost?.annualUSD,
    unit: 'USD/year',
    source: 'derived',
    note: metrics?.cost?.reason || null,
  });
  const emissionAxis = axis({
    key: 'emissions',
    label: 'CO₂ proxy',
    target: targets.emissionsGramsPerMile,
    value: metrics?.emissions?.gramsCO2PerMile,
    unit: 'g CO2/mi',
    source: 'derived',
  });
  const rangeAxis = axis({
    key: 'range',
    label: 'Driving range',
    target: targets.rangeMiles,
    value: view?.efficiency?.totalRangeMiles?.value,
    unit: 'mi',
    source: view?.efficiency?.totalRangeMiles?.reason || view?.efficiency?.totalRangeMiles?.status || null,
  });
  const seatAxis = axis({
    key: 'seats',
    label: 'Seating capacity',
    target: targets.seats,
    value: view?.seats,
    unit: 'seats',
    source: 'database',
  });
  const cargoAxis = axis({
    key: 'cargo',
    label: 'Cargo / space proxy',
    target: targets.cargoRank,
    value: view?.dimensions?.cargoProxy?.rank,
    unit: 'rank',
    source: view?.dimensions?.cargoProxy?.basis || 'missing',
    note: view?.dimensions?.cargoProxy ? 'Ordinal body-type proxy; measured cargo volume is not recorded.' : null,
  });

  const cost = dimension({
    key: 'cost',
    label: 'Cost',
    weight: weights.cost,
    axes: [
      {axis: priceAxis, weightWithin: 0.55},
      {axis: energyAxis, weightWithin: 0.45},
    ],
  });
  const time = dimension({
    key: 'time',
    label: 'Time & range',
    weight: weights.time,
    axes: [{axis: rangeAxis, weightWithin: 1}],
    notes: ['Charging and refuelling infrastructure is reported as a separate contextual caveat; it is not silently folded into the score.'],
  });
  const emissions = dimension({
    key: 'emissions',
    label: 'Emissions',
    weight: weights.emissions,
    axes: [{axis: emissionAxis, weightWithin: 1}],
  });
  const comfortSpace = dimension({
    key: 'comfortSpace',
    label: 'Comfort & space',
    weight: weights.comfortSpace,
    axes: [
      {axis: seatAxis, weightWithin: 0.45},
      {axis: cargoAxis, weightWithin: 0.55},
    ],
  });
  const dimensions = {cost, time, emissions, comfortSpace};
  const order = ['cost', 'time', 'emissions', 'comfortSpace'];
  const scorePoint = Math.round(100 * order.reduce((sum, key) => sum + weights[key] * dimensions[key].satisfaction, 0) * 10) / 10;
  const scoreLowerBound = Math.round(100 * order.reduce((sum, key) => sum + weights[key] * dimensions[key].lowerBound, 0) * 10) / 10;
  const scoreUpperBound = Math.round(100 * order.reduce((sum, key) => sum + weights[key] * dimensions[key].upperBound, 0) * 10) / 10;
  const coverage = order.reduce((sum, key) => sum + weights[key] * dimensions[key].coverage, 0);
  const unknown = order.flatMap(key => dimensions[key].axes
    .filter(item => item.status === 'unknown')
    .map(item => ({dimension: key, axis: item.key, label: item.label})));

  const caveats = [];
  if (budget.status === 'conditional') caveats.push({code: 'budget-conditional', severity: 'warning', message: budget.reason});
  if (budget.status === 'over') caveats.push({code: 'over-budget', severity: 'risk', message: budget.reason});
  if (unknown.length) caveats.push({code: 'unknown-values', severity: 'info', message: `${unknown.length} DNA value${unknown.length === 1 ? ' is' : 's are'} unknown for this car; the conservative bound treats them as unsatisfied.`, values: unknown});
  if (view?.price?.isEstimate) caveats.push({code: 'estimated-price', severity: 'info', message: 'The purchase price is an estimate, not a verified transaction price.'});
  if (view?.dimensions?.cargoVolumeCubicFeet === null) caveats.push({code: 'cargo-proxy', severity: 'info', message: 'Cargo is an ordinal body-type proxy; no measured cargo volume is recorded.'});
  if (dna?.usage?.annualMilesKnown === false) caveats.push({code: 'mileage-placeholder', severity: 'warning', message: 'Annual mileage is unknown; energy cost and emissions use a 12,000 mi/yr placeholder.'});

  return {
    vehicleId: view?.vehicleId || null,
    displayName: view?.displayName || null,
    scores: {
      point: scorePoint,
      lowerBound: scoreLowerBound,
      upperBound: scoreUpperBound,
      rankScore: scoreLowerBound,
      uncertaintyBand: Math.round((scoreUpperBound - scoreLowerBound) * 10) / 10,
      coverage: Math.round(coverage * 1000) / 1000,
    },
    weights,
    dimensions,
    axes: [priceAxis, energyAxis, emissionAxis, rangeAxis, seatAxis, cargoAxis],
    budget,
    caveats,
    dataQuality: {
      confidence: coverage >= 0.9 && view?.dataQuality?.confidence !== 'LOW' ? 'MEDIUM' : 'LOW',
      knownAxisCount: 6 - unknown.length,
      unknownAxisCount: unknown.length,
      sourceConfidence: view?.dataQuality?.confidence || 'UNKNOWN',
    },
  };
}

/**
 * Six-axis radar values for a vehicle: 0–100 axis satisfaction. Unknown = null, never 0.
 * The ideal polygon is 100 on every axis by definition.
 */
export function buildRadar(scored, dna) {
  const axes = dna?.displayAxes || [];
  return axes.map(axisDefinition => {
    const scoredAxis = scored?.axes?.find(item => item.key === axisDefinition.key);
    return {
      key: axisDefinition.key,
      label: axisDefinition.label,
      shortLabel: axisDefinition.shortLabel,
      dimension: axisDefinition.dimension,
      ideal: 100,
      vehicle: scoredAxis?.satisfaction === null || scoredAxis?.satisfaction === undefined
        ? null
        : Math.round(scoredAxis.satisfaction * 100),
      value: scoredAxis?.value ?? null,
      unit: scoredAxis?.unit || null,
      idealValue: dna?.targets?.[axisDefinition.targetKey]?.ideal ?? null,
      status: scoredAxis?.status || 'unknown',
    };
  });
}

/** Human-readable label for a score without implying precision that the data does not have. */
export function scoreLabel(score) {
  if (!Number.isFinite(Number(score))) return 'Not scored';
  if (score >= 85) return 'Excellent match';
  if (score >= 70) return 'Strong match';
  if (score >= 55) return 'Moderate match';
  if (score >= 40) return 'Weak match';
  return 'Poor match';
}

