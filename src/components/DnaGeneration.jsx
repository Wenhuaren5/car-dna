import {useEffect, useMemo, useRef, useState} from 'react';
import IdealCar3D, {buildCarSpec} from './IdealCar3D';
import carDatabase from '../data/carDatabase.json';
import {adaptVehicles} from '../algorithms/vehicleAdapter';
import {buildDemandModel} from '../algorithms/userDemandModel';
import {generateIdealDna} from '../algorithms/idealDnaGenerator';
import {createEditableDna} from '../algorithms/editableIdealDna';

/*
 * DnaGeneration - one screen, one clock.
 *
 * The DNA read-out on the left and the 3D assembly on the right are driven by the SAME 0..1
 * progress value. The car scene receives that value through a ref (no per-frame React work),
 * while the decode column samples it ~20 times a second for its labels and meter.
 *
 * The screen is presentation only: the recommendation pipeline is not touched, and the visible
 * targets are the editable DNA the Studio will open with (or the generated DNA when the profile
 * has not been edited yet).
 */

const STAGES = [
  {key: 'constraints', label: 'Reading your hard constraints', detail: 'Budget, seats, condition and accepted powertrains'},
  {key: 'range', label: 'Balancing range and daily routes', detail: 'Road-trip need and observed market range'},
  {key: 'energy', label: 'Modelling energy and emissions', detail: 'Efficiency assumptions applied to every real record'},
  {key: 'space', label: 'Mapping body, cargo and seats', detail: 'Ordinal space proxy from real body types'},
  {key: 'feasibility', label: 'Checking the affordable market', detail: 'No vehicle or price is invented'},
];

const BUILD_STAGES = [
  {at: 0.00, key: 'wheels', label: 'Wheels and platform'},
  {at: 0.12, key: 'chassis', label: 'Chassis and floor'},
  {at: 0.28, key: 'powertrain', label: 'Powertrain layout'},
  {at: 0.46, key: 'frame', label: 'Cabin frame'},
  {at: 0.56, key: 'body', label: 'Body printing'},
  {at: 0.72, key: 'glass', label: 'Glass and seals'},
  {at: 0.82, key: 'details', label: 'Lights, trim and badges'},
  {at: 0.90, key: 'paint', label: 'Paint and finish'},
  {at: 1.00, key: 'ready', label: 'Assembled'},
];

const RUNGS = 11;
const BUILD_MS = 3600;
const HOLD_MS = 2600;
const VIEWS = adaptVehicles(carDatabase);
const clamp01 = value => Math.min(1, Math.max(0, value));
const powertrainLabel = value => Array.isArray(value) && value.length ? value.join(' · ') : 'None selected';

function stageFor(progress) {
  let current = BUILD_STAGES[0];
  for (const stage of BUILD_STAGES) if (progress >= stage.at) current = stage;
  return current;
}

function helixPoint(index, progress) {
  const y = 28 + index * 26;
  const phase = index * 0.72 + progress * Math.PI * 3.2;
  return {y, left: 106 + Math.sin(phase) * 70, right: 106 - Math.sin(phase) * 70};
}

export default function DnaGeneration({profile, editable = null, onDone, onSkip}) {
  const reduced = useMemo(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);
  const [progress, setProgress] = useState(0);
  const [sceneReady, setSceneReady] = useState(false);
  const [ready, setReady] = useState(false);
  const [modelStatus, setModelStatus] = useState(null);
  const assemblyRef = useRef(0);
  const finished = useRef(false);
  const onDoneRef = useRef(onDone);
  const onSkipRef = useRef(onSkip);
  onDoneRef.current = onDone;
  onSkipRef.current = onSkip;

  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    onDoneRef.current?.();
  };
  const skip = () => {
    if (finished.current) return;
    finished.current = true;
    onSkipRef.current?.();
  };

  const previewDna = useMemo(() => {
    if (editable?.values) return editable;
    try {
      const demand = buildDemandModel(profile);
      const generated = generateIdealDna(demand, VIEWS);
      return createEditableDna(generated, {profile, demand, views: VIEWS});
    } catch (error) {
      return null;
    }
    // The profile is a plain form object; the Studio guards its memo the same way.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editable, JSON.stringify(profile)]);
  const spec = useMemo(() => buildCarSpec(previewDna), [previewDna]);

  useEffect(() => { window.scrollTo({top: 0, left: 0}); }, []);

  useEffect(() => {
    if (!sceneReady) return undefined;
    if (reduced) {
      assemblyRef.current = 1;
      setProgress(1);
      setReady(true);
      const timer = window.setTimeout(finish, 700);
      return () => window.clearTimeout(timer);
    }
    let rafId = 0;
    let holdId = 0;
    let lastReport = -1;
    const started = performance.now();
    const step = now => {
      const value = clamp01((now - started) / BUILD_MS);
      assemblyRef.current = value;
      if (value - lastReport >= 0.012 || value >= 1) {
        lastReport = value;
        setProgress(value);
      }
      if (value >= 1) {
        setReady(true);
        holdId = window.setTimeout(finish, HOLD_MS);
        return;
      }
      rafId = window.requestAnimationFrame(step);
    };
    rafId = window.requestAnimationFrame(step);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.clearTimeout(holdId);
    };
    // `finish` only reads refs, so the timeline must not restart when the parent re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneReady, reduced]);

  const percent = Math.round(progress * 100);
  const decodeStage = ready ? STAGES.length : Math.min(STAGES.length - 1, Math.floor(progress * STAGES.length));
  const buildStage = stageFor(progress);
  const lit = Math.round(progress * RUNGS);
  const parameters = [
    ['Budget ceiling', profile?.budget ? `$${Number(profile.budget).toLocaleString()}` : 'Unknown'],
    ['Powertrains accepted', powertrainLabel(profile?.acceptablePowertrains)],
    ['Body styles accepted', Array.isArray(profile?.acceptableBodyTypes) && profile.acceptableBodyTypes.length ? profile.acceptableBodyTypes.join(' · ') : 'Unknown'],
    ['Seat minimum', profile?.minimumSeats ? `${profile.minimumSeats}+ seats` : 'Unknown'],
    ['Annual driving', profile?.totalAnnualMiles !== null && profile?.totalAnnualMiles !== undefined ? `${Number(profile.totalAnnualMiles).toLocaleString()} mi` : 'From your routes'],
    ['Priorities', Array.isArray(profile?.selectedPriorities) && profile.selectedPriorities.length ? profile.selectedPriorities.join(' · ') : 'Balanced'],
    ['Home context', profile?.homeLocation ? 'Local map loaded' : 'Not set'],
  ];
  const targets = [
    ['Body', spec.bodyLabel],
    ['Seats', `${spec.seats} seats`],
    ['Space', spec.spaceLabel],
    ['Range', `${spec.range} mi target`],
    ['Powertrain', spec.powertrain === 'ANY' ? 'Preview mode' : spec.powertrain],
  ];
  const sceneStatus = !sceneReady ? 'Loading the 3D assembly' : ready ? 'Assembly complete' : buildStage.label;
  const glbReady = modelStatus?.status === 'ready';
  const hudStageLabel = glbReady && ['body', 'glass', 'details', 'paint'].includes(buildStage.key)
    ? 'GLB concept reveal'
    : buildStage.label;

  return <main className={`dna-generation ${reduced ? 'reduced-motion' : ''} ${ready ? 'is-ready' : ''}`}
    data-progress={progress.toFixed(3)} data-build-stage={buildStage.key}
    data-scene-ready={sceneReady ? 'true' : 'false'} data-ready={ready ? 'true' : 'false'}
    data-model-status={modelStatus?.status || 'loading'}>
    <header className="results-nav generation-nav">
      <span className="brand"><i/> CAR DNA</span>
      <div className="generation-nav-actions">
        <span className="generation-live" data-testid="generation-status"><i aria-hidden="true"/>{sceneStatus}</span>
        <button className="text" onClick={skip}>Skip Animation →</button>
      </div>
    </header>
    <section className="generation-split" aria-label="DNA decoding and 3D concept-car assembly">
      <div className="generation-decode">
        <div className="generation-decode-scroll">
          <p className="eyebrow">DNA GENERATION</p>
          <h1 aria-live="polite">{ready ? 'Your Ideal Car DNA is ready.' : 'Decoding your answers into a car.'}</h1>
          <p className="lead">{ready
            ? 'The decoded targets already follow your questionnaire, the hard constraints and the real market sample. Open the Studio to fine-tune the soft targets before matching.'
            : 'Watch the same targets that will open in the Studio assemble into a concept car. This sequence is visual only; the recommendation pipeline runs after you enter the editor.'}</p>

          <div className="decode-visual">
            <svg className="decode-helix" viewBox="0 0 212 300" role="img" aria-label="DNA decode sequence">
              <defs>
                <linearGradient id="decode-a" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#b8ff54"/>
                  <stop offset="1" stopColor="#78f0ba"/>
                </linearGradient>
                <linearGradient id="decode-b" x1="1" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#ffb27a"/>
                  <stop offset="1" stopColor="#b8ff54"/>
                </linearGradient>
              </defs>
              <ellipse cx="106" cy="158" rx="100" ry="130" className="decode-halo"/>
              {Array.from({length: RUNGS}, (_, index) => {
                const point = helixPoint(index, progress);
                return <g key={index} className={`decode-rung ${index < lit ? 'is-lit' : ''}`}
                  style={{opacity: index < lit ? 1 : 0.3}}>
                  <line x1={point.left} y1={point.y} x2={point.right} y2={point.y}/>
                  <circle cx={point.left} cy={point.y} r="3.1"/>
                  <circle cx={point.right} cy={point.y} r="3.1"/>
                </g>;
              })}
              {[0, 1].map(strand => <polyline key={strand}
                points={Array.from({length: RUNGS}, (_, index) => {
                  const point = helixPoint(index, progress);
                  return `${strand === 0 ? point.left : point.right},${point.y}`;
                }).join(' ')}
                pathLength="1" strokeDasharray="1" strokeDashoffset={1 - progress}
                stroke={strand === 0 ? 'url(#decode-a)' : 'url(#decode-b)'}
                className={`decode-strand ${strand === 0 ? 'strand-a' : 'strand-b'}`}/>)}
              <line className="decode-scan" x1="14" x2="198" y1={20 + progress * 276} y2={20 + progress * 276}/>
            </svg>
            <span className="decode-helix-tag">Ideal DNA</span>
            <div className="decode-readout">
              <p className="decode-percent">{String(percent).padStart(2, '0')}<small>%</small></p>
              <p className="decode-caption">Sequence encoded</p>
              <div className="decode-side">
                <span><i aria-hidden="true"/> {sceneStatus}</span>
                <span>Step {Math.min(STAGES.length, decodeStage + 1)} of {STAGES.length}</span>
              </div>
            </div>
          </div>

          <div className="generation-progress" role="progressbar" aria-label="DNA generation progress"
            aria-valuemin="0" aria-valuemax="100" aria-valuenow={percent}>
            <span style={{width: `${percent}%`}}/>
          </div>

          <ol className="generation-steps">
            {STAGES.map((item, index) => <li key={item.key}
              className={index < decodeStage ? 'done' : index === decodeStage && !ready ? 'active' : ''}>
              <span className="step-dot">{index < decodeStage ? '✓' : String(index + 1).padStart(2, '0')}</span>
              <div><b>{item.label}</b><small>{item.detail}</small></div>
            </li>)}
          </ol>

          <div className="generated-params" aria-label="Encoded targets">
            {targets.map(([label, value], index) => <span key={label}
              style={{opacity: progress > 0.18 + index * 0.14 ? 1 : 0.3}}>
              <small>{label}</small><b>{value}</b>
            </span>)}
          </div>

        </div>

        <div className="generation-cta">
          {ready
            ? <button className="primary" onClick={finish}>Open DNA Studio →</button>
            : <button className="secondary" onClick={skip}>Skip Animation</button>}
          <span>{ready ? 'Opening automatically…' : 'The editor stays fully editable.'}</span>
        </div>
      </div>

      <div className="generation-vehicle">
        <div className="vehicle-hud">
          <span className="vehicle-hud-live"><i aria-hidden="true"/> {glbReady ? 'GLB concept reveal' : 'Live assembly'}</span>
          <span className="vehicle-hud-stage">{hudStageLabel}</span>
          <span className="vehicle-hud-pct">{percent}%</span>
        </div>
        <IdealCar3D dna={previewDna} variant="generation" assemblyProgress={assemblyRef}
          onReady={() => setSceneReady(true)} onModelStatus={setModelStatus} className="generation-car"/>
        <div className="vehicle-foot">
          <div className="vehicle-rail" aria-hidden="true"><span style={{width: `${percent}%`}}/></div>
          <p>{glbReady
            ? `Concept reveal: fixed ${modelStatus.label} exterior (${modelStatus.license}). Chassis and energy phases are illustrative; DNA targets are not baked into the model.`
            : 'Procedural assembly study driven by the decoded DNA. Real dimensions, capacity and performance are not modelled.'}</p>
        </div>
      </div>
    </section>

    <details className="generation-parameters">
      <summary>Inputs used for this decode</summary>
      <dl>
        {parameters.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>
    </details>
  </main>;
}

