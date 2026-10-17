export const emptyProfile={role:'',ownershipDurationMonths:'',purchaseIntention:'buy',budget:'',vehicleCondition:'Either',acceptableBodyTypes:[],preferredBodyType:'',minimumSeats:5,cargoNeeds:'Medium',homeLocation:null,destinations:[],annualMileage:'',estimateMileageLater:false,acceptablePowertrains:['ICE','HEV','PHEV','EV'],chargingApplicable:true,homeCharging:'Unsure',workplaceCharging:'Unsure',parking:'Private garage',roadTripFrequency:'Occasionally',selectedPriorities:['balanced'],longDistanceTripsPerYear:'',longDistanceRoundTripMiles:'',dailyDrivingMiles:null,longDistanceMiles:null,totalAnnualMiles:null,derivedData:null};
/** Legacy values remain readable, but only the five categories present in the database are selectable. */
export const BODY_TYPE_VALUES=['Sedan','Hatchback','SUV / Crossover','Minivan (MPV)','Pickup Truck','Sports Car','No Preference'];
export const DATABASE_BODY_TYPE_VALUES=['Sedan','Hatchback','SUV / Crossover','Minivan (MPV)','Pickup Truck'];
const BODY_TYPE_ALIASES={SUV:'SUV / Crossover',Pickup:'Pickup Truck',Minivan:'Minivan (MPV)',Sports:'Sports Car','SPORTS CAR':'Sports Car'};
export const DESTINATION_TYPES=['School','Work','Shopping','Recreation','Other'];
export const LOCATION_TYPES=['Home',...DESTINATION_TYPES];
export const TRIPS_PER_WEEK_LIMITS={min:0,max:21};
export const WEEKS_PER_YEAR_LIMITS={min:1,max:52};

/**
 * Powertrain acceptance — the user's hard constraint.
 *
 * `acceptablePowertrains` is the only list Algorithm 2 (vehicle DNA generation) and Algorithm 3
 * (real-vehicle matching) may draw from. A missing or unusable value means "open to everything",
 * which is how profiles created before this field migrate; an explicitly empty list stays empty
 * and blocks Step 4, because accepting no powertrain at all is not a usable demand.
 */
export const POWERTRAIN_VALUES=['ICE','HEV','PHEV','EV'];
export const CHARGING_POWERTRAINS=['PHEV','EV'];
const POWERTRAIN_ALIASES={ICE:'ICE','GASOLINE (ICE)':'ICE',GASOLINE:'ICE',GAS:'ICE',PETROL:'ICE','INTERNAL COMBUSTION':'ICE',HEV:'HEV','HYBRID (HEV)':'HEV',HYBRID:'HEV','FULL HYBRID':'HEV',PHEV:'PHEV','PLUG-IN HYBRID (PHEV)':'PHEV','PLUG-IN HYBRID':'PHEV','PLUGIN HYBRID':'PHEV',EV:'EV','ELECTRIC (EV)':'EV',ELECTRIC:'EV',BEV:'EV','BATTERY ELECTRIC':'EV'};
/** Canonical order, duplicates removed, unknown labels dropped. Non-arrays mean "all four". */
export function normalizePowertrains(value){if(!Array.isArray(value))return[...POWERTRAIN_VALUES];const accepted=new Set();value.forEach(item=>{const mapped=POWERTRAIN_ALIASES[String(item??'').trim().toUpperCase()];if(mapped)accepted.add(mapped)});return POWERTRAIN_VALUES.filter(item=>accepted.has(item))}
export const powertrainsRequireCharging=value=>normalizePowertrains(value).some(item=>CHARGING_POWERTRAINS.includes(item));
/**
 * The charging side of the demand profile as Algorithm 1 should read it.
 *
 * The answers the user typed are never deleted. When no accepted powertrain needs external
 * charging the questions are hidden, `chargingApplicable` becomes false and the *effective*
 * charging fields become null, so a hidden answer can never act as a live algorithm input. The
 * raw answers stay in `keptAnswers` (and in the stored profile) so re-accepting a plug-in type
 * brings them back untouched.
 */
export function chargingDemand(profile){const source=profile&&typeof profile==='object'?profile:{};const acceptablePowertrains=normalizePowertrains(source.acceptablePowertrains);const chargingApplicable=acceptablePowertrains.some(item=>CHARGING_POWERTRAINS.includes(item));const keptAnswers={homeCharging:source.homeCharging??null,workplaceCharging:source.workplaceCharging??null};return{chargingApplicable,acceptablePowertrains,excludedPowertrains:POWERTRAIN_VALUES.filter(item=>!acceptablePowertrains.includes(item)),effective:chargingApplicable?{...keptAnswers}:{homeCharging:null,workplaceCharging:null},keptAnswers,parking:source.parking??null,relation:chargingApplicable?'applicable':'not-applicable',reason:chargingApplicable?'At least one accepted vehicle type (PHEV or EV) can be charged externally, so the charging questions apply.':'None of the accepted vehicle types needs external charging (gasoline and non-plug-in hybrid only), so the charging questions do not apply.',enforcement:'Hard constraint: Algorithm 2 may only generate powertrains from acceptablePowertrains, and Algorithm 3 may only recommend real vehicles whose powertrain is in that list.'}}

/**
 * Step 5 priorities — what the car should optimize for, held as a canonical multi-select.
 *
 * The four concrete priorities are a free multi-select: any 1–4 of them may be combined and the
 * stored order always follows PRIORITY_VALUES instead of the click order. `balanced` is mutually
 * exclusive with them (it stands for all four goals at once) and is what a new profile starts with.
 * At least one entry always stays selected — Step 5 refuses to empty the list — so Algorithm 1 never
 * has to guess what a blank preference means.
 */
export const PRIORITY_VALUES=['save_money','save_time','environment','comfort_space','balanced'];
export const BALANCED_PRIORITY='balanced';
export const CONCRETE_PRIORITY_VALUES=PRIORITY_VALUES.filter(item=>item!==BALANCED_PRIORITY);
/** The new keys and the old single-select labels ('Save Money') both migrate to the same keys. */
const PRIORITY_ALIASES={SAVE_MONEY:'save_money','SAVE MONEY':'save_money',SAVE_TIME:'save_time','SAVE TIME':'save_time',ENVIRONMENT:'environment','PROTECT THE ENVIRONMENT':'environment','PROTECT ENVIRONMENT':'environment',COMFORT_SPACE:'comfort_space','COMFORT & SPACE':'comfort_space','MORE COMFORT & SPACE':'comfort_space',BALANCED:'balanced'};
/**
 * Canonical Step 5 value: the concrete priorities in canonical order, or `['balanced']` on its own.
 * A missing or empty-string value means "this profile predates the question", which defaults to
 * Balanced; an explicitly empty array stays empty so Step 5 can ask for at least one priority.
 */
export function normalizePriorities(value){if(value===undefined||value===null||value==='')return[BALANCED_PRIORITY];const items=Array.isArray(value)?value:[value];const chosen=new Set();items.forEach(item=>{const mapped=PRIORITY_ALIASES[String(item??'').trim().toUpperCase()];if(mapped)chosen.add(mapped)});if(chosen.has(BALANCED_PRIORITY))return[BALANCED_PRIORITY];return CONCRETE_PRIORITY_VALUES.filter(item=>chosen.has(item))}
/**
 * The priority side of the demand profile as Algorithm 1 should read it.
 *
 * Every selected priority is kept (never only the last click), the concrete selection is a free
 * 1–4 combination, and Balanced means "weight the four goals evenly" instead of adding a fifth goal.
 */
export function priorityDemand(profile){const source=profile&&typeof profile==='object'?profile:{};const selectedPriorities=normalizePriorities(source.selectedPriorities);const concretePriorities=selectedPriorities.filter(item=>item!==BALANCED_PRIORITY);const isBalanced=selectedPriorities.includes(BALANCED_PRIORITY);return{selectedPriorities,concretePriorities,isBalanced,allPriorityValues:PRIORITY_VALUES,balancedValue:BALANCED_PRIORITY,relation:isBalanced?'balanced':selectedPriorities.length?'combined':'empty',reason:isBalanced?'The user chose Balanced, so all four goals should carry the same weight instead of favoring one specific priority.':selectedPriorities.length?'The user combined specific priorities, so Algorithm 1 should weight every selected entry and drop none.':'No priority is selected yet, which Step 5 blocks before the profile can be submitted.',enforcement:'Algorithm 1 must read all of selectedPriorities and give every entry its own weight; Balanced is never combined with the four specific priorities.'}}
/**
 * The pure Step 5 click rule, shared by the picker and checkable without a browser.
 *
 * Returns the next canonical selection plus `blockedReason` (`''` when the click was applied,
 * `'only-priority-left'` or `'already-balanced'` when it was refused) so the UI can explain the
 * refusal without the model holding any user-facing copy. Balanced replaces the four specific
 * priorities, any specific priority replaces Balanced, and the last remaining priority can never be
 * switched off, which is what keeps the stored selection a usable Algorithm 1 input.
 */
export function togglePriority(current,next){const selected=normalizePriorities(current);if(next===BALANCED_PRIORITY){if(selected.length===1&&selected[0]===BALANCED_PRIORITY)return{selection:selected,blockedReason:'already-balanced',blockedPriority:next};return{selection:[BALANCED_PRIORITY],blockedReason:'',blockedPriority:''}}if(selected.includes(next)){const remaining=CONCRETE_PRIORITY_VALUES.filter(item=>item!==next&&selected.includes(item));if(!remaining.length)return{selection:selected,blockedReason:'only-priority-left',blockedPriority:next};return{selection:remaining,blockedReason:'',blockedPriority:''}}return{selection:CONCRETE_PRIORITY_VALUES.filter(item=>item===next||selected.includes(item)),blockedReason:'',blockedPriority:''}}

/** Counts typed by the user: whole numbers only, inside an explicit range, never invented. */
export function validateCount(value,{min,max}={}){
  const raw=String(value??'').trim();
  if(!raw)return{value:null,error:'Enter a whole number.'};
  if(!/^\d+$/.test(raw))return{value:null,error:'Whole numbers only (no decimals or signs).'};
  const parsed=Number(raw);
  if(!Number.isFinite(parsed))return{value:null,error:'Enter a whole number.'};
  if(min!==undefined&&parsed<min)return{value:null,error:`Must be ${min} or more.`};
  if(max!==undefined&&parsed>max)return{value:null,error:`Must be ${max} or less.`};
  return{value:parsed,error:''};
}
export const normalizeBodyType=value=>{const text=typeof value==='string'?value.trim():'';const migrated=BODY_TYPE_ALIASES[text]||text;return BODY_TYPE_VALUES.includes(migrated)?migrated:'No Preference'};
/**
 * Normalize the questionnaire body-style answer to the canonical database categories.
 *
 * `acceptableBodyTypes` is the current field. A legacy scalar `preferredBodyType` is migrated to a
 * one-element array. The legacy values "No Preference" and "Sports Car" used to mean an open market
 * (the database has no Sports Car records), so they migrate to every supported category. An explicit
 * empty array stays empty and is rejected by Step 2 instead of silently selecting cars for the user.
 */
export function normalizeBodyTypes(value){
  const list=Array.isArray(value)?value:typeof value==='string'&&value.trim()?[value]:[];
  const selected=new Set();
  let openMarket=false;
  list.forEach(item=>{
    const body=normalizeBodyType(item);
    if(body==='No Preference'||body==='Sports Car')openMarket=true;
    else if(DATABASE_BODY_TYPE_VALUES.includes(body))selected.add(body);
  });
  if(openMarket)DATABASE_BODY_TYPE_VALUES.forEach(body=>selected.add(body));
  return DATABASE_BODY_TYPE_VALUES.filter(body=>selected.has(body));
}
const defaultWeeks={School:40,Work:48,Shopping:52,Recreation:40,Other:40};
const normalizePoint=value=>{if(!value)return null;const lat=Number(value.lat??value.latitude),lng=Number(value.lng??value.longitude);return Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180?{lat,lng}:null};
const normalizePositive=value=>{const n=Number(value);return Number.isFinite(n)&&n>0?n:null};
const trimText=value=>(typeof value==='string'?value.trim():'');
const normalizeTrips=value=>{const n=Number(value);return Number.isFinite(n)?Math.min(TRIPS_PER_WEEK_LIMITS.max,Math.max(TRIPS_PER_WEEK_LIMITS.min,Math.round(n))):null};
const normalizeWeeks=value=>{const n=Number(value);return Number.isFinite(n)?Math.min(WEEKS_PER_YEAR_LIMITS.max,Math.max(WEEKS_PER_YEAR_LIMITS.min,Math.round(n))):null};
/**
 * Address record produced by the offline reverse geocoder. Only a real display name from local
 * OpenStreetMap data is kept; anything unrecognised becomes null instead of a made-up address.
 */
const normalizeAddress=value=>{if(!value||typeof value!=='object')return null;const displayName=trimText(value.displayName);if(!displayName)return null;const components=value.components&&typeof value.components==='object'?value.components:{};const part=key=>{const raw=trimText(components[key]);return raw||null};const distance=Number(value.distanceMetres);return{displayName,precision:value.precision||'none',relation:value.relation||'none',matchLabel:trimText(value.matchLabel),components:{houseNumber:part('houseNumber'),street:part('street'),city:part('city'),state:part('state'),postcode:part('postcode')},distanceMetres:Number.isFinite(distance)?distance:null,confidence:value.confidence||'none',source:value.source||'OpenStreetMap (ODbL 1.0)',sourceKind:trimText(value.sourceKind),detail:trimText(value.detail),offline:true,resolvedAt:value.resolvedAt||null}};
/** Home keeps its optional custom name and address; older `{lat,lng}` records stay valid. */
const normalizeHome=value=>{const point=normalizePoint(value);if(!point)return null;const customName=trimText(value.customName)||trimText(value.name);return{lat:point.lat,lng:point.lng,customName,address:normalizeAddress(value.address)}};
const normalizeDestination=(item,index)=>{const point=normalizePoint(item);if(!point)return null;const type=DESTINATION_TYPES.includes(item.type)?item.type:'Other';const customName=trimText(item.customName)||trimText(item.name);return{id:item.id||`migrated-${index}`,type,customName,name:customName,lat:point.lat,lng:point.lng,address:normalizeAddress(item.address),addressResolvedAt:item.addressResolvedAt||null,roundTripsPerWeek:normalizeTrips(item.roundTripsPerWeek)??1,weeksPerYear:normalizeWeeks(item.weeksPerYear)??defaultWeeks[type],routeDistanceMiles:normalizePositive(item.routeDistanceMiles),routeMethod:item.routeMethod||null,routeComputedAt:item.routeComputedAt||null}};
export function normalizeProfile(source){const p=source&&typeof source==='object'?source:{};const wasPurchase=String(p.purchaseIntention||'').toLowerCase()==='buy';const safeBudget=!p.purchaseIntention||wasPurchase?p.budget??'':'';const {leaseMonthlyBudget,rentalDailyBudget,priority:legacyPriority,...supported}=p;const destinations=Array.isArray(p.destinations)?p.destinations.map(normalizeDestination).filter(Boolean):[];const acceptablePowertrains=normalizePowertrains(p.acceptablePowertrains);const bodySource=Array.isArray(p.acceptableBodyTypes)||typeof p.acceptableBodyTypes==='string'?p.acceptableBodyTypes:p.preferredBodyType;const acceptableBodyTypes=normalizeBodyTypes(bodySource);const preferredBodyType=acceptableBodyTypes.length===1?acceptableBodyTypes[0]:(acceptableBodyTypes[0]||'No Preference');return {...emptyProfile,...supported,acceptablePowertrains,acceptableBodyTypes,chargingApplicable:acceptablePowertrains.some(item=>CHARGING_POWERTRAINS.includes(item)),purchaseIntention:'buy',budget:safeBudget,preferredBodyType,homeLocation:normalizeHome(p.homeLocation),selectedPriorities:normalizePriorities(p.selectedPriorities??legacyPriority),destinations};}
export function validateStep(step,p){const e={};if(step===1){if(!p.role)e.role='Choose a role.';if(!Number.isFinite(+p.ownershipDurationMonths)||+p.ownershipDurationMonths<1||+p.ownershipDurationMonths>600)e.ownershipDurationMonths='Enter 1–600 months.';}if(step===2){if(!Number.isFinite(+p.budget)||+p.budget<1000)e.budget='Enter a purchase budget of at least $1,000.';const selectedBodyTypes=normalizeBodyTypes(Array.isArray(p.acceptableBodyTypes)||typeof p.acceptableBodyTypes==='string'?p.acceptableBodyTypes:p.preferredBodyType);if(!selectedBodyTypes.length)e.acceptableBodyTypes='Choose at least one body style.';else if(selectedBodyTypes.some(body=>!DATABASE_BODY_TYPE_VALUES.includes(body)))e.acceptableBodyTypes='Choose only the body styles supported by the vehicle database.';if(+p.minimumSeats<1||+p.minimumSeats>15)e.minimumSeats='Enter 1–15 seats.';}if(step===3){if(!normalizePoint(p.homeLocation))e.homeLocation='Set home on the local San Jose map or type coordinates.';if(!p.destinations.length)e.destinations='Add at least one frequent destination.';else if(p.destinations.some(d=>!d.type||!Number.isInteger(d.roundTripsPerWeek)||d.roundTripsPerWeek<TRIPS_PER_WEEK_LIMITS.min||d.roundTripsPerWeek>TRIPS_PER_WEEK_LIMITS.max||d.weeksPerYear<WEEKS_PER_YEAR_LIMITS.min||d.weeksPerYear>WEEKS_PER_YEAR_LIMITS.max||!normalizePoint(d)))e.destinations='Each destination needs coordinates, a type, 0–21 weekly round trips, and 1–52 weeks/year.';else if(p.destinations.some(d=>!normalizePositive(d.routeDistanceMiles)))e.destinations='Waiting for the offline road distance of every destination. Keep the map open until each route shows a distance.';}if(step===4){if(!normalizePowertrains(p.acceptablePowertrains).length)e.acceptablePowertrains='Keep at least one vehicle type selected.';if(!p.estimateMileageLater&&(!Number.isFinite(+p.annualMileage)||+p.annualMileage<0||+p.annualMileage>200000))e.annualMileage='Enter 0–200,000 miles, or estimate later.';if(!Number.isFinite(+p.longDistanceTripsPerYear)||+p.longDistanceTripsPerYear<0||+p.longDistanceTripsPerYear>1000)e.longDistanceTripsPerYear='Enter 0–1,000 long-distance trips per year.';if(!Number.isFinite(+p.longDistanceRoundTripMiles)||+p.longDistanceRoundTripMiles<0||+p.longDistanceRoundTripMiles>20000)e.longDistanceRoundTripMiles='Enter 0–20,000 miles per round trip.';}if(step===5){if(!normalizePriorities(p.selectedPriorities).length)e.selectedPriorities='Keep at least one priority selected.';}return e;}
