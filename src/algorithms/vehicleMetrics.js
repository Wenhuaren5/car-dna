/**
 * Energy and emissions metrics for one adapted vehicle.
 *
 * These numbers are derived from the recorded efficiency fields and explicit, documented
 * assumptions. They are not read from a hidden ranking table. Whenever a required field is
 * missing the metric is `null` with a reason; it is never treated as 0, which would make an
 * unknown vehicle look infinitely cheap or clean.
 */

export const METRIC_ASSUMPTIONS = {
  fuelPriceUSDPerGallon: 3.50,
  electricityUSDPerKWh: 0.31,
  publicChargingPremiumUSDPerKWh: 0.20,
  gasolineKgCO2PerGallon: 8.887,
  gridKgCO2PerKWh: 0.386,
  defaultAnnualMiles: 12000,
  epaAnnualMilesBasis: 15000,
};

const number = value => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/**
 * Estimate how much of a plug-in hybrid's driving is electric.
 *
 * The utility factor is based on the recorded electric range and the user's own daily mileage.
 * Daily driving is electric up to the recorded range (with a 10% engine-on reserve), while
 * long-distance miles are treated as gasoline miles. No electric share is invented when the
 * electric range is missing.
 */
export function phevElectricShare({electricRangeMiles, dailyMiles, annualMiles}) {
  const range = number(electricRangeMiles);
  const annual = number(annualMiles);
  const daily = number(dailyMiles);
  if (range === null || range <= 0) {
    return {share: null, reason: 'electric-range-missing', electricMiles: null, gasolineMiles: null};
  }
  const effectiveDaily = daily !== null && daily > 0 ? daily : 35;
  const dailyShare = clamp((range / effectiveDaily) * 0.9, 0, 0.95);
  if (annual === null || annual <= 0) {
    return {share: dailyShare, reason: 'daily-share-used', electricMiles: null, gasolineMiles: null};
  }
  const dailyPortion = daily !== null && daily > 0 ? Math.min(annual, daily * 260) : annual;
  const electricMiles = dailyPortion * dailyShare;
  return {
    share: electricMiles / annual,
    dailyShare,
    reason: daily !== null && daily > 0 ? 'daily-and-long-distance-split' : 'daily-share-applied-to-all-miles',
    electricMiles,
    gasolineMiles: annual - electricMiles,
  };
}

/**
 * Compute cost, tailpipe/grid emissions, range and packaging utility for a VehicleView.
 *
 * @param {object} view an adapted VehicleView.
 * @param {object} [options] annualMiles/dailyMiles and the documented price/emission assumptions.
 */
export function computeVehicleMetrics(view, options = {}) {
  const annualMiles = number(options.annualMiles) ?? METRIC_ASSUMPTIONS.defaultAnnualMiles;
  const dailyMiles = number(options.dailyMiles);
  const fuelPrice = number(options.fuelPriceUSDPerGallon) ?? METRIC_ASSUMPTIONS.fuelPriceUSDPerGallon;
  const electricityPrice = number(options.electricityUSDPerKWh) ?? METRIC_ASSUMPTIONS.electricityUSDPerKWh;
  const publicPremium = number(options.publicChargingPremiumUSDPerKWh) ?? METRIC_ASSUMPTIONS.publicChargingPremiumUSDPerKWh;
  const gasolineKgCO2PerGallon = number(options.gasolineKgCO2PerGallon) ?? METRIC_ASSUMPTIONS.gasolineKgCO2PerGallon;
  const gridKgCO2PerKWh = number(options.gridKgCO2PerKWh) ?? METRIC_ASSUMPTIONS.gridKgCO2PerKWh;
  const electricityCostPerKWh = electricityPrice + publicPremium;

  const mpg = number(view?.efficiency?.combinedMpg?.value);
  const kwhPer100 = number(view?.efficiency?.kwhPer100Miles?.value);
  const electricRange = number(view?.efficiency?.electricRangeMiles?.value);
  const totalRange = number(view?.efficiency?.totalRangeMiles?.value);
  const epaAnnualCost = number(view?.efficiency?.epaAnnualFuelCostUSD?.value);
  const powertrain = view?.powertrain;
  const isEv = powertrain === 'EV';
  const isPhev = powertrain === 'PHEV';
  const usesGas = powertrain === 'ICE' || powertrain === 'HEV' || powertrain === 'PHEV';
  const usesElectricity = isEv || (isPhev && kwhPer100 !== null);

  let gasolineMiles = null;
  let electricMiles = null;
  let electricShare = null;
  let costReason = null;

  if (isEv) {
    if (kwhPer100 === null) costReason = 'kwh-per-100-miles-missing';
    else {
      electricMiles = annualMiles;
      electricShare = 1;
      gasolineMiles = 0;
    }
  } else if (isPhev) {
    if (mpg === null && kwhPer100 === null) costReason = 'phev-efficiency-missing';
    else {
      const split = phevElectricShare({electricRangeMiles: electricRange, dailyMiles, annualMiles});
      if (kwhPer100 === null) {
        gasolineMiles = annualMiles;
        electricShare = 0;
      } else if (mpg === null) {
        electricMiles = annualMiles;
        electricShare = 1;
      } else {
        electricShare = split.share;
        electricMiles = split.electricMiles;
        gasolineMiles = split.gasolineMiles;
        if (electricShare === null) costReason = 'electric-range-missing-gas-only';
      }
    }
  } else {
    // ICE and HEV: gasoline only.
    if (mpg === null) costReason = 'combined-mpg-missing';
    else {
      gasolineMiles = annualMiles;
      electricMiles = 0;
      electricShare = 0;
    }
  }

  let annualCostUSD = null;
  if (gasolineMiles !== null && electricMiles !== null) {
    if (gasolineMiles > 0 && mpg === null) annualCostUSD = null;
    else {
      const gasCost = gasolineMiles > 0 ? gasolineMiles / mpg * fuelPrice : 0;
      const electricCost = electricMiles > 0 ? electricMiles / 100 * kwhPer100 * electricityCostPerKWh : 0;
      annualCostUSD = gasCost + electricCost;
    }
  }
  const perMileCostUSD = annualCostUSD !== null && annualMiles > 0 ? annualCostUSD / annualMiles : null;


  let annualTailpipeKg = null;
  if (gasolineMiles !== null && (gasolineMiles === 0 || mpg !== null)) {
    annualTailpipeKg = gasolineMiles > 0 ? gasolineMiles / mpg * gasolineKgCO2PerGallon : 0;
  }
  let annualGridKg = null;
  if (electricMiles !== null && (electricMiles === 0 || kwhPer100 !== null)) {
    annualGridKg = electricMiles / 100 * kwhPer100 * gridKgCO2PerKWh;
  }
  const annualKgCO2 = annualTailpipeKg !== null && annualGridKg !== null ? annualTailpipeKg + annualGridKg : null;
  const gramsCO2PerMile = annualKgCO2 !== null && annualMiles > 0 ? annualKgCO2 * 1000 / annualMiles : null;

  // Cross-check against the database's EPA annual fuel cost (15,000-mile basis). This only
  // reports the gap; it never replaces the user-mileage calculation.
  const epaComputedAt15k = mpg !== null && usesGas && !usesElectricity
    ? 15000 / mpg * fuelPrice
    : null;
  const epaValidation = epaAnnualCost !== null && epaComputedAt15k !== null
    ? {
      reportedUSD: epaAnnualCost,
      computedAt15kUSD: Math.round(epaComputedAt15k),
      ratio: epaAnnualCost > 0 ? epaComputedAt15k / epaAnnualCost : null,
      note: 'Cross-check only. The database EPA value uses its own regional fuel-price assumptions.',
    }
    : null;

  return {
    annualMiles,
    annualMilesSource: options.annualMilesSource || 'provided-or-default',
    powertrain,
    energy: {
      usesGas,
      usesElectricity,
      combinedMpg: mpg,
      kwhPer100Miles: kwhPer100,
      electricRangeMiles: electricRange,
      totalRangeMiles: totalRange,
      gasolineMiles,
      electricMiles,
      electricShare,
      electricityCostPerKWh,
    },
    cost: {
      annualUSD: annualCostUSD === null ? null : Math.round(annualCostUSD),
      perMileUSD: perMileCostUSD === null ? null : Math.round(perMileCostUSD * 1000) / 1000,
      reason: annualCostUSD === null ? costReason : null,
    },
    emissions: {
      annualKgCO2: annualKgCO2 === null ? null : Math.round(annualKgCO2),
      gramsCO2PerMile: gramsCO2PerMile === null ? null : Math.round(gramsCO2PerMile),
      tailpipeAnnualKg: annualTailpipeKg === null ? null : Math.round(annualTailpipeKg),
      gridAnnualKg: annualGridKg === null ? null : Math.round(annualGridKg),
      gridKgCO2PerKWh,
    },
    epaValidation,
    assumptions: {
      fuelPriceUSDPerGallon: fuelPrice,
      electricityUSDPerKWh: electricityPrice,
      publicChargingPremiumUSDPerKWh: publicPremium,
      electricityCostPerKWh,
      gasolineKgCO2PerGallon,
      gridKgCO2PerKWh,
      note: 'Derived estimates for comparison. They use one documented fuel price, one electricity price and one grid intensity for every vehicle; they are not a lifecycle assessment.',
    },
    utility: {
      seats: number(view?.seats),
      cargoRank: number(view?.dimensions?.cargoProxy?.rank),
      cargoLabel: view?.dimensions?.cargoProxy?.label || null,
      cargoBasis: view?.dimensions?.cargoProxy?.basis || null,
      measuredCargoCubicFeet: number(view?.dimensions?.cargoVolumeCubicFeet),
    },
  };
}

