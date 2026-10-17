/**
 * Market benchmark for the six radar axes — Checkpoint G.
 *
 * Every axis is first converted to a direction-consistent performance number for each adapted
 * vehicle. The benchmark is the arithmetic mean of those real performance values, and the plotted
 * index is `100 * value / mean`: Market Average = 100 by definition.
 *
 * The benchmark is independent of the Top 3, but it is scoped to the same market the user can
 * actually buy from: every adapted record must pass the current hard constraints and its price band
 * must sit fully inside the budget. Budget-conditional and over-budget records are excluded, so 100
 * describes the in-budget market rather than the whole database.
 *
 * The benchmark reports its own sample size and missing count per axis, and never fills a missing
 * value with 0. The index is visual context only; the DNA Match Score stays the matcher score.
 */

import {computeVehicleMetrics} from './vehicleMetrics.js';
import {budgetTier, hardRejection} from './vehicleMatcher.js';

export const MARKET_BENCHMARK_SCHEMA_VERSION = 'market-benchmark/2.0';
export const MARKET_AVERAGE_INDEX = 100;

export const MARKET_AXIS_DEFINITIONS = [
  {
    key: 'purchaseAffordability',
    label: 'Purchase Affordability',
    shortLabel: 'Affordability',
    direction: 'higher',
    unit: 'budget / price',
    definition: 'Budget ceiling divided by the estimated purchase price. Higher means more budget headroom.',
    performanceLabel: 'Budget ÷ price',
    missing: 'No usable estimated price or no budget ceiling.',
  },
  {
    key: 'energyCostFit',
    label: 'Energy Cost Fit',
    shortLabel: 'Energy cost',
    direction: 'higher',
    unit: '1 / (USD per year)',
    definition: 'Inverse of derived annual energy cost under the shared fuel and electricity assumptions. Higher is cheaper.',
    performanceLabel: '1 ÷ annual energy cost',
    missing: 'Annual energy cost cannot be derived from the recorded efficiency.',
  },
  {
    key: 'rangeAdequacy',
    label: 'Range Adequacy',
    shortLabel: 'Range',
    direction: 'higher',
    unit: 'share of target',
    definition: 'Recorded total range divided by the edited range target, capped at 1. This asks whether the car meets the planning range.',
    performanceLabel: 'min(range, target) ÷ target',
    missing: 'Total range is not recorded.',
  },
  {
    key: 'refuelingConvenience',
    label: 'Refueling Convenience',
    shortLabel: 'Refueling',
    direction: 'higher',
    unit: 'miles per stop',
    definition: 'Recorded total range used as distance between refuelling or charging stops. Charging power and station access are missing, so no stop time or local access is invented.',
    performanceLabel: 'miles between stops',
    missing: 'Total range is not recorded.',
  },
  {
    key: 'energyEmissionsFit',
    label: 'Energy & Emissions Fit',
    shortLabel: 'Emissions',
    direction: 'higher',
    unit: '1 / (g CO2 per mile)',
    definition: 'Inverse of the derived tailpipe + grid CO2 proxy per mile. Higher is cleaner. This is not a lifecycle assessment.',
    performanceLabel: '1 ÷ g CO2/mi',
    missing: 'Emissions cannot be derived from the recorded efficiency.',
  },
  {
    key: 'bodyCargoFit',
    label: 'Body & Cargo Fit',
    shortLabel: 'Body & cargo',
    direction: 'higher',
    unit: 'composite index',
    definition: '45% recorded seats + 55% ordinal cargo rank. The cargo rank is a labelled body-type proxy because measured cargo volume is missing.',
    performanceLabel: '0.45 × seats + 0.55 × cargo rank',
    missing: 'Seats or cargo proxy is not recorded.',
  },
];

const number = value => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const rounded = value => Number.isFinite(value) ? Math.round(value * 10) / 10 : null;
const precise = value => Number.isFinite(value) ? Math.round(value * 1000000) / 1000000 : null;

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const position = Math.max(0, Math.min(1, fraction)) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function describe(values) {
  const known = values.filter(Number.isFinite);
  if (!known.length) return {count: 0, min: null, max: null, mean: null, median: null, p25: null, p75: null};
  return {
    count: known.length,
    min: precise(Math.min(...known)),
    max: precise(Math.max(...known)),
    mean: precise(mean(known)),
    median: precise(percentile(known, 0.5)),
    p25: precise(percentile(known, 0.25)),
    p75: precise(percentile(known, 0.75)),
  };
}

function performanceFor(view, metrics, {budget, rangeTarget}) {
  const price = number(view?.price?.estimatedUSD);
  const annualCost = number(metrics?.cost?.annualUSD);
  const range = number(metrics?.energy?.totalRangeMiles);
  const emissions = number(metrics?.emissions?.gramsCO2PerMile);
  const seats = number(view?.seats);
  const cargo = number(view?.dimensions?.cargoProxy?.rank);
  return {
    purchaseAffordability: Number.isFinite(budget) && budget > 0 && price !== null && price > 0 ? budget / price : null,
    energyCostFit: annualCost !== null && annualCost > 0 ? 1 / annualCost : null,
    rangeAdequacy: range !== null && range >= 0 && rangeTarget !== null && rangeTarget > 0 ? Math.min(range, rangeTarget) / rangeTarget : null,
    refuelingConvenience: range !== null && range > 0 ? range : null,
    energyEmissionsFit: emissions !== null && emissions > 0 ? 1 / emissions : null,
    bodyCargoFit: seats !== null && cargo !== null ? 0.45 * seats + 0.55 * cargo : null,
  };
}

function idealPerformance({budget, targets, annualMiles, maxRefuelingStopsPerYear}) {
  const price = number(targets?.purchasePriceUSD?.ideal);
  const annualCost = number(targets?.annualEnergyCostUSD?.ideal);
  const emissions = number(targets?.emissionsGramsPerMile?.ideal);
  const seats = number(targets?.seats?.ideal);
  const cargo = number(targets?.cargoRank?.ideal);
  const stops = number(maxRefuelingStopsPerYear);
  return {
    purchaseAffordability: Number.isFinite(budget) && budget > 0 && price !== null && price > 0 ? budget / price : null,
    energyCostFit: annualCost !== null && annualCost > 0 ? 1 / annualCost : null,
    rangeAdequacy: targets?.rangeMiles?.ideal !== null && targets?.rangeMiles?.ideal !== undefined ? 1 : null,
    refuelingConvenience: stops !== null && stops > 0 && annualMiles > 0 ? annualMiles / stops : null,
    energyEmissionsFit: emissions !== null && emissions > 0 ? 1 / emissions : null,
    bodyCargoFit: seats !== null && cargo !== null ? 0.45 * seats + 0.55 * cargo : null,
  };
}

const MIN_SCALE_SPAN = 20;
const BASELINE_MIN_RADIUS = 0.4;
const NICE_FACTORS = [1, 2, 2.5, 5, 10];
const roundScale = value => Math.round(value * 1000000) / 1000000;
const formatScale = value => Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10);

function niceStep(raw) {
  if (!Number.isFinite(raw) || raw <= 0) return 5;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const factor = NICE_FACTORS.find(candidate => normalized <= candidate) ?? 10;
  return factor * magnitude;
}

/**
 * Build the compact linear radar scale from every valid point that will be drawn.
 *
 * Market Average always stays at index 100. The lower and upper bounds are chosen from the data
 * (plus the ideal and all three cars), then rounded to a readable step with a little headroom. This
 * makes 100 a real midpoint-ish reference instead of pinning it near the centre of a fixed 0-400
 * chart, and guarantees `containsAll` without silently clipping an extreme axis.
 */
export function buildRadarScale({series = [], ideal = null, marketAverage = MARKET_AVERAGE_INDEX} = {}) {
  const known = [marketAverage];
  for (const item of series) {
    for (const value of item?.values || []) {
      if (Number.isFinite(value)) known.push(value);
    }
  }
  for (const value of ideal?.values || []) {
    if (Number.isFinite(value)) known.push(value);
  }

  let dataMin = Math.min(...known);
  let dataMax = Math.max(...known);
  if (dataMax - dataMin < MIN_SCALE_SPAN) {
    const center = (dataMin + dataMax) / 2;
    dataMin = center - MIN_SCALE_SPAN / 2;
    dataMax = center + MIN_SCALE_SPAN / 2;
  }
  const span = dataMax - dataMin;
  const padding = Math.max(4, span * 0.06);
  const paddedMin = dataMin - padding;
  const paddedMax = dataMax + padding;
  const step = niceStep((paddedMax - paddedMin) / 5);
  let minIndex = Math.max(0, Math.floor(paddedMin / step) * step);
  let maxIndex = Math.ceil(paddedMax / step) * step;
  if (maxIndex - minIndex < step) maxIndex = minIndex + step;
  // Keep the 100 reference ring at least 40% out from the centre when the data allows it, so a
  // cluster of slightly-below-average points does not collapse into the middle of the chart.
  if ((marketAverage - minIndex) / (maxIndex - minIndex) < BASELINE_MIN_RADIUS && maxIndex > marketAverage) {
    const desiredMin = marketAverage - (maxIndex - marketAverage) * BASELINE_MIN_RADIUS / (1 - BASELINE_MIN_RADIUS);
    minIndex = Math.max(0, Math.floor(desiredMin / step) * step);
  }
  minIndex = roundScale(minIndex);
  maxIndex = roundScale(maxIndex);

  const ticks = [];
  for (let value = minIndex; value <= maxIndex + step * 1e-6; value += step) {
    ticks.push(roundScale(value));
  }
  if (!ticks.some(value => Math.abs(value - marketAverage) < 1e-6)) {
    ticks.push(marketAverage);
    ticks.sort((a, b) => a - b);
  }

  const containsAll = known.every(value => value >= minIndex - 1e-6 && value <= maxIndex + 1e-6);
  const bottom = formatScale(minIndex);
  const top = formatScale(maxIndex);
  return {
    type: 'linear-dynamic',
    minIndex,
    maxIndex,
    ticks,
    marketAverage,
    dataMin: roundScale(Math.min(...known)),
    dataMax: roundScale(Math.max(...known)),
    containsAll,
    baselineRadius: (marketAverage - minIndex) / (maxIndex - minIndex),
    formula: 'radius = (index − min) ÷ (max − min) × radar radius',
    description: `Dynamic linear scale ${bottom}–${top}. The dashed 100 line is the in-budget market average, kept at least 40% out from the centre when the data allows, so above- and below-average points stay readable. All valid points fit inside this range without clipping.`,
  };
}

export function buildMarketBenchmark(views, {
  demand = null,
  budget = null,
  annualMiles = 12000,
  dailyMiles = null,
  targets = {},
  maxRefuelingStopsPerYear = null,
} = {}) {
  const allViews = Array.isArray(views) ? views : [];
  const eligible = allViews.filter(view => view
    && view.valid !== false
    && view.dataQuality?.recommendationEligible !== false);
  const budgetCeiling = number(budget);
  const records = [];
  let excludedHardConstraints = 0;
  let excludedBudgetConditional = 0;
  let excludedOverBudget = 0;
  let excludedBudgetUnknown = 0;
  for (const view of eligible) {
    if (demand?.constraints && hardRejection(view, demand)) {
      excludedHardConstraints += 1;
      continue;
    }
    const tier = budgetTier(view, budgetCeiling);
    if (tier.status === 'strict' || tier.status === 'no-budget') {
      records.push(view);
      continue;
    }
    if (tier.status === 'conditional') excludedBudgetConditional += 1;
    else if (tier.status === 'over') excludedOverBudget += 1;
    else excludedBudgetUnknown += 1;
  }
  const budgetScoped = budgetCeiling !== null;
  const rangeTarget = number(targets?.rangeMiles?.ideal);
  const rows = records.map(view => {
    const metrics = computeVehicleMetrics(view, {annualMiles, dailyMiles, annualMilesSource: 'market-benchmark'});
    return {view, metrics, performance: performanceFor(view, metrics, {budget: number(budget), rangeTarget})};
  });
  const averageKnown = selector => {
    const values = rows.map(selector).filter(value => Number.isFinite(value));
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  };
  const comparisonBaseline = {
    annualEnergyCostUSD: averageKnown(row => number(row.metrics?.cost?.annualUSD)),
    emissionsGramsPerMile: averageKnown(row => number(row.metrics?.emissions?.gramsCO2PerMile)),
    annualEnergyCostSampleSize: rows.filter(row => Number.isFinite(number(row.metrics?.cost?.annualUSD))).length,
    emissionsSampleSize: rows.filter(row => Number.isFinite(number(row.metrics?.emissions?.gramsCO2PerMile))).length,
    annualMiles,
    scope: budgetScoped
      ? 'eligible vehicles passing your hard filters with price bands fully within budget'
      : 'eligible vehicles passing your hard filters',
  };
  const byVehicle = {};
  const axes = MARKET_AXIS_DEFINITIONS.map(definition => {
    const values = rows
      .map(row => row.performance[definition.key])
      .filter(value => Number.isFinite(value) && value >= 0);
    const sample = describe(values);
    const baseline = sample.mean;
    rows.forEach(row => {
      const value = row.performance[definition.key];
      const index = Number.isFinite(value) && Number.isFinite(baseline) && baseline > 0
        ? rounded(value / baseline * MARKET_AVERAGE_INDEX)
        : null;
      byVehicle[row.view.vehicleId] = byVehicle[row.view.vehicleId] || {};
      byVehicle[row.view.vehicleId][definition.key] = {
        performance: Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null,
        index,
      };
    });
    return {
      ...definition,
      baselineIndex: MARKET_AVERAGE_INDEX,
      sample,
      missingCount: records.length - sample.count,
      status: sample.count ? 'measured' : 'unknown',
    };
  });
  const stops = number(maxRefuelingStopsPerYear)
    ?? (rangeTarget !== null && rangeTarget > 0 && annualMiles > 0 ? annualMiles / rangeTarget : null);
  const idealPerformanceValues = idealPerformance({
    budget: number(budget),
    targets,
    annualMiles,
    maxRefuelingStopsPerYear: stops,
  });
  const ideal = {};
  MARKET_AXIS_DEFINITIONS.forEach(definition => {
    const axis = axes.find(item => item.key === definition.key);
    const value = idealPerformanceValues[definition.key];
    ideal[definition.key] = {
      performance: Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null,
      index: Number.isFinite(value) && Number.isFinite(axis?.sample?.mean) && axis.sample.mean > 0
        ? rounded(value / axis.sample.mean * MARKET_AVERAGE_INDEX)
        : null,
    };
  });

  const hardScope = demand?.constraints
    ? 'pass every current hard constraint (final body style, seats, powertrain and condition)'
    : 'are recommendation-eligible';
  const scope = budgetScoped
    ? `Adapted records that ${hardScope} and whose price band is fully inside the budget. Budget-conditional, over-budget and unknown-price records are excluded, so 100 describes the in-budget market.`
    : `Adapted records that ${hardScope}. No budget ceiling was supplied, so price does not scope this baseline.`;

  return {
    schemaVersion: MARKET_BENCHMARK_SCHEMA_VERSION,
    baseline: MARKET_AVERAGE_INDEX,
    axes,
    ideal,
    byVehicle,
    comparisonBaseline,
    sample: {
      databaseRecords: allViews.length,
      eligibleDatabaseRecords: eligible.length,
      eligibleRecords: records.length,
      scope,
      baselineMethod: budgetScoped
        ? 'Arithmetic mean of each axis performance across the scoped in-budget vehicles. Index = performance ÷ mean × 100.'
        : 'Arithmetic mean of each axis performance across the scoped vehicles. Index = performance ÷ mean × 100.',
      missingPolicy: 'Missing performance values are excluded from that axis mean and shown as Unknown. They are never filled with zero. When a budget is active, a record with an unknown price is excluded from the baseline because its budget fit cannot be verified.',
      budgetScoped,
      excludedIneligible: allViews.length - eligible.length,
      excludedHardConstraints,
      excludedBudgetConditional,
      excludedOverBudget,
      excludedBudgetUnknown,
      annualMiles,
      dailyMiles,
      budget: budgetCeiling,
      rangeTarget,
      refuelingTargetStopsPerYear: stops,
      notes: [
        'The baseline is scoped to the current hard constraints and, when a budget is present, to fully in-budget price bands. It is not the whole vehicle database.',
        'Purchase Affordability uses the current budget ceiling only as a denominator; it is not a vehicle price.',
        'Refueling Convenience is miles between refuelling or charging stops because charging power and local station access are missing from the vehicle records.',
        'Body & Cargo Fit uses an ordinal body-type cargo proxy; measured cargo volume is unavailable.',
      ],
    },
  };
}


export function buildMarketRadar({benchmark, series = []}) {
  if (!benchmark?.axes) throw new TypeError('buildMarketRadar expects buildMarketBenchmark output.');
  const axes = benchmark.axes.map(axis => ({
    key: axis.key,
    label: axis.label,
    shortLabel: axis.shortLabel,
    direction: axis.direction,
    unit: axis.unit,
    definition: axis.definition,
    performanceLabel: axis.performanceLabel,
    sample: axis.sample,
    missingCount: axis.missingCount,
    status: axis.status,
  }));
  const ideal = {
    key: 'ideal-dna',
    name: 'Your Ideal DNA',
    values: axes.map(axis => benchmark.ideal?.[axis.key]?.index ?? null),
    dashed: true,
    color: '#d0b8ff',
  };
  const radarSeries = series.map((car, index) => ({
    key: car.vehicleId,
    vehicleId: car.vehicleId,
    name: `#${car.rank} ${car.displayName}`,
    score: Number.isFinite(car?.score?.scores?.point) ? Math.round(car.score.scores.point) : null,
    values: axes.map(axis => benchmark.byVehicle?.[car.vehicleId]?.[axis.key]?.index ?? null),
    color: ['#b8ff54', '#78f0ba', '#ffb27a'][index % 3],
  }));
  const measuredAxes = axes.filter(axis => axis.sample?.count > 0);
  const unavailableAxes = axes.filter(axis => !(axis.sample?.count > 0)).map(axis => axis.shortLabel || axis.label);
  return {
    schemaVersion: 'market-radar/2.0',
    marketAverage: MARKET_AVERAGE_INDEX,
    scale: buildRadarScale({series: radarSeries, ideal}),
    axes,
    ideal,
    series: radarSeries,
    sample: {
      ...benchmark.sample,
      available: measuredAxes.length > 0,
      complete: measuredAxes.length === axes.length,
      unavailableAxes,
    },
    note: 'Radar indexes are a market comparison only. They do not replace the DNA Match Score.',
  };
}

