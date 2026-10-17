/**
 * Recommendation pipeline — one entry point for the results page.
 *
 *   profile → buildDemandModel → adaptVehicles → generateIdealDna → matchVehicles → Strict Top 3
 *
 * A confirmed `finalBodyStyle` from the DNA Studio is part of the effective demand, so it is a hard
 * filter inside matchVehicles before any score is computed. Conditional-budget cars are returned in
 * a separate list and never fill a strict Top 3 slot.
 *
 * The pipeline is pure and synchronous. Infrastructure is loaded separately (once per home
 * location) and passed in, so every car is annotated against the same context. Infrastructure
 * never changes the four-dimension score; it only adds an explicit suitability note and caveats.
 *
 * No vehicle is invented. When the hard constraints leave nothing, the result is an empty Top 3
 * with an honest explanation, not a "closest" car that breaks the user's limits.
 */

import {adaptVehicles} from './vehicleAdapter.js';
import {buildDemandModel} from './userDemandModel.js';
import {generateIdealDna} from './idealDnaGenerator.js';
import {matchVehicles} from './vehicleMatcher.js';
import {evaluateFeasibility, materializeEditableDna} from './editableIdealDna.js';
import {buildMarketBenchmark, buildMarketRadar} from './marketBenchmark.js';

const number = value => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const uniqueCaveats = caveats => {
  const seen = new Set();
  return caveats.filter(item => {
    const key = `${item.code}|${item.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

function infrastructureFor(candidate, context, dna) {
  if (!candidate) return {status: 'unknown', summary: 'Infrastructure is unknown.', caveats: []};
  const plugIn = candidate.powertrain === 'EV' || candidate.powertrain === 'PHEV';
  const charging = context?.charging;
  const gas = context?.gas;
  const homeCharging = dna?.contextual?.charging?.home || null;
  const workplace = dna?.contextual?.charging?.workplace || null;
  const caveats = [];

  if (!context || context.status !== 'covered') {
    caveats.push({
      code: 'infrastructure-unknown',
      severity: 'info',
      message: context?.status === 'out-of-coverage'
        ? 'Home is outside the local San Jose extract, so nearby charging and gas availability are Unknown, not zero.'
        : 'Local infrastructure data is unavailable, so charging and gas availability are Unknown.',
    });
    return {
      status: 'unknown',
      known: false,
      plugIn,
      homeCharging,
      workplace,
      summary: plugIn ? 'Charging access: Unknown' : 'Refuelling access: Unknown',
      caveats,
    };
  }

  if (plugIn) {
    if (!charging?.known) {
      caveats.push({code: 'charging-unknown', severity: 'info', message: charging?.reason || 'Nearby charger counts are unavailable.'});
      return {status: 'unknown', known: false, plugIn, homeCharging, workplace, summary: 'Charging access: Unknown', caveats};
    }
    const publicCount = charging.publicCount;
    const nearest = charging.nearestPublicMiles;
    const homeReady = homeCharging === 'Level 2' || homeCharging === 'Regular outlet';
    const status = publicCount >= 3 || homeReady ? 'good' : publicCount >= 1 ? 'limited' : 'weak';
    if (!homeReady && publicCount === 0) {
      caveats.push({
        code: 'charging-access-risk',
        severity: 'warning',
        message: `Home charging is ${homeCharging || 'unknown'} and no public charger is recorded within ${context.radiusMiles} mi. A plug-in car would depend on unverified charging access.`,
      });
    } else if (!homeReady && publicCount < 3) {
      caveats.push({
        code: 'charging-access-limited',
        severity: 'info',
        message: `Home charging is ${homeCharging || 'unknown'}; ${publicCount} public charger${publicCount === 1 ? '' : 's'} within ${context.radiusMiles} mi.`,
      });
    }
    return {
      status,
      known: true,
      plugIn,
      homeCharging,
      workplace,
      publicCount,
      nearestPublicMiles: nearest,
      radiusMiles: context.radiusMiles,
      summary: `${publicCount} public charger${publicCount === 1 ? '' : 's'} within ${context.radiusMiles} mi${nearest === null ? '' : ` (nearest ${nearest} mi)`}; home charging: ${homeCharging || 'Unknown'}.`,
      caveats,
    };
  }

  if (!gas?.known) {
    caveats.push({code: 'gas-unknown', severity: 'info', message: gas?.reason || 'Nearby gas-station counts are unavailable.'});
    return {status: 'unknown', known: false, plugIn, homeCharging, workplace, summary: 'Refuelling access: Unknown', caveats};
  }
  const status = gas.count >= 3 ? 'good' : gas.count >= 1 ? 'limited' : 'weak';
  if (gas.count === 0) caveats.push({code: 'gas-access-weak', severity: 'info', message: `No gas station is recorded within ${context.radiusMiles} mi of home.`});
  return {
    status,
    known: true,
    plugIn,
    homeCharging,
    workplace,
    count: gas.count,
    nearestMiles: gas.nearestMiles,
    radiusMiles: context.radiusMiles,
    summary: `${gas.count} gas station${gas.count === 1 ? '' : 's'} within ${context.radiusMiles} mi${gas.nearestMiles === null ? '' : ` (nearest ${gas.nearestMiles} mi)`}.`,
    caveats,
  };
}

function annotateTop(match, context, dna) {
  return match.top.map(candidate => {
    const infrastructure = infrastructureFor(candidate, context, dna);
    return {
      ...candidate,
      infrastructure,
      caveats: uniqueCaveats([...candidate.caveats, ...infrastructure.caveats]),
    };
  });
}

function emptyStateFor(match, demand) {
  if (!match.empty) return null;
  const rejected = match.rejectedBy || {};
  const maxBudget = number(demand?.constraints?.maxPurchasePriceUSD);
  const finalBodyStyle = demand?.constraints?.finalBodyStyle || null;
  const hardRejects = (rejected.seats || 0) + (rejected.powertrain || 0)
    + (rejected.condition || 0) + (rejected['body-style'] || 0) + (rejected['over-budget'] || 0);
  let reason = match.emptyState?.reason || 'hard-constraints';
  let suggestion = match.emptyState?.suggestion;
  if ((rejected['body-style'] || 0) >= hardRejects && (rejected['body-style'] || 0) > 0 && match.counts.strict === 0) {
    reason = 'body-style';
    suggestion = `No ${finalBodyStyle || 'selected'} car passes the strict hard filters. Choose another final body style in the DNA Studio or relax the seat, powertrain, condition or budget answer.`;
  } else if ((rejected['over-budget'] || 0) >= hardRejects && (rejected['over-budget'] || 0) > 0) {
    reason = 'budget';
    suggestion = `Every remaining car starts above your ${maxBudget === null ? 'stated' : `$${Math.round(maxBudget).toLocaleString()}`} budget. Raise the budget or accept an older/higher-mileage car.`;
  } else if ((rejected.seats || 0) >= hardRejects && (rejected.seats || 0) > 0) {
    reason = 'seats';
    suggestion = 'Your seat minimum removes almost every car. Lower it by one seat or accept a different body type.';
  } else if ((rejected.powertrain || 0) >= hardRejects && (rejected.powertrain || 0) > 0) {
    reason = 'powertrain';
    suggestion = 'Your powertrain choice removes almost every car. Allow one more powertrain type.';
  } else if ((rejected.condition || 0) >= hardRejects && (rejected.condition || 0) > 0) {
    reason = 'condition';
    suggestion = 'Your condition choice removes almost every car. Allow used or new cars as well.';
  } else if (match.counts.strict === 0 && (match.counts.conditional || 0) > 0) {
    reason = 'conditional-only';
    suggestion = 'Only budget-conditional cars are left. They are shown separately; they never enter the Strict Top 3.';
  } else if (match.counts.strict === 0 && (rejected['body-style'] || 0) > 0) {
    reason = 'body-style';
  }
  return {
    ...match.emptyState,
    reason,
    suggestion,
    detail: `Checked ${match.counts.database} real records: ${rejected.seats || 0} failed seats, ${rejected['body-style'] || 0} failed the final body style, ${rejected.powertrain || 0} failed powertrain, ${rejected.condition || 0} failed condition, ${rejected['over-budget'] || 0} exceeded budget, ${rejected['price-unknown'] || 0} had no usable price band.`,
  };
}

function summaryFor({match, dna, infrastructure, top}) {
  const counts = match.counts;
  const quality = dna.dataQuality;
  const unknownInfrastructure = !infrastructure || infrastructure.status !== 'covered';
  return {
    headline: top.length
      ? `${top.length} real car${top.length === 1 ? '' : 's'} matched your DNA`
      : 'No real car passes your hard constraints',
    subline: top.length
      ? `${counts.strict} strict-budget ${dna.constraints?.finalBodyStyle || 'body-style'} car${counts.strict === 1 ? '' : 's'} found in ${counts.database} records; the Top ${top.length} are shown. ${counts.conditional} budget-conditional car${counts.conditional === 1 ? '' : 's'} listed separately.`
      : `${counts.database} records checked; no ${dna.constraints?.finalBodyStyle || 'eligible'} car passes the strict budget and hard filters. ${counts.conditional} conditional car${counts.conditional === 1 ? '' : 's'} are shown separately.`,
    dnaConfidence: quality.confidence,
    dnaStatus: quality.status,
    sampleSize: quality.sampleSize,
    infrastructureStatus: unknownInfrastructure ? 'Unknown' : (dna.contextual?.charging?.applicable ? 'Checked for plug-in cars' : 'Checked'),
    counts,
    caveatCount: top.reduce((total, car) => total + car.caveats.length, 0),
  };
}

/**
 * Run the whole recommendation chain.
 *
 * @param {object} input
 * @param {object} input.profile the questionnaire profile.
 * @param {Array} [input.vehicles] raw database records (omit when `views` is supplied).
 * @param {Array} [input.views] already-adapted views (tests / cached data).
 * @param {object|null} [input.infrastructure] shared context from getInfrastructureContext.
 * @param {number} [input.limit] number of cards, default 3.
 * @param {number|null} [input.annualMiles] explicit override; otherwise the demand/DNA value is used.
 * @param {object|null} [input.editableDna] validated editor payload; when present it replaces the
 *   generated soft targets and may narrow the accepted powertrain set, but never changes the
 *   four-dimension scoring formula.
 * @returns {object} demand, DNA, match audit, annotated Top 3 and UI-ready summary.
 */
export function runRecommendationPipeline({
  profile,
  vehicles,
  views,
  infrastructure = null,
  limit = 3,
  annualMiles = null,
  editableDna = null,
} = {}) {
  if (!profile) throw new TypeError('runRecommendationPipeline expects a questionnaire profile.');
  const adapted = Array.isArray(views) ? views : adaptVehicles(vehicles);
  if (!adapted.length) throw new TypeError('runRecommendationPipeline needs the vehicle database.');

  let demand = buildDemandModel(profile);
  const dnaOptions = {};
  const explicitMiles = number(annualMiles);
  if (explicitMiles !== null && explicitMiles > 0) dnaOptions.annualMiles = explicitMiles;
  if (infrastructure) dnaOptions.infrastructure = infrastructure;
  const generatedDna = generateIdealDna(demand, adapted, dnaOptions);
  let dna = generatedDna;
  if (editableDna) {
    const materialized = materializeEditableDna(generatedDna, editableDna, {profile, demand});
    dna = materialized.dna;
    demand = materialized.demand;
  }

  const match = matchVehicles({
    views: adapted,
    demand,
    dna,
    annualMiles: dna.usage.annualMiles,
    dailyMiles: dna.usage.dailyMiles,
    limit,
  });
  const top = annotateTop(match, infrastructure, dna);
  const conditionalTop = annotateTop({...match, top: match.conditionalTop || []}, infrastructure, dna);
  const emptyState = emptyStateFor(match, demand);
  const feasibility = editableDna
    ? evaluateFeasibility({views: adapted, demand, dna, annualMiles: dna.usage.annualMiles})
    : null;
  const marketBenchmark = buildMarketBenchmark(adapted, {
    demand,
    budget: demand.constraints.maxPurchasePriceUSD,
    annualMiles: dna.usage.annualMiles,
    dailyMiles: dna.usage.dailyMiles,
    targets: dna.targets,
    maxRefuelingStopsPerYear: dna.editor?.values?.maxRefuelingStopsPerYear ?? null,
  });
  const marketRadar = buildMarketRadar({benchmark: marketBenchmark, series: top});

  return {
    schemaVersion: 'recommendation-pipeline/1.2',
    profile: {
      name: profile.name || null,
      home: profile.homeLocation || profile.home || null,
    },
    demand,
    generatedDna,
    dna,
    editableDna: editableDna || null,
    feasibility,
    marketBenchmark,
    marketRadar,
    match,
    top,
    conditionalTop,
    infrastructure,
    emptyState,
    summary: summaryFor({match, dna, infrastructure, top}),
    caveats: uniqueCaveats([
      ...(infrastructure?.caveats || []),
      ...top.flatMap(car => car.caveats),
    ]),
    disclosures: [
      'Prices are ESTIMATED from the prototype database. They are not dealer quotes or verified transaction prices.',
      'Efficiency, range and charging figures come from the recorded vehicle data; missing values stay Unknown instead of being invented.',
      'Insurance, maintenance, depreciation, financing and resale value are not modeled.',
      'The ideal DNA is a target profile, not a real car. The Top 3 are the only vehicles presented as purchasable records.',
      'Local infrastructure is context only: it adds caveats and never changes the four weighted scores.',
      'Edited soft targets are converted into the existing DNA targets. No second ranking formula is used.',
      'Radar axes are performance indexes against a market average of 100 and are visual context only. They are not the DNA Match Score.',
    ],
    handoff: dna.handoff,
  };
}

export default runRecommendationPipeline;

