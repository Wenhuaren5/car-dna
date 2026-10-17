import {useEffect, useMemo, useState} from 'react';
import IdealCar3D from './IdealCar3D';
import carDatabase from '../data/carDatabase.json';
import {adaptVehicles} from '../algorithms/vehicleAdapter';
import {buildDemandModel} from '../algorithms/userDemandModel';
import {generateIdealDna} from '../algorithms/idealDnaGenerator';
import {
  EDITOR_LIMITS,
  SPACE_LABELS,
  annualEnergyCostForEfficiency,
  createEditableDna,
  efficiencyFieldDefinitions,
  evaluateFeasibility,
  materializeEditableDna,
  validateEditableDna,
} from '../algorithms/editableIdealDna';
import {saveEditableDna} from '../storage/editableDnaStorage';
import {countStrictCandidates} from '../algorithms/vehicleMatcher';

const ADAPTED_VIEWS = adaptVehicles(carDatabase);
const money = value => Number.isFinite(Number(value)) ? `$${Number(value).toLocaleString('en-US', {maximumFractionDigits: 0})}` : 'Unknown';
const integer = value => Number.isFinite(Number(value)) ? Number(value).toLocaleString('en-US', {maximumFractionDigits: 1}) : 'Unknown';
const decimal = value => Number.isFinite(Number(value)) ? Number(value).toLocaleString('en-US', {maximumFractionDigits: 1}) : 'Unknown';

const FEASIBILITY_COPY = {
  'within-market-range': {
    eyebrow: 'Within Market Range',
    title: 'Your ideal sits inside the affordable market',
    note: 'At least one real, within-budget record already meets every soft target.',
  },
  aspirational: {
    eyebrow: 'Aspirational',
    title: 'Some targets reach beyond today\'s affordable market',
    note: 'You can keep them. Matching will return the closest feasible real cars and show the trade-off.',
  },
  'no-strict-match': {
    eyebrow: 'No Strict Matches',
    title: 'Only budget-conditional cars remain',
    note: 'Conditional price bands are shown separately. They never enter the Strict Top 3.',
  },
  'no-known-match': {
    eyebrow: 'No Known Match',
    title: 'The hard constraints leave no usable car',
    note: 'This is a hard-constraint result, not a soft-target preference. No vehicle is invented.',
  },
};

function RangeField({id, label, value, min, max, step, onChange, format, help, error, endpoints = []}) {
  const numeric = Number(value);
  const safe = Number.isFinite(numeric) ? Math.min(max, Math.max(min, numeric)) : min;
  const decimals = (String(step).split('.')[1] || '').length;
  const snapped = Number((min + Math.round((safe - min) / step) * step).toFixed(Math.min(6, decimals)));
  return <label className={`editor-field ${error ? 'has-error' : ''}`} htmlFor={id}>
    <span className="field-head"><span>{label}</span><output>{format ? format(snapped) : snapped}</output></span>
    <input
      id={id}
      type="range"
      min={min}
      max={max}
      step={step}
      value={snapped}
      aria-invalid={error ? 'true' : 'false'}
      onChange={event => onChange(Number(event.target.value))}
    />
    {endpoints.length === 2 && <span className="field-scale"><small>{endpoints[0]}</small><small>{endpoints[1]}</small></span>}
    {help && <details className="field-help"><summary>How this is derived</summary><p>{help}</p></details>}
    {error && <em>{error}</em>}
  </label>;
}

function SelectField({id, label, value, onChange, children, help, error}) {
  return <label className={`editor-field ${error ? 'has-error' : ''}`} htmlFor={id}>
    <span className="field-head"><span>{label}</span></span>
    <select id={id} value={value} aria-invalid={error ? 'true' : 'false'} onChange={event => onChange(event.target.value)}>
      {children}
    </select>
    {help && <details className="field-help"><summary>How this is used</summary><p>{help}</p></details>}
    {error && <em>{error}</em>}
  </label>;
}

export default function IdealDnaBuilder({profile, initialEditable = null, onConfirm, onBack, onEditAnswers}) {
  useEffect(() => { window.scrollTo({top: 0, left: 0}); }, []);
  const prepared = useMemo(() => {
    try {
      const demand = buildDemandModel(profile);
      const generatedDna = generateIdealDna(demand, ADAPTED_VIEWS);
      const generatedEditable = createEditableDna(generatedDna, {profile, demand, views: ADAPTED_VIEWS});
      return {demand, generatedDna, generatedEditable, error: null};
    } catch (error) {
      return {error: error?.message || String(error)};
    }
  }, [JSON.stringify(profile)]);

  const initial = useMemo(() => {
    if (prepared.error) return null;
    if (initialEditable) {
      const checked = validateEditableDna(initialEditable, {
        profile,
        demand: prepared.demand,
        generatedDna: prepared.generatedDna,
      });
      if (checked.ok) return {value: checked.sanitized, restored: true};
    }
    return {value: prepared.generatedEditable, restored: false};
  }, [prepared, initialEditable, JSON.stringify(profile)]);

  const [draft, setDraft] = useState(initial?.value || null);
  useEffect(() => {
    if (initial?.value) setDraft(initial.value);
  }, [initial]);

  const updateValue = (key, value) => setDraft(current => ({
    ...current,
    values: {...current.values, [key]: value},
  }));
  const setPowertrainMode = value => setDraft(current => {
    const allowed = current.hard.allowedPowertrains;
    const reference = value === 'ANY'
      ? (allowed.includes(current.values.efficiencyReference) ? current.values.efficiencyReference : allowed[0])
      : value;
    return {...current, values: {...current.values, powertrainMode: value, efficiencyReference: reference}};
  });
  const setEfficiencyReference = value => setDraft(current => ({
    ...current,
    values: {
      ...current.values,
      efficiencyReference: value,
      powertrainMode: current.values.powertrainMode === 'ANY' ? 'ANY' : value,
    },
  }));

  const validation = validateEditableDna(draft || {}, {
    profile,
    demand: prepared.demand,
    generatedDna: prepared.generatedDna,
  });
  const preview = useMemo(() => {
    if (!draft || !validation.ok) return null;
    try {
      const materialized = materializeEditableDna(prepared.generatedDna, validation.sanitized, {
        profile,
        demand: prepared.demand,
      });
      const feasibility = evaluateFeasibility({
        views: ADAPTED_VIEWS,
        demand: materialized.demand,
        dna: materialized.dna,
        annualMiles: materialized.dna.usage?.annualMiles,
      });
      return {...materialized, feasibility};
    } catch (error) {
      return {error: error?.message || String(error)};
    }
  }, [validation.ok, validation.sanitized, prepared, JSON.stringify(profile)]);

  const allowedBodyTypes = draft?.hard?.allowedBodyTypes || [];
  const bodyCounts = useMemo(() => {
    if (!preview?.demand || preview.error || !allowedBodyTypes.length) return {};
    return Object.fromEntries(allowedBodyTypes.map(bodyStyle => [
      bodyStyle,
      countStrictCandidates({views: ADAPTED_VIEWS, demand: preview.demand, bodyStyle}),
    ]));
  }, [preview, JSON.stringify(allowedBodyTypes)]);

  const changed = Boolean(draft && prepared.generatedEditable)
    && JSON.stringify(draft.values) !== JSON.stringify(prepared.generatedEditable.values);
  const hardBudget = Number(draft?.hard?.budgetCeilingUSD);
  const budgetMax = Number.isFinite(hardBudget) && hardBudget >= EDITOR_LIMITS.budgetUSD.min ? hardBudget : EDITOR_LIMITS.budgetUSD.max;
  const budgetMin = Math.min(EDITOR_LIMITS.budgetUSD.min, budgetMax);
  const budgetStep = budgetMax - budgetMin < 1000 ? 100 : 500;
  const fields = efficiencyFieldDefinitions(draft?.values?.efficiencyReference);
  const annualMiles = prepared.generatedDna?.usage?.annualMiles ?? 12000;
  const annualCost = Number.isFinite(preview?.derived?.annualEnergyCostUSD)
    ? preview.derived.annualEnergyCostUSD
    : draft ? annualEnergyCostForEfficiency(draft.values, {annualMiles, dailyMiles: prepared.generatedDna?.usage?.dailyMiles}) : null;
  const feasibility = preview?.feasibility || null;
  const copy = FEASIBILITY_COPY[feasibility?.status] || FEASIBILITY_COPY.aspirational;
  const errorFor = key => validation.errors?.[key];

  useEffect(() => {
    if (!validation.ok || !changed) return undefined;
    const timer = window.setTimeout(() => {
      saveEditableDna({editable: validation.sanitized, confirmed: false});
    }, 500);
    return () => window.clearTimeout(timer);
  }, [JSON.stringify(draft?.values || null), validation.ok, changed]);

  if (prepared.error) {
    return <main className="builder-page">
      <header className="results-nav"><span className="brand"><i/> CAR DNA</span></header>
      <section className="builder-error" role="alert">
        <p className="eyebrow">DNA EDITOR STOPPED</p>
        <h1>The editable DNA could not be prepared.</h1>
        <p className="lead">No target was invented to replace the missing input.</p>
        <pre>{prepared.error}</pre>
        <button className="secondary" onClick={onBack}>Go back</button>
      </section>
    </main>;
  }
  if (!draft) return null;

  const values = draft.values;
  const allowed = draft.hard.allowedPowertrains;
  const setFinalBodyStyle = value => setDraft(current => ({
    ...current,
    values: {...current.values, finalBodyStyle: value, bodyType: value},
  }));
  const selectedBodyCount = values.finalBodyStyle ? bodyCounts[values.finalBodyStyle] : null;
  const confirm = () => {
    if (!validation.ok || !preview || preview.error) return;
    saveEditableDna({editable: validation.sanitized, confirmed: true});
    onConfirm?.(validation.sanitized);
  };
  const resetDna = () => {
    const fresh = createEditableDna(prepared.generatedDna, {profile, demand: prepared.demand, views: ADAPTED_VIEWS});
    setDraft(fresh);
    saveEditableDna({editable: fresh, confirmed: false});
  };

  return <main className="builder-page">
    <header className="results-nav">
      <span className="brand"><i/> CAR DNA</span>
      <div className="results-nav-actions">
        <button className="text" onClick={onBack}>← Back</button>
        {onEditAnswers && <button className="secondary" onClick={onEditAnswers}>Edit answers</button>}
      </div>
    </header>

    <section className="builder-hero">
      <div className="builder-hero-copy">
        <p className="eyebrow">IDEAL DNA STUDIO</p>
        <h1>Shape the car your life actually needs.</h1>
        <p className="lead">One editable DNA, one live concept. Your questionnaire hard limits stay locked. Move a soft target and the 3D study, feasibility check and the same real-market matcher respond together.</p>
        <div className="builder-chips">
          <span className="dna-chip" data-testid="studio-final-body-chip">Final body: {values.finalBodyStyle}</span>
          <span className="dna-chip">Allowed body styles: {allowedBodyTypes.join(' · ')}</span>
          <span className="dna-chip">Powertrains: {allowed.join(' · ')}</span>
          <span className="dna-chip">{integer(annualMiles)} mi/year</span>
          <span className={`dna-chip feasibility-${feasibility?.status || 'pending'}`}>{feasibility?.statusLabel || 'Checking feasibility'}</span>
          {initial?.restored && <span className="dna-chip">Restored edit</span>}
        </div>
      </div>
      <div className="builder-hero-stat">
        <small>FINAL BODY STYLE · LIVE PREVIEW</small>
        <b data-testid="studio-final-body">{values.finalBodyStyle}</b>
        <p>{values.powertrainMode === 'ANY'
          ? 'The body switches immediately. Other DNA targets stay unchanged, and this choice becomes a hard matcher filter only when you confirm.'
          : `Previewing ${values.finalBodyStyle} with the ${values.powertrainMode} concept. Other DNA targets stay unchanged.`}</p>
      </div>
    </section>

    <section className="studio-preview" aria-labelledby="studio-preview-title">
      <div className="studio-preview-head">
        <div>
          <p className="eyebrow">LIVE 3D CONCEPT</p>
          <h2 id="studio-preview-title">Your Ideal DNA, in three dimensions</h2>
        </div>
        <p>Body, cabin, seats, powertrain and energy volume respond live. This is a design study, not a production specification.</p>
      </div>
      <IdealCar3D dna={draft}/>
    </section>

    <section className="studio-final-body" aria-labelledby="final-body-title">
      <div className="studio-final-body-head">
        <div>
          <p className="eyebrow">FINAL BODY STYLE</p>
          <h2 id="final-body-title">Choose the body you want matched</h2>
          <p>Only the body styles you accepted in the questionnaire appear here. Selecting one updates the 3D preview immediately; it becomes a hard matcher filter when you confirm. Range, efficiency, space and every other DNA target stay unchanged.</p>
        </div>
        <span className="final-body-selected" data-testid="studio-selected-body">
          <small>CURRENT SELECTION</small>
          <b>{values.finalBodyStyle}</b>
          <em>{typeof selectedBodyCount === 'number'
            ? `${selectedBodyCount} strict-budget candidate${selectedBodyCount === 1 ? '' : 's'}`
            : 'Counting strict candidates'}</em>
        </span>
      </div>
      <div className="final-body-grid" role="group" aria-label="Final body style choices">
        {allowedBodyTypes.map(bodyStyle => {
          const selected = values.finalBodyStyle === bodyStyle;
          const count = bodyCounts[bodyStyle];
          const known = typeof count === 'number';
          return <button type="button" key={bodyStyle}
            className={`final-body-card ${selected ? 'selected' : ''} ${known && count === 0 ? 'zero' : ''}`}
            aria-pressed={selected}
            data-final-body-style={bodyStyle}
            data-final-body-count={known ? count : ''}
            onClick={() => setFinalBodyStyle(bodyStyle)}>
            <span className="final-body-card-top">
              <b>{bodyStyle}</b>
              <i aria-hidden="true">{selected ? 'Selected' : 'Preview'}</i>
            </span>
            <strong>{known ? `${count} car${count === 1 ? '' : 's'}` : 'Checking…'}</strong>
            <small>{known ? (count === 0 ? 'No Strict Matches' : 'Strict-budget candidates') : 'Reading the database'}</small>
          </button>;
        })}
      </div>
      <p className="final-body-method">Live counts apply the same hard filters and strict budget rule as the matcher. Conditional price bands are excluded. Switching body does not regenerate the DNA.</p>
      {selectedBodyCount === 0 && <p className="final-body-zero" role="status">
        <b>No Strict Matches for {values.finalBodyStyle}.</b> You can still preview and confirm this body, but the Strict Top 3 will be empty. Budget-conditional cars, if any, appear separately.
      </p>}
    </section>

    <div className="builder-grid">
      <div className="builder-main">
        <section className="editor-section" aria-labelledby="hard-constraints-title">
          <header>
            <p className="eyebrow">HARD CONSTRAINTS</p>
            <h2 id="hard-constraints-title">What cannot move</h2>
            <p>These come from the questionnaire and are enforced before any score is calculated.</p>
          </header>
          <div className="editor-fields two-col">
            <RangeField
              id="budget-ceiling"
              label="Budget ceiling"
              value={values.budgetCeilingUSD}
              min={budgetMin}
              max={budgetMax}
              step={budgetStep}
              onChange={value => updateValue('budgetCeilingUSD', value)}
              format={money}
              endpoints={[money(budgetMin), money(budgetMax)]}
              help={`Questionnaire hard maximum: ${money(hardBudget)}. Lowering it can only narrow the real market.`}
              error={errorFor('budgetCeilingUSD')}
            />
            <SelectField
              id="powertrain-mode"
              label="Powertrain"
              value={values.powertrainMode}
              onChange={setPowertrainMode}
              help={values.powertrainMode === 'ANY'
                ? 'All questionnaire-accepted types remain eligible. The efficiency reference below only chooses units and the shared energy conversion.'
                : `Matching is narrowed to ${values.powertrainMode}; this is a subset of the allowed set, never an excluded type.`}
              error={errorFor('powertrainMode')}
            >
              <option value="ANY">All allowed ({allowed.join(' · ')})</option>
              {allowed.map(powertrain => <option key={powertrain} value={powertrain}>{powertrain}</option>)}
            </SelectField>
            <div className="locked-field">
              <span>Minimum seats</span>
              <b>{draft.hard.minimumSeats} seats</b>
              <small>Hard minimum. The target below cannot go lower.</small>
            </div>
            <div className="locked-field">
              <span>Vehicle condition</span>
              <b>{draft.hard.vehicleCondition}</b>
              <small>Carried from the questionnaire and enforced by the matcher.</small>
            </div>
          </div>
        </section>

        <section className="editor-section" aria-labelledby="soft-targets-title">
          <header>
            <p className="eyebrow">SOFT TARGETS</p>
            <h2 id="soft-targets-title">What can evolve</h2>
            <p>Every change becomes a target in the existing six-axis satisfaction model. The four demand weights are not rewritten.</p>
          </header>
          <div className="editor-fields two-col">
            <div className="locked-field" data-testid="target-seats-locked">
              <span>Target seats</span>
              <b>{values.seats} seats</b>
              <small>Read-only. The questionnaire minimum of {draft.hard.minimumSeats} seats is enforced before scoring, and changing the final body style cannot bypass it.</small>
            </div>
            <div className="locked-field" data-testid="final-body-locked">
              <span>Final body style</span>
              <b>{values.finalBodyStyle}</b>
              <small>Hard matcher filter once confirmed. Change it in the Final Body Style section above; other DNA targets are preserved.</small>
            </div>
            <RangeField
              id="target-range"
              label="Target range"
              value={values.rangeMiles}
              min={EDITOR_LIMITS.rangeMiles.min}
              max={EDITOR_LIMITS.rangeMiles.max}
              step={EDITOR_LIMITS.rangeMiles.step}
              onChange={value => updateValue('rangeMiles', value)}
              format={value => `${integer(value)} mi`}
              endpoints={['50 mi', '600 mi']}
              help="Planning range target, based on recorded vehicle range and your road-trip answers."
              error={errorFor('rangeMiles')}
            />
            <RangeField
              id="refueling-convenience"
              label="Refueling convenience"
              value={values.maxRefuelingStopsPerYear}
              min={EDITOR_LIMITS.maxRefuelingStopsPerYear.min}
              max={EDITOR_LIMITS.maxRefuelingStopsPerYear.max}
              step={1}
              onChange={value => updateValue('maxRefuelingStopsPerYear', value)}
              format={value => `≤ ${value} stops/yr`}
              endpoints={['Fewer stops', 'More stops allowed']}
              help={`At ${integer(annualMiles)} mi/year this implies roughly ${integer(annualMiles / Math.max(1, values.maxRefuelingStopsPerYear))} mi between stops. It affects feasibility and the radar index, not the four weighted scores; local infrastructure remains context only.`}
              error={errorFor('maxRefuelingStopsPerYear')}
            />
          </div>


          <div className="efficiency-block">
            <div className="efficiency-head">
              <div>
                <h3>Target efficiency</h3>
                <p>Units follow the reference powertrain. PHEV keeps electric and gasoline modes separate.</p>
              </div>
              {allowed.length > 1 && values.powertrainMode === 'ANY' && <SelectField
                id="efficiency-reference"
                label="Efficiency reference"
                value={values.efficiencyReference}
                onChange={setEfficiencyReference}
                help="Changes units and the shared annual-energy conversion only."
                error={errorFor('efficiencyReference')}
              >
                {allowed.map(powertrain => <option key={powertrain} value={powertrain}>{powertrain}</option>)}
              </SelectField>}
            </div>
            <div className="editor-fields efficiency-fields">
              {fields.map(field => {
                const limits = field.key === 'mpg'
                  ? EDITOR_LIMITS.mpg
                  : field.key === 'kwhPer100Miles'
                    ? EDITOR_LIMITS.kwhPer100Miles
                    : EDITOR_LIMITS.phevElectricRangeMiles;
                return <RangeField
                  key={field.key}
                  id={`efficiency-${field.key}`}
                  label={`${field.label} · ${field.unit}`}
                  value={values[field.key]}
                  min={limits.min}
                  max={limits.max}
                  step={limits.step}
                  onChange={value => updateValue(field.key, value)}
                  format={value => `${decimal(value)} ${field.unit}`}
                  help={field.direction === 'lower' ? 'Lower consumption is better.' : 'Higher efficiency is better.'}
                  error={errorFor(field.key)}
                />;
              })}
            </div>
            <div className="derived-targets">
              <span><small>Derived annual energy target</small><b>{annualCost === null ? 'Unknown' : `${money(annualCost)}/yr`}</b></span>
              <span><small>Derived emissions target</small><b>{preview?.dna?.targets?.emissionsGramsPerMile?.ideal === null || preview?.dna?.targets?.emissionsGramsPerMile?.ideal === undefined ? 'Unknown' : `${integer(preview.dna.targets.emissionsGramsPerMile.ideal)} g/mi`}</b></span>
              <span><small>Energy conversion</small><b>{values.efficiencyReference} reference</b></span>
            </div>
            {values.efficiencyReference === 'PHEV' && <p className="method-note">PHEV annual cost separates electric miles and gasoline miles with the existing electric-share model. The electric-only range target is explicit above; no gasoline efficiency is shown in kWh/100 mi.</p>}
          </div>

          <div className="editor-fields two-col">
            <RangeField
              id="space-preference"
              label="Space preference"
              value={values.spacePreference}
              min={1}
              max={4}
              step={1}
              onChange={value => updateValue('spacePreference', value)}
              format={value => `${SPACE_LABELS[value]} · rank ${value}/4`}
              endpoints={['Small', 'Extra large']}
              help="Ordinal body-type cargo proxy. Measured cargo volume is missing from every record."
              error={errorFor('spacePreference')}
            />
            <RangeField
              id="environmental-preference"
              label="Environmental preference"
              value={values.environmentalPreference}
              min={0}
              max={100}
              step={1}
              onChange={value => updateValue('environmentalPreference', value)}
              format={value => `${value}/100`}
              endpoints={['Market-acceptable', 'Cleanest observed']}
              help="Interpolates the emissions target between the observed p75 and the cleanest adapted car. It never uses a zero for missing data."
              error={errorFor('environmentalPreference')}
            />
          </div>
        </section>
      </div>


      <aside className="builder-aside">
        <section className={`feasibility-card compact ${feasibility?.status || 'pending'}`} aria-live="polite">
          <div className="feasibility-topline">
            <p className="eyebrow">ESTIMATED FEASIBILITY</p>
            <span className={`feasibility-pill ${feasibility?.status || 'pending'}`}>{feasibility?.statusLabel || 'Checking'}</span>
          </div>
          <h2>{copy.eyebrow}</h2>
          <p>{feasibility?.summary || (validation.ok ? 'Checking the affordable market.' : 'Fix the highlighted values to continue.')}</p>
          {!validation.ok && <ul className="validation-list">{Object.entries(validation.errors).map(([key, message]) => <li key={key}>{message}</li>)}</ul>}
          {feasibility && <>
            <div className="feasibility-counts">
              <span><b>{feasibility.counts.strictCandidates ?? feasibility.counts.strict}</b><small>strict-budget candidates</small></span>
              <span><b>{feasibility.counts.allSoftMet}</b><small>meet every soft target</small></span>
              <span><b>{feasibility.counts.database}</b><small>records checked</small></span>
            </div>
            <p className="feasibility-body-note" data-testid="feasibility-body-note">
              <b>{feasibility.bodyStyle?.finalBodyStyle}</b> · {feasibility.counts.conditional} budget-conditional candidate{feasibility.counts.conditional === 1 ? '' : 's'} excluded from strict counts.
            </p>
            <details className="feasibility-detail">
              <summary>Inspect the {feasibility.checks.length} live target checks</summary>
              <ul className="feasibility-checks">
                {feasibility.checks.map(check => <li key={check.key} className={check.marketStatus}>
                  <span>{check.label}</span>
                  <b>{check.kind === 'hard' ? 'Fixed filter' : `${check.metCount}/${check.total}`}</b>
                  <small>{check.marketStatus === 'aspirational' ? 'Beyond affordable market' : check.marketStatus === 'within' ? 'Within market' : 'Unknown'}</small>
                </li>)}
              </ul>
              {feasibility.status !== 'within-market-range' && feasibility.closest.length > 0 && <div className="closest-cars">
                <small>CLOSEST REAL RECORDS</small>
                {feasibility.closest.map(car => <span key={car.vehicleId}>{car.displayName}<b>{car.met}/{car.total}</b></span>)}
              </div>}
            </details>
          </>}
          <p className="method-note"><b>Budget is always a hard ceiling.</b> It is never the price of this theoretical car. Feasibility is a live database check; it does not change the score.</p>
        </section>

        <section className="builder-actions">
          {selectedBodyCount === 0 && <p className="final-body-zero" role="status" data-testid="confirm-zero-warning">
            <b>No Strict Matches for {values.finalBodyStyle}.</b> Confirming is allowed, but no strict Top 3 car can be shown. You can choose another body or revise your questionnaire limits.
          </p>}
          <button className="primary" onClick={confirm} disabled={!validation.ok || !preview || Boolean(preview?.error)}>
            Find My DNA Matches →
          </button>
          <button className="secondary" onClick={resetDna}>Reset to Generated DNA</button>
          <p>{changed ? 'You have edited the generated DNA or final body style. Confirming will re-score real cars against these targets.' : 'This is the generated DNA. Adjust any soft target or final body style to see feasibility and matching change.'}</p>
        </section>
      </aside>
    </div>
  </main>;
}

