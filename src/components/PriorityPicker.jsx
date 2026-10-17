import {useState} from 'react';
import {BALANCED_PRIORITY,normalizePriorities,togglePriority} from '../model/profile';

/**
 * Step 5 priority picker.
 *
 * The four specific priorities are a free multi-select: any 1–4 of them can be on at once and the
 * same card switches a choice back off. Balanced means "weight every goal evenly", so it is mutually
 * exclusive with them — choosing it clears the four, and choosing any of the four clears it. The last
 * remaining card refuses to switch off, so the stored profile always carries at least one priority
 * for Algorithm 1 to read.
 *
 * Card copy, layout and the chosen-card styling are unchanged from the previous single-select step;
 * only the toggle behaviour is new.
 */
export const PRIORITY_OPTIONS=[
  {value:'save_money',label:'Save Money',description:'Keep purchase and long-term costs low.'},
  {value:'save_time',label:'Save Time',description:'Minimize charging and refueling inconvenience.'},
  {value:'environment',label:'Protect the Environment',description:'Reduce energy use and emissions.'},
  {value:'comfort_space',label:'More Comfort & Space',description:'Prioritize passenger and cargo space.'},
  {value:BALANCED_PRIORITY,label:'Balanced',description:'Find the best overall combination.'},
];
const optionFor=value=>PRIORITY_OPTIONS.find(item=>item.value===value);
export const priorityLabel=value=>optionFor(value)?.label||value;

/**
 * Copy for the two clicks the model refuses. The rule itself lives in `togglePriority`
 * (`src/model/profile.js`) so Step 5 behaves the same in the browser and in the node checks.
 */
const NOTICES={
  'only-priority-left':value=>`${priorityLabel(value)} is the only priority left. Keep at least one priority selected.`,
  'already-balanced':()=>'Balanced already covers every goal and is the only priority selected.',
};

export default function PriorityPicker({value,onChange,error}){
  const [notice,setNotice]=useState('');
  const selected=normalizePriorities(value);

  const toggle=next=>{
    const result=togglePriority(selected,next);
    setNotice(result.blockedReason?NOTICES[result.blockedReason](result.blockedPriority):'');
    if(!result.blockedReason)onChange(result.selection);
  };

  return <fieldset className="priority-fieldset" data-testid="priority-picker">
    <div className="cards">
      {PRIORITY_OPTIONS.map(item=>{
        const chosen=selected.includes(item.value);
        return <button
          type="button"
          key={item.value}
          className={chosen?'card chosen':'card'}
          aria-pressed={chosen}
          data-testid={`priority-${item.value}`}
          onClick={()=>toggle(item.value)}
        >
          <b>{item.label}</b>
          <span>{item.description}</span>
        </button>;
      })}
    </div>
    <div className="priority-footer">
      <span data-testid="priority-count">{selected.length} of {PRIORITY_OPTIONS.length} selected</span>
      <span data-testid="priority-selection">{selected.map(priorityLabel).join(' · ')}</span>
    </div>
    {notice&&<em className="field-error" role="status" data-testid="priority-notice">{notice}</em>}
    {!selected.length&&<em className="field-error" role="status" data-testid="priority-empty">Select at least one priority.</em>}
    {error&&<em className="field-error" data-testid="priority-error">{error}</em>}
    <p className="priority-note" data-testid="priority-note"><b>Multi-select.</b> The four specific priorities can be combined any way you like; <b>Balanced</b> covers all of them at once and is never combined with them. Every selected priority is kept in <code>selectedPriorities</code> for Algorithm 1.</p>
  </fieldset>;
}
