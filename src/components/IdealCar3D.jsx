import {useEffect, useId, useMemo, useRef, useState} from 'react';
import {
  applyGlbFinish,
  modelForBody,
  prepareGlbModel,
  releaseGlbModel,
  resolveModelUrl,
  setGlbReveal,
} from './glbCarModel';

/*
 * IdealCar3D - a procedural, parameter-driven concept car.
 *
 * The model is deliberately a design study, not an engineering vehicle. Every proportion below
 * is a visual mapping of the editable Ideal DNA (body preference, seats, space, powertrain,
 * range and efficiency). It never claims real battery capacity, cargo volume or performance.
 *
 * The whole vehicle is built from one 0..1 assembly progress value. The Generation screen passes
 * that value in (so the DNA decode and the car build stay on the same clock); the Studio lets the
 * scene run its own build. Three.js is imported lazily so a WebGL failure can only affect this
 * preview, never the questionnaire, the editor or the recommendation flow.
 */

const clamp = (value, low, high) => {
  const numeric = Number(value);
  return Math.min(high, Math.max(low, Number.isFinite(numeric) ? numeric : low));
};
const damp = (from, to, speed, delta) => from + (to - from) * (1 - Math.exp(-speed * delta));
const smoothstep = value => {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
};
const easeOutCubic = value => 1 - Math.pow(1 - clamp(value, 0, 1), 3);
const lerp = (from, to, t) => from + (to - from) * t;

const SPACE_WORDS = {1: 'Small', 2: 'Medium', 3: 'Large', 4: 'Extra large'};


const BODY_PRESETS = {
  sedan: {
    label: 'Sedan', detail: 'Three-box silhouette',
    length: 4.72, width: 1.84, height: 1.44, ride: 0.17, wheelR: 0.32, wheelBaseRatio: 0.625,
    beltRatio: 0.56, cabinStart: 0.24, cabinEnd: 0.79, roofPeak: 0.50, sidePanels: 3,
    noseDrop: 0.10, tailDrop: 0.035, frontTaper: 0.10, rearTaper: 0.07, bed: 0,
    roofRail: 0, spoiler: 'deck', archFlare: 0.026, cladding: 0, tailStyle: 'bar',
  },
  hatchback: {
    label: 'Hatchback', detail: 'Short-tail silhouette',
    length: 4.26, width: 1.80, height: 1.50, ride: 0.17, wheelR: 0.32, wheelBaseRatio: 0.615,
    beltRatio: 0.55, cabinStart: 0.14, cabinEnd: 0.80, roofPeak: 0.44, sidePanels: 3,
    noseDrop: 0.11, tailDrop: 0.015, frontTaper: 0.11, rearTaper: 0.045, bed: 0,
    roofRail: 0, spoiler: 'roof', archFlare: 0.024, cladding: 0.10, tailStyle: 'bar',
  },
  suv: {
    label: 'SUV / Crossover', detail: 'Tall two-box silhouette',
    length: 4.80, width: 1.94, height: 1.76, ride: 0.23, wheelR: 0.37, wheelBaseRatio: 0.635,
    beltRatio: 0.555, cabinStart: 0.19, cabinEnd: 0.81, roofPeak: 0.46, sidePanels: 3,
    noseDrop: 0.07, tailDrop: 0.04, frontTaper: 0.08, rearTaper: 0.05, bed: 0,
    roofRail: 1, spoiler: 'roof', archFlare: 0.042, cladding: 0.65, tailStyle: 'bar',
  },
  minivan: {
    label: 'Minivan (MPV)', detail: 'One-box passenger volume',
    length: 5.02, width: 1.98, height: 1.82, ride: 0.19, wheelR: 0.36, wheelBaseRatio: 0.66,
    beltRatio: 0.545, cabinStart: 0.08, cabinEnd: 0.80, roofPeak: 0.42, sidePanels: 3,
    noseDrop: 0.09, tailDrop: 0.03, frontTaper: 0.08, rearTaper: 0.04, bed: 0,
    roofRail: 0.8, spoiler: 'roof', archFlare: 0.028, cladding: 0.30, tailStyle: 'blade',
  },
  pickup: {
    label: 'Pickup Truck', detail: 'Cab-and-bed silhouette',
    length: 5.38, width: 2.02, height: 1.88, ride: 0.27, wheelR: 0.40, wheelBaseRatio: 0.65,
    beltRatio: 0.58, cabinStart: 0.52, cabinEnd: 0.82, roofPeak: 0.66, sidePanels: 2,
    noseDrop: 0.06, tailDrop: 0.025, frontTaper: 0.07, rearTaper: 0.025, bed: 1,
    roofRail: 0.6, spoiler: 'none', archFlare: 0.05, cladding: 0.85, tailStyle: 'blade',
  },
  sports: {
    label: 'Sports Car', detail: 'Low fastback silhouette',
    length: 4.42, width: 1.92, height: 1.26, ride: 0.14, wheelR: 0.325, wheelBaseRatio: 0.63,
    beltRatio: 0.63, cabinStart: 0.30, cabinEnd: 0.76, roofPeak: 0.52, sidePanels: 2,
    noseDrop: 0.15, tailDrop: 0.05, frontTaper: 0.14, rearTaper: 0.10, bed: 0,
    roofRail: 0, spoiler: 'deck', archFlare: 0.03, cladding: 0, tailStyle: 'bar',
  },
  concept: {
    label: 'No Preference', detail: 'Neutral fastback concept',
    length: 4.76, width: 1.90, height: 1.48, ride: 0.18, wheelR: 0.35, wheelBaseRatio: 0.635,
    beltRatio: 0.58, cabinStart: 0.24, cabinEnd: 0.81, roofPeak: 0.50, sidePanels: 2,
    noseDrop: 0.12, tailDrop: 0.03, frontTaper: 0.12, rearTaper: 0.07, bed: 0,
    roofRail: 0, spoiler: 'deck', archFlare: 0.03, cladding: 0.15, tailStyle: 'bar',
  },
};

const BODY_KEY_BY_LABEL = {
  Sedan: 'sedan',
  Hatchback: 'hatchback',
  'SUV / Crossover': 'suv',
  'Minivan (MPV)': 'minivan',
  'Pickup Truck': 'pickup',
  'Sports Car': 'sports',
  'No Preference': 'concept',
};

const POWERTRAIN_STYLES = {
  ICE: {
    label: 'ICE', detail: 'Combustion concept', storage: 'Engine + fuel tank concept', accent: '#ffb27a',
    mix: {engine: 1, battery: 0, motor: 0, fuel: 1, exhaust: 1, charge: 0, neutral: 0},
  },
  HEV: {
    label: 'HEV', detail: 'Hybrid concept', storage: 'Engine + compact battery concept', accent: '#e4f58a',
    mix: {engine: 0.85, battery: 0.45, motor: 0.45, fuel: 0.9, exhaust: 1, charge: 0, neutral: 0},
  },
  PHEV: {
    label: 'PHEV', detail: 'Plug-in hybrid concept', storage: 'Engine + plug-in battery', accent: '#c8a7ff',
    mix: {engine: 0.70, battery: 0.80, motor: 0.55, fuel: 0.55, exhaust: 1, charge: 0.85, neutral: 0},
  },
  EV: {
    label: 'EV', detail: 'Electric concept', storage: 'Battery + motor concept', accent: '#78f0ba',
    mix: {engine: 0, battery: 1, motor: 1, fuel: 0, exhaust: 0, charge: 1, neutral: 0},
  },
  ANY: {
    label: 'Preview', detail: 'Neutral powertrain concept', storage: 'Neutral preview mode', accent: '#d7efe2',
    mix: {engine: 0, battery: 0, motor: 0, fuel: 0, exhaust: 0, charge: 0, neutral: 1},
  },
};

const SCALAR_KEYS = [
  'length', 'width', 'height', 'ride', 'wheelRadius', 'wheelBase', 'wheelTrack',
  'belt', 'cabinHeight', 'cabinStart', 'cabinEnd', 'roofPeak', 'noseDrop', 'tailDrop',
  'frontTaper', 'rearTaper', 'bedFactor', 'energyScale', 'rangeNorm', 'efficiency',
  'seats', 'space', 'range', 'archFront', 'archRear', 'archInner',
];
const MIX_KEYS = ['engine', 'battery', 'motor', 'fuel', 'exhaust', 'charge', 'neutral'];

function bodyTopAt(spec, t) {
  const nose = Math.pow(clamp((t - 0.74) / 0.26, 0, 1), 2);
  const tail = Math.pow(clamp((0.17 - t) / 0.17, 0, 1), 2);
  return spec.belt - spec.noseDrop * nose - spec.tailDrop * tail;
}

function bodyHalfWidthAt(spec, t) {
  const nose = Math.pow(clamp((t - 0.66) / 0.34, 0, 1), 2.2);
  const tail = Math.pow(clamp((0.30 - t) / 0.30, 0, 1), 2.1);
  const endRound = 1
    - 0.10 * Math.pow(clamp((t - 0.90) / 0.10, 0, 1), 2)
    - 0.08 * Math.pow(clamp((0.10 - t) / 0.10, 0, 1), 2);
  return (spec.width / 2) * (1.015 - spec.frontTaper * nose - spec.rearTaper * tail
    + 0.015 * Math.sin(Math.PI * t)) * endRound;
}

const HULL_LOWER_Y = [0.018, 0.18, 0.40, 0.65, 0.86, 0.975];
const HULL_LOWER_Z = [0.42, 0.74, 0.90, 0.965, 0.998, 0.998];

// Mirrors the lower half of the lofted hull so bolt-on parts (sills, bumpers,
// splitter) can hug the actual skin instead of floating at beltline width.
function lowerSkinFactor(u) {
  const value = clamp(u, 0, 1);
  for (let index = 1; index < HULL_LOWER_Y.length; index += 1) {
    if (value <= HULL_LOWER_Y[index]) {
      const span = Math.max(0.001, HULL_LOWER_Y[index] - HULL_LOWER_Y[index - 1]);
      return lerp(HULL_LOWER_Z[index - 1], HULL_LOWER_Z[index],
        clamp((value - HULL_LOWER_Y[index - 1]) / span, 0, 1));
    }
  }
  return HULL_LOWER_Z[HULL_LOWER_Z.length - 1];
}

function skinHalfAt(spec, t, y) {
  const bottom = spec.ride;
  const top = Math.min(spec.belt, Math.max(bottom + 0.05, hullTopAt(spec, t)));
  return bodyHalfWidthAt(spec, t) * lowerSkinFactor((y - bottom) / Math.max(0.05, top - bottom));
}

function roofRiseAt(spec, t) {
  if (t <= spec.cabinStart || t >= spec.cabinEnd) return 0;
  const span = Math.max(0.001, spec.cabinEnd - spec.cabinStart);
  const u = clamp((t - spec.cabinStart) / span, 0, 1);
  const peak = clamp((spec.roofPeak - spec.cabinStart) / span, 0.24, 0.76);
  const plateau = 0.20;
  const ps = clamp(peak - plateau, 0.025, 0.58);
  const pe = clamp(peak + plateau, 0.42, 0.975);
  if (u < ps) return smoothstep(u / Math.max(0.001, ps));
  if (u > pe) return smoothstep((1 - u) / Math.max(0.001, 1 - pe));
  const crown = 0.014 * Math.sin((Math.PI * (u - ps)) / Math.max(0.001, pe - ps));
  return clamp(1 + crown, 0, 1.02);
}

function cabinRoofAt(spec, t) {
  if (t <= spec.cabinStart || t >= spec.cabinEnd) return spec.belt;
  return spec.belt + spec.cabinHeight * roofRiseAt(spec, t);
}

function hullTopAt(spec, t) {
  return Math.max(bodyTopAt(spec, t), cabinRoofAt(spec, t));
}

function topHalfAt(spec, t, top = hullTopAt(spec, t)) {
  const half = bodyHalfWidthAt(spec, t);
  if (top - spec.belt < 0.015) return half * 0.87;
  const cabin = clamp((top - spec.belt) / Math.max(0.05, spec.cabinHeight), 0, 1);
  return half * (0.87 - 0.15 * cabin);
}

function upperZAt(spec, t, y) {
  const half = bodyHalfWidthAt(spec, t);
  const top = hullTopAt(spec, t);
  const crown = topHalfAt(spec, t, top);
  const lowerTop = Math.min(spec.belt, top);
  if (y <= lowerTop) return half * 0.998;
  const u = clamp((y - lowerTop) / Math.max(0.001, top - lowerTop), 0, 1);
  return half * 0.998 + (crown * 0.99 - half * 0.998) * smoothstep(u);
}

function roofWindow(spec) {
  const span = Math.max(0.001, spec.cabinEnd - spec.cabinStart);
  const peak = clamp((spec.roofPeak - spec.cabinStart) / span, 0.24, 0.76);
  const ps = clamp(peak - 0.20, 0.025, 0.58);
  const pe = clamp(peak + 0.20, 0.42, 0.975);
  return {
    plateauStart: spec.cabinStart + span * ps,
    plateauEnd: spec.cabinStart + span * pe,
  };
}

function efficiencyScore(values) {
  const reference = values.efficiencyReference
    || (values.powertrainMode && values.powertrainMode !== 'ANY' ? values.powertrainMode : 'ICE');
  const kwh = Number(values.kwhPer100Miles);
  const mpg = Number(values.mpg);
  const plugInRange = Number(values.phevElectricRangeMiles);
  const electric = Number.isFinite(kwh) ? clamp((55 - kwh) / 40, 0, 1) : 0.5;
  const liquid = Number.isFinite(mpg) ? clamp((mpg - 12) / 48, 0, 1) : 0.5;
  const plug = Number.isFinite(plugInRange) ? clamp((plugInRange - 5) / 55, 0, 1) : 0.5;
  if (reference === 'EV') return electric;
  if (reference === 'PHEV') return clamp(electric * 0.5 + liquid * 0.3 + plug * 0.2, 0, 1);
  return liquid;
}


export function buildCarSpec(dna) {
  const values = dna?.values && typeof dna.values === 'object' ? dna.values : (dna || {});
  const hard = dna?.hard && typeof dna.hard === 'object' ? dna.hard : {};
  const allowed = Array.isArray(hard.allowedPowertrains) ? hard.allowedPowertrains : [];

  const mode = String(values.powertrainMode || 'ANY');
  const powertrain = mode !== 'ANY' && POWERTRAIN_STYLES[mode] ? mode : 'ANY';
  const powertrainInfo = POWERTRAIN_STYLES[powertrain];

  const requestedBody = values.finalBodyStyle || values.bodyType;
  const bodyLabel = BODY_KEY_BY_LABEL[requestedBody] ? requestedBody : 'No Preference';
  const bodyKey = BODY_KEY_BY_LABEL[bodyLabel] || 'concept';
  const preset = BODY_PRESETS[bodyKey];

  const seats = clamp(values.seats ?? 5, 1, 15);
  const space = clamp(values.spacePreference ?? 2, 1, 4);
  const range = clamp(values.rangeMiles ?? 300, 50, 600);
  const spaceNorm = (space - 1) / 3;
  const rangeNorm = clamp((range - 50) / 550, 0, 1);
  const efficiency = efficiencyScore(values);

  const seatExtra = clamp(seats - 5, -2, 4) * 0.17;
  const length = preset.length + seatExtra + spaceNorm * 0.075 + efficiency * 0.07;
  const width = preset.width + spaceNorm * 0.05;
  const height = preset.height + spaceNorm * 0.045 - (efficiency - 0.5) * 0.06;
  const ride = preset.ride + spaceNorm * 0.01;
  const wheelRadius = preset.wheelR * (1 + (spaceNorm - 0.5) * 0.03);
  const wheelBase = clamp(length * preset.wheelBaseRatio + seatExtra * 0.35, length * 0.48, length * 0.73);
  const belt = height * preset.beltRatio;
  const cabinHeight = Math.max(0.34, (height - belt) * (1 - 0.08 * efficiency));
  const cabinStart = clamp(preset.cabinStart - spaceNorm * 0.02 - Math.max(0, seats - 5) * 0.007, 0.075, 0.62);
  const cabinEnd = clamp(preset.cabinEnd + (efficiency - 0.5) * 0.012, 0.68, 0.94);
  const roofPeak = clamp(preset.roofPeak + (efficiency - 0.5) * 0.045 + seatExtra * 0.008,
    cabinStart + 0.12, cabinEnd - 0.12);
  const energyScale = 0.35 + 0.65 * Math.sqrt(rangeNorm);
  const noseDrop = preset.noseDrop * (1 + 0.5 * efficiency);
  const tailDrop = preset.tailDrop * (1 + 0.5 * efficiency);
  const frontTaper = clamp(preset.frontTaper + 0.06 * efficiency, 0, 0.24);
  const rearTaper = preset.rearTaper;
  const wheelTrack = width / 2 - 0.10;

  const proportions = {belt, width, noseDrop, tailDrop, frontTaper, rearTaper};
  const frontT = clamp((length / 2 + wheelBase / 2) / length, 0.02, 0.98);
  const rearT = clamp((length / 2 - wheelBase / 2) / length, 0.02, 0.98);
  const archRadius = t => {
    const available = bodyTopAt(proportions, t) - (ride + wheelRadius) - 0.05;
    return clamp(Math.min(wheelRadius * 1.075, available), wheelRadius * 0.72, wheelRadius * 1.10);
  };
  const archFront = archRadius(frontT);
  const archRear = archRadius(rearT);
  const archInner = clamp(
    Math.min(bodyHalfWidthAt(proportions, frontT), bodyHalfWidthAt(proportions, rearT)) - 0.30,
    0.16,
    width / 2,
  );

  return {
    bodyKey,
    bodyLabel,
    bodyDetail: preset.detail,
    bodyStyle: preset.spoiler,
    sidePanels: preset.sidePanels,
    roofRail: preset.roofRail,
    archFlare: preset.archFlare,
    cladding: preset.cladding,
    tailStyle: preset.tailStyle,
    powertrain,
    powertrainLabel: powertrain === 'ANY'
      ? `Preview mode · ${allowed.length ? allowed.join(' / ') : 'all types'}`
      : `${powertrainInfo.label} · ${powertrainInfo.detail}`,
    powertrainStorage: powertrainInfo.storage,
    powertrainMix: powertrainInfo.mix,
    accent: powertrainInfo.accent,
    allowedText: allowed.length ? allowed.join(' / ') : 'Not specified',
    seats,
    space,
    spaceLabel: SPACE_WORDS[Math.round(space)] || 'Medium',
    range,
    efficiency,
    length,
    width,
    height,
    ride,
    wheelRadius,
    wheelBase,
    wheelTrack,
    belt,
    cabinHeight,
    cabinStart,
    cabinEnd,
    roofPeak,
    noseDrop,
    tailDrop,
    frontTaper,
    rearTaper,
    bedFactor: preset.bed,
    energyScale,
    rangeNorm,
    archFront,
    archRear,
    archInner,
  };
}


export function CarSilhouette({spec, className = ''}) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const bodyFill = `car3d-body-fill-${uid}`;
  const glassFill = `car3d-glass-fill-${uid}`;
  const scale = 436 / spec.length;
  const x0 = 122;
  const ground = 288;
  const xAt = t => x0 + t * 436;
  const yAt = metres => ground - metres * scale;

  let body = `M ${xAt(0).toFixed(1)} ${yAt(spec.ride).toFixed(1)}`;
  body += ` L ${xAt(0).toFixed(1)} ${yAt(hullTopAt(spec, 0)).toFixed(1)}`;
  for (let index = 1; index <= 40; index += 1) {
    const t = index / 40;
    body += ` L ${xAt(t).toFixed(1)} ${yAt(hullTopAt(spec, t)).toFixed(1)}`;
  }
  body += ` L ${xAt(1).toFixed(1)} ${yAt(spec.ride).toFixed(1)} Z`;

  let glass = `M ${xAt(spec.cabinStart + 0.008).toFixed(1)} ${yAt(spec.belt + 0.035).toFixed(1)}`;
  for (let index = 0; index <= 22; index += 1) {
    const t = lerp(spec.cabinStart + 0.008, spec.cabinEnd - 0.008, index / 22);
    glass += ` L ${xAt(t).toFixed(1)} ${yAt(cabinRoofAt(spec, t) - 0.028).toFixed(1)}`;
  }
  glass += ` L ${xAt(spec.cabinEnd - 0.008).toFixed(1)} ${yAt(spec.belt + 0.035).toFixed(1)} Z`;

  const frontX = xAt((spec.length / 2 + spec.wheelBase / 2) / spec.length);
  const rearX = xAt((spec.length / 2 - spec.wheelBase / 2) / spec.length);
  const wheelPx = spec.wheelRadius * scale;
  const archFrontPx = spec.archFront * scale;
  const archRearPx = spec.archRear * scale;
  const bedStart = xAt(0.045);
  const bedEnd = xAt(Math.max(0.10, spec.cabinStart - 0.02));
  const bedTop = yAt(spec.belt + 0.20);
  const markerX = xAt(0.30);
  const batteryBars = spec.powertrainMix.battery;
  const engineDots = spec.powertrainMix.engine;
  const preview = spec.powertrain === 'ANY';
  const panelSplit = [1 / 3, 2 / 3].slice(0, Math.max(0, spec.sidePanels - 1));

  return <svg className={`car-silhouette ${className}`.trim()} viewBox="0 0 680 330" role="img"
    aria-label={`Static concept silhouette: ${spec.bodyLabel}, ${spec.seats} seats, ${spec.range} mile range target, ${spec.powertrainLabel}`}>
    <defs>
      <linearGradient id={bodyFill} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#d5f7e2"/>
        <stop offset=".48" stopColor="#93d8ab"/>
        <stop offset="1" stopColor="#3c7657"/>
      </linearGradient>
      <linearGradient id={glassFill} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#2c5c50" stopOpacity=".97"/>
        <stop offset="1" stopColor="#061511" stopOpacity=".99"/>
      </linearGradient>
    </defs>
    <line x1="74" y1={ground} x2="606" y2={ground} stroke="#315346" strokeWidth="1"/>
    {spec.bedFactor > 0.02 && <g opacity={spec.bedFactor}>
      <path d={`M ${bedStart.toFixed(1)} ${yAt(spec.belt + 0.02).toFixed(1)}
        L ${bedEnd.toFixed(1)} ${yAt(spec.belt + 0.02).toFixed(1)}
        L ${bedEnd.toFixed(1)} ${bedTop.toFixed(1)}
        L ${bedStart.toFixed(1)} ${bedTop.toFixed(1)} Z`}
        fill="#08130e" stroke="#3f6555" strokeWidth="1"/>
      <rect x={bedStart} y={bedTop} width={bedEnd - bedStart} height="5" rx="2" fill="#7fa48f" opacity=".5"/>
      <line x1={bedEnd} y1={yAt(spec.belt + 0.02)} x2={bedEnd} y2={bedTop} stroke="#6f9c84" strokeWidth="1.4" opacity=".6"/>
    </g>}
    <path d={body} fill={`url(#${bodyFill})`} stroke="#b6ffd0" strokeWidth="1.15" strokeOpacity=".52"/>
    <path d={glass} fill={`url(#${glassFill})`} stroke="#79c6a8" strokeWidth="1" strokeOpacity=".62"/>
    {panelSplit.map((fraction, index) => {
      const t = lerp(spec.cabinStart, spec.cabinEnd, fraction);
      return <line key={`pillar-${index}`} x1={xAt(t)} y1={yAt(spec.belt + 0.03)}
        x2={xAt(t)} y2={yAt(cabinRoofAt(spec, t) - 0.03)} stroke="#0b211a" strokeWidth="2.4" opacity=".9"/>;
    })}
    <line x1={xAt(0.17)} y1={yAt(spec.ride + 0.10)} x2={xAt(0.17 + 0.30 + 0.34 * spec.energyScale)} y2={yAt(spec.ride + 0.10)}
      stroke={spec.accent} strokeWidth="3" strokeLinecap="round" opacity=".9"/>
    <circle cx={frontX} cy={yAt(spec.wheelRadius)} r={archFrontPx + 3} fill="#07110c" stroke="#4c7563" strokeWidth="1.2"/>
    <circle cx={rearX} cy={yAt(spec.wheelRadius)} r={archRearPx + 3} fill="#07110c" stroke="#4c7563" strokeWidth="1.2"/>
    {[rearX, frontX].map((centre, index) => <g key={`wheel-${index}`}>
      <circle cx={centre} cy={ground - wheelPx} r={wheelPx} fill="#08110d" stroke="#3c5d4d" strokeWidth="1.4"/>
      <circle cx={centre} cy={ground - wheelPx} r={wheelPx * 0.58} fill="none" stroke="#b7d2c4" strokeWidth="1.6"/>
      {[0, 1, 2, 3, 4].map(spoke => <line key={`spoke-${index}-${spoke}`}
        x1={centre} y1={ground - wheelPx}
        x2={centre + Math.cos((Math.PI * 2 * spoke) / 5) * wheelPx * 0.48}
        y2={ground - wheelPx + Math.sin((Math.PI * 2 * spoke) / 5) * wheelPx * 0.48}
        stroke="#86a897" strokeWidth="1" opacity=".65"/>)}
      <circle cx={centre} cy={ground - wheelPx} r={wheelPx * 0.13} fill={spec.accent} opacity=".9"/>
    </g>)}
    <g opacity={Math.max(0.4, batteryBars + engineDots)}>
      {batteryBars > 0.02 && [0, 1, 2, 3].map(index => <rect key={`battery-${index}`}
        x={markerX + index * 12} y={yAt(spec.ride + 0.24)} width="7" height="12" rx="2"
        fill={spec.accent} opacity={0.35 + batteryBars * 0.6}/>)}
      {engineDots > 0.02 && [0, 1, 2].map(index => <circle key={`engine-${index}`}
        cx={markerX + index * 15} cy={yAt(spec.ride + 0.30)} r="4"
        fill="#ffb27a" opacity={0.25 + engineDots * 0.6}/>)}
      {preview && <circle cx={markerX + 16} cy={yAt(spec.ride + 0.27)} r="7" fill="none"
        stroke={spec.accent} strokeWidth="2" strokeDasharray="3 3"/>}
    </g>
    <rect x={xAt(0.985)} y={yAt(spec.belt - spec.noseDrop - 0.12)} width="4" height="5" rx="1.6" fill="#eafff4" opacity=".95"/>
    <rect x={xAt(0.012)} y={yAt(spec.belt - spec.tailDrop - 0.12)} width="4" height="5" rx="1.6" fill="#ff6259" opacity=".95"/>
  </svg>;
}


const BODY_RING_COUNT = 36;
const HULL_RING_SIZE = 23;
const SIDE_GLASS_STEPS = 12;
const TOP_GLASS_ROWS = 10;
const TOP_GLASS_COLS = 8;

function createLoftGeometry(THREE, rings, ringSize) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array((rings * ringSize + 2) * 3);
  const sideIndices = [];
  for (let ring = 0; ring < rings - 1; ring += 1) {
    for (let point = 0; point < ringSize; point += 1) {
      const next = (point + 1) % ringSize;
      const a = ring * ringSize + point;
      const b = ring * ringSize + next;
      const c = (ring + 1) * ringSize + point;
      const d = (ring + 1) * ringSize + next;
      sideIndices.push(a, c, b, b, c, d);
    }
  }
  const rear = rings * ringSize;
  const front = rear + 1;
  // The end caps are emitted first and last so the body print can seal the rear
  // panel immediately and close the nose on the final frame of the sweep.
  const rearIndices = [];
  const frontIndices = [];
  for (let point = 0; point < ringSize; point += 1) {
    const next = (point + 1) % ringSize;
    rearIndices.push(rear, point, next);
    frontIndices.push(front, rings * ringSize - point - 1, rings * ringSize - next - 1);
  }
  geometry.setIndex([...rearIndices, ...sideIndices, ...frontIndices]);
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.userData.rearCapIndexCount = rearIndices.length;
  geometry.userData.sideIndexCount = sideIndices.length;
  geometry.userData.frontCapIndexCount = frontIndices.length;
  geometry.userData.totalIndexCount = rearIndices.length + sideIndices.length + frontIndices.length;
  return geometry;
}

function writeHullGeometry(geometry, spec) {
  const positions = geometry.attributes.position.array;
  let cursor = 0;
  const lowerY = HULL_LOWER_Y;
  const lowerZ = HULL_LOWER_Z;
  const upperY = [0.34, 0.66, 0.88];
  for (let ring = 0; ring < BODY_RING_COUNT; ring += 1) {
    const t = ring / (BODY_RING_COUNT - 1);
    const x = -spec.length / 2 + t * spec.length;
    const bottom = spec.ride;
    const top = Math.max(bottom + 0.18, hullTopAt(spec, t));
    const half = Math.max(0.12, bodyHalfWidthAt(spec, t));
    const crown = Math.max(0.08, topHalfAt(spec, t, top));
    const lowerTop = Math.min(spec.belt, top);
    const lowerHeight = Math.max(0.05, lowerTop - bottom);
    const points = [];
    for (let index = 0; index < lowerY.length; index += 1) {
      points.push([bottom + lowerHeight * lowerY[index], half * lowerZ[index]]);
    }
    for (let index = 0; index < upperY.length; index += 1) {
      const u = upperY[index];
      const y = lowerTop + (top - lowerTop) * u;
      points.push([y, half * 0.998 + (crown * 0.99 - half * 0.998) * smoothstep(u)]);
    }
    const topEdge = Math.max(lowerTop, top - Math.min(0.016, Math.max(0.004, (top - bottom) * 0.10)));
    points.push([topEdge, crown * 0.985]);
    points.push([top, crown * 0.55]);
    points.push([top, 0]);
    for (let index = points.length - 2; index >= 0; index -= 1) {
      points.push([points[index][0], -points[index][1]]);
    }
    for (let index = 0; index < points.length; index += 1) {
      positions[cursor++] = x;
      positions[cursor++] = points[index][0];
      positions[cursor++] = points[index][1];
    }
  }
  positions[cursor++] = -spec.length / 2;
  positions[cursor++] = (spec.ride + hullTopAt(spec, 0)) / 2;
  positions[cursor++] = 0;
  positions[cursor++] = spec.length / 2;
  positions[cursor++] = (spec.ride + hullTopAt(spec, 1)) / 2;
  positions[cursor++] = 0;
  geometry.attributes.position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
}


function createGridGeometry(THREE, rows, columns) {
  const geometry = new THREE.BufferGeometry();
  const count = (rows + 1) * (columns + 1);
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  const indices = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const a = row * (columns + 1) + column;
      const b = a + 1;
      const c = a + columns + 1;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  geometry.setIndex(indices);
  return geometry;
}

function glassPanelRange(spec, index) {
  const span = spec.cabinEnd - spec.cabinStart;
  const inset = span * 0.035;
  const low = spec.cabinStart + inset;
  const high = spec.cabinEnd - inset;
  const count = Math.max(1, spec.sidePanels);
  const width = (high - low) / count;
  return [low + width * index + span * 0.012, low + width * (index + 1) - span * 0.012];
}

function writeSideGlass(geometry, spec, t0, t1, side) {
  const positions = geometry.attributes.position.array;
  let cursor = 0;
  for (let step = 0; step <= SIDE_GLASS_STEPS; step += 1) {
    const t = lerp(t0, t1, step / SIDE_GLASS_STEPS);
    const x = -spec.length / 2 + t * spec.length;
    const roof = cabinRoofAt(spec, t);
    const yBottom = spec.belt + 0.045;
    const yTop = Math.max(spec.belt + 0.075,
      Math.min(roof - 0.05, spec.belt + spec.cabinHeight * 0.86));
    const zBottom = upperZAt(spec, t, yBottom) + 0.02;
    const zTop = upperZAt(spec, t, yTop) + 0.02;
    positions[cursor++] = x;
    positions[cursor++] = yBottom;
    positions[cursor++] = side * zBottom;
    positions[cursor++] = x;
    positions[cursor++] = yTop;
    positions[cursor++] = side * zTop;
  }
  geometry.attributes.position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
}

function writeTopGlass(geometry, spec, t0, t1, inset, lift) {
  const positions = geometry.attributes.position.array;
  let cursor = 0;
  for (let row = 0; row <= TOP_GLASS_ROWS; row += 1) {
    const t = lerp(t0, t1, row / TOP_GLASS_ROWS);
    const x = -spec.length / 2 + t * spec.length;
    const top = hullTopAt(spec, t);
    const crown = topHalfAt(spec, t, top) * inset;
    for (let column = 0; column <= TOP_GLASS_COLS; column += 1) {
      const u = -1 + (2 * column) / TOP_GLASS_COLS;
      const z = u * crown;
      const y = top + lift - 0.006 * u * u * (crown / Math.max(0.2, spec.width / 2));
      positions[cursor++] = x;
      positions[cursor++] = y;
      positions[cursor++] = z;
    }
  }
  geometry.attributes.position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
}

function orientBeam(THREE, mesh, from, to, thickness) {
  const direction = new THREE.Vector3().subVectors(to, from);
  const length = direction.length();
  mesh.position.copy(from).add(to).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  mesh.scale.set(thickness, Math.max(0.001, length), thickness);
}


function makeWheel(THREE) {
  const group = new THREE.Group();
  const tyreMaterial = new THREE.MeshStandardMaterial({color: 0x10161a, roughness: 0.86, metalness: 0.08});
  const sidewallMaterial = new THREE.MeshStandardMaterial({color: 0x171e22, roughness: 0.78, metalness: 0.1});
  const rimMaterial = new THREE.MeshStandardMaterial({color: 0xc9d7d1, roughness: 0.3, metalness: 0.9});
  const innerMaterial = new THREE.MeshStandardMaterial({color: 0x0a0f11, roughness: 0.5, metalness: 0.6});
  const brakeMaterial = new THREE.MeshStandardMaterial({color: 0x535d60, roughness: 0.45, metalness: 0.8});
  const accentMaterial = new THREE.MeshStandardMaterial({color: 0x78f0ba, emissive: 0x2a6a4a,
    emissiveIntensity: 0.6, roughness: 0.4, metalness: 0.3});
  const tyre = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.60, 32), tyreMaterial);
  tyre.rotation.x = Math.PI / 2;
  group.add(tyre);
  const tread = new THREE.Mesh(new THREE.TorusGeometry(0.965, 0.05, 8, 32), sidewallMaterial);
  group.add(tread);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.63, 24), rimMaterial);
  rim.rotation.x = Math.PI / 2;
  group.add(rim);
  const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.65, 20), innerMaterial);
  dish.rotation.x = Math.PI / 2;
  group.add(dish);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.06, 20), brakeMaterial);
  disc.rotation.x = Math.PI / 2;
  disc.position.z = -0.02;
  group.add(disc);
  for (let spoke = 0; spoke < 5; spoke += 1) {
    const angle = (spoke / 5) * Math.PI * 2;
    const spokeMesh = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.60, 0.06), rimMaterial);
    spokeMesh.position.set(Math.cos(angle) * 0.30, Math.sin(angle) * 0.30, 0.33);
    spokeMesh.rotation.z = angle - Math.PI / 2;
    group.add(spokeMesh);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.70, 16), rimMaterial);
  hub.rotation.x = Math.PI / 2;
  group.add(hub);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.50, 0.014, 6, 32), accentMaterial);
  ring.position.z = 0.325;
  group.add(ring);
  const caliper = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.20, 0.07), accentMaterial);
  caliper.position.set(0.26, 0.18, 0.18);
  group.add(caliper);
  return group;
}


function createCarScene(THREE, OrbitControls, GLTFLoader, host, options) {
  const parent = host.parentElement || host;
  let reduceMotion = Boolean(options.reducedMotion);
  const assemblyRef = options.assemblyProgress || null;
  let targetSpec = options.initialSpec || null;
  let currentState = null;
  let disposed = false;
  let cameraPlaced = false;
  let userAdjusted = false;
  let lastSignature = '';
  let lastBodyKey = null;
  let assemblyStart = null;
  let externalAssembly = null;

  const renderer = new THREE.WebGLRenderer({antialias: true, alpha: true, powerPreference: 'high-performance'});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(1, 1, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.04;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 90);
  camera.position.set(6.4, 3.1, 7.2);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.minPolarAngle = 0.5;
  controls.maxPolarAngle = 1.47;
  controls.minDistance = 3.4;
  controls.maxDistance = 15;
  controls.target.set(0, 0.7, 0);
  controls.autoRotate = !reduceMotion;
  controls.autoRotateSpeed = 0.55;

  scene.add(new THREE.HemisphereLight(0xe9fff5, 0x08130f, 1.0));
  const keyLight = new THREE.DirectionalLight(0xd9ffef, 1.85);
  keyLight.position.set(4.6, 7.4, 5.4);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.width = 1024;
  keyLight.shadow.mapSize.height = 1024;
  keyLight.shadow.camera.left = -7;
  keyLight.shadow.camera.right = 7;
  keyLight.shadow.camera.top = 7;
  keyLight.shadow.camera.bottom = -7;
  keyLight.shadow.camera.near = 0.5;
  keyLight.shadow.camera.far = 26;
  keyLight.shadow.bias = -0.0012;
  scene.add(keyLight);
  const rimLight = new THREE.DirectionalLight(0x5fb79c, 1.9);
  rimLight.position.set(-5.2, 4.2, -6.4);
  scene.add(rimLight);
  const fillLight = new THREE.DirectionalLight(0xa9d9c4, 0.62);
  fillLight.position.set(-3.4, 2.4, 6.2);
  scene.add(fillLight);
  // Neutral paint light: the GLB uses a real charcoal colour map, and the strongly tinted
  // studio lights above would otherwise turn the whole car green and hide its surfacing.
  const paintLight = new THREE.DirectionalLight(0xffffff, 0.55);
  paintLight.position.set(2.2, 2.8, 7.4);
  scene.add(paintLight);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envShell = new THREE.Mesh(
    new THREE.SphereGeometry(14, 16, 12),
    new THREE.MeshBasicMaterial({color: 0x0d211a, side: THREE.BackSide}),
  );
  envScene.add(envShell);
  const envPanel = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 3.4),
    new THREE.MeshBasicMaterial({color: 0xc6ffe2, side: THREE.DoubleSide}),
  );
  envPanel.position.set(5.4, 6.4, 5.2);
  envPanel.lookAt(0, 1, 0);
  envScene.add(envPanel);
  const envPanelB = new THREE.Mesh(
    new THREE.PlaneGeometry(7, 2.2),
    new THREE.MeshBasicMaterial({color: 0x2c7b62, side: THREE.DoubleSide}),
  );
  envPanelB.position.set(-6.2, 3.4, -3.6);
  envPanelB.lookAt(0, 1, 0);
  envScene.add(envPanelB);
  // A soft overhead strip supplies the long clearcoat highlight across the roof and hood.
  const envPanelC = new THREE.Mesh(
    new THREE.PlaneGeometry(9, 2.4),
    new THREE.MeshBasicMaterial({color: 0xf2fff9, side: THREE.DoubleSide}),
  );
  envPanelC.position.set(0.6, 9.2, 0.8);
  envPanelC.lookAt(0, 0, 0);
  envScene.add(envPanelC);
  const envRenderTarget = pmrem.fromScene(envScene, 0.04);
  scene.environment = envRenderTarget.texture;
  scene.environmentIntensity = 1.12;
  pmrem.dispose();
  envScene.traverse(object => {
    if (object.geometry) object.geometry.dispose();
    if (object.material) object.material.dispose();
  });

  const platform = new THREE.Group();
  platform.position.y = -0.004;
  scene.add(platform);
  const platformDisc = new THREE.Mesh(
    new THREE.CircleGeometry(4.4, 72),
    new THREE.MeshBasicMaterial({color: 0x07120e, transparent: true, opacity: 0.8, depthWrite: false}),
  );
  platformDisc.rotation.x = -Math.PI / 2;
  platform.add(platformDisc);
  const platformRings = new THREE.Group();
  for (let index = 0; index < 3; index += 1) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(3.0 + index * 0.44, 3.035 + index * 0.44, 96),
      new THREE.MeshBasicMaterial({
        color: 0x4fdca4, transparent: true, opacity: 0.12 + index * 0.035,
        side: THREE.DoubleSide, depthWrite: false,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    platformRings.add(ring);
  }
  platform.add(platformRings);
  const platformGrid = new THREE.GridHelper(11, 22, 0x2f6a55, 0x1b3b30);
  platformGrid.material.transparent = true;
  platformGrid.material.opacity = 0.32;
  platform.add(platformGrid);

  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = 192;
  shadowCanvas.height = 192;
  const shadowContext = shadowCanvas.getContext('2d');
  if (shadowContext) {
    const gradient = shadowContext.createRadialGradient(96, 96, 4, 96, 96, 92);
    gradient.addColorStop(0, 'rgba(104,255,184,0.62)');
    gradient.addColorStop(0.45, 'rgba(58,196,138,0.26)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    shadowContext.fillStyle = gradient;
    shadowContext.fillRect(0, 0, 192, 192);
  }
  const shadowTexture = new THREE.CanvasTexture(shadowCanvas);
  shadowTexture.colorSpace = THREE.SRGBColorSpace;
  const shadowPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(8.4, 4.2),
    new THREE.MeshBasicMaterial({map: shadowTexture, transparent: true, depthWrite: false, opacity: 0.5}),
  );
  shadowPlane.rotation.x = -Math.PI / 2;
  shadowPlane.position.y = 0.002;
  shadowPlane.renderOrder = 1;
  scene.add(shadowPlane);

  // The pool above is light spill, not shadow. A separate dark plane gives the car a
  // contact shadow so the tyres read as touching the platform instead of floating.
  const contactCanvas = document.createElement('canvas');
  contactCanvas.width = 128;
  contactCanvas.height = 128;
  const contactContext = contactCanvas.getContext('2d');
  if (contactContext) {
    const gradient = contactContext.createRadialGradient(64, 64, 3, 64, 64, 62);
    gradient.addColorStop(0, 'rgba(0,0,0,0.8)');
    gradient.addColorStop(0.44, 'rgba(0,0,0,0.52)');
    gradient.addColorStop(0.72, 'rgba(0,0,0,0.2)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    contactContext.fillStyle = gradient;
    contactContext.fillRect(0, 0, 128, 128);
  }
  const contactTexture = new THREE.CanvasTexture(contactCanvas);
  contactTexture.colorSpace = THREE.SRGBColorSpace;
  const contactPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({map: contactTexture, transparent: true, depthWrite: false, opacity: 0.92}),
  );
  contactPlane.rotation.x = -Math.PI / 2;
  contactPlane.position.y = 0.004;
  contactPlane.renderOrder = 2;
  scene.add(contactPlane);


  const paintColor = new THREE.Color(0xd3eee0);
  const primerColor = new THREE.Color(0x2f4038);
  const batteryTint = new THREE.Color(0x8ff0c4);
  const bodyMaterial = new THREE.MeshPhysicalMaterial({
    color: paintColor.clone(), metalness: 0.38, roughness: 0.34, clearcoat: 1, clearcoatRoughness: 0.16,
    sheen: 0.35, sheenColor: new THREE.Color(0x9fe8c6), envMapIntensity: 1.3,
  });
  bodyMaterial.name = 'ideal-car-paint';

  // Wheel arches are carved out of the paint shader: the hull is a closed loft,
  // so cutting the side skin below the fender line reads as a real wheel well.
  const archUniforms = {
    uArchFront: {value: new THREE.Vector3(0, 0, 0)},
    uArchRear: {value: new THREE.Vector3(0, 0, 0)},
    uArchInner: {value: 0.6},
    uArchRide: {value: 0.18},
  };
  bodyMaterial.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, archUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCarLocalPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCarLocalPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vCarLocalPos;
uniform vec3 uArchFront;
uniform vec3 uArchRear;
uniform float uArchInner;
uniform float uArchRide;`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
if (vCarLocalPos.y > uArchRide - 0.03 && abs(vCarLocalPos.z) > uArchInner) {
  if (distance(vCarLocalPos.xy, uArchFront.xy) < uArchFront.z) discard;
  if (distance(vCarLocalPos.xy, uArchRear.xy) < uArchRear.z) discard;
}`);
  };

  const glassMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x122a25, metalness: 0.3, roughness: 0.07, clearcoat: 1, clearcoatRoughness: 0.04,
    transparent: true, opacity: 0.86, envMapIntensity: 1.65, side: THREE.DoubleSide, depthWrite: true,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  const trimMaterial = new THREE.MeshStandardMaterial({color: 0x141d1b, roughness: 0.46, metalness: 0.5});
  const claddingMaterial = new THREE.MeshStandardMaterial({color: 0x1d2724, roughness: 0.82, metalness: 0.12});
  const chromeMaterial = new THREE.MeshStandardMaterial({color: 0xd5e4dc, roughness: 0.2, metalness: 0.95});
  const plateMaterial = new THREE.MeshStandardMaterial({color: 0xcfdbd5, roughness: 0.5, metalness: 0.1});
  const accentMaterial = new THREE.MeshStandardMaterial({
    color: 0x78f0ba, emissive: 0x2a6a4a, emissiveIntensity: 0.75, roughness: 0.34, metalness: 0.4,
  });
  const headlightMaterial = new THREE.MeshStandardMaterial({
    color: 0xd8ece5, emissive: 0xa8f0d6, emissiveIntensity: 1.1, roughness: 0.2, metalness: 0.12,
  });
  const taillightMaterial = new THREE.MeshStandardMaterial({
    color: 0xff4438, emissive: 0xd41c10, emissiveIntensity: 0.8, roughness: 0.38, metalness: 0.1,
  });
  const engineMaterial = new THREE.MeshStandardMaterial({
    color: 0xb06a35, metalness: 0.85, roughness: 0.35, transparent: true, opacity: 1,
  });
  const batteryMaterial = new THREE.MeshStandardMaterial({
    color: 0x5fe0a6, emissive: 0x1e6b47, emissiveIntensity: 0.6, metalness: 0.5,
    roughness: 0.4, transparent: true, opacity: 1,
  });
  const motorMaterial = new THREE.MeshStandardMaterial({
    color: 0xc4854f, metalness: 0.9, roughness: 0.28, transparent: true, opacity: 1,
  });
  const fuelMaterial = new THREE.MeshStandardMaterial({
    color: 0xd6a15c, metalness: 0.4, roughness: 0.5, transparent: true, opacity: 0.8,
  });
  const archMaterial = new THREE.MeshStandardMaterial({
    color: 0x0a1210, roughness: 0.9, metalness: 0.25, side: THREE.DoubleSide,
  });
  const cabinFrameMaterial = new THREE.MeshBasicMaterial({
    color: 0x9ff2c8, transparent: true, opacity: 0.55, depthWrite: false,
  });
  const scanMaterial = new THREE.MeshBasicMaterial({
    color: 0x78f0ba, transparent: true, opacity: 0, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const beltLineMaterial = new THREE.LineBasicMaterial({
    color: 0xd7ffe9, transparent: true, opacity: 0.42, depthWrite: false,
  });
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const addBox = (material, group) => {
    const mesh = new THREE.Mesh(unitBox, material);
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  };

  const car = new THREE.Group();
  scene.add(car);
  const wheelAnchor = new THREE.Group();
  car.add(wheelAnchor);
  const chassisGroup = new THREE.Group();
  chassisGroup.visible = false;
  car.add(chassisGroup);
  const powertrainGroup = new THREE.Group();
  powertrainGroup.visible = false;
  car.add(powertrainGroup);
  const frameGroup = new THREE.Group();
  frameGroup.visible = false;
  car.add(frameGroup);
  const bodyGroup = new THREE.Group();
  bodyGroup.visible = false;
  car.add(bodyGroup);
  const glassGroup = new THREE.Group();
  bodyGroup.add(glassGroup);
  const detailGroup = new THREE.Group();
  detailGroup.visible = false;
  car.add(detailGroup);

  // ---------------------------------------------------------------------------
  // Fixed exterior GLB layer
  // ---------------------------------------------------------------------------
  // The GLB is a presentation asset. It is loaded only for body types with a verified local
  // file, sits in the same car rig as the procedural geometry, and is revealed as a concept
  // animation during the final third of the build. The procedural car remains fully intact
  // underneath and is used whenever no model exists, while loading, or after a load failure.
  const glbGroup = new THREE.Group();
  glbGroup.name = 'glb-body-layer';
  glbGroup.visible = false;
  car.add(glbGroup);
  let glbPrepared = null;
  let glbStatus = 'idle';
  let glbRequest = 0;
  let glbKey = null;
  let glbFit = null;
  let glbAccent = null;

  function reportModelStatus(status, extra = {}) {
    const model = extra.model || modelForBody(targetSpec?.bodyKey);
    const info = {
      status,
      bodyKey: targetSpec?.bodyKey || null,
      label: model?.label || targetSpec?.bodyLabel || 'Procedural body',
      title: model?.title || null,
      source: model?.source || 'Procedural concept geometry (project code)',
      license: model?.license || 'Original project code',
      url: model ? resolveModelUrl(model) : null,
      triangles: model?.triangles || 0,
      bytes: model?.byteSize || 0,
      loadMs: extra.loadMs || 0,
      message: extra.message || '',
      fallback: status === 'failed' || status === 'procedural',
    };
    glbStatus = status;
    host.dataset.modelStatus = status;
    host.dataset.modelSource = status === 'ready' ? 'glb' : 'procedural';
    host.dataset.modelKey = info.bodyKey || '';
    host.dataset.modelLabel = info.label;
    host.dataset.modelUrl = info.url || '';
    host.dataset.modelTriangles = String(info.triangles || 0);
    host.dataset.modelBytes = String(info.bytes || 0);
    host.dataset.modelLoadMs = info.loadMs ? info.loadMs.toFixed(0) : '';
    if (typeof options.onModelStatus === 'function') options.onModelStatus(info);
  }

  function disposePreparedGlb() {
    if (!glbPrepared) return;
    releaseGlbModel(glbPrepared);
    glbPrepared = null;
    glbGroup.visible = false;
    host.dataset.modelReveal = '0';
  }

  function ensureGlb() {
    if (!targetSpec) return;
    const key = targetSpec.bodyKey;
    const model = modelForBody(key);

    if (!model) {
      glbRequest += 1;
      disposePreparedGlb();
      glbKey = null;
      glbFit = null;
      if (glbStatus !== 'procedural') {
        reportModelStatus('procedural', {
          message: 'No verified local GLB exists for this body type, so the procedural concept body is used.',
        });
      } else {
        host.dataset.modelStatus = 'procedural';
        host.dataset.modelSource = 'procedural';
      }
      return;
    }

    if ((glbStatus === 'ready' || glbStatus === 'loading') && glbKey === key) return;
    if (glbStatus === 'failed' && glbKey === key) return;

    glbRequest += 1;
    const request = glbRequest;
    disposePreparedGlb();
    glbKey = key;
    glbFit = null;
    glbAccent = targetSpec.accent;
    reportModelStatus('loading', {model, message: `Loading the ${model.label} concept exterior…`});

    const startedAt = performance.now();
    const loader = new GLTFLoader();
    loader.load(
      resolveModelUrl(model),
      gltf => {
        if (disposed || request !== glbRequest) {
          if (gltf?.scene) releaseGlbModel({root: gltf.scene});
          return;
        }
        try {
          const prepared = prepareGlbModel(THREE, gltf, model, {targetLength: targetSpec.length});
          applyGlbFinish(THREE, prepared, targetSpec.accent);
          glbPrepared = prepared;
          glbGroup.add(prepared.root);
          glbFit = {
            length: prepared.size.x,
            width: prepared.size.z,
            height: prepared.size.y,
            model: true,
          };
          host.dataset.modelProgress = '100';
          host.dataset.modelActualLength = prepared.size.x.toFixed(2);
          host.dataset.modelActualWidth = prepared.size.z.toFixed(2);
          host.dataset.modelActualHeight = prepared.size.y.toFixed(2);
          applyGlbCameraFit();
          reportModelStatus('ready', {
            model,
            loadMs: performance.now() - startedAt,
            message: `${model.title} · ${model.credit}`,
          });
        } catch (error) {
          console.warn('IdealCar3D could not prepare the GLB body', error);
          disposePreparedGlb();
          reportModelStatus('failed', {
            model,
            message: `The GLB body could not be prepared (${error?.message || String(error)}). The procedural concept body is shown instead.`,
          });
        }
      },
      event => {
        if (disposed || request !== glbRequest) return;
        if (event?.total) {
          const percent = Math.min(99, Math.round((event.loaded / event.total) * 100));
          host.dataset.modelProgress = String(percent);
        }
      },
      error => {
        if (disposed || request !== glbRequest) return;
        console.warn('IdealCar3D could not load the GLB body', error);
        disposePreparedGlb();
        reportModelStatus('failed', {
          model,
          message: 'The local GLB body could not be loaded. The procedural concept body is shown instead.',
        });
      },
    );
  }

  function applyGlbReveal(progressValue) {
    const ready = Boolean(glbPrepared) && glbStatus === 'ready';
    if (!ready) {
      if (glbGroup.visible) glbGroup.visible = false;
      host.dataset.modelReveal = '0';
      return;
    }

    const reveal = reduceMotion ? 1 : smoothstep((progressValue - 0.55) / 0.30);
    setGlbReveal(glbPrepared, reveal, reduceMotion);
    glbGroup.visible = reveal > 0.002;
    host.dataset.modelReveal = reveal.toFixed(3);

    if (reveal > 0.18) {
      // The real shell replaces the printed shell. Early concept internals (chassis and
      // powertrain) remain visible through the fade, then step aside as the paint settles.
      wheelAnchor.visible = false;
      bodyGroup.visible = false;
      detailGroup.visible = false;
      frameGroup.visible = false;
      scanRing.visible = false;
    }
    if (reveal > 0.72) {
      chassisGroup.visible = false;
      powertrainGroup.visible = false;
    }
  }
  const bodyGeometry = createLoftGeometry(THREE, BODY_RING_COUNT, HULL_RING_SIZE);
  const bodyMesh = new THREE.Mesh(bodyGeometry, bodyMaterial);
  bodyMesh.castShadow = true;
  bodyMesh.frustumCulled = false;
  bodyGroup.add(bodyMesh);
  bodyGeometry.setDrawRange(0, 0);

  const sideGlassMeshes = [];
  for (let sideIndex = 0; sideIndex < 2; sideIndex += 1) {
    for (let panel = 0; panel < 3; panel += 1) {
      const geometry = createGridGeometry(THREE, SIDE_GLASS_STEPS, 1);
      const mesh = new THREE.Mesh(geometry, glassMaterial);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      glassGroup.add(mesh);
      sideGlassMeshes.push({mesh, geometry, side: sideIndex === 0 ? 1 : -1});
    }
  }
  const topGlassMeshes = [];
  for (let index = 0; index < 2; index += 1) {
    const geometry = createGridGeometry(THREE, TOP_GLASS_ROWS, TOP_GLASS_COLS);
    const mesh = new THREE.Mesh(geometry, glassMaterial);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    glassGroup.add(mesh);
    topGlassMeshes.push({mesh, geometry});
  }


  const halfTubeGeometry = new THREE.CylinderGeometry(1, 1, 1, 26, 1, true, -Math.PI / 2, Math.PI);
  halfTubeGeometry.rotateX(-Math.PI / 2);
  const halfDiscGeometry = new THREE.CircleGeometry(1, 26, 0, Math.PI);
  const wheelWells = [];
  const archFlares = [];
  for (let axle = 0; axle < 2; axle += 1) {
    for (let side = -1; side <= 1; side += 2) {
      const group = new THREE.Group();
      const liner = new THREE.Mesh(halfTubeGeometry, archMaterial);
      liner.scale.set(1, 1, 0.42);
      group.add(liner);
      const wall = new THREE.Mesh(halfDiscGeometry, archMaterial);
      wall.position.z = -side * 0.205;
      group.add(wall);
      chassisGroup.add(group);
      wheelWells.push({group, liner, wall, axle, side});

      const flare = new THREE.Mesh(
        new THREE.TorusGeometry(1, 0.05, 8, 24, Math.PI),
        trimMaterial,
      );
      detailGroup.add(flare);
      archFlares.push({mesh: flare, axle, side});
    }
  }

  const wheels = [];
  for (let axle = 0; axle < 2; axle += 1) {
    for (let side = -1; side <= 1; side += 2) {
      const wheel = makeWheel(THREE);
      wheelAnchor.add(wheel);
      wheels.push({mesh: wheel, axle, side});
    }
  }

  const scanRing = new THREE.Mesh(
    new THREE.RingGeometry(0.5, 0.53, 64, 1, 0, Math.PI * 2),
    scanMaterial,
  );
  scanRing.rotation.y = Math.PI / 2;
  scene.add(scanRing);

  const frameBeams = [];
  const frameMaterials = [];
  for (let index = 0; index < 6; index += 1) {
    const material = cabinFrameMaterial.clone();
    const geometry = new THREE.CylinderGeometry(1, 1, 1, 6);
    const beam = new THREE.Mesh(geometry, material);
    frameGroup.add(beam);
    frameBeams.push(beam);
    frameMaterials.push(material);
  }
  const underbody = addBox(trimMaterial, chassisGroup);
  const underRailLeft = addBox(accentMaterial, chassisGroup);
  const underRailRight = addBox(accentMaterial, chassisGroup);
  const crossMembers = [addBox(trimMaterial, chassisGroup), addBox(trimMaterial, chassisGroup),
    addBox(trimMaterial, chassisGroup)];

  const batteryPack = addBox(trimMaterial, powertrainGroup);
  const batteryCells = addBox(batteryMaterial, powertrainGroup);
  const batteryStrip = addBox(accentMaterial, powertrainGroup);
  const engineBlock = addBox(engineMaterial, powertrainGroup);
  const engineCover = addBox(trimMaterial, powertrainGroup);
  const enginePipes = [0, 1, 2, 3].map(() => addBox(chromeMaterial, powertrainGroup));
  const fuelTank = addBox(fuelMaterial, powertrainGroup);
  const exhaustPipe = addBox(chromeMaterial, powertrainGroup);
  const motorUnit = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 18), motorMaterial);
  powertrainGroup.add(motorUnit);
  const gearbox = addBox(motorMaterial, powertrainGroup);
  const halfShafts = [addBox(chromeMaterial, powertrainGroup), addBox(chromeMaterial, powertrainGroup)];

  const detail = {};
  const makeDetailBox = (material = trimMaterial) => addBox(material, detailGroup);
  detail.headlights = [makeDetailBox(headlightMaterial), makeDetailBox(headlightMaterial)];
  detail.headlightHousings = [makeDetailBox(trimMaterial), makeDetailBox(trimMaterial)];
  detail.drls = [makeDetailBox(accentMaterial), makeDetailBox(accentMaterial)];
  detail.grille = makeDetailBox(trimMaterial);
  detail.grilleSurround = makeDetailBox(chromeMaterial);
  detail.grilleSlats = [0, 1, 2, 3, 4].map(() => makeDetailBox(chromeMaterial));
  detail.lowerIntake = makeDetailBox(trimMaterial);
  detail.splitter = makeDetailBox(trimMaterial);
  detail.frontBumper = makeDetailBox(plateMaterial);
  detail.rearBumper = makeDetailBox(plateMaterial);
  detail.frontBadge = makeDetailBox(accentMaterial);
  detail.tailBar = makeDetailBox(taillightMaterial);
  detail.tailLights = [makeDetailBox(taillightMaterial), makeDetailBox(taillightMaterial)];
  detail.tailLightHousings = [makeDetailBox(trimMaterial), makeDetailBox(trimMaterial)];
  detail.diffuser = makeDetailBox(trimMaterial);
  detail.diffuserFins = [0, 1, 2].map(() => makeDetailBox(trimMaterial));
  detail.plate = makeDetailBox(plateMaterial);
  detail.rearBadge = makeDetailBox(accentMaterial);
  detail.deckSpoiler = makeDetailBox(trimMaterial);
  detail.roofSpoiler = makeDetailBox(trimMaterial);
  detail.duckTail = makeDetailBox(trimMaterial);
  detail.exhausts = [makeDetailBox(chromeMaterial), makeDetailBox(chromeMaterial)];
  detail.mirrors = [makeDetailBox(bodyMaterial), makeDetailBox(bodyMaterial)];
  detail.mirrorStalks = [makeDetailBox(trimMaterial), makeDetailBox(trimMaterial)];
  detail.handles = [0, 1, 2, 3].map(() => makeDetailBox(trimMaterial));
  detail.rockers = [makeDetailBox(claddingMaterial), makeDetailBox(claddingMaterial)];
  detail.skirts = [makeDetailBox(accentMaterial), makeDetailBox(accentMaterial)];
  detail.roofRails = [makeDetailBox(trimMaterial), makeDetailBox(trimMaterial)];
  detail.cladding = [makeDetailBox(claddingMaterial), makeDetailBox(claddingMaterial)];
  detail.chargeFlap = makeDetailBox(trimMaterial);
  detail.chargeDot = makeDetailBox(accentMaterial);
  detail.bedWalls = [makeDetailBox(bodyMaterial), makeDetailBox(bodyMaterial)];
  detail.bedFloor = makeDetailBox(trimMaterial);
  detail.bedGate = makeDetailBox(bodyMaterial);
  detail.bedRails = [makeDetailBox(trimMaterial), makeDetailBox(trimMaterial)];

  const seamPositions = new Float32Array(12 * 3);
  const seamGeometry = new THREE.BufferGeometry();
  seamGeometry.setAttribute('position', new THREE.BufferAttribute(seamPositions, 3));
  const seamLines = new THREE.LineSegments(seamGeometry, new THREE.LineBasicMaterial({
    color: 0x2a5a48, transparent: true, opacity: 0.7, depthWrite: false,
  }));
  detailGroup.add(seamLines);

  const beltPositions = new Float32Array(12);
  const beltGeometry = new THREE.BufferGeometry();
  beltGeometry.setAttribute('position', new THREE.BufferAttribute(beltPositions, 3));
  const beltLine = new THREE.LineSegments(beltGeometry, beltLineMaterial);
  detailGroup.add(beltLine);


  function createState(spec) {
    const state = {};
    SCALAR_KEYS.forEach(key => {
      state[key] = Number.isFinite(Number(spec[key])) ? Number(spec[key]) : 0;
    });
    MIX_KEYS.forEach(key => {
      state[key] = clamp(spec.powertrainMix?.[key] ?? 0, 0, 1);
    });
    state.accent = new THREE.Color(spec.accent);
    return state;
  }

  if (targetSpec) currentState = createState(targetSpec);

  const scratchAccent = new THREE.Color();
  function frameFromState() {
    const frame = {...targetSpec};
    SCALAR_KEYS.forEach(key => { frame[key] = currentState[key]; });
    frame.powertrainMix = {};
    MIX_KEYS.forEach(key => { frame.powertrainMix[key] = currentState[key]; });
    frame.accent = `#${currentState.accent.getHexString()}`;
    return frame;
  }

  function layoutCar(frame) {
    const length = frame.length;
    const topNose = bodyTopAt(frame, 0.993);
    const topTail = bodyTopAt(frame, 0.007);
    const frontAxleX = frame.wheelBase / 2;
    const rearAxleX = -frame.wheelBase / 2;
    const frontT = (length / 2 + frontAxleX) / length;
    const rearT = (length / 2 + rearAxleX) / length;
    const halfFront = bodyHalfWidthAt(frame, frontT);
    const halfRear = bodyHalfWidthAt(frame, rearT);
    const cabinSpan = Math.max(0.001, frame.cabinEnd - frame.cabinStart);
    const {plateauStart, plateauEnd} = roofWindow(frame);
    const signature = `${SCALAR_KEYS.map(key => frame[key].toFixed(3)).join(',')}|${frame.sidePanels}`;
    if (signature === lastSignature) return;
    lastSignature = signature;

    writeHullGeometry(bodyGeometry, frame);

    const sidePanelCount = Math.max(1, Math.min(3, frame.sidePanels));
    sideGlassMeshes.forEach(({mesh, geometry, side}, index) => {
      const panel = index % 3;
      const visible = panel < sidePanelCount;
      mesh.visible = visible;
      if (!visible) return;
      const [t0, t1] = glassPanelRange(frame, panel);
      writeSideGlass(geometry, frame, t0, t1, side);
    });
    const windshieldRange = [plateauEnd, frame.cabinEnd - cabinSpan * 0.02];
    const rearGlassRange = [frame.cabinStart + cabinSpan * 0.02, plateauStart];
    topGlassMeshes.forEach(({geometry}, index) => {
      if (index === 0) writeTopGlass(geometry, frame, rearGlassRange[0], rearGlassRange[1], 0.86, 0.02);
      else writeTopGlass(geometry, frame, windshieldRange[0], windshieldRange[1], 0.84, 0.022);
    });

    wheelWells.forEach(({group, axle, side}) => {
      const radius = axle === 0 ? frame.archFront : frame.archRear;
      const t = axle === 0 ? frontT : rearT;
      const half = bodyHalfWidthAt(frame, t);
      group.position.set(axle === 0 ? frontAxleX : rearAxleX, frame.wheelRadius,
        side * (half - 0.24));
      group.scale.set(radius, radius, 0.5);
    });
    archFlares.forEach(({mesh, axle, side}) => {
      const radius = axle === 0 ? frame.archFront : frame.archRear;
      const t = axle === 0 ? frontT : rearT;
      const half = bodyHalfWidthAt(frame, t);
      mesh.position.set(axle === 0 ? frontAxleX : rearAxleX, frame.wheelRadius,
        side * (half + 0.004 + frame.archFlare * 0.3));
      mesh.scale.set(radius * 1.015, radius * 1.015, 1);
    });
    wheels.forEach(({mesh, axle, side}) => {
      mesh.position.set(axle === 0 ? frontAxleX : rearAxleX, frame.wheelRadius, side * frame.wheelTrack);
      mesh.scale.setScalar(frame.wheelRadius);
      // Spokes, the accent ring and the brake are modelled on the +z face only,
      // so the left-hand wheels are turned around to face outward too.
      mesh.rotation.y = side < 0 ? Math.PI : 0;
    });
    archUniforms.uArchFront.value.set(frontAxleX, frame.wheelRadius, frame.archFront);
    archUniforms.uArchRear.value.set(rearAxleX, frame.wheelRadius, frame.archRear);
    archUniforms.uArchInner.value = frame.archInner;
    archUniforms.uArchRide.value = frame.ride;

    platformRings.scale.setScalar(clamp(length / 4.8, 0.88, 1.1));
    shadowPlane.scale.set(length / 6, frame.width / 2.4, 1);
    contactPlane.scale.set(length * 1.04, frame.width * 1.36, 1);


    const frontHalfZ = upperZAt(frame, plateauEnd - 0.02, frame.belt + 0.06);
    const roofY = frame.belt + frame.cabinHeight;
    const roofCrown = topHalfAt(frame, frame.roofPeak, hullTopAt(frame, frame.roofPeak));
    const frontRoofT = Math.max(frame.cabinStart + 0.04, plateauEnd - 0.03);
    const rearRoofT = Math.min(frame.cabinEnd - 0.04, plateauStart + 0.03);
    const aBase = new THREE.Vector3(-length / 2 + frame.cabinEnd * length, frame.belt + 0.04,
      frontHalfZ * 0.94);
    const aTop = new THREE.Vector3(-length / 2 + frontRoofT * length,
      cabinRoofAt(frame, frontRoofT) - 0.02, roofCrown * 0.86);
    const bBase = new THREE.Vector3(-length / 2 + frame.roofPeak * length, frame.belt + 0.02,
      bodyHalfWidthAt(frame, frame.roofPeak) * 0.99);
    const bTop = new THREE.Vector3(-length / 2 + frame.roofPeak * length, roofY - 0.02, roofCrown * 0.86);
    const railBack = new THREE.Vector3(-length / 2 + rearRoofT * length,
      cabinRoofAt(frame, rearRoofT) - 0.03, roofCrown * 0.82);
    const railFront = new THREE.Vector3(-length / 2 + frontRoofT * length,
      cabinRoofAt(frame, frontRoofT) - 0.03, roofCrown * 0.82);
    const mirrored = point => point.clone().setZ(point.z * -1);
    const beamPairs = [
      [aBase, aTop], [mirrored(aBase), mirrored(aTop)], [bBase, bTop], [mirrored(bBase), mirrored(bTop)],
      [railBack, railFront], [mirrored(railBack), mirrored(railFront)],
    ];
    frameBeams.forEach((beam, index) => {
      orientBeam(THREE, beam, beamPairs[index][0], beamPairs[index][1], index < 4 ? 0.022 : 0.018);
    });

    layoutDetails(frame, {
      length, topNose, topTail, frontAxleX, rearAxleX, halfFront, halfRear,
      cabinSpan, plateauStart, plateauEnd,
    });
    layoutChassis(frame, {length, frontAxleX, rearAxleX});
    layoutPowertrain(frame, {length, frontAxleX, rearAxleX});

    seamPositions.fill(0);
    const seamCount = Math.max(1, Math.min(2, sidePanelCount - 1));
    let seamCursor = 0;
    [1, -1].forEach(side => {
      for (let index = 0; index < seamCount; index += 1) {
        const t = frame.cabinStart + cabinSpan * (0.28 + index * 0.3);
        const half = upperZAt(frame, t, frame.belt - 0.02) + 0.004;
        seamPositions[seamCursor++] = -length / 2 + t * length;
        seamPositions[seamCursor++] = frame.ride + 0.14;
        seamPositions[seamCursor++] = side * half;
        seamPositions[seamCursor++] = -length / 2 + t * length;
        seamPositions[seamCursor++] = frame.belt - 0.015;
        seamPositions[seamCursor++] = side * half;
      }
    });
    seamGeometry.attributes.position.needsUpdate = true;
    seamGeometry.setDrawRange(0, seamCount * 4);
    seamGeometry.computeBoundingSphere();

    beltPositions.fill(0);
    let beltCursor = 0;
    [1, -1].forEach(side => {
      [frame.cabinStart + cabinSpan * 0.06, frame.cabinEnd - cabinSpan * 0.04].forEach(t => {
        beltPositions[beltCursor++] = -length / 2 + t * length;
        beltPositions[beltCursor++] = frame.belt + 0.025;
        beltPositions[beltCursor++] = side * (upperZAt(frame, t, frame.belt + 0.025) + 0.006);
      });
    });
    beltGeometry.attributes.position.needsUpdate = true;
    beltGeometry.computeBoundingSphere();
  }


  function layoutDetails(frame, geo) {
    const {length, topNose, topTail, cabinSpan} = geo;
    const L = length;
    const W = frame.width;
    const noseH = Math.max(0.22, topNose - frame.ride);
    const tailH = Math.max(0.22, topTail - frame.ride);
    // Lamp / grille band measurements are taken from the actual skin at the
    // height they sit at, so the fascia never floats outside the nose or tail.
    const faceHalf = skinHalfAt(frame, 0.998, frame.ride + noseH * 0.60);
    const grilleHalf = faceHalf * 0.40;
    const lampHalf = faceHalf * 0.152;
    const lampZ = faceHalf * 0.715;
    const lampH = noseH * 0.105;
    const lampY = frame.ride + noseH * 0.575;
    const rearFaceHalf = skinHalfAt(frame, 0.002, frame.ride + tailH * 0.60);
    const tailLampZ = rearFaceHalf * 0.60;
    const tailLampH = tailH * 0.20;
    const tailLampY = frame.ride + tailH * 0.60;
    const noseBumperHalf = skinHalfAt(frame, 0.993, frame.ride + noseH * 0.292);
    const tailBumperHalf = skinHalfAt(frame, 0.007, frame.ride + tailH * 0.292);
    // The lip / diffuser sit lower than the bumpers, where the skin has already
    // tapered in — measure there so neither part pokes out of the body.
    const noseLowHalf = Math.min(noseBumperHalf, skinHalfAt(frame, 0.99, frame.ride + noseH * 0.052));
    const tailLowHalf = Math.min(tailBumperHalf, skinHalfAt(frame, 0.01, frame.ride + tailH * 0.10));

    // Chrome surround sits behind the dark grille so a bright lip frames it.
    detail.grilleSurround.position.set(L / 2 + 0.005, frame.ride + noseH * 0.578, 0);
    detail.grilleSurround.scale.set(0.020, noseH * 0.205, grilleHalf * 2.14);
    detail.grille.position.set(L / 2 + 0.012, frame.ride + noseH * 0.578, 0);
    detail.grille.scale.set(0.020, noseH * 0.168, grilleHalf * 1.90);
    detail.grilleSlats.forEach((mesh, index) => {
      mesh.position.set(L / 2 + 0.020, frame.ride + noseH * (0.512 + index * 0.031), 0);
      mesh.scale.set(0.010, 0.008, grilleHalf * 1.70);
    });
    detail.headlights.forEach((mesh, index) => {
      mesh.position.set(L / 2 + 0.017, lampY, (index === 0 ? 1 : -1) * lampZ);
      mesh.scale.set(0.020, lampH, lampHalf * 2);
    });
    detail.headlightHousings.forEach((mesh, index) => {
      mesh.position.set(L / 2 + 0.004, lampY, (index === 0 ? 1 : -1) * lampZ);
      mesh.scale.set(0.018, lampH * 1.16, lampHalf * 2.12);
    });
    detail.drls.forEach((mesh, index) => {
      mesh.position.set(L / 2 + 0.019, lampY - lampH * 0.92, (index === 0 ? 1 : -1) * lampZ);
      mesh.scale.set(0.010, 0.010, lampHalf * 1.72);
    });
    detail.lowerIntake.position.set(L / 2 + 0.003, frame.ride + noseH * 0.135, 0);
    detail.lowerIntake.scale.set(0.016, noseH * 0.055, noseLowHalf * 1.62);
    detail.splitter.position.set(L / 2 - 0.062, frame.ride + noseH * 0.052, 0);
    detail.splitter.scale.set(0.15, 0.030, noseLowHalf * 1.90);
    detail.frontBumper.position.set(L / 2 + 0.005, frame.ride + noseH * 0.292, 0);
    detail.frontBumper.scale.set(0.050, noseH * 0.076, noseBumperHalf * 1.96);
    detail.frontBadge.position.set(L / 2 + 0.026, frame.ride + noseH * 0.578, 0);
    detail.frontBadge.scale.set(0.012, 0.038, 0.050);

    detail.tailBar.position.set(-L / 2 - 0.004, tailLampY, 0);
    detail.tailBar.scale.set(0.014, tailH * 0.075, rearFaceHalf * 0.98);
    detail.tailLights.forEach((mesh, index) => {
      mesh.position.set(-L / 2 - 0.010, tailLampY, (index === 0 ? 1 : -1) * tailLampZ);
      mesh.scale.set(0.018, tailLampH, rearFaceHalf * 0.32);
    });
    detail.tailLightHousings.forEach((mesh, index) => {
      mesh.position.set(-L / 2 - 0.003, tailLampY, (index === 0 ? 1 : -1) * tailLampZ);
      mesh.scale.set(0.016, tailLampH * 1.055, rearFaceHalf * 0.33);
    });
    detail.diffuser.position.set(-L / 2 + 0.06, frame.ride + tailH * 0.10, 0);
    detail.diffuser.scale.set(0.15, 0.05, tailLowHalf * 1.90);
    detail.diffuserFins.forEach((mesh, index) => {
      mesh.position.set(-L / 2 + 0.035, frame.ride + tailH * 0.058, (index - 1) * tailLowHalf * 0.56);
      mesh.scale.set(0.10, 0.016, 0.016);
    });
    detail.rearBumper.position.set(-L / 2 - 0.005, frame.ride + tailH * 0.292, 0);
    detail.rearBumper.scale.set(0.050, tailH * 0.078, tailBumperHalf * 1.96);
    detail.plate.position.set(-L / 2 - 0.004, frame.ride + tailH * 0.375, 0);
    detail.plate.scale.set(0.006, 0.085, 0.30);
    detail.rearBadge.position.set(-L / 2 - 0.01, frame.belt - 0.12, 0);
    detail.rearBadge.scale.set(0.008, 0.035, 0.045);

    const deckSpoiler = frame.bodyStyle === 'deck';
    detail.deckSpoiler.visible = deckSpoiler;
    if (deckSpoiler) {
      detail.deckSpoiler.position.set(-L / 2 + 0.055, topTail + 0.02, 0);
      detail.deckSpoiler.scale.set(0.09, 0.018, W * 0.68);
    }
    const roofSpoiler = frame.bodyStyle === 'roof';
    detail.roofSpoiler.visible = roofSpoiler;
    if (roofSpoiler) {
      detail.roofSpoiler.position.set(-L / 2 + frame.cabinStart * L,
        frame.belt + frame.cabinHeight * 0.93, 0);
      detail.roofSpoiler.scale.set(0.13, 0.022, W * 0.52);
    }
    detail.exhausts.forEach((mesh, index) => {
      mesh.position.set(-L / 2 - 0.02, frame.ride + 0.035, (index === 0 ? 1 : -1) * W * 0.22);
      mesh.scale.set(0.12, 0.035, 0.035);
    });

    const mirrorT = frame.cabinEnd - 0.045;
    const mirrorX = -L / 2 + mirrorT * L;
    const mirrorBaseZ = upperZAt(frame, mirrorT, frame.belt + 0.03);
    detail.mirrors.forEach((mesh, index) => {
      const side = index === 0 ? 1 : -1;
      mesh.position.set(mirrorX, frame.belt + 0.07, side * (mirrorBaseZ + 0.06));
      mesh.scale.set(0.085, 0.042, 0.055);
    });
    detail.mirrorStalks.forEach((mesh, index) => {
      const side = index === 0 ? 1 : -1;
      mesh.position.set(mirrorX - 0.018, frame.belt + 0.042, side * (mirrorBaseZ + 0.028));
      mesh.scale.set(0.055, 0.02, 0.045);
    });
    const handleTs = [frame.cabinStart + cabinSpan * 0.28, frame.cabinStart + cabinSpan * 0.68];
    detail.handles.forEach((mesh, index) => {
      const side = index < 2 ? 1 : -1;
      const t = handleTs[index % 2];
      const y = frame.belt - 0.09;
      mesh.position.set(-L / 2 + t * L, y, side * (upperZAt(frame, t, y) + 0.008));
      mesh.scale.set(0.11, 0.022, 0.014);
    });
    const sillHalf = skinHalfAt(frame, 0.5, frame.ride + 0.06);
    const skirtHalf = skinHalfAt(frame, 0.5, frame.ride + 0.105);
    const claddingHalf = skinHalfAt(frame, 0.5, frame.ride + 0.13);
    detail.rockers.forEach((mesh, index) => {
      const side = index === 0 ? 1 : -1;
      mesh.position.set(0, frame.ride + 0.06, side * sillHalf * 0.98);
      mesh.scale.set(frame.wheelBase * 0.92, 0.05, 0.045);
    });
    detail.skirts.forEach((mesh, index) => {
      const side = index === 0 ? 1 : -1;
      mesh.position.set(0, frame.ride + 0.105, side * skirtHalf * 1.002);
      mesh.scale.set(frame.wheelBase * 0.74, 0.009, 0.010);
    });
    const railsOn = frame.roofRail > 0.15;
    detail.roofRails.forEach((mesh, index) => {
      mesh.visible = railsOn;
      if (!railsOn) return;
      const t0 = frame.cabinStart + cabinSpan * 0.10;
      const t1 = frame.cabinStart + cabinSpan * 0.90;
      const t = (t0 + t1) / 2;
      const side = index === 0 ? 1 : -1;
      mesh.position.set(-L / 2 + t * L, cabinRoofAt(frame, t) + 0.024,
        side * topHalfAt(frame, t, hullTopAt(frame, t)) * 0.72);
      mesh.scale.set((t1 - t0) * L * 0.92, 0.022, 0.03);
    });
    const claddingOn = frame.cladding > 0.05;
    detail.cladding.forEach((mesh, index) => {
      mesh.visible = claddingOn;
      if (!claddingOn) return;
      const side = index === 0 ? 1 : -1;
      mesh.position.set(0, frame.ride + 0.13, side * claddingHalf * 1.01);
      mesh.scale.set(frame.wheelBase * 0.96, 0.10, 0.05);
    });


    const chargeT = clamp(frame.cabinStart * 0.45, 0.06, 0.26);
    const chargeX = -L / 2 + chargeT * L;
    const chargeY = frame.belt - 0.09;
    const chargeZ = upperZAt(frame, chargeT, chargeY) + 0.008;
    detail.chargeFlap.position.set(chargeX, chargeY, chargeZ);
    detail.chargeFlap.scale.set(0.13, 0.09, 0.014);
    detail.chargeDot.position.set(chargeX, chargeY, chargeZ + 0.006);
    detail.chargeDot.scale.set(0.035, 0.035, 0.01);

    const bedOn = frame.bedFactor > 0.5;
    detail.bedWalls.forEach(mesh => { mesh.visible = bedOn; });
    detail.bedFloor.visible = bedOn;
    detail.bedGate.visible = bedOn;
    detail.bedRails.forEach(mesh => { mesh.visible = bedOn; });
    if (bedOn) {
      const bedStart = -L / 2 + 0.055;
      const bedEnd = -L / 2 + frame.cabinStart * L - 0.06;
      const bedLength = Math.max(0.25, bedEnd - bedStart);
      const bedCentre = (bedStart + bedEnd) / 2;
      const bedY = frame.belt + 0.13;
      detail.bedWalls.forEach((mesh, index) => {
        const side = index === 0 ? 1 : -1;
        mesh.position.set(bedCentre, bedY, side * W * 0.40);
        mesh.scale.set(bedLength, 0.26, 0.055);
      });
      detail.bedFloor.position.set(bedCentre, frame.belt + 0.02, 0);
      detail.bedFloor.scale.set(bedLength, 0.015, W * 0.74);
      detail.bedGate.position.set(-L / 2 + 0.035, bedY, 0);
      detail.bedGate.scale.set(0.05, 0.26, W * 0.78);
      detail.bedRails.forEach((mesh, index) => {
        const side = index === 0 ? 1 : -1;
        mesh.position.set(bedCentre, bedY + 0.14, side * W * 0.40);
        mesh.scale.set(bedLength, 0.02, 0.07);
      });
    }
    detail.duckTail.visible = bedOn;
    if (bedOn) {
      detail.duckTail.position.set(-L / 2 + 0.035, frame.belt + 0.275, 0);
      detail.duckTail.scale.set(0.07, 0.02, W * 0.78);
    }
  }

  function layoutChassis(frame) {
    const length = frame.length;
    underbody.position.set(0, frame.ride - 0.028, 0);
    underbody.scale.set(length * 0.86, 0.045, frame.width * 0.44);
    underRailLeft.position.set(0, frame.ride + 0.012, frame.width * 0.22);
    underRailRight.position.set(0, frame.ride + 0.012, -frame.width * 0.22);
    underRailLeft.scale.set(frame.wheelBase * 0.98, 0.022, 0.03);
    underRailRight.scale.copy(underRailLeft.scale);
    crossMembers.forEach((mesh, index) => {
      mesh.position.set((index - 1) * frame.wheelBase * 0.33, frame.ride - 0.008, 0);
      mesh.scale.set(0.06, 0.025, frame.width * 0.40);
    });
  }

  function layoutPowertrain(frame) {
    const length = frame.length;
    const packX = -length * 0.04;
    batteryPack.position.set(packX, frame.ride + 0.07, 0);
    batteryPack.scale.set(length * 0.40, 0.10, frame.width * 0.60);
    batteryCells.position.set(packX, frame.ride + 0.135, 0);
    batteryCells.scale.set(length * 0.36, 0.028, frame.width * 0.30);
    batteryStrip.position.set(packX, frame.ride + 0.152, 0);
    batteryStrip.scale.set(length * 0.34, 0.008, 0.04);

    const engineX = length * 0.20;
    engineBlock.position.set(engineX, frame.ride + 0.20, 0);
    engineBlock.scale.set(length * 0.15, 0.24, frame.width * 0.28);
    engineCover.position.set(engineX, frame.ride + 0.33, 0);
    engineCover.scale.set(length * 0.12, 0.05, frame.width * 0.24);
    enginePipes.forEach((mesh, index) => {
      mesh.position.set(engineX - 0.12 + index * 0.08, frame.ride + 0.34, frame.width * 0.08);
      mesh.scale.set(0.03, 0.03, frame.width * 0.18);
    });

    fuelTank.position.set(-length * 0.30, frame.ride + 0.11, 0);
    fuelTank.scale.set(length * 0.16, 0.12, frame.width * 0.42);
    exhaustPipe.position.set(-length * 0.04, frame.ride + 0.02, frame.width * 0.24);
    exhaustPipe.scale.set(length * 0.60, 0.028, 0.03);

    motorUnit.position.set(-length * 0.18, frame.ride + 0.14, 0);
    motorUnit.rotation.x = Math.PI / 2;
    motorUnit.scale.set(0.13, length * 0.05, 0.13);
    gearbox.position.set(-length * 0.18, frame.ride + 0.13, frame.width * 0.16);
    gearbox.scale.set(0.32, 0.16, 0.18);
    halfShafts.forEach((mesh, index) => {
      const side = index === 0 ? 1 : -1;
      mesh.position.set(-length * 0.18, frame.ride + 0.13, side * frame.width * 0.26);
      mesh.scale.set(0.045, 0.035, frame.width * 0.30);
    });
  }


  function applyMixVisibility(frame) {
    const mix = frame.powertrainMix;
    const on = value => value > 0.02;
    engineBlock.visible = engineCover.visible = on(mix.engine);
    enginePipes.forEach(mesh => { mesh.visible = on(mix.engine); });
    engineMaterial.opacity = clamp(mix.engine, 0, 1);
    batteryPack.visible = batteryCells.visible = batteryStrip.visible = on(mix.battery);
    batteryMaterial.opacity = clamp(mix.battery, 0, 1);
    fuelTank.visible = on(mix.fuel);
    fuelMaterial.opacity = clamp(mix.fuel, 0, 0.9);
    motorUnit.visible = gearbox.visible = on(mix.motor);
    halfShafts.forEach(mesh => { mesh.visible = on(mix.motor); });
    motorMaterial.opacity = clamp(mix.motor, 0, 1);
    exhaustPipe.visible = on(mix.exhaust);
    detail.exhausts.forEach(mesh => { mesh.visible = on(mix.exhaust); });
    detail.chargeFlap.visible = on(mix.charge);
    detail.chargeDot.visible = on(mix.charge);
    // The dark grille panel and its chrome slats read as a grille on every
    // powertrain — hiding the slats on a neutral build left a black slot.
  }

  function applyPaint(frame, paintAmount) {
    const accent = scratchAccent.set(frame.accent);
    bodyMaterial.color.copy(primerColor).lerp(paintColor, paintAmount);
    bodyMaterial.metalness = lerp(0.16, 0.46, paintAmount);
    bodyMaterial.roughness = lerp(0.72, 0.3, paintAmount);
    bodyMaterial.clearcoat = lerp(0.04, 1, paintAmount);
    bodyMaterial.clearcoatRoughness = lerp(0.62, 0.12, paintAmount);
    bodyMaterial.envMapIntensity = lerp(0.35, 1.15, paintAmount);
    accentMaterial.color.copy(accent);
    accentMaterial.emissive.copy(accent).multiplyScalar(0.32);
    batteryMaterial.color.copy(accent).lerp(batteryTint, 0.5);
    frameMaterials.forEach(material => material.color.copy(accent));
    headlightMaterial.emissiveIntensity = 0.28 + paintAmount * 0.6;
    taillightMaterial.emissiveIntensity = 0.24 + paintAmount * 0.55;
    scanMaterial.color.copy(accent);
    cabinFrameMaterial.color.copy(accent);
    host.style.setProperty('--car-accent', frame.accent);
  }

  function layoutAssembly(frame, progress) {
    const wheelsIn = easeOutCubic(progress / 0.14);
    const chassisIn = easeOutCubic((progress - 0.02) / 0.20);
    const powerIn = easeOutCubic((progress - 0.22) / 0.24);
    const frameIn = easeOutCubic((progress - 0.26) / 0.22);
    const bodyPrint = smoothstep((progress - 0.50) / 0.30);
    const glassIn = easeOutCubic((progress - 0.66) / 0.14);
    const detailIn = easeOutCubic((progress - 0.78) / 0.08);
    const paintIn = easeOutCubic((progress - 0.82) / 0.18);
    const finished = clamp((progress - 0.96) / 0.04, 0, 1);

    wheelAnchor.visible = wheelsIn > 0.002;
    wheelAnchor.position.y = (1 - wheelsIn) * 0.55;
    chassisGroup.visible = chassisIn > 0.002;
    chassisGroup.position.y = -(1 - chassisIn) * 0.32;
    powertrainGroup.visible = powerIn > 0.002;
    powertrainGroup.position.y = -(1 - powerIn) * 0.10;
    frameGroup.visible = frameIn > 0.002 && bodyPrint < 0.98;
    frameGroup.position.y = 0;
    frameMaterials.forEach(material => {
      material.opacity = 0.55 * frameIn * (1 - clamp(bodyPrint / 0.9, 0, 1));
    });
    bodyGroup.visible = bodyPrint > 0.001;
    const printedIndices = Math.floor(bodyGeometry.userData.sideIndexCount * bodyPrint);
    const rearCap = bodyGeometry.userData.rearCapIndexCount;
    const frontCap = bodyGeometry.userData.frontCapIndexCount;
    // Rear panel is sealed from the first printed ring; the nose closes once the
    // sweep reaches the front, so the body is never left open at either end.
    const closedFront = bodyPrint > 0.985 ? frontCap : 0;
    bodyGeometry.setDrawRange(0, printedIndices > 5 ? rearCap + printedIndices + closedFront : 0);
    glassGroup.visible = bodyPrint > 0.03 && glassIn > 0.01;
    glassMaterial.opacity = 0.1 + glassIn * 0.72;
    detailGroup.visible = detailIn > 0.005;
    detailGroup.position.y = 0;

    if (bodyPrint > 0.01 && bodyPrint < 0.99) {
      scanRing.visible = true;
      scanRing.position.set(-frame.length / 2 + bodyPrint * frame.length,
        frame.height * 0.46, 0);
      scanRing.scale.setScalar(frame.height * 1.28);
      scanMaterial.opacity = Math.sin(Math.PI * bodyPrint) * 0.55;
    } else {
      scanRing.visible = false;
    }

    applyPaint(frame, paintIn);
    host.dataset.assembly = progress.toFixed(3);
    host.dataset.assemblyStage = progress >= 0.999 ? 'ready'
      : progress > 0.8 ? 'paint'
        : progress > 0.6 ? 'body'
          : progress > 0.3 ? 'powertrain'
            : progress > 0.05 ? 'chassis' : 'preparing';
    host.dataset.finished = finished > 0.5 ? 'true' : 'false';
  }

  function activeFrame() {
    return (glbFit && glbStatus === 'ready') ? glbFit : targetSpec;
  }

  function frameDistance(frame) {
    const halfSize = Math.max(frame.length * 0.52, frame.width * 0.82);
    const vertical = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
    const horizontal = vertical * Math.max(0.5, camera.aspect);
    return clamp((halfSize / Math.max(0.18, Math.min(vertical, horizontal))) * 1.03, 5.4, 13.5);
  }

  function resetView() {
    const frame = activeFrame();
    if (!frame) return;
    controls.target.set(0, frame.height * 0.44, 0);
    const direction = new THREE.Vector3(0.82, 0.34, 0.84).normalize();
    camera.position.copy(controls.target).addScaledVector(direction, frameDistance(frame));
    camera.lookAt(controls.target);
    controls.minDistance = clamp(frame.length * 0.58, 2.6, 4.2);
    controls.maxDistance = frameDistance(frame) * 2.0;
    controls.update();
    cameraPlaced = true;
    userAdjusted = false;
    controls.autoRotate = !reduceMotion && !(externalAssembly !== null && externalAssembly < 0.97);
    host.dataset.cameraDistance = camera.position.distanceTo(controls.target).toFixed(2);
  }

  function applyGlbCameraFit() {
    if (!targetSpec || !glbFit) return;
    if (!userAdjusted) {
      resetView();
      return;
    }
    // Keep the user's orbit direction and zoom; only lift the pivot to the new model's
    // centre so a taller SUV is not cropped after switching bodies.
    const target = new THREE.Vector3(0, glbFit.height * 0.44, 0);
    const offset = camera.position.clone().sub(controls.target);
    controls.target.copy(target);
    camera.position.copy(target).add(offset);
    controls.minDistance = clamp(glbFit.length * 0.58, 2.6, 4.2);
    controls.maxDistance = frameDistance(glbFit) * 2.0;
    controls.update();
    host.dataset.cameraDistance = camera.position.distanceTo(controls.target).toFixed(2);
  }

  function onUserStart() {
    userAdjusted = true;
    controls.autoRotate = false;
    host.dataset.userOrbit = 'true';
  }
  controls.addEventListener('start', onUserStart);

  function resize() {
    const rect = parent.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width || 1));
    const height = Math.max(1, Math.floor(rect.height || 1));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (targetSpec && !userAdjusted) resetView();
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(parent);
  resize();


  function setSpec(nextSpec) {
    if (!nextSpec) return;
    const bodyChanged = lastBodyKey !== nextSpec.bodyKey;
    targetSpec = nextSpec;
    if (!currentState) currentState = createState(nextSpec);
    host.dataset.body = nextSpec.bodyKey;
    host.dataset.bodyLabel = nextSpec.bodyLabel;
    host.dataset.powertrain = nextSpec.powertrain;
    host.dataset.seats = String(nextSpec.seats);
    host.dataset.range = String(nextSpec.range);
    host.dataset.space = String(nextSpec.space);
    if (bodyChanged) {
      lastBodyKey = nextSpec.bodyKey;
      // Resolve the new body before re-framing so the camera uses the procedural preset
      // until a GLB fit is available.
      ensureGlb();
      if (!userAdjusted) resetView();
    } else if (glbPrepared && glbStatus === 'ready' && glbAccent !== nextSpec.accent) {
      glbAccent = nextSpec.accent;
      applyGlbFinish(THREE, glbPrepared, nextSpec.accent);
    }
  }

  const clock = new THREE.Clock();
  let animationFrame = 0;
  let firstFrame = true;
  let progress = 0;

  function animate() {
    if (disposed) return;
    animationFrame = requestAnimationFrame(animate);
    const delta = Math.min(0.05, clock.getDelta());
    const elapsed = clock.elapsedTime;

    if (assemblyRef && typeof assemblyRef.current === 'number') {
      externalAssembly = reduceMotion ? 1 : clamp(assemblyRef.current, 0, 1);
    } else {
      externalAssembly = null;
    }
    if (reduceMotion) {
      progress = 1;
    } else if (externalAssembly !== null) {
      progress = externalAssembly;
    } else {
      if (assemblyStart === null) assemblyStart = elapsed;
      progress = clamp((elapsed - assemblyStart) / 2.5, 0, 1);
    }

    if (targetSpec && currentState) {
      if (reduceMotion) {
        SCALAR_KEYS.forEach(key => { currentState[key] = Number(targetSpec[key]) || 0; });
        MIX_KEYS.forEach(key => { currentState[key] = clamp(targetSpec.powertrainMix?.[key] ?? 0, 0, 1); });
        currentState.accent.set(targetSpec.accent);
      } else {
        SCALAR_KEYS.forEach(key => {
          currentState[key] = damp(currentState[key], Number(targetSpec[key]) || 0, 6.5, delta);
        });
        MIX_KEYS.forEach(key => {
          currentState[key] = damp(currentState[key], clamp(targetSpec.powertrainMix?.[key] ?? 0, 0, 1), 5, delta);
        });
        currentState.accent.lerp(scratchAccent.set(targetSpec.accent), 1 - Math.exp(-5 * delta));
      }
      const frame = frameFromState();
      layoutCar(frame);
      applyMixVisibility(frame);
      layoutAssembly(frame, progress);
      applyGlbReveal(progress);
      if (!cameraPlaced) resetView();
    }

    if (!reduceMotion) {
      platformRings.rotation.y += delta * 0.06;
      car.position.y = Math.sin(elapsed * 0.7) * 0.0035;
    } else {
      platformRings.rotation.y = 0;
      car.position.y = 0;
    }
    controls.update();
    renderer.render(scene, camera);
    if (firstFrame) {
      firstFrame = false;
      host.dataset.webgl = 'ready';
      if (typeof options.onFirstFrame === 'function') options.onFirstFrame();
    }
  }

  function setReducedMotion(next) {
    reduceMotion = Boolean(next);
    controls.autoRotate = !reduceMotion && !userAdjusted;
    host.dataset.reducedMotion = reduceMotion ? 'true' : 'false';
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    glbRequest += 1;
    disposePreparedGlb();
    cancelAnimationFrame(animationFrame);
    resizeObserver.disconnect();
    controls.removeEventListener('start', onUserStart);
    controls.dispose();
    scene.traverse(object => {
      if (object.geometry) object.geometry.dispose();
      if (object.material) {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach(material => material.dispose());
      }
    });
    envRenderTarget.dispose();
    shadowTexture.dispose();
    contactTexture.dispose();
    renderer.dispose();
    if (renderer.domElement.parentElement === host) host.removeChild(renderer.domElement);
  }

  if (targetSpec) setSpec(targetSpec);
  host.dataset.webgl = 'starting';
  resize();
  animate();

  return {
    setSpec,
    setReducedMotion,
    resetView,
    dispose,
    getModelStatus: () => ({
      status: glbStatus,
      bodyKey: glbKey,
      triangles: glbPrepared?.triangles || 0,
      loadMs: Number(host.dataset.modelLoadMs || 0),
      source: glbStatus === 'ready' && glbPrepared ? 'glb' : 'procedural',
    }),
  };
}


function canUseWebGL() {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(
      window.WebGLRenderingContext
      && (canvas.getContext('webgl2') || canvas.getContext('webgl')),
    );
  } catch (error) {
    return false;
  }
}

function prefersReducedMotion() {
  return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

export default function IdealCar3D({
  dna = null,
  initialSpec = null,
  className = '',
  variant = 'studio',
  assemblyProgress = null,
  onReady = null,
  onModelStatus = null,
}) {
  const spec = useMemo(() => initialSpec || buildCarSpec(dna), [dna, initialSpec]);
  const hostRef = useRef(null);
  const apiRef = useRef(null);
  const specRef = useRef(spec);
  const onReadyRef = useRef(onReady);
  const onModelStatusRef = useRef(onModelStatus);
  const notifiedRef = useRef(false);
  const numberProgressRef = useRef(typeof assemblyProgress === 'number' ? assemblyProgress : null);
  const [status, setStatus] = useState('loading');
  const [statusMessage, setStatusMessage] = useState('Preparing the WebGL concept preview...');
  const [modelInfo, setModelInfo] = useState(() => {
    const model = modelForBody(spec.bodyKey);
    return {
      status: model ? 'loading' : 'procedural',
      bodyKey: spec.bodyKey,
      label: model?.label || spec.bodyLabel,
      title: model?.title || null,
      license: model?.license || 'Original project code',
      message: model ? `Loading the ${model.label} concept exterior…` : '',
      loadMs: 0,
      triangles: model?.triangles || 0,
    };
  });

  specRef.current = spec;
  onReadyRef.current = onReady;
  onModelStatusRef.current = onModelStatus;
  if (typeof assemblyProgress === 'number') numberProgressRef.current = assemblyProgress;
  const externalProgress = (assemblyProgress && typeof assemblyProgress === 'object')
    ? assemblyProgress
    : numberProgressRef;

  useEffect(() => {
    if (apiRef.current) apiRef.current.setSpec(spec);
  }, [spec]);

  useEffect(() => {
    if (status !== 'ready' && status !== 'fallback') return;
    if (notifiedRef.current) return;
    notifiedRef.current = true;
    if (typeof onReadyRef.current === 'function') onReadyRef.current();
  }, [status]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    let cancelled = false;

    if (!canUseWebGL()) {
      setStatus('fallback');
      setStatusMessage('WebGL is unavailable in this browser, so a static concept silhouette is shown.');
      return undefined;
    }

    const start = async () => {
      try {
        const [THREE, orbitModule, gltfModule] = await Promise.all([
          import('three'),
          import('three/addons/controls/OrbitControls.js'),
          import('three/addons/loaders/GLTFLoader.js'),
        ]);
        if (cancelled) return;
        const api = createCarScene(THREE, orbitModule.OrbitControls, gltfModule.GLTFLoader, host, {
          initialSpec: specRef.current,
          reducedMotion: prefersReducedMotion(),
          assemblyProgress: externalProgress,
          onFirstFrame: () => {
            if (cancelled) return;
            host.dataset.webgl = 'ready';
            setStatus('ready');
          },
          onModelStatus: info => {
            if (cancelled) return;
            setModelInfo(info);
            if (typeof onModelStatusRef.current === 'function') onModelStatusRef.current(info);
          },
        });
        apiRef.current = api;
      } catch (error) {
        if (cancelled) return;
        console.error('IdealCar3D failed to start', error);
        setStatus('fallback');
        setStatusMessage(`The 3D preview could not start (${error?.message || String(error)}). A static concept silhouette is shown instead.`);
      }
    };

    start();

    return () => {
      cancelled = true;
      if (apiRef.current) {
        apiRef.current.dispose();
        apiRef.current = null;
      }
    };
    // The scene is created once. DNA edits are pushed through the separate effect above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const listener = event => apiRef.current?.setReducedMotion(event.matches);
    if (query.addEventListener) query.addEventListener('change', listener);
    else if (query.addListener) query.addListener(listener);
    return () => {
      if (query.removeEventListener) query.removeEventListener('change', listener);
      else if (query.removeListener) query.removeListener(listener);
    };
  }, []);


  const isReady = status === 'ready';
  const isGeneration = variant === 'generation';
  const modelReady = modelInfo.status === 'ready';
  const modelChipLabel = modelReady
    ? 'GLB exterior'
    : modelInfo.status === 'loading'
      ? 'Loading GLB'
      : modelInfo.status === 'failed'
        ? 'Procedural fallback'
        : 'Procedural body';

  return <div className={`ideal-car3d is-${status} is-${variant} ${className}`.trim()} role="group"
    data-body-key={spec.bodyKey} data-powertrain={spec.powertrain} data-seats={spec.seats}
    data-range={spec.range} data-space={spec.space}
    data-assembly-mode={isGeneration ? 'external' : 'internal'} data-webgl-status={status}
    data-model-status={modelInfo.status} data-model-key={modelInfo.bodyKey || ''}
    aria-label="Interactive concept car preview. Drag to orbit and scroll or pinch to zoom.">
    <div ref={hostRef} className="car3d-host" />
    <div className={`car3d-fallback ${isReady ? 'is-hidden' : ''}`}
      aria-hidden={isReady ? 'true' : undefined}>
      <CarSilhouette spec={spec}/>
    </div>
    <div className="car3d-topline">
      <span className="car3d-live"><i aria-hidden="true"/> {isReady
        ? (isGeneration ? 'Drag to orbit' : modelReady ? 'Live GLB concept' : 'Live WebGL concept')
        : 'Concept preview'}</span>
      <span className={`car3d-model-chip is-${modelInfo.status}`}
        title={modelInfo.status === 'ready'
          ? `${modelInfo.title || modelInfo.label} — ${modelInfo.license}`
          : modelInfo.message || 'Procedural concept geometry'}>{modelChipLabel}</span>
      <button type="button" className="car3d-reset" onClick={() => apiRef.current?.resetView()}
        aria-label="Reset the 3D camera view">Reset view</button>
    </div>
    {!isGeneration && <div className="car3d-bottom">
      <div className="car3d-hud">
        <span>{spec.bodyLabel}</span>
        <span>{spec.seats} seats</span>
        <span>{spec.spaceLabel} space</span>
        <span>{spec.range} mi target</span>
        <span>{spec.powertrainLabel}</span>
      </div>
      <div className="car3d-readout">
        <span>{spec.powertrainStorage}</span>
        <span>{spec.seats >= 7 ? 'Long cabin mapping' : 'Balanced cabin mapping'}</span>
        <span>{spec.energyScale >= 0.72 ? 'Extended energy volume' : 'Compact energy volume'}</span>
      </div>
      <p className="car3d-note">
        {modelReady
          ? `Concept exterior: fixed ${modelInfo.label} GLB (${modelInfo.license}). Body proportions are not derived from DNA; seats, range, space and powertrain remain separate targets.`
          : 'Procedural concept study: body proportions follow your DNA. Capacity, packaging and engineering dimensions are not modelled.'}
        {isReady ? ' Drag to orbit · scroll or pinch to zoom.' : ''}
      </p>
    </div>}
    {isGeneration && isReady && <div className="car3d-generation-readout">
      <span>{spec.bodyLabel}</span>
      <span>{spec.seats} seats</span>
      <span>{spec.range} mi target</span>
      <span>{spec.powertrainLabel}</span>
      <span>{spec.spaceLabel} space</span>
    </div>}
    {status !== 'ready' && <p className="car3d-status" role="status">{statusMessage}</p>}
    {status === 'ready' && modelInfo.status === 'failed' && <p className="car3d-status is-fallback" role="status">{modelInfo.message}</p>}
    {status === 'ready' && modelInfo.status === 'loading' && <p className="car3d-status is-loading" role="status">{modelInfo.message || 'Loading the concept exterior…'}</p>}
  </div>;
}

