/**
 * Real-vehicle matching — hard constraints first, DNA score second.
 *
 * Nothing is scored until it passes the user's hard constraints (recommendation eligibility,
 * seats, accepted powertrains, condition and budget). Price is handled in three tiers because the
 * database records a price *band*:
 *
 *   strict      — the whole band is inside the budget;
 *   conditional — the band straddles the budget, so only a negotiated price would qualify;
 *   over        — even the low end is above budget and the car is rejected.
 *
 * Only strict cars can enter the Top 3. Conditional cars are scored for a separate panel, but they
 * never fill a missing strict slot. Over-budget cars are never recommended.
 */

import {computeVehicleMetrics} from './vehicleMetrics.js';
import {scoreVehicle, buildRadar, scoreLabel} from './dnaScoring.js';

const number = value => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const conditionAccepts = (view, wanted) => {
  if (wanted === 'New') return view?.condition === 'NEW';
  if (wanted === 'Used') return view?.condition === 'USED';
  return true;
};

/** Why a vehicle cannot be recommended, or null when it passes the hard filters. */
export function hardRejection(view, demand) {
  const constraints = demand?.constraints || {};
  if (!view || view.valid === false || view.dataQuality?.recommendationEligible === false) {
    return 'not-eligible';
  }
  const minimumSeats = number(constraints.minimumSeats) || 1;
  if (number(view.seats) === null || number(view.seats) < minimumSeats) return 'seats';
  const powertrains = Array.isArray(constraints.acceptablePowertrains) ? constraints.acceptablePowertrains : [];
  if (powertrains.length && !powertrains.includes(view.powertrain)) return 'powertrain';
  if (!conditionAccepts(view, constraints.vehicleCondition || 'Either')) return 'condition';
  // Checkpoint O: the Studio's confirmed body style is a hard constraint, applied before scoring.
  if (constraints.finalBodyStyle && view.bodyType !== constraints.finalBodyStyle) return 'body-style';
  return null;
}

export function budgetTier(view, demandedBudget) {
  if (!Number.isFinite(demandedBudget)) return {status: 'no-budget', priority: 2};
  const low = number(view?.price?.bandUSD?.low);
  const high = number(view?.price?.bandUSD?.high);
  const point = number(view?.price?.estimatedUSD);
  if (low !== null && high !== null && low <= high) {
    if (high <= demandedBudget) return {status: 'strict', priority: 0};
    if (low <= demandedBudget) return {status: 'conditional', priority: 1};
    return {status: 'over', priority: 3};
  }
  if (point !== null && point <= demandedBudget) return {status: 'conditional', priority: 1};
  return point === null ? {status: 'unknown', priority: 3} : {status: 'over', priority: 3};
}

/**
 * Checkpoint P: count the real strict-budget candidates for one final body style.
 *
 * This deliberately reuses `hardRejection` and `budgetTier` from the matcher, so the Studio card
 * cannot disagree with the recommendation pipeline. Conditional price bands are not counted.
 */
export function countStrictCandidates({views = [], demand, bodyStyle = null} = {}) {
  if (!Array.isArray(views) || !demand?.constraints) return null;
  const budget = number(demand.constraints.maxPurchasePriceUSD);
  const scopedDemand = bodyStyle
    ? {...demand, constraints: {...demand.constraints, finalBodyStyle: bodyStyle}}
    : demand;
  let count = 0;
  for (const view of views) {
    if (hardRejection(view, scopedDemand)) continue;
    if (budgetTier(view, budget).status === 'strict') count += 1;
  }
  return count;
}

function softPreference(view, demand, dna) {
  const constraints = demand?.constraints || {};
  const preferred = constraints.softPreferences?.preferredBodyType || 'No Preference';
  const bodyTypeMatch = preferred !== 'No Preference' ? view.bodyType === preferred : null;
  const cargoNeed = constraints.softPreferences?.cargoNeeds || null;
  const cargoTarget = number(dna?.targets?.cargoRank?.ideal);
  const cargoRank = number(view?.dimensions?.cargoProxy?.rank);
  const cargoMatch = cargoTarget === null || cargoRank === null ? null : cargoRank >= cargoTarget;
  const notes = [];
  if (bodyTypeMatch === false) notes.push(`Preferred body type is ${preferred}; this is a ${view.bodyType}.`);
  if (cargoMatch === false) notes.push('This car is below the preferred cargo/space level.');
  return {preferredBodyType: preferred, bodyTypeMatch, cargoNeed, cargoTarget, cargoRank, cargoMatch, notes};
}

function strengthsAndWeaknesses(scored) {
  const entries = Object.values(scored.dimensions)
    .map(dimension => ({
      key: dimension.key,
      label: dimension.label,
      score: Math.round(dimension.satisfaction * 100),
      weight: dimension.weight,
      contribution: Math.round(dimension.weight * dimension.satisfaction * 1000) / 10,
    }))
    .sort((a, b) => b.score - a.score || b.weight - a.weight);
  return {
    strengths: entries.filter(item => item.score >= 60).slice(0, 2),
    weaknesses: [...entries].reverse().filter(item => item.score < 60).slice(0, 2),
    dimensionTable: entries,
  };
}

const TIER_LABELS = {
  strict: 'Price band fully inside your budget',
  conditional: 'Budget-conditional: only a negotiated price would fit',
  'no-budget': 'No budget cap applied',
};



/**
 * Rank real vehicles for one demand model + ideal DNA.
 *
 * @param {object} input views, demand, dna, annualMiles/dailyMiles and limit.
 * @returns {object} top 3 with full explanation, plus audit counts and empty-state diagnostics.
 */
export function matchVehicles({views, demand, dna, annualMiles, dailyMiles, limit = 3} = {}) {
  if (!Array.isArray(views)) throw new TypeError('matchVehicles expects an array of adapted VehicleViews.');
  if (!demand?.constraints) throw new TypeError('matchVehicles expects the demand model from buildDemandModel(profile).');
  if (!dna?.targets) throw new TypeError('matchVehicles expects the ideal DNA from generateIdealDna(demand, views).');
  const budget = number(demand?.constraints?.maxPurchasePriceUSD);
  const finalBodyStyle = demand?.constraints?.finalBodyStyle || null;
  const rejectedBy = {'not-eligible': 0, seats: 0, powertrain: 0, condition: 0, 'body-style': 0, 'over-budget': 0, 'price-unknown': 0};
  const examples = [];
  const scored = [];
  let strict = 0;
  let conditional = 0;

  for (const view of views) {
    const rejection = hardRejection(view, demand);
    if (rejection) {
      rejectedBy[rejection] += 1;
      examples.push({vehicleId: view?.vehicleId || null, reason: rejection, bodyType: view?.bodyType || null});
      continue;
    }
    const tier = budgetTier(view, budget);
    if (tier.status === 'over') {
      rejectedBy['over-budget'] += 1;
      examples.push({vehicleId: view?.vehicleId || null, reason: 'over-budget', low: view?.price?.bandUSD?.low ?? null});
      continue;
    }
    if (tier.status === 'unknown') {
      rejectedBy['price-unknown'] += 1;
      examples.push({vehicleId: view?.vehicleId || null, reason: 'price-unknown'});
      continue;
    }
    if (tier.status === 'strict') strict += 1;
    else if (tier.status === 'conditional') conditional += 1;

    // Conditional budget bands are scored for their separate panel, but they never enter Top 3.
    const metrics = computeVehicleMetrics(view, {annualMiles, dailyMiles, annualMilesSource: dna?.usage?.annualMilesSource});
    const score = scoreVehicle(view, metrics, dna);
    const soft = softPreference(view, demand, dna);
    const sides = strengthsAndWeaknesses(score);
    scored.push({
      vehicleId: view.vehicleId,
      displayName: view.displayName,
      brand: view.brand,
      model: view.model,
      trim: view.trim,
      year: view.year,
      condition: view.condition,
      powertrain: view.powertrain,
      bodyType: view.bodyType,
      seats: view.seats,
      price: view.price,
      efficiency: view.efficiency,
      charging: view.charging,
      dimensions: view.dimensions,
      view,
      metrics,
      score,
      radar: buildRadar(score, dna),
      budgetTier: {...tier, label: TIER_LABELS[tier.status] || tier.status},
      priceStatus: tier.status,
      soft,
      strengths: sides.strengths,
      weaknesses: sides.weaknesses,
      dimensionTable: sides.dimensionTable,
      matchLabel: scoreLabel(score.scores.point),
      caveats: [...score.caveats, ...soft.notes.map(note => ({code: 'soft-preference', severity: 'info', message: note}))],
    });
  }


  const byRank = (a, b) => (a.budgetTier.priority - b.budgetTier.priority)
    || (b.score.scores.rankScore - a.score.scores.rankScore)
    || (b.score.scores.point - a.score.scores.point)
    || (Number(b.soft.bodyTypeMatch === true) - Number(a.soft.bodyTypeMatch === true))
    || (number(a.price.estimatedUSD) ?? Infinity) - (number(b.price.estimatedUSD) ?? Infinity)
    || String(a.vehicleId).localeCompare(String(b.vehicleId));

  const ranked = scored.filter(candidate => candidate.priceStatus === 'strict').sort(byRank)
    .map((candidate, index) => ({...candidate, rank: index + 1}));
  const conditionalRanked = scored.filter(candidate => candidate.priceStatus === 'conditional').sort(byRank)
    .map((candidate, index) => ({...candidate, rank: index + 1}));
  const top = ranked.slice(0, Math.max(0, limit));
  const conditionalTop = conditionalRanked.slice(0, Math.max(0, limit));
  const empty = top.length === 0;
  const hardPassed = strict + conditional;
  const bodyRejected = rejectedBy['body-style'] || 0;
  const reason = hardPassed === 0
    ? (bodyRejected > 0 && finalBodyStyle ? 'body-style' : 'hard-constraints')
    : (strict === 0 && conditional > 0 ? 'conditional-only' : 'budget');
  return {
    top,
    ranked,
    conditionalTop,
    conditionalRanked,
    counts: {
      database: views.length,
      hardPassed,
      strict,
      conditional,
      scored: ranked.length + conditionalRanked.length,
      returned: top.length,
      conditionalReturned: conditionalTop.length,
    },
    rejectedBy,
    rejectionExamples: examples.slice(0, 8),
    empty,
    emptyState: empty ? {
      title: 'No real car passes your strict hard constraints',
      message: finalBodyStyle
        ? `No ${finalBodyStyle} record fits every strict hard constraint. This is an honest empty result; no other body style is substituted.`
        : 'This is an honest empty result, not a missing recommendation. The DNA panel still shows the ideal you described.',
      reason,
      suggestion: reason === 'body-style'
        ? `Every ${finalBodyStyle} record failed another hard filter or the strict budget. Choose another final body style in the DNA Studio or relax a questionnaire constraint.`
        : reason === 'conditional-only'
          ? 'Only budget-conditional records exist. They are listed separately and are not admitted to the Strict Top 3.'
          : 'Relax the seat, powertrain, condition or budget answer and run the match again.',
    } : null,
    filters: {
      minimumSeats: number(demand?.constraints?.minimumSeats),
      acceptablePowertrains: demand?.constraints?.acceptablePowertrains || [],
      acceptableBodyTypes: demand?.constraints?.acceptableBodyTypes || [],
      finalBodyStyle,
      vehicleCondition: demand?.constraints?.vehicleCondition || 'Either',
      maxPurchasePriceUSD: budget,
      conditionalInTop: false,
      limit,
      bodyStyleRule: finalBodyStyle
        ? `Body type must equal ${finalBodyStyle}. This hard filter runs before any DNA score or ranking.`
        : 'No final body style has been confirmed; every questionnaire body style remains eligible.',
      priceTierRule: 'The Top 3 contains strict price bands only. Conditional bands are returned in a separate list and never fill an empty strict slot. Over-budget cars are never returned.',
    },
    assumptions: dna?.assumptions?.list || [],
  };
}

export default matchVehicles;

