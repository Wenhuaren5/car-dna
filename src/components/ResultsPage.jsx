import {useEffect,useState} from 'react';
import carDatabase from '../data/carDatabase.json';
import {runRecommendationPipeline} from '../algorithms/recommendationPipeline';
import {getInfrastructureContext} from '../services/infrastructureService';
import {exportProfile} from '../storage/profileStorage';
import DnaRadar from './DnaRadar';

const integer = new Intl.NumberFormat('en-US',{maximumFractionDigits:0});

const AXIS_METRIC = {
  priceFit:'purchasePriceUSD',
  price:'purchasePriceUSD',
  energyCost:'annualEnergyCostUSD',
  energy:'annualEnergyCostUSD',
  emissions:'emissionsGramsPerMile',
  range:'rangeMiles',
  seats:'seats',
  cargo:'cargoRank',
};

const DIMENSION_LABELS = {cost:'Cost',time:'Time & range',emissions:'Emissions',comfortSpace:'Comfort & space'};

const SERIES_COLORS = ['#b8ff54','#78f0ba','#ffb27a'];

const measure = (key,value) => {
  const numeric = Number(value);
  if (value === null || value === undefined || !Number.isFinite(numeric)) return 'Unknown';
  if (key === 'purchasePriceUSD') return `$${integer.format(numeric)}`;
  if (key === 'annualEnergyCostUSD') return `$${integer.format(numeric)}/yr`;
  if (key === 'emissionsGramsPerMile') return `${integer.format(numeric)} g/mi`;
  if (key === 'rangeMiles') return `${integer.format(numeric)} mi`;
  if (key === 'seats') return `${integer.format(numeric)} seats`;
  if (key === 'cargoRank') return `rank ${integer.format(numeric)} of 4`;
  return integer.format(numeric);
};

const acceptable = target => {
  if (!target) return null;
  const min = target.acceptableMin;
  const max = target.acceptableMax;
  if (Number.isFinite(min) && Number.isFinite(max)) return `${measure(target.key,min)} – ${measure(target.key,max)}`;
  if (Number.isFinite(min)) return `at least ${measure(target.key,min)}`;
  if (Number.isFinite(max)) return `up to ${measure(target.key,max)}`;
  return null;
};

const severityClass = severity => {
  const value = String(severity || 'info').toLowerCase();
  if (value === 'high' || value === 'critical' || value === 'warning') return 'warn';
  if (value === 'medium') return 'caution';
  return 'info';
};

const satisfactionClass = value => value === null || value === undefined
  ? 'unknown'
  : value >= 70 ? 'high' : value >= 40 ? 'mid' : 'low';

const tierLabel = status => status === 'strict'
  ? 'Strict budget'
  : status === 'conditional' ? 'Budget-conditional' : 'No budget';

const externalHttpsUrl = value => {
  if(typeof value!=='string'||!value.trim())return null;
  try{
    const url=new URL(value);
    return url.protocol==='https:'&&url.hostname?url.href:null;
  }catch{
    return null;
  }
};

export default function ResultsPage({profile,onEdit,onBack,editableDna=null,onEditDna}){
  const [attempt,setAttempt]=useState(0);
  const [state,setState]=useState({status:'loading'});
  const profileKey=JSON.stringify(profile);
  const editableKey=JSON.stringify(editableDna);
  useEffect(()=>{window.scrollTo({top:0,left:0});},[]);
  useEffect(()=>{
    let cancelled=false;
    setState({status:'loading'});
    (async()=>{
      try{
        const infrastructure=await getInfrastructureContext(profile.homeLocation||null);
        const result=runRecommendationPipeline({profile,vehicles:carDatabase,infrastructure,editableDna});
        if(!cancelled)setState({status:'ready',result});
      }catch(error){
        if(!cancelled)setState({status:'error',error:error?.message||String(error)});
      }
    })();
    return ()=>{cancelled=true;};
  },[profileKey,editableKey,attempt]);
  return <main className="results-page">
    <header className="results-nav">
      <span className="brand"><i/> CAR DNA</span>
      <div className="results-nav-actions">
        <button className="text" onClick={onBack}>← Profile</button>
        {onEditDna&&<button className="secondary" onClick={onEditDna}>Edit Ideal DNA</button>}
        <button className="secondary" onClick={onEdit}>Edit answers</button>
        <button className="secondary" onClick={()=>exportProfile(profile)}>Download profile JSON</button>
      </div>
    </header>
    {state.status==='loading'&&<section className="results-loading" aria-live="polite">
      <p className="eyebrow">BUILDING YOUR RECOMMENDATION</p>
      <div className="loading-card">
        <span className="spinner" aria-hidden="true"/>
        <h2>Reading your DNA against real cars.</h2>
        <p className="lead">Scoring the recorded database with the ideal profile, then checking local charging and refuelling context. Nothing is invented while this runs.</p>
        <div className="loading-cards" aria-hidden="true"><i/><i/><i/></div>
      </div>
    </section>}
    {state.status==='error'&&<section className="results-error" role="alert">
      <p className="eyebrow">RECOMMENDATION STOPPED</p>
      <h2>We could not finish the match.</h2>
      <p className="lead">The pipeline refused to return cars rather than inventing a result. The technical reason is shown below.</p>
      <pre>{state.error}</pre>
      <div className="empty-actions">
        <button className="primary" onClick={()=>setAttempt(value=>value+1)}>Try again</button>
        {onEditDna&&<button className="secondary" onClick={onEditDna}>Edit Ideal DNA</button>}
        <button className="secondary" onClick={onEdit}>Edit answers</button>
      </div>
    </section>}
    {state.status==='ready'&&<ResultsContent profile={profile} result={state.result} onEdit={onEdit} onEditDna={onEditDna}/>}
  </main>;
}


export function ResultsContent({profile,result,onEdit,onEditDna}){
  const {dna,top,summary,infrastructure,emptyState,disclosures,caveats,conditionalTop=[]}=result;
  const finalBodyStyle=dna.constraints?.finalBodyStyle||dna.editor?.values?.finalBodyStyle||null;
  const allowedBodyTypes=dna.constraints?.acceptableBodyTypes||dna.editor?.hard?.allowedBodyTypes||[];
  const axes=dna.displayAxes||[];
  const marketRadar=result.marketRadar||null;
  const radarAxes=marketRadar?.axes||axes;
  const series=marketRadar?.series||top.map((car,index)=>({
    key:car.vehicleId,
    name:`#${car.rank} ${car.displayName}`,
    values:axes.map(axis=>{
      const point=(car.radar||[]).find(item=>item.key===axis.key);
      return Number.isFinite(point?.vehicle)?point.vehicle:null;
    }),
    score:Math.round(car.score.scores.point),
    color:SERIES_COLORS[index%SERIES_COLORS.length],
  }));
  const counts=summary.counts||{};
  return <>
    <section className="results-hero">
      <div>
        <p className="eyebrow">YOUR RECOMMENDATION</p>
        <h1>{summary.headline}</h1>
        <p className="lead">{summary.subline}</p>
        <div className="results-chips">
          {finalBodyStyle&&<span className="dna-chip results-body-chip" data-testid="results-final-body">Final body: {finalBodyStyle}</span>}
          <span className={`dna-chip ${String(summary.dnaConfidence||'unknown').toLowerCase()}`}>DNA confidence {summary.dnaConfidence||'Unknown'}</span>
          <span className="dna-chip">Sample {summary.sampleSize??0} car{(summary.sampleSize??0)===1?'':'s'}</span>
          <span className="dna-chip">Infrastructure {summary.infrastructureStatus||'Unknown'}</span>
          <span className="dna-chip">{counts.database??0} records checked</span>
        </div>
      </div>
      <aside className="results-context-card">
        <b>How to read this page</b>
        <p>Scores rank real records against your ideal DNA. Local infrastructure is context only: it adds notes and caveats, never points.</p>
        <p className="muted">Prices are estimates from the prototype database, not dealer quotes.</p>
      </aside>
    </section>

    {finalBodyStyle&&<section className="results-body-banner" aria-label="Confirmed final body style">
      <div>
        <small>Confirmed Final Body Style</small>
        <b>{finalBodyStyle}</b>
        <span>Every Strict Top 3 car must be this body type. Questionnaire options: {allowedBodyTypes.length?allowedBodyTypes.join(' · '):'Unknown'}.</span>
      </div>
    </section>}

    {dna.editor?.applied&&<div className="edited-dna-banner">
      <b>Edited Ideal DNA applied</b>
      <span>Final body {dna.editor.values?.finalBodyStyle||finalBodyStyle||'Unknown'} · Budget ceiling {measure('purchasePriceUSD',dna.constraints?.maxPurchasePriceUSD)} · Target range {measure('rangeMiles',dna.targets?.rangeMiles?.ideal)} · Efficiency reference {dna.editor.values?.efficiencyReference} · {dna.editor.values?.powertrainMode==='ANY'?'All allowed powertrains':`${dna.editor.values?.powertrainMode} only`}</span>
      {onEditDna&&<button className="text" onClick={onEditDna}>Edit again</button>}
    </div>}
    {top.length===0&&<EmptyResults emptyState={emptyState} match={result.match} onEdit={onEdit} onEditDna={onEditDna}/>}
    {top.length>0&&<TopCars top={top} dna={dna} baseline={result.marketBenchmark?.comparisonBaseline}/>} 
    {conditionalTop.length>0&&<ConditionalCars top={conditionalTop} dna={dna}/>}

    {axes.length>0&&<section className="results-section" aria-labelledby="dna-title">
      <SectionHead eyebrow="IDEAL DNA" title="The target profile your answers describe" id="dna-title"
        note="This is a target profile, not a real car. Each card lists the target, the acceptable range and how certain the evidence is."/>
      <div className="target-grid">
        {axes.map(axis=>{
          const target=dna.targets?.[axis.targetKey];
          const tolerance=acceptable(target);
          const uncertainty=target?.uncertainty;
          return <article className="target-card" key={axis.key}>
            <header><small>{axis.label}</small>{uncertainty?.level==='HIGH'&&<span className="uncertainty-tag">High uncertainty</span>}</header>
            <h3>{measure(axis.targetKey,target?.ideal)}</h3>
            <p>{tolerance?`Acceptable: ${tolerance}`:'No acceptable range recorded'}</p>
            <span className="target-direction">{axis.direction==='lower'?'Lower is better':'Higher is better'}</span>
            <p className="target-note">{axis.description}</p>
          </article>;
        })}
      </div>
      <div className="dna-evidence">
        <div className="weight-panel">
          <h3>How the 100 points are split</h3>
          {Object.entries(dna.weights||{}).map(([key,weight])=><div className="weight-row" key={key}>
            <span>{dna.weightModel?.labels?.[key]||DIMENSION_LABELS[key]||key}</span>
            <div className="weight-bar"><i style={{width:`${Math.round(Number(weight)*100)}%`}}/></div>
            <b>{Math.round(Number(weight)*100)}%</b>
          </div>)}
          <p className="muted">{dna.weightModel?.source==='demand-model-normalized-weights'
            ? 'These weights come from your selected priorities, normalised to 100%.'
            : 'No usable priority weights were found, so the four dimensions fall back to equal weight.'}</p>
        </div>
        <div className="dna-details">
          <h3>Evidence behind the DNA</h3>
          <p className="muted">Confidence {dna.dataQuality?.confidence||'Unknown'} · {dna.dataQuality?.sampleSize??0} matching vehicle records · status {dna.dataQuality?.status||'Unknown'}.</p>
          <ul className="uncertainty-list">
            {(dna.uncertainty||[]).map(item=><li key={item.code} className={severityClass(item.severity)}>
              <b>{item.severity}</b><span>{item.message}</span>
            </li>)}
          </ul>
          <details className="results-details">
            <summary>Assumptions used for every car</summary>
            <ul>{(dna.assumptions?.list||[]).map(item=><li key={item}>{item}</li>)}</ul>
          </details>
        </div>
      </div>
      <div className="radar-panel">
        <div className="radar-copy">
          <h3>Six-axis comparison</h3>
          <p className="muted">{marketRadar?.sample?.available===false
            ? 'No in-budget vehicle remains after your hard constraints, so the market average cannot be formed. Unknown data is omitted, never plotted as zero.'
            : marketRadar?.scale
              ? 'Index 100 is the average of the in-budget cars that meet your constraints. The dashed line marks 100: outside it is above average, inside it is below. The scale adapts to these six axes so every valid point stays visible.'
              : 'Every car is plotted against the market benchmark. Unknown values are omitted, never plotted as zero.'}</p>
          <p className="muted">The radar index is visual context only. It does not replace the DNA Match Score shown on each card.</p>
          {marketRadar?.sample&&<details className="results-details radar-details">
            <summary>Benchmark sample & axis definitions</summary>
            <p><b>{marketRadar.sample.eligibleRecords}</b> {marketRadar.sample.budgetScoped?'in-budget':'scoped'} adapted records of {marketRadar.sample.databaseRecords} database records; {marketRadar.sample.eligibleDatabaseRecords??0} were recommendation-eligible. Baseline method: {marketRadar.sample.baselineMethod}</p>
            {marketRadar.sample.budgetScoped&&<p>{marketRadar.sample.excludedHardConstraints??0} removed by hard constraints · {marketRadar.sample.excludedBudgetConditional??0} budget-conditional · {marketRadar.sample.excludedOverBudget??0} over budget · {marketRadar.sample.excludedBudgetUnknown??0} unknown price · {marketRadar.sample.excludedIneligible??0} not recommendation-eligible.</p>}
            <p>{marketRadar.sample.scope}</p>
            <p>{marketRadar.sample.missingPolicy}</p>
            <div className="benchmark-axis-list">
              {marketRadar.axes.map(axis=><div key={axis.key}>
                <b>{axis.label} · {axis.sample.count} known / {axis.missingCount} missing</b>
                <span>{axis.definition}</span>
                <small>Direction: {axis.direction==='higher'?'higher is better':'lower is better'} · performance: {axis.performanceLabel} · baseline mean {Number.isFinite(axis.sample.mean)?axis.sample.mean.toLocaleString('en-US',{maximumFractionDigits:4}):'Unknown'} · range {axis.sample.min??'Unknown'}–{axis.sample.max??'Unknown'}</small>
              </div>)}
            </div>
            {marketRadar.scale&&<p className="muted">{marketRadar.scale.description} {marketRadar.scale.formula}</p>}
          </details>}
        </div>
        <DnaRadar axes={radarAxes} series={series} ideal={marketRadar?.ideal||null} scale={marketRadar?.scale||null} marketAverage={marketRadar?.marketAverage??100} available={marketRadar?.sample?.available!==false}/>
      </div>
      {top.length>0&&<ComparisonTable top={top} axes={axes} dna={dna}/>}
    </section>}

    <MethodPanel result={result} disclosures={disclosures} caveats={caveats}/>
  </>;
}

function SectionHead({eyebrow,title,note,id}){
  return <header className="results-section-head">
    <div><p className="eyebrow">{eyebrow}</p><h2 id={id}>{title}</h2>{note&&<p className="lead">{note}</p>}</div>
  </header>;
}


function TopCars({top,dna,baseline}){
  const budget=Number(dna.constraints?.maxPurchasePriceUSD);
  const finalBodyStyle=dna.constraints?.finalBodyStyle||dna.editor?.values?.finalBodyStyle||null;
  return <section className="results-section top-section" aria-labelledby="top-title">
    <SectionHead eyebrow="STRICT TOP REAL CARS" title={`${top.length} ${finalBodyStyle||''} car${top.length===1?'':'s'} closest to your DNA`} id="top-title"
      note="Every car below passed the final body style, seats, powertrain, condition and strict budget filters before scoring. Conditional-budget cars are listed separately and cannot fill these slots."/>
    <div className="results-rule">
      <span><b>Budget cap</b> {Number.isFinite(budget)&&budget>0?`$${integer.format(budget)}`:'Not set'}</span>
      <span><b>Final body</b> {finalBodyStyle||'Not confirmed'}</span>
      <span><b>Strict budget</b> {top.length}</span>
      <span><b>Ideal sample</b> {dna.dataQuality?.sampleSize??0} car{(dna.dataQuality?.sampleSize??0)===1?'':'s'}</span>
    </div>
    {baseline&&<p className="comparison-baseline">Savings and CO₂ compare with the average of {baseline.annualEnergyCostSampleSize} {baseline.scope}, using {integer.format(baseline.annualMiles)} miles/year.</p>}
    <div className="recommendation-layout">
      <CarCard car={top[0]} baseline={baseline} hero showVehicleLink/>
      {top.length>1&&<div className="comparison-cards">{top.slice(1).map(car=><CarCard car={car} baseline={baseline} key={car.vehicleId} showVehicleLink/>)}</div>}
    </div>
    <p className="results-footnote">Over-budget cars are never returned. Only strict price bands enter this Top 3; if fewer than three qualify, fewer are shown.</p>
  </section>;
}

function ConditionalCars({top,dna}){
  const finalBodyStyle=dna.constraints?.finalBodyStyle||dna.editor?.values?.finalBodyStyle||'selected';
  return <details className="results-section conditional-results">
    <summary><b>Budget-conditional recommendations</b><span>{top.length} car{top.length===1?'':'s'} needing a negotiated price</span></summary>
    <section aria-labelledby="conditional-title">
    <SectionHead eyebrow="BUDGET-CONDITIONAL MATCHES" title={`${top.length} ${finalBodyStyle} car${top.length===1?'':'s'} needing a negotiated price`} id="conditional-title"
      note="These real records match the final body style and every other hard constraint, but their price band straddles your cap. They are shown separately and are not part of the Strict Top 3."/>
    <div className="car-grid">
      {top.map(car=><CarCard car={car} key={`conditional-${car.vehicleId}`}/>)}
    </div>
    <p className="results-footnote">A conditional car needs a negotiated price at or below your budget. It is never presented as a strict match.</p>
    </section>
  </details>;
}

function PriceBlock({price}){
  const estimated=price?.estimatedUSD;
  const band=price?.bandUSD;
  const main=band?`$${integer.format(band.low)} – $${integer.format(band.high)}`
    :estimated!==null&&estimated!==undefined?`$${integer.format(estimated)}`:'Unknown';
  return <div className="price-block">
    <b>{main}</b>
    <small>{band?'Recorded price band':'Estimated price only'}</small>
    {band&&estimated!==null&&estimated!==undefined&&<em>Point estimate {integer.format(estimated)}</em>}
    <span className="estimate-tag">{price?.isEstimate===false?'Verified price':'Estimated price'}</span>
  </div>;
}

function CaveatList({caveats=[],limit=4}){
  if(!caveats.length)return null;
  return <ul className="caveat-list">
    {caveats.slice(0,limit).map((item,index)=><li key={`${item.code}-${index}`} className={severityClass(item.severity)}>
      <span>{item.message}</span>
    </li>)}
  </ul>;
}

function VehicleLink({car}){
  const href=externalHttpsUrl(car.view?.officialWebsite);
  if(!href)return null;
  const scope=car.view?.officialWebsiteInfo?.scope;
  const context=scope==='MODEL_YEAR_USED_LISTINGS'
    ?'Used-vehicle marketplace listings — not a manufacturer website. Inventory and asking prices change.'
    :scope==='MODEL_FAMILY'?'Official manufacturer model page.':'External vehicle page — not verified as a manufacturer website.';
  return <div className="vehicle-link-block">
    <a className="vehicle-link" href={href} target="_blank" rel="noopener noreferrer" aria-label={`View ${car.displayName} on an external page (opens in a new tab)`}>View Vehicle ↗</a>
    <small className="vehicle-link-context">{context}</small>
    <small className="vehicle-link-hint">External page may show a different year or trim.</small>
  </div>;
}

function signedComparison(value,positiveLabel,negativeLabel,unit='$'){
  if(!Number.isFinite(value))return {value:'Unavailable',label:positiveLabel,tone:'neutral'};
  const positive=value>=0;
  const formatted=unit==='$'?`${unit}${integer.format(Math.abs(value))}`:`${integer.format(Math.abs(value))} ${unit}`;
  return {value:formatted,label:positive?positiveLabel:negativeLabel,tone:positive?'positive':'negative'};
}

function CarCard({car,showVehicleLink=false,baseline=null,hero=false}){
  const score=car.score.scores;
  const price=car.price;
  const metrics=car.metrics;
  const annualCost=Number(metrics?.cost?.annualUSD);
  const emissions=Number(metrics?.emissions?.gramsCO2PerMile);
  const annualMiles=Number(baseline?.annualMiles);
  const savings=signedComparison(Number.isFinite(annualCost)&&Number.isFinite(baseline?.annualEnergyCostUSD)?baseline.annualEnergyCostUSD-annualCost:null,'Annual savings','Additional annual cost');
  const avoided=signedComparison(Number.isFinite(emissions)&&Number.isFinite(baseline?.emissionsGramsPerMile)&&Number.isFinite(annualMiles)?(baseline.emissionsGramsPerMile-emissions)*annualMiles/1000:null,'CO₂ avoided/year','Additional CO₂/year','kg');
  return <article className={`car-card ${hero?'hero-car-card':'comparison-car-card'} tier-${car.priceStatus}`}>
    <header className="car-card-head">
      <div className="car-identity">
        <div className="car-rank-row">
          <span className="rank-chip">#{car.rank}</span>
          <span className={`tier-badge ${car.priceStatus}`}>{tierLabel(car.priceStatus)}</span>
        </div>
        <div>
          <h3>{car.displayName}</h3>
          <p className="car-meta">{car.year}{car.trim?` · ${car.trim}`:''} · {car.powertrain} · {car.bodyType}</p>
        </div>
      </div>
      <div className="score-orb">
        <strong>{Math.round(score.point)}</strong><span>/100</span>
        <small>DNA Match</small>
      </div>
    </header>
    <div className="annual-metrics">
      <div><small>Annual energy cost</small><b>{measure('annualEnergyCostUSD',metrics?.cost?.annualUSD)}</b></div>
      <div className={savings.tone}><small>{savings.label}</small><b>{savings.value}</b></div>
      <div className={avoided.tone}><small>{avoided.label}</small><b>{avoided.value}</b></div>
    </div>
    <div className="secondary-specs">
      <PriceBlock price={price}/>
      <div className="range-block"><small>Vehicle range</small><b>{measure('rangeMiles',metrics?.energy?.totalRangeMiles)}</b><span>{measure('emissionsGramsPerMile',metrics?.emissions?.gramsCO2PerMile)} emissions</span></div>
    </div>
    <p className={`tier-note ${car.priceStatus}`}>{car.budgetTier?.reason||car.budgetTier?.label||tierLabel(car.priceStatus)}</p>
    {showVehicleLink&&<VehicleLink car={car}/>}
    <details className="results-details car-details">
      <summary>Detailed Calculations &amp; Data Sources</summary>
      <p className="score-method">Ranked on the lower bound {Math.round(score.lowerBound)}; point estimate {Math.round(score.point)}; best case {Math.round(score.upperBound)}. Unknown values keep the point estimate neutral and lower the conservative score.</p>
      <AxisTable car={car}/>
      <CaveatList caveats={car.caveats}/>
    </details>
  </article>;
}


function AxisTable({car}){
  return <div className="axis-table-wrap">
    <table className="axis-table">
      <thead><tr><th>Axis</th><th>This car</th><th>Ideal</th><th>Hit rate</th></tr></thead>
      <tbody>
        {car.score.axes.map(axis=>{
          const key=axis.targetKey||AXIS_METRIC[axis.key];
          const satisfaction=axis.satisfaction===null||axis.satisfaction===undefined?null:Math.round(axis.satisfaction*100);
          return <tr key={axis.key} className={satisfaction===null?'unknown':''}>
            <th>{axis.label}</th>
            <td>{measure(key,axis.value)}</td>
            <td>{measure(key,axis.ideal)}</td>
            <td><span className={`satisfaction ${satisfactionClass(satisfaction)}`}>{satisfaction===null?'Unknown':`${satisfaction}%`}</span></td>
          </tr>;
        })}
      </tbody>
    </table>
  </div>;
}

function InfrastructureNote({infrastructure}){
  if(!infrastructure)return null;
  const label={good:'Good access',limited:'Limited access',weak:'Weak access',unknown:'Access unknown'}[infrastructure.status]||'Access unknown';
  return <div className={`infrastructure-note infra-${infrastructure.status}`}>
    <header><span>{infrastructure.plugIn?'⚡':'⛽'} Nearby {infrastructure.plugIn?'charging':'refuelling'}</span><b>{label}</b></header>
    <p>{infrastructure.summary||'Availability is unknown.'}</p>
    {infrastructure.known&&infrastructure.plugIn&&Number.isFinite(infrastructure.publicCount)&&<small>{infrastructure.publicCount} public charger{infrastructure.publicCount===1?'':'s'} · home charging {infrastructure.homeCharging||'Unknown'}</small>}
    {infrastructure.known&&!infrastructure.plugIn&&Number.isFinite(infrastructure.count)&&<small>{infrastructure.count} gas station{infrastructure.count===1?'':'s'} nearby</small>}
    <small className="context-only">Context only — this note never changes the score.</small>
  </div>;
}

function ComparisonTable({top,axes,dna}){
  return <div className="comparison-block">
    <h3>Axis-by-axis comparison</h3>
    <p className="muted">Hit rates are satisfaction against the ideal; the recorded value sits underneath. Use this table when two cars are close.</p>
    <div className="comparison-wrap">
      <table className="comparison-table">
        <thead><tr><th>Axis and ideal</th>{top.map(car=><th key={car.vehicleId}><span>#{car.rank}</span>{car.displayName}</th>)}</tr></thead>
        <tbody>
          {axes.map(axis=>{
            const target=dna.targets?.[axis.targetKey];
            return <tr key={axis.key}>
              <th>{axis.label}<small>Ideal {measure(axis.targetKey,target?.ideal)}</small></th>
              {top.map(car=>{
                const point=(car.radar||[]).find(item=>item.key===axis.key);
                const raw=point?.vehicle;
                const satisfaction=Number.isFinite(raw)?raw:null;
                return <td key={car.vehicleId}>
                  <b className={satisfactionClass(satisfaction)}>{satisfaction===null?'Unknown':`${satisfaction}%`}</b>
                  <small>{measure(axis.targetKey,point?.value)}</small>
                </td>;
              })}
            </tr>;
          })}
        </tbody>
      </table>
    </div>
  </div>;
}

function EmptyResults({emptyState,match,onEdit,onEditDna}){
  if(!emptyState)return null;
  const rejected=match?.rejectedBy||{};
  return <section className="empty-results" aria-labelledby="empty-title">
    <p className="eyebrow">HONEST EMPTY RESULT</p>
    <h2 id="empty-title">{emptyState.title||'No real car passes your hard constraints'}</h2>
    <p className="lead">{emptyState.message}</p>
    <div className="empty-diagnosis">
      <small>MOST LIKELY BLOCKER · {String(emptyState.reason||'hard-constraints').replaceAll('-',' ').toUpperCase()}</small>
      <p>{emptyState.suggestion}</p>
      {emptyState.detail&&<p className="muted">{emptyState.detail}</p>}
    </div>
    <div className="rejection-grid">
      {[['Final body',rejected['body-style']],['Seats',rejected.seats],['Powertrain',rejected.powertrain],['Condition',rejected.condition],['Over budget',rejected['over-budget']],['No usable price',rejected['price-unknown']],['Not eligible',rejected['not-eligible']]].map(([label,count])=>
        <div key={label}><b>{count||0}</b><span>{label}</span></div>)}
    </div>
    <div className="empty-actions">
      {onEditDna&&<button className="primary" onClick={onEditDna}>Edit Ideal DNA</button>}
      <button className={onEditDna?'secondary':'primary'} onClick={onEdit}>Adjust my answers</button>
    </div>
  </section>;
}


function InfrastructurePanel({infrastructure,dna,profile,onEdit}){
  const status=infrastructure?.status||'unknown';
  const covered=status==='covered';
  const charging=infrastructure?.charging;
  const gas=infrastructure?.gas;
  const home=profile.homeLocation;
  const homeName=home?.customName||home?.address?.displayName||(home?'Home':'No home saved');
  const coverage={covered:'Checked inside the local San Jose extract', 'out-of-coverage':'Outside the local San Jose extract', 'unknown-location':'Home location unknown', unknown:'Home location unknown', unavailable:'Local data could not be loaded'}[status]||'Unknown';
  const total=Number(charging?.totalWithinRadius);
  const share=value=>Number.isFinite(total)&&total>0?`${(Number(value||0)/total)*100}%`:'0%';
  return <section className="results-section infra-section" aria-labelledby="infra-title">
    <SectionHead eyebrow="LOCAL CONTEXT" title="What is around your home" id="infra-title"
      note="Charging and refuelling are shown once per home location and shared by every car. They explain suitability; they do not add or remove points."/>
    <div className="infra-panel">
      <div className="infra-summary">
        <article className="infra-home">
          <small>HOME BASE</small>
          <b>{homeName}</b>
          {home?.address?.displayName&&<p>{home.address.displayName}</p>}
          {Number.isFinite(Number(home?.lat))&&<p className="muted">{Number(home.lat).toFixed(4)}, {Number(home.lng).toFixed(4)}</p>}
          <span className={`coverage-chip ${status}`}>{coverage}</span>
          {!home&&<button className="text" onClick={onEdit}>Add home in your answers</button>}
        </article>
        <InfraStat label="Public chargers" value={charging?.publicCount} known={charging?.known}
          detail={charging?.known?(charging.nearestPublicMiles!==null?`Nearest ${charging.nearestPublicMiles} mi`:`Within ${infrastructure?.radiusMiles??3} mi`):(charging?.reason||'Unknown')}/>
        <InfraStat label="All chargers recorded" value={charging?.totalWithinRadius} known={charging?.known}
          detail={charging?.known?`${charging.limitedCount||0} customer-only · ${charging.unknownAccessCount||0} unknown access`:(charging?.reason||'Unknown')}/>
        <InfraStat label="Gas stations" value={gas?.count} known={gas?.known}
          detail={gas?.known?(gas.nearestMiles!==null?`Nearest ${gas.nearestMiles} mi`:`Within ${infrastructure?.radiusMiles??3} mi`):(gas?.reason||'Unknown')}/>
      </div>
      {covered&&charging?.known&&<div className="access-split">
        <div className="access-bar" aria-hidden="true">
          <i style={{width:share(charging.publicCount),background:'#b8ff54'}}/>
          <i style={{width:share(charging.limitedCount),background:'#78f0ba'}}/>
          <i style={{width:share(charging.unknownAccessCount),background:'#ffd899'}}/>
          <i style={{width:share(charging.privateCount),background:'#5c7668'}}/>
        </div>
        <div className="access-legend">
          <span><b style={{background:'#b8ff54'}}/>{charging.publicCount} public</span>
          <span><b style={{background:'#78f0ba'}}/>{charging.limitedCount} customers only</span>
          <span><b style={{background:'#ffd899'}}/>{charging.unknownAccessCount} access unknown</span>
          <span><b style={{background:'#5c7668'}}/>{charging.privateCount} private</span>
        </div>
        <p className="muted">Counts partition every charger inside {infrastructure.radiusMiles} mi. Connector type, power and live availability are not assumed.</p>
      </div>}
      {!covered&&<div className="infra-unknowns">
        <h3>Counts stay Unknown — they are never shown as zero.</h3>
        <p>{charging?.reason||'No local facility context is available for this home.'}</p>
        {gas?.reason&&<p>{gas.reason}</p>}
      </div>}
      {dna.contextual?.charging?.applicable&&<p className="infra-note">Your accepted powertrains include a plug-in type, so home charging ({dna.contextual.charging.home||'Unknown'}) and workplace charging ({dna.contextual.charging.workplace||'Unknown'}) were considered when annotating each car. They still do not change the score.</p>}
      <div className="infra-caveats"><CaveatList caveats={infrastructure?.caveats||[]} limit={6}/></div>
      <details className="results-details">
        <summary>Source, radius and method</summary>
        <ul className="provenance-list">
          <li><b>Source</b> {infrastructure?.provenance?.source||'OpenStreetMap contributors'}{infrastructure?.provenance?.license?` · ${infrastructure.provenance.license}`:''}</li>
          <li><b>Method</b> {infrastructure?.provenance?.method||'Straight-line distance from home to every recorded station.'}</li>
          <li><b>Coverage policy</b> {infrastructure?.provenance?.outOfCoveragePolicy||'Outside the extract, every count stays null and is displayed as Unknown.'}</li>
          <li><b>Map snapshot</b> {infrastructure?.provenance?.mapGeneratedAt||'Unknown'}</li>
        </ul>
      </details>
      <p className="infra-footnote">Infrastructure is a local context layer. It never adds, removes or rescales points in the four-dimension score.</p>
    </div>
  </section>;
}

function InfraStat({label,value,known,detail}){
  const usable=known===true&&value!==null&&value!==undefined;
  return <article className={`infra-stat ${usable?'':'unknown'}`}>
    <small>{label}</small>
    <b>{usable?integer.format(Number(value)):'Unknown'}</b>
    <p>{detail||'No local data'}</p>
  </article>;
}


function MethodPanel({result,disclosures,caveats}){
  const {dna,match,infrastructure}=result;
  return <details className="results-section method-section">
    <summary><b>Detailed Calculations &amp; Data Sources</b><span>Assumptions, limitations, and provenance</span></summary>
    <section aria-labelledby="method-title">
    <SectionHead eyebrow="METHOD & LIMITS" title="What this recommendation does not know" id="method-title"
      note="Every limitation stays visible. The pipeline never fills a missing value with a guess."/>
    <div className="method-grid">
      <article>
        <h3>Disclosures</h3>
        <ol className="disclosure-list">{(disclosures||[]).map(item=><li key={item}>{item}</li>)}</ol>
      </article>
      <article>
        <h3>All caveats</h3>
        {caveats?.length?<ul className="method-caveats">{caveats.map((item,index)=><li key={`${item.code}-${index}`} className={severityClass(item.severity)}>{item.message}</li>)}</ul>
          :<p className="muted">No caveats were raised for this profile and match.</p>}
      </article>
      <article>
        <h3>Not modeled</h3>
        <p>Insurance, maintenance, depreciation, financing, resale value and a full total cost of ownership are outside this prototype.</p>
        <p>The ideal DNA is a target profile, not a purchasable car. Only the Top 3 are real records.</p>
      </article>
    </div>
    <details className="results-details">
      <summary>Pipeline provenance and data gaps</summary>
      <dl className="provenance-grid">
        <div><dt>Pipeline</dt><dd>{result.schemaVersion}</dd></div>
        <div><dt>DNA schema</dt><dd>{dna.schemaVersion}</dd></div>
        <div><dt>Database records</dt><dd>{match.counts.database}</dd></div>
        <div><dt>Final body style</dt><dd>{dna.constraints?.finalBodyStyle||'Not confirmed'}</dd></div>
        <div><dt>Hard-filter passes</dt><dd>{match.counts.hardPassed}</dd></div>
        <div><dt>Strict / conditional</dt><dd>{match.counts.strict} strict · {match.counts.conditional} conditional</dd></div>
        <div><dt>DNA sample</dt><dd>{dna.dataQuality?.sampleSize??0}</dd></div>
        <div><dt>Weight source</dt><dd>{dna.weightModel?.source||'Unknown'}</dd></div>
        <div><dt>Annual mileage</dt><dd>{integer.format(dna.usage?.annualMiles||0)} mi · {dna.usage?.annualMilesSource||'Unknown'}</dd></div>
        <div><dt>Infrastructure</dt><dd>{infrastructure?.status||'Unknown'}</dd></div>
      </dl>
      {dna.dataQuality?.missingTargets?.length>0&&<p className="method-warning"><b>Missing DNA targets:</b> {dna.dataQuality.missingTargets.join(', ')}. These are reported as Unknown, not filled.</p>}
      <ul className="provenance-list">{(dna.provenance?.notInvented||[]).map(item=><li key={item}>{item}</li>)}</ul>
    </details>
    <p className="results-footnote">Questionnaire, map, address and facility data are processed locally in this browser. Prices are estimated, and no result is a dealer quote.</p>
    </section>
  </details>;
}

