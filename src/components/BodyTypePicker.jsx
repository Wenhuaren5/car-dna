import {useEffect,useRef,useState} from 'react';
import {DATABASE_BODY_TYPE_VALUES, normalizeBodyTypes} from '../model/profile';

/**
 * Checkpoint M: multi-select body styles.
 *
 * Only the five categories represented in the vehicle database are offered. The answer is stored as
 * an array; a legacy scalar value is normalized to a one-element array. "No Preference" is no longer
 * an option because the user must name at least one acceptable body style.
 */
export const BODY_TYPES = [
  {value:'Sedan',image:'/images/body-types/sedan-reference.webp',description:'A classic passenger car with a separate trunk for everyday driving.'},
  {value:'Hatchback',image:'/images/body-types/hatchback-reference.webp',description:'A compact car with a rear liftgate and flexible cargo access.'},
  {value:'SUV / Crossover',image:'/images/body-types/suv-reference.webp',description:'A taller, versatile vehicle with generous passenger and cargo room.'},
  {value:'Minivan (MPV)',image:'/images/body-types/minivan-reference.webp',description:'A spacious family vehicle with flexible seating and easy access.'},
  {value:'Pickup Truck',image:'/images/body-types/pickup-reference.webp',description:'A capable utility vehicle with an open cargo bed.'}
].filter(item=>DATABASE_BODY_TYPE_VALUES.includes(item.value));

export default function BodyTypePicker({value,onChange,error}){
  const selected = normalizeBodyTypes(value);
  const [preview,setPreview]=useState(null),[failed,setFailed]=useState({}),timer=useRef();
  const showLater=item=>{clearTimeout(timer.current);timer.current=setTimeout(()=>setPreview(item),500)};
  const showNow=item=>{clearTimeout(timer.current);setPreview(item)};
  const hide=()=>{clearTimeout(timer.current);setPreview(null)};
  useEffect(()=>()=>clearTimeout(timer.current),[]);
  const toggle=item=>{
    const next=selected.includes(item.value)
      ? selected.filter(body=>body!==item.value)
      : [...selected,item.value];
    onChange(BODY_TYPES.map(body=>body.value).filter(body=>next.includes(body)));
    showNow(item);
  };
  return <fieldset className={`body-fieldset ${error?'has-error':''}`}>
    <legend>Acceptable body styles <small>Select one or more</small></legend>
    <div className="body-picker" data-testid="body-multi-select">
      {BODY_TYPES.map(item=>{
        const isSelected=selected.includes(item.value);
        return <div className="body-option" key={item.value}
          onMouseEnter={()=>showLater(item)} onMouseLeave={hide}
          onFocus={()=>showLater(item)} onBlur={hide}>
          <button type="button" role="checkbox" aria-checked={isSelected}
            aria-describedby={`body-help-${item.value.replaceAll(' ','-')}`}
            className={isSelected?'body-card selected':'body-card'}
            data-body-value={item.value}
            onClick={()=>toggle(item)}>
            {item.image&&<img src={item.image} alt={`${item.value} vehicle example from the provided Car Types Overview`} loading="lazy" decoding="async"/>}
            <span><b>{item.value}</b><small id={`body-help-${item.value.replaceAll(' ','-')}`}>{item.description}</small></span>
            <i aria-hidden="true">{isSelected?'✓':'+'}</i>
          </button>
          {preview?.value===item.value&&<div className="body-preview" role="tooltip">
            {item.image&&!failed[item.value]
              ? <div className="preview-photos"><img src={item.image} alt={`Enlarged ${item.value} vehicle example`} loading="lazy" decoding="async" onError={()=>setFailed(x=>({...x,[item.value]:true}))}/></div>
              : <div className="image-fallback">{item.value}</div>}
            <div className="preview-copy"><b>{item.value}</b><p>{item.description}</p></div>
          </div>}
        </div>;
      })}
    </div>
    <p className="body-selection-summary" data-testid="body-selection-summary" aria-live="polite">
      {selected.length
        ? <>Selected <b>{selected.length}</b>: {selected.join(' · ')}</>
        : <>Select at least one body style to continue.</>}
    </p>
    {error&&<em className="field-error" role="alert">{error}</em>}
    <p className="body-note">Images illustrate body shape only. Dimensions, efficiency, and capabilities vary by real vehicle and will come from verified vehicle data. These choices become the only body styles available in the DNA Studio.</p>
  </fieldset>;
}
