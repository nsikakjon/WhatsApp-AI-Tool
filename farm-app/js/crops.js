"use strict";
/* =====================================================================
   CROP LIBRARY: southern Nigeria
   Figures are typical ranges for planning, drawn from common extension
   guidance (CRIN, NIFOR, IITA/NRCRI, ADPs). They are not prescriptions:
   chemical products and rates must always follow the label and local
   extension advice.
   ===================================================================== */

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DAY = 86400000;

/* Southern Nigeria seasons (rough): long rains Mar–Jul, "August break",
   short rains Sep–Oct, dry season Nov–Mar with harmattan Dec–Feb. */
const SEASON = m => (m>=11||m<=2) ? (m===11?"Dry season":"Harmattan / dry season") : m===3 ? "Early rains" : m<=7 ? "Long rains" : m===8 ? "August break" : "Short rains";

/* Task rule kinds:
   dap:     one-off, `day` days after planting
   yearly:  once a year on the 15th of each month in `months`
   every:   every `days` days (anchored on planting date) while the month is in `months`
   Optional minM / maxM limit by crop age in months. */
const CROPS = {
  cocoa: {
    name:"Cocoa", latin:"Theobroma cacao", perennial:true, color:"#7a4a2a",
    spacing:[3,3], unit:"kg dry beans", yieldPerHa:[300,550,1000], bearAt:36, fullAt:72, lifeM:300,
    harvestMonths:[10,11,12,1,2,5,6,7], peakMonths:[10,11,12,1],
    harvestNote:"Main crop Oct–Feb, light crop May–Aug",
    varieties:["CRIN TC1–TC8 hybrids","Amelonado (local)","Trinitario","F3 Amazon","Other / unknown"],
    stages:[[0,"Establishment"],[12,"Juvenile"],[36,"Early bearing"],[72,"Peak bearing"],[300,"Ageing: plan rehabilitation"]],
    tasks:[
      {id:"bp",  kind:"every", days:21, months:[5,6,7,8,9,10], minM:30, t:"Black pod spray round", d:"Copper or metalaxyl-based fungicide on pods, label rate. Remove and bury black pods first."},
      {id:"cap", kind:"yearly", months:[8,9,10,12], minM:12, t:"Mirid (capsid) spray", d:"CRIN-recommended insecticide against mirids/capsids. Spray in the cool of the morning."},
      {id:"hv",  kind:"every", days:14, months:[10,11,12,1,2,5,6,7], minM:36, t:"Harvest round", d:"Pick ripe pods only, break within 3 days, and remove diseased pods during the same round."},
      {id:"pr",  kind:"yearly", months:[2], minM:18, t:"Pruning & chupon removal", d:"Remove chupons, dead and diseased branches and mistletoe. Open the canopy for air flow."},
      {id:"sl",  kind:"yearly", months:[4,9], t:"Slashing / weeding", d:"Slash undergrowth, mostly on young farms and around new plantings."},
      {id:"fe",  kind:"yearly", months:[5], minM:12, t:"Fertiliser application", d:"After the rains are established. Use soil test results if you have them."},
      {id:"sh",  kind:"yearly", months:[3], maxM:48, t:"Check shade for young trees", d:"Plantain or temporary shade for seedlings, and replace dead stands before the rains."},
      {id:"fb",  kind:"yearly", months:[12], t:"Fire break before harmattan", d:"Clear a 5–10 m strip around the farm. Bush burning is a big risk Dec–Feb."}
    ],
    issues:["Black pod","Mirid / capsid damage","Swollen shoot (CSSVD)","Mistletoe","Cherelle wilt","Termites","Squirrel / rodent damage","Stem borer","Overgrown weeds","Too much / too little shade"],
    measures:[{k:"pods",l:"Healthy pods per tree (avg)"},{k:"blackpods",l:"Black pods counted"},{k:"trees",l:"Trees sampled"}],
    tips:["Ferment beans 5–6 days, turning every 2 days, then sun-dry to ~7% moisture. Good fermentation earns better prices.","A standard cocoa bag is 64 kg of dry beans.","Black pod spreads fastest in long rains with humidity above 85%. Sanitation harvest every 2 weeks cuts losses a lot."]
  },
  oilpalm: {
    name:"Oil palm", latin:"Elaeis guineensis", perennial:true, color:"#b8541b",
    spacing:[9,9,"tri"], unit:"t FFB", yieldPerHa:[4,8,15], bearAt:30, fullAt:84, lifeM:300,
    harvestMonths:[1,2,3,4,5,6,7,8,9,10,11,12], peakMonths:[2,3,4,5],
    harvestNote:"All year round, with a peak Feb–May",
    varieties:["Tenera (NIFOR hybrid)","Dura (wild / local)","Pisifera","Other / unknown"],
    stages:[[0,"Immature: establishment"],[12,"Immature"],[30,"Early harvest"],[84,"Peak production"],[216,"Declining: plan replanting"]],
    tasks:[
      {id:"hv", kind:"every", days:12, minM:30, t:"Harvest round", d:"Cut bunches with 5+ loose fruits on the ground. Collect all loose fruits, and get FFB to the mill within 24–48 h."},
      {id:"rw", kind:"yearly", months:[3,6,9,12], t:"Ring weeding (2 m circle)", d:"Clear a 2 m ring around each palm so fertiliser works and loose fruits can be found."},
      {id:"sl", kind:"yearly", months:[5,8,11], t:"Slash inter-rows", d:"Keep the paths open. Stack pruned fronds between the rows."},
      {id:"pr", kind:"yearly", months:[1,7], minM:30, t:"Pruning", d:"Keep 2 fronds below the lowest bunch on young palms and 1 on old palms. Stack fronds in the inter-rows."},
      {id:"fe", kind:"yearly", months:[4,9], t:"Fertiliser (split dose)", d:"NPK plus potash (MOP) and magnesium (kieserite) in the ring, early and late in the rains. Follow a soil/leaf test if available."},
      {id:"rb", kind:"yearly", months:[1,2,3,4,5,6,7,8,9,10,11,12], maxM:48, t:"Check young palms for rhinoceros beetle", d:"Look for V-cuts in the fronds and holes at the spear. Remove rotting trunks and heaps where they breed."},
      {id:"cs", kind:"yearly", months:[1], t:"Palm census & supplying", d:"Count palms, mark dead or sick ones (Ganoderma, wilt) and plan vacancy filling for the rains."},
      {id:"fb", kind:"yearly", months:[12], t:"Fire break before harmattan", d:"Clear a strip round the plantation and keep fronds away from the boundary."}
    ],
    issues:["Orange-spotted / yellow fronds (K/Mg)","Rhinoceros beetle","Leaf miner","Rats on bunches","Ganoderma (basal stem rot)","Vascular wilt (Fusarium)","Bunch rot","Unripe bunches harvested","Loose fruits left","Weeds in rings"],
    measures:[{k:"bunches",l:"Ripe bunches harvested"},{k:"bunchkg",l:"Average bunch weight (kg)"},{k:"palms",l:"Palms checked"}],
    tips:["Tenera palms give roughly 20–25% oil at a mill. Traditional processing usually gets about 12–16%.","Dry spells now reduce bunch numbers about 2 years later, so mulch with empty bunches and fronds.","A full stand at 9 m triangular spacing is about 143 palms per hectare."]
  },
  cassava: {
    name:"Cassava", latin:"Manihot esculenta", perennial:false, color:"#8a6b3d",
    spacing:[1,1], unit:"t fresh roots", yieldPerHa:[8,15,25], harvestDays:365, harvestWindow:[270,540],
    plantMonths:[3,4,5,9,10],
    varieties:["TME 419","TMS 30572","UMUCASS 36 (yellow)","UMUCASS 37 (yellow)","UMUCASS 38 (yellow)","TMS 98/0505","Game Changer (TMS 13F1160P0004)","Local variety"],
    stages:[[0,"Sprouting"],[1,"Establishment"],[3,"Root bulking"],[8,"Maturing"],[12,"Ready to harvest"],[18,"Over-mature: roots getting woody"]],
    tasks:[
      {id:"sp", kind:"dap", day:21, t:"Check sprouting & replace missing stands", d:"Replant gaps with fresh, healthy stems (20–25 cm, 5–7 nodes)."},
      {id:"w1", kind:"dap", day:21, t:"1st weeding (3 weeks)", d:"Early weed control matters most: weeds in the first 3–4 months can halve yield."},
      {id:"fe", kind:"dap", day:42, t:"Fertiliser (NPK 15:15:15)", d:"Ring-apply 4–8 weeks after planting, away from the stem, on moist soil."},
      {id:"w2", kind:"dap", day:56, t:"2nd weeding (8 weeks)", d:""},
      {id:"c1", kind:"dap", day:60, t:"Scout for mosaic disease (CMD)", d:"Uproot and destroy plants with mottled, twisted leaves. Don't use them for stems."},
      {id:"w3", kind:"dap", day:84, t:"3rd weeding (12 weeks)", d:"After this the canopy usually closes."},
      {id:"dm", kind:"yearly", months:[12,1,2,3], maxM:14, t:"Dry-season pest check", d:"Look for green mite and mealybug on shoot tips (bunchy, yellowed tops)."},
      {id:"hp", kind:"dap", day:330, t:"Line up buyers / processor", d:"Roots spoil 2–3 days after harvest. Book the garri/fufu processor, starch factory or offtaker first."},
      {id:"hv", kind:"dap", day:365, t:"Harvest window opens", d:"Harvest in batches to match what you can sell or process within 48 h."},
      {id:"ov", kind:"dap", day:540, t:"Harvest now: over-mature", d:"After about 18 months roots get woody and starch content falls."}
    ],
    issues:["Mosaic disease (CMD)","Mealybug","Green mite","Bacterial blight","Brown leaf spot","Grasshoppers","Termites","Root rot (waterlogging)","Grasscutter / rodent damage","Missing stands","Weeds overgrown"],
    measures:[{k:"height",l:"Plant height (cm)"},{k:"cmd",l:"Plants with CMD (%)"},{k:"stands",l:"Stands counted"}],
    tips:["At 1 m × 1 m spacing that is 10,000 stands per hectare.","Process or sell roots within 48 hours of harvest.","Yellow (pro-vitamin A) varieties like UMUCASS 36–38 often sell at a premium for garri."]
  },
  plantain: {
    name:"Plantain", latin:"Musa spp.", perennial:false, color:"#6b8f2a",
    spacing:[3,2], unit:"bunches", yieldPerHa:[600,1000,1500], harvestDays:420, harvestWindow:[360,480],
    plantMonths:[3,4,5,9],
    varieties:["Agbagba (False Horn)","Orishele (French)","PITA hybrids","Other"],
    stages:[[0,"Establishment"],[2,"Vegetative growth"],[8,"Flowering (shooting)"],[11,"Bunch filling"],[13,"Harvest"]],
    tasks:[
      {id:"w1", kind:"dap", day:30, t:"Weeding", d:""},
      {id:"fe1", kind:"dap", day:60, t:"Fertiliser (1st)", d:"NPK or poultry manure in a ring around the plant."},
      {id:"w2", kind:"dap", day:90, t:"Weeding", d:""},
      {id:"ds", kind:"every", days:60, minM:4, maxM:16, t:"Desuckering", d:"Keep 1 strong follower sucker per mat and remove the rest."},
      {id:"fe2", kind:"dap", day:150, t:"Fertiliser (2nd)", d:""},
      {id:"pp", kind:"dap", day:270, t:"Prop plants at bunch emergence", d:"Bamboo or poles stop wind snapping heavy bunches."},
      {id:"ml", kind:"yearly", months:[11,12], t:"Mulch for dry season", d:"Thick mulch keeps moisture in through the harmattan."},
      {id:"hv", kind:"dap", day:420, t:"Harvest bunches", d:"Harvest when fingers are full and rounded."}
    ],
    issues:["Black Sigatoka (leaf streak)","Banana weevil","Nematodes (toppling)","Wind damage","Bunchy top","Weeds"],
    measures:[{k:"bunched",l:"Plants with bunches"},{k:"plants",l:"Plants checked"}],
    tips:["3 m × 2 m spacing is about 1,667 stands per hectare.","Plantain makes good temporary shade for young cocoa."]
  },
  maize: {
    name:"Maize", latin:"Zea mays", perennial:false, color:"#c9a227",
    spacing:[0.75,0.25], unit:"t grain", yieldPerHa:[1.5,3,5], harvestDays:110, harvestWindow:[75,130],
    plantMonths:[3,4,8,9],
    varieties:["SAMMAZ (open-pollinated)","Oba Super hybrids","Yellow local","White local","Sweet corn"],
    stages:[[0,"Emergence"],[0.7,"Vegetative"],[1.8,"Tasselling & silking"],[2.5,"Grain filling"],[3.3,"Mature"]],
    tasks:[
      {id:"w1", kind:"dap", day:14, t:"1st weeding", d:""},
      {id:"fe", kind:"dap", day:18, t:"Fertiliser (NPK 15:15:15)", d:"Side-place 5–7 cm from the plants."},
      {id:"faw", kind:"every", days:7, maxM:2, t:"Scout for fall armyworm", d:"Look for windowed leaves and frass in the funnel. Act early."},
      {id:"w2", kind:"dap", day:35, t:"2nd weeding", d:""},
      {id:"td", kind:"dap", day:40, t:"Top-dress with urea", d:"Apply before tasselling."},
      {id:"gc", kind:"dap", day:75, t:"Green maize harvest (if selling fresh)", d:""},
      {id:"hv", kind:"dap", day:110, t:"Dry grain harvest", d:"Harvest when the husks are dry. Dry the grain to ~13% before storing."}
    ],
    issues:["Fall armyworm","Stem borer","Maize streak virus","Leaf blight","Lodging","Birds / monkeys","Weeds"],
    measures:[{k:"faw",l:"Plants with armyworm damage (%)"},{k:"height",l:"Plant height (cm)"}],
    tips:["Southern Nigeria gets two maize seasons: plant Mar–Apr and again Aug–Sep."]
  },
  yam: {
    name:"Yam", latin:"Dioscorea spp.", perennial:false, color:"#8c5a3c",
    spacing:[1,1], unit:"t tubers", yieldPerHa:[8,14,22], harvestDays:270, harvestWindow:[180,300],
    plantMonths:[2,3,4],
    varieties:["White yam (D. rotundata)","Water yam (D. alata)","Yellow yam","Other"],
    stages:[[0,"Sprouting"],[1.5,"Vine growth"],[4,"Tuber bulking"],[7,"Maturing"],[9,"Harvest"]],
    tasks:[
      {id:"ml", kind:"dap", day:1, t:"Mulch the mounds", d:"Keeps sets cool and moist until the rains."},
      {id:"st", kind:"dap", day:40, t:"Staking", d:"Stake 4–6 weeks after emergence."},
      {id:"w1", kind:"dap", day:45, t:"1st weeding", d:""},
      {id:"fe", kind:"dap", day:60, t:"Fertiliser", d:""},
      {id:"w2", kind:"dap", day:100, t:"2nd weeding", d:""},
      {id:"w3", kind:"dap", day:150, t:"3rd weeding", d:""},
      {id:"mk", kind:"dap", day:180, t:"Milking (early harvest), optional", d:"Carefully take the first tuber and leave the plant for seed yam."},
      {id:"hv", kind:"dap", day:270, t:"Harvest", d:"When the vines dry. Store in a ventilated barn."}
    ],
    issues:["Yam beetle","Nematodes","Anthracnose","Yam mosaic virus","Termites","Tuber rot"],
    measures:[{k:"stands",l:"Stands counted"}],
    tips:["Yam is usually planted at the end of the dry season (Feb–Apr)."]
  }
};
const CROP_ORDER = ["cocoa","oilpalm","cassava","plantain","maize","yam"];

/* Approximate state capital coordinates: used as a weather location
   until a field has a boundary or a pin. */
const STATES = {
  "Abia":[5.53,7.49],"Akwa Ibom":[5.04,7.91],"Anambra":[6.21,7.07],"Bayelsa":[4.92,6.26],"Cross River":[4.96,8.33],
  "Delta":[6.20,6.73],"Ebonyi":[6.32,8.11],"Edo":[6.34,5.62],"Ekiti":[7.62,5.22],"Enugu":[6.44,7.50],"Imo":[5.48,7.03],
  "Lagos":[6.60,3.35],"Ogun":[7.15,3.35],"Ondo":[7.25,5.19],"Osun":[7.77,4.56],"Oyo":[7.38,3.94],"Rivers":[4.82,7.03],
  "Kogi":[7.80,6.74],"Kwara":[8.50,4.55],"Benue":[7.73,8.54],"FCT Abuja":[9.06,7.49]
};

/* ---------- helpers ---------- */
const ymd = d => { const x=new Date(d); return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,"0")}-${String(x.getDate()).padStart(2,"0")}`; };
const parseYmd = s => { const [y,m,d]=String(s).split("-").map(Number); return new Date(y,(m||1)-1,d||1); };
const ageMonths = (planted, now=new Date()) => planted ? (now - parseYmd(planted))/DAY/30.44 : null;
const plantsPerHa = c => { const s=CROPS[c]?.spacing; if(!s) return null; return s[2]==="tri" ? Math.round(10000/(s[0]*s[0]*0.866)) : Math.round(10000/(s[0]*s[1])); };

function cropStage(cropId, planted, now=new Date()){
  const c=CROPS[cropId]; if(!c||!planted) return null;
  const am=ageMonths(planted,now); if(am<0) return {label:"Not yet planted", progress:0, am};
  let label=c.stages[0][1]; for(const [m,l] of c.stages) if(am>=m) label=l;
  if(c.perennial){
    const years=am/12;
    const bearing = am>=c.bearAt;
    const progress = Math.min(1, am/c.fullAt);
    return {label, am, years, bearing, progress, ageText: years>=1? `Year ${Math.floor(years)+1}` : `${Math.max(1,Math.round(am))} mo old`};
  }
  const days=(now-parseYmd(planted))/DAY, hd=c.harvestDays;
  return {label, am, days, progress:Math.min(1,days/hd), daysToHarvest:Math.round(hd-days), harvestDate:new Date(parseYmd(planted).getTime()+hd*DAY),
    window:c.harvestWindow, ageText: days<60? `Day ${Math.round(days)}` : `Month ${Math.floor(am)+1}`};
}

/* yield estimate for the current year or cycle: [low, typical, good] in crop units */
function yieldEstimate(cropId, planted, ha, now=new Date()){
  const c=CROPS[cropId]; if(!c||!ha) return null;
  let f=1;
  if(c.perennial){
    const am=ageMonths(planted,now)??c.fullAt;
    if(am<c.bearAt) f=0; else if(am<c.fullAt) f=0.3+0.7*(am-c.bearAt)/(c.fullAt-c.bearAt);
    if(c.lifeM && am>c.lifeM) f*=0.6;
  }
  return c.yieldPerHa.map(v=>v*ha*f);
}

/* ---------- task generation ---------- */
function genTasks(field, from, to){
  const c=CROPS[field.crop?.id]; if(!c) return [];
  const planted = field.crop.planted ? parseYmd(field.crop.planted) : null;
  const out=[];
  const okAge = (r,d)=>{ if(!planted) return !r.minM; const am=(d-planted)/DAY/30.44; if(am<0) return false; if(r.minM!=null && am<r.minM) return false; if(r.maxM!=null && am>r.maxM) return false; return true; };
  for(const r of c.tasks){
    if(r.kind==="dap"){
      if(!planted) continue;
      const d=new Date(planted.getTime()+r.day*DAY);
      if(d>=from && d<=to) out.push({rule:r,date:d});
    } else if(r.kind==="yearly"){
      for(let y=from.getFullYear(); y<=to.getFullYear(); y++) for(const m of r.months){
        const d=new Date(y,m-1,15); if(d>=from && d<=to && okAge(r,d)) out.push({rule:r,date:d});
      }
    } else if(r.kind==="every"){
      const anchor = planted || new Date(from.getFullYear(),0,1);
      let k=Math.ceil((from-anchor)/DAY/r.days); if(k<0) k=0;
      for(;;k++){
        const d=new Date(anchor.getTime()+k*r.days*DAY); if(d>to) break;
        if(d<from) continue;
        if(r.months && !r.months.includes(d.getMonth()+1)) continue;
        if(okAge(r,d)) out.push({rule:r,date:d});
      }
    }
  }
  return out.map(x=>({id:`${field.id}:${x.rule.id}@${ymd(x.date)}`, rule:`${field.id}:${x.rule.id}`, every:x.rule.kind==="every"?x.rule.days:null, fieldId:field.id, title:x.rule.t, detail:x.rule.d, date:ymd(x.date), auto:true}));
}

/* ---------- weather summary + insights ---------- */
function wxSummary(wx){
  if(!wx||!wx.daily) return null;
  const today=ymd(new Date()), D=wx.daily, idx=D.time.indexOf(today);
  const t=idx<0? D.time.length-8 : idx;
  const sum=(a,b)=>D.precipitation_sum.slice(Math.max(0,a),Math.max(0,b)).reduce((s,v)=>s+(v||0),0);
  const rh=wx.rhDaily||[];
  const rain7=sum(t-7,t), rain30=sum(t-30,t), next3=sum(t,t+3), next7=sum(t,t+7);
  const rainDays7=D.precipitation_sum.slice(Math.max(0,t-7),t).filter(v=>v>=1).length;
  const rh7=rh.slice(Math.max(0,t-7),t).filter(v=>v!=null); const rhAvg7=rh7.length? rh7.reduce((a,b)=>a+b,0)/rh7.length : null;
  const et30=(D.et0_fao_evapotranspiration||[]).slice(Math.max(0,t-30),t).reduce((s,v)=>s+(v||0),0);
  return {rain7,rain30,next3,next7,rainDays7,rhAvg7,balance30:rain30-et30,tomorrow:D.precipitation_sum[t+1]??0,
    tmax:D.temperature_2m_max[t], tmin:D.temperature_2m_min[t], cur:wx.current, soil:wx.soil, t};
}

function insights(field, wx, now=new Date()){
  const out=[]; const c=CROPS[field.crop?.id]; const m=now.getMonth()+1; const S=wxSummary(wx);
  const st = c ? cropStage(field.crop.id, field.crop.planted, now) : null;
  const add=(level,title,text)=>out.push({level,title,text});
  if(c && S){
    if(field.crop.id==="cocoa"){
      if(S.rainDays7>=4 && (S.rhAvg7??0)>=85) add("high","Black pod risk is high",`${S.rainDays7} wet days this week and humidity around ${Math.round(S.rhAvg7)}%. Do a sanitation harvest, remove black pods and keep the 3-weekly spray round.`);
      else if([5,6,7,8,9,10].includes(m)) add("med","Black pod season",`Long rains favour Phytophthora. Keep the canopy open and pods sprayed.`);
      if([8,9,10,11,12].includes(m)) add("med","Mirid (capsid) season","Watch for dark lesions on pods and dying shoot tips. Follow the CRIN spray calendar.");
      if((m>=12||m<=2) && st && st.am<36 && S.rain30<20) add("high","Young trees under dry-season stress","Mulch the seedlings, check their shade and water them if you can. Harmattan kills young cocoa.");
    }
    if(field.crop.id==="oilpalm"){
      if(S.balance30 < -60) add("med","Water deficit building",`Rain over the last 30 days was ${Math.round(-S.balance30)} mm short of what the palms used. That lowers bunch yields 19–24 months from now. Mulch with fronds or empty bunches.`);
      if([2,3,4,5].includes(m) && st?.bearing) add("info","Peak bunch season","Shorten harvest rounds to 7–10 days so bunches don't over-ripen and loose fruits aren't lost.");
      if(st && st.am<48) add("med","Young palms: rhinoceros beetle","Check spears and new fronds monthly, and remove decaying trunks and heaps nearby.");
    }
    if(field.crop.id==="cassava"){
      if((m>=12||m<=3) && S.rain30<30) add("med","Dry season: mites & mealybug","Check the shoot tips for bunchy, yellow tops. Rain usually brings the numbers down.");
      if(S.rain7>120) add("med","Waterlogging risk","Heavy rain this week can cause root rot on flat or clay land. Clear the drainage furrows.");
      if([3,4,5,6].includes(m) && st && st.am<4) add("med","Grasshopper season","Variegated grasshoppers attack young cassava in the early rains.");
      if(st && st.days>540) add("high","Roots are over-mature","Past 18 months, roots get woody and lose starch. Harvest as soon as you can.");
      else if(st && st.days>=270) add("info","In the harvest window","Harvest in batches you can sell or process within 48 hours.");
    }
    if(field.crop.id==="maize" && st && st.days<60) add("med","Fall armyworm watch","Scout weekly. Look for ragged 'windowed' leaves and sawdust-like frass in the funnel.");
    if(field.crop.id==="plantain" && [11,12,1,2].includes(m)) add("med","Dry season","Mulch heavily and prop any plants carrying bunches before harmattan winds.");
    if(field.crop.id==="yam" && st && st.days>=270) add("info","Ready for harvest","Harvest once the vines dry and store the tubers in a ventilated barn.");
  }
  if(S){
    if(S.next3>50) add("high","Heavy rain coming",`${Math.round(S.next3)} mm forecast in the next 3 days. Hold off on fertiliser and sprays, and check the drains.`);
    else if(S.tomorrow>=5) add("info","Rain tomorrow",`About ${Math.round(S.tomorrow)} mm expected. Spray today, or wait for a dry window.`);
    if((m===12||m<=2) && S.rain30<10) add("med","Harmattan fire risk","Keep fire breaks clear and talk to your neighbours about bush burning.");
  }
  // satellite: a clear drop in greenness compared with recent clear views
  const ser=field.sat?.series;
  if(ser && ser.length>=4){
    const last=ser[ser.length-1], prev=ser.slice(-4,-1).map(x=>x.mean).sort((a,b)=>a-b)[1];
    if(prev-last.mean>=0.1) add("med","Satellite: field looks less green",`Greenness fell from about ${prev.toFixed(2)} to ${last.mean.toFixed(2)} (${last.date}). Walk the field: it could be pests, disease, drought, pruning or harvest.`);
  }
  // scouting follow-ups
  const sc=(field.scouts||[]).slice().sort((a,b)=>b.date.localeCompare(a.date));
  if(field.crop?.id){
    if(!sc.length) add("info","No scouting yet","Walk the field and log what you see. It builds a health history.");
    else {
      const days=Math.round((now-parseYmd(sc[0].date))/DAY);
      if(days>14) add("med",`Last scouted ${days} days ago`,"A walk-through every 1–2 weeks catches pests early.");
      if(sc[0].issues?.length) add(sc[0].health<=2?"high":"med","Follow up on last scouting",sc[0].issues.join(", ")+".");
    }
  }
  const rank={high:0,med:1,info:2,low:3};
  return out.sort((a,b)=>rank[a.level]-rank[b.level]);
}

const WMO = c => c==null? ["—","cloud"] : c===0? ["Clear","sun"] : c<=2? ["Partly cloudy","partly"] : c===3? ["Overcast","cloud"] : c<=48? ["Hazy / fog","cloud"] : c<=57? ["Drizzle","rain"] : c<=67? ["Rain","rain"] : c<=82? ["Showers","rain"] : ["Thunderstorm","storm"];
