import {useState} from 'react';
import {POWERTRAIN_VALUES} from '../model/profile';

/**
 * Powertrain acceptance picker.
 *
 * Multi-select cards that decide which vehicle types later stages may consider. The selection is a
 * user-set hard constraint, so it is always at least one entry: the last remaining card refuses to
 * switch off and says why instead of silently accepting an empty list.
 *
 * ICE and HEV are shown as "no plug" and PHEV and EV as "plugs in", so a non-plug-in hybrid is
 * never mixed up with a plug-in hybrid.
 */
export const POWERTRAIN_OPTIONS=[
  {value:'ICE',label:'Gasoline (ICE)',short:'Gasoline',tag:'No plug',plugsIn:false,description:'Traditional gasoline-powered vehicles.'},
  {value:'HEV',label:'Hybrid (HEV)',short:'Hybrid',tag:'No plug',plugsIn:false,description:'Uses gasoline and electricity, but does not need to be plugged in.'},
  {value:'PHEV',label:'Plug-in Hybrid (PHEV)',short:'Plug-in Hybrid',tag:'Plugs in',plugsIn:true,description:'Uses gasoline and electricity and can be charged externally.'},
  {value:'EV',label:'Electric (EV)',short:'Electric',tag:'Plugs in',plugsIn:true,description:'Fully electric, requires charging.'},
];
const optionFor=value=>POWERTRAIN_OPTIONS.find(item=>item.value===value);
export const powertrainLabel=value=>optionFor(value)?.label||value;
export const powertrainShort=value=>optionFor(value)?.short||value;

export default function PowertrainPicker({value,onChange,error,chargingApplicable}){
  const [notice,setNotice]=useState('');
  const selected=POWERTRAIN_VALUES.filter(item=>Array.isArray(value)&&value.includes(item));

  const toggle=next=>{
    if(selected.includes(next)){
      if(selected.length===1){
        setNotice(`${powertrainLabel(next)} is the only type left. Keep at least one vehicle type selected.`);
        return;
      }
      setNotice('');
      onChange(POWERTRAIN_VALUES.filter(item=>item!==next&&selected.includes(item)));
      return;
    }
    setNotice('');
    onChange(POWERTRAIN_VALUES.filter(item=>item===next||selected.includes(item)));
  };

  return <fieldset className="powertrain-fieldset" data-testid="powertrain-picker">
    <legend>Which vehicle types would you consider?</legend>
    <p className="powertrain-lead">Select all the types you are open to. We will only recommend vehicles from your selected categories.</p>
    <div className="powertrain-grid">
      {POWERTRAIN_OPTIONS.map(item=>{
        const chosen=selected.includes(item.value);
        return <button
          type="button"
          key={item.value}
          className={chosen?'powertrain-card chosen':'powertrain-card'}
          aria-pressed={chosen}
          aria-describedby={`powertrain-help-${item.value}`}
          data-testid={`powertrain-${item.value}`}
          onClick={()=>toggle(item.value)}
        >
          <span className="powertrain-check" aria-hidden="true">{chosen?'✓':''}</span>
          <span className="powertrain-copy">
            <b>{item.label}</b>
            <small id={`powertrain-help-${item.value}`}>{item.description}</small>
          </span>
          <span className={item.plugsIn?'powertrain-tag plugs-in':'powertrain-tag'}>{item.tag}</span>
        </button>;
      })}
    </div>
    <div className="powertrain-footer">
      <span data-testid="powertrain-count">{selected.length} of {POWERTRAIN_OPTIONS.length} selected</span>
      <button type="button" className="powertrain-reset" data-testid="powertrain-select-all" onClick={()=>{setNotice('');onChange([...POWERTRAIN_VALUES])}}>Select all four</button>
    </div>
    {notice&&<em className="field-error" role="status" data-testid="powertrain-notice">{notice}</em>}
    {!selected.length&&<em className="field-error" role="status" data-testid="powertrain-empty">Select at least one vehicle type.</em>}
    {error&&<em className="field-error" data-testid="powertrain-error">{error}</em>}
    <p className="powertrain-note" data-testid="powertrain-constraint"><b>Hard constraint.</b> Vehicle DNA generation and real-vehicle matching may only use the types you keep selected here. Types you switch off can never be recommended, whatever they score.</p>
    <p className="powertrain-note" data-testid="powertrain-charging-hint">{chargingApplicable
      ? 'Because PHEV or EV is accepted, the charging questions below still apply.'
      : 'With gasoline and non-plug-in hybrid only, no charging question is asked: nothing you accept needs to be plugged in.'}</p>
  </fieldset>;
}
