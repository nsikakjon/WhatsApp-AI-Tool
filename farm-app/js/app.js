"use strict";
/* =====================================================================
   OKO by yarnOga: farm & land app (personal edition)
   Data lives on this phone (IndexedDB). Weather: Open-Meteo.
   ===================================================================== */
const APP_NAME = "Oko";
const $ = s=>document.querySelector(s), $$ = s=>[...document.querySelectorAll(s)];

/* ---------------- icons ---------------- */
const IC = {
  home:'<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  map:'<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  tasks:'<rect x="4" y="4" width="16" height="16" rx="4"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  user:'<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
  back:'<path d="M19 12H5M11 6l-6 6 6 6"/>',
  chat:'<path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12z"/><path d="M8.5 11h.01M12 11h.01M15.5 11h.01"/>',
  expand:'<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>',
  edit:'<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13 7 4 4"/>',
  drop:'<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
  thermo:'<path d="M14 14.8V5a2 2 0 1 0-4 0v9.8a4 4 0 1 0 4 0z"/>',
  rain:'<path d="M7 15a4 4 0 0 1 .5-8A5.5 5.5 0 0 1 18 8a3.5 3.5 0 0 1-.5 7z"/><path d="m8 18-1 2m5-2-1 2m5-2-1 2"/>',
  wind:'<path d="M3 8h11a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h8"/>',
  humid:'<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/><path d="M9.5 15a2.5 2.5 0 0 0 2.5 2.5"/>',
  soil:'<path d="M3 12h18M3 16h18M3 20h18"/><path d="M12 12V5m0 3c-2 0-3.5-1.5-3.5-3.5C10.5 4.5 12 6 12 8zm0 0c2 0 3.5-1.5 3.5-3.5C13.5 4.5 12 6 12 8z"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  cloud:'<path d="M7 18a4.5 4.5 0 0 1-.6-9A6 6 0 0 1 18 9.5a4 4 0 0 1-.5 8.5z"/>',
  partly:'<path d="M8 4v1.5M3.5 8.5H5M4.6 5.1l1 1M12 6.2a3.5 3.5 0 0 0-6.6 2"/><path d="M8.5 19a4 4 0 0 1-.4-8 5.2 5.2 0 0 1 9.9 1.4A3.3 3.3 0 0 1 17.5 19z"/>',
  storm:'<path d="M7 15a4 4 0 0 1 .5-8A5.5 5.5 0 0 1 18 8a3.5 3.5 0 0 1-.5 7"/><path d="m12 13-2 4h4l-2 4"/>',
  pin:'<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  nav:'<path d="m3 11 18-8-8 18-2-8z"/>',
  globe:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18"/>',
  share:'<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.4m-7.6 6.8 7.6 4.4"/>',
  arrow:'<path d="M7 17 17 7M8 7h9v9"/>',
  chev:'<path d="m9 6 6 6-6 6"/>',
  alert:'<path d="M12 4 2.5 20h19z"/><path d="M12 10v4m0 3v.01"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8v.01"/>',
  leaf:'<path d="M5 19c0-8 5-13 15-14-1 10-6 15-14 15"/><path d="M5 19 14 10"/>',
  sprout:'<path d="M12 20v-8"/><path d="M12 12c0-3-2-5-6-5 0 3 2 5 6 5zm0 0c0-3.5 2.5-6 7-6 0 3.5-2.5 6-7 6z"/>',
  bug:'<rect x="8" y="7" width="8" height="12" rx="4"/><path d="M12 7V5m-3-2 1.5 2M15 3l-1.5 2M4 11h4m8 0h4M4 17l4-1m8 1 4 1"/>',
  cal:'<rect x="4" y="5" width="16" height="16" rx="3"/><path d="M4 10h16M9 3v4m6-4v4"/>',
  coin:'<circle cx="12" cy="12" r="9"/><path d="M8 8v8m8-8v8M8 8l8 8M6.5 11h11m-11 2h11"/>',
  ruler:'<path d="m3 17 14-14 4 4L7 21z"/><path d="m7 13 2 2m1-5 2 2m1-5 2 2"/>',
  layers:'<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  minus:'<path d="M5 12h14"/>',
  target:'<circle cx="12" cy="12" r="7"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/><circle cx="12" cy="12" r="1.5"/>',
  camera:'<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  doc:'<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6m-6 4h6"/>',
  check:'<path d="m5 12 4.5 4.5L19 7"/>',
  trash:'<path d="M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  dl:'<path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14"/>',
  wa:'<path d="M4 20l1.3-3.9A8 8 0 1 1 8 19z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 .8a4 4 0 0 1-2-2l.8-1-1-2z"/>'
};
const CROP_IC = {
  cocoa:'<path d="M12 3c4 0 6.5 4.5 6.5 9S16 21 12 21s-6.5-4.5-6.5-9S8 3 12 3z"/><path d="M12 3v18M8.5 5.5c-1 4-1 9 0 13M15.5 5.5c1 4 1 9 0 13"/>',
  oilpalm:'<path d="M12 21v-9"/><path d="M12 12c-2-4-6-5-9-4 3-3 7-3 9 0zm0 0c2-4 6-5 9-4-3-3-7-3-9 0zm0 0c-1-3-1-6 0-9 1 3 1 6 0 9z"/><circle cx="10.5" cy="14" r="1.2"/><circle cx="13.5" cy="14" r="1.2"/><circle cx="12" cy="15.6" r="1.2"/>',
  cassava:'<path d="M5 6c3 1 6 3 8 6s3 6 3 9"/><path d="M8 4c3 2 6 5 7.5 9M13 12c2-1 4-1 6 0M11 9c1-2 3-3 5-3"/><path d="M14 16c-3 1-6 1-8 3m9-.5c-2 2-3 3-3 3.5"/>',
  plantain:'<path d="M6 4c0 7 3 13 12 16"/><path d="M9 4c0 6 2 11 9 14M6 4h3"/>',
  maize:'<path d="M12 21V8"/><path d="M12 8c2-2 2-5 0-6-2 1-2 4 0 6z"/><rect x="9.5" y="8" width="5" height="9" rx="2.5"/><path d="M12 17c-4 0-7-3-7-7 3 1 5 3 7 7zm0 0c4 0 7-3 7-7-3 1-5 3-7 7z"/>',
  yam:'<path d="M7 5c3-2 8-1 10 3s2 10-2 12-9 0-10-4S4 7 7 5z"/><path d="M9 9h.01M13 8h.01M11 13h.01M15 14h.01"/>',
  land:'<path d="M3 18 9 6l4 7 3-4 5 9z"/>'
};
const ic = (k,cls="")=>`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="${cls}">${IC[k]||CROP_IC[k]||""}</svg>`;
const cropIc = (id,sz="100%")=>`<svg width="${sz}" height="${sz}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${CROP_IC[id]||CROP_IC.land}</svg>`;

/* ---------------- storage ---------------- */
const Store = (()=>{
  let db=null, mem={};
  const ready = new Promise(res=>{
    try{ const rq=indexedDB.open("sitewalk",1);
      rq.onupgradeneeded=()=>rq.result.createObjectStore("projects",{keyPath:"id"});
      rq.onsuccess=()=>{db=rq.result;res();}; rq.onerror=()=>res();
    }catch(e){res();}
  });
  const tx=(mode,fn)=>new Promise((res,rej)=>{ try{ const t=db.transaction("projects",mode); const r=fn(t.objectStore("projects")); t.oncomplete=()=>res(r&&r.result); t.onerror=()=>rej(t.error);}catch(e){rej(e)} });
  return {
    async all(){ await ready; if(!db) return Object.values(mem); try{ return await tx("readonly",s=>s.getAll()); }catch(e){ return Object.values(mem);} },
    async put(p){ await ready; mem[p.id]=p; if(db) try{ await tx("readwrite",s=>s.put(p)); }catch(e){} },
    async del(id){ await ready; delete mem[id]; if(db) try{ await tx("readwrite",s=>s.delete(id)); }catch(e){} }
  };
})();

/* ---------------- state ---------------- */
let fields=[], settings={id:"__settings",name:"",state:"Lagos"}, P=null;
let route={name:"home"};
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const todayYmd=()=>ymd(new Date());
const nf=new Intl.NumberFormat("en-NG");
const naira=k=>"₦"+nf.format(Math.round((k||0)/100));
const fmtDate=(s,o={day:"numeric",month:"short"})=>parseYmd(s).toLocaleDateString("en-GB",o);

function normalize(p){
  p.f=p.f||{}; p.beacons=p.beacons||[]; p.features=p.features||[]; p.checks=p.checks||{};
  p.scouts=p.scouts||[]; p.records=p.records||[]; p.tasks=p.tasks||[]; p.taskState=p.taskState||{};
  if(p.crop===undefined) p.crop=null;
  if(!p.kind) p.kind = p.crop? "crop":"land";
  if(!p.f.plotSize) p.f.plotSize="648"; if(!p.f.gpsSecs) p.f.gpsSecs="30"; if(!p.f.gpsMax) p.f.gpsMax="15";
  return p;
}
let saveT={};
function saveLocal(p=P){ if(!p) return; clearTimeout(saveT[p.id]); saveT[p.id]=setTimeout(()=>Store.put(p),250); }
/** A change the user made: saved here, then synced. */
function touch(p=P){ if(!p) return; p.updated=Date.now(); p._dirty=true; p._rev=(p._rev||0)+1; saveLocal(p); if(typeof Sync!=="undefined") Sync.schedule(); }
const forget=(p,id)=>{ p.deleted=[...(p.deleted||[]),id]; };
async function loadAll(){
  const all=await Store.all();
  const s=all.find(x=>x.id==="__settings"); if(s) settings=Object.assign(settings,s);
  fields=all.filter(x=>x.id!=="__settings").map(normalize).sort((a,b)=>(b.updated||0)-(a.updated||0));
}
const saveSettings=()=>Store.put(settings);
const fieldById=id=>fields.find(f=>f.id===id);
function fieldCode(p){
  if(p.code) return p.code;
  const st=(p.f.state||"NG").replace(/[^A-Za-z]/g,"").slice(0,3).toUpperCase();
  const cr=p.crop? (CROPS[p.crop.id]?.name||"").replace(/[^A-Za-z]/g,"").slice(0,3).toUpperCase() : "LND";
  const n=fields.filter(f=>f!==p && f.code && f.code.startsWith(`${st}-${cr}`)).length+1;
  p.code=`${st}-${cr}-${String(n).padStart(2,"0")}`; return p.code;
}

/* ---------------- geometry helpers ---------------- */
function areaHa(p){
  if(p.beacons.length>=3){ const prev=P; P=p; const R=compute(); P=prev; return R.area/10000; }
  return parseFloat(p.crop?.areaHa||p.f.areaHa)||null;
}
function centroid(p){
  if(p.beacons.length){ const n=p.beacons.length; return {lat:p.beacons.reduce((s,b)=>s+b.lat,0)/n, lon:p.beacons.reduce((s,b)=>s+b.lon,0)/n, src:"boundary"}; }
  if(p.loc) return {...p.loc, src:"pin"};
  const st=STATES[p.f.state]||STATES[settings.state]; if(st) return {lat:st[0],lon:st[1],src:"state"};
  return null;
}
function accessPoint(p){
  const g=p.features.find(f=>/gate|access/i.test(f.type||""));
  if(g) return {lat:g.lat,lon:g.lon,src:"gate",label:g.label||"Gate"};
  const c=centroid(p); return c? {...c,label:c.src==="boundary"?"Plot centre":c.src==="pin"?"Pinned location":"Approximate (state capital)"} : null;
}

/* ---------------- UI helpers ---------------- */
function toast(msg,ms=2600){ const t=$("#toast"); t.textContent=msg; t.classList.add("on"); clearTimeout(t._t); t._t=setTimeout(()=>t.classList.remove("on"),ms); }
function openM(id){ $(id).classList.add("on"); }
function closeM(id){ $(id).classList.remove("on"); }
$$(".modal").forEach(m=>m.addEventListener("click",e=>{ if(e.target===m || e.target.closest("[data-close]")) m.classList.remove("on"); }));
function sheet(html){ $("#sheetBody").innerHTML=html; openM("#mSheet"); $("#sheetBody").scrollTop=0; }
const closeSheet=()=>closeM("#mSheet");
function confirmBox(title,text,yes="Delete"){ return new Promise(res=>{
  $("#cfTitle").textContent=title; $("#cfText").textContent=text; $("#cfYes").textContent=yes; openM("#mConfirm");
  $("#cfYes").onclick=()=>{closeM("#mConfirm");res(true)}; $("#cfNo").onclick=()=>{closeM("#mConfirm");res(false)};
});}
function seeded(str){ let h=1779033703^str.length; for(let i=0;i<str.length;i++){h=Math.imul(h^str.charCodeAt(i),3432918353);h=h<<13|h>>>19;}
  return ()=>{ h=Math.imul(h^h>>>16,2246822507); h=Math.imul(h^h>>>13,3266489909); h^=h>>>16; return (h>>>0)/4294967296; }; }

/* ---------------- router ---------------- */
function go(r,push=true){
  route=r; if(r.id) P=fieldById(r.id)||P;
  if(push){ try{ history.pushState(r,""); }catch(e){} }
  render(); window.scrollTo(0,0);
}
window.addEventListener("popstate",e=>{ route=e.state||{name:"home"}; if(route.id) P=fieldById(route.id); render(); });
function back(){ try{ if(history.state && history.length>1){ history.back(); return; } }catch(e){} go({name:"home"}); }

function render(){
  const el=$("#app");
  $$("#dock button").forEach(b=>b.classList.toggle("on",b.dataset.go===route.name));
  const gate = typeof Sync!=="undefined" && Sync.mode==="gate";
  $("#dock").classList.toggle("hidden",gate);
  if(gate) { el.innerHTML=Sync.gateView(); return; }
  if(route.name==="home") el.innerHTML=homeView();
  else if(route.name==="map") { el.innerHTML=mapView(); afterMap(); }
  else if(route.name==="tasks") el.innerHTML=tasksView();
  else if(route.name==="settings") { el.innerHTML=settingsView(); Sync.loadAdmin(); }
  else if(route.name==="field"){ if(!P){ route={name:"home"}; return render(); } el.innerHTML=fieldView(); afterField(); }
  bindForms();
}
// dock
(()=>{ const d=$("#dock"); const k={home:"home",map:"map",new:"plus",tasks:"tasks",settings:"user"};
  d.querySelectorAll("button").forEach(b=>{ b.innerHTML=ic(k[b.dataset.go]); b.onclick=()=>{ if(b.dataset.go==="new") return newFieldSheet(); go({name:b.dataset.go}); }; }); })();

/* ---------------- weather ---------------- */
const wxBusy={};
function wxFor(p){ return p.wx || null; }
async function refreshWx(p, force=false){
  const c=centroid(p); if(!c) return;
  const key=`${c.lat.toFixed(2)},${c.lon.toFixed(2)}`;
  if(!force && p.wx && !p.wx.sample && p.wx.key===key && Date.now()-p.wx.at<2*3600e3) return;
  if(wxBusy[p.id]) return; wxBusy[p.id]=true;
  try{
    const u=`https://api.open-meteo.com/v1/forecast?latitude=${c.lat.toFixed(4)}&longitude=${c.lon.toFixed(4)}`+
      `&current=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m`+
      `&hourly=relative_humidity_2m,soil_moisture_3_to_9cm`+
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,et0_fao_evapotranspiration`+
      `&past_days=31&forecast_days=8&timezone=Africa%2FLagos`;
    const r=await fetch(u); if(!r.ok) throw new Error("wx "+r.status); const j=await r.json();
    const rhDaily=j.daily.time.map((_,i)=>{ const a=j.hourly.relative_humidity_2m.slice(i*24,i*24+24).filter(v=>v!=null); return a.length? a.reduce((x,y)=>x+y,0)/a.length : null; });
    const nowIdx=j.hourly.time.indexOf(j.current.time.slice(0,13)+":00");
    const soil=j.hourly.soil_moisture_3_to_9cm[nowIdx>=0?nowIdx:j.hourly.time.length-1];
    p.wx={at:Date.now(),key,current:j.current,daily:j.daily,rhDaily,soil,monthly:p.wx&&p.wx.key===key?p.wx.monthly:null};
    saveLocal(p); rerenderSoft();
  }catch(e){ /* offline or blocked: keep cache */ }
  finally{ wxBusy[p.id]=false; }
}
async function refreshMonthly(p){
  const c=centroid(p); if(!c||!p.wx||p.wx.sample) return;
  if(p.wx.monthly && Date.now()-p.wx.monthly.at<7*86400e3) return;
  try{
    const end=new Date(Date.now()-6*86400e3), start=new Date(end.getFullYear()-1,end.getMonth()+1,1);
    const r=await fetch(`https://archive-api.open-meteo.com/v1/archive?latitude=${c.lat.toFixed(4)}&longitude=${c.lon.toFixed(4)}&start_date=${ymd(start)}&end_date=${ymd(end)}&daily=precipitation_sum&timezone=Africa%2FLagos`);
    if(!r.ok) throw 0; const j=await r.json(); const m={};
    j.daily.time.forEach((t,i)=>{ const k=t.slice(0,7); m[k]=(m[k]||0)+(j.daily.precipitation_sum[i]||0); });
    p.wx.monthly={at:Date.now(), months:Object.keys(m).sort().map(k=>[k,m[k]])}; saveLocal(p); rerenderSoft();
  }catch(e){}
}
let softT=null;
function rerenderSoft(){ clearTimeout(softT); softT=setTimeout(()=>{ if(route.name==="home"||(route.name==="field"&&["overview"].includes(route.tab||"overview"))){ const y=window.scrollY; render(); window.scrollTo(0,y);} },120); }
function sampleWx(seedStr, lat){
  const rnd=seeded(seedStr); const t0=new Date(); t0.setHours(0,0,0,0);
  const time=[],pr=[],tx=[],tn=[],code=[],et=[],rh=[],pp=[];
  for(let i=-31;i<8;i++){ const d=new Date(t0.getTime()+i*DAY); time.push(ymd(d)); const m=d.getMonth()+1;
    const wet=[0.08,0.15,0.3,0.45,0.55,0.65,0.55,0.4,0.6,0.55,0.3,0.08][m-1];
    const r=rnd()<wet? Math.round((2+rnd()*rnd()*40)*10)/10 : (rnd()<0.2? Math.round(rnd()*10)/10:0);
    pr.push(r); tx.push(Math.round((30.5+rnd()*2.5)*10)/10); tn.push(Math.round((22+rnd()*1.5)*10)/10);
    code.push(r>15?95:r>3?63:r>0.3?61:rnd()<.5?2:1); et.push(Math.round((3.4+rnd())*10)/10); rh.push(r>1? 86+rnd()*8 : 76+rnd()*8); pp.push(Math.round(r>0?50+rnd()*45:rnd()*30)); }
  const clim=[20,45,100,140,190,270,220,120,230,190,60,20];
  const months=[]; for(let k=12;k>=1;k--){ const d=new Date(t0.getFullYear(),t0.getMonth()-k,1); months.push([`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`, Math.round(clim[d.getMonth()]*(0.75+rnd()*0.5))]); }
  return {sample:true,at:Date.now(),key:"sample",current:{temperature_2m:29.4,relative_humidity_2m:79,precipitation:0,weather_code:2,wind_speed_10m:7.6,time:new Date().toISOString().slice(0,16)},
    daily:{time,precipitation_sum:pr,temperature_2m_max:tx,temperature_2m_min:tn,weather_code:code,et0_fao_evapotranspiration:et,precipitation_probability_max:pp},rhDaily:rh,soil:0.31,monthly:{at:Date.now(),months}};
}

/* ---------------- art: stylised field shapes ---------------- */
function smoothPath(pts){ // closed Catmull-Rom → Bézier
  const n=pts.length; let d=`M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for(let i=0;i<n;i++){ const p0=pts[(i-1+n)%n],p1=pts[i],p2=pts[(i+1)%n],p3=pts[(i+2)%n];
    d+=`C${(p1[0]+(p2[0]-p0[0])/6).toFixed(1)},${(p1[1]+(p2[1]-p0[1])/6).toFixed(1)} ${(p2[0]-(p3[0]-p1[0])/6).toFixed(1)},${(p2[1]-(p3[1]-p1[1])/6).toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`; }
  return d+"Z";
}
function blob(cx,cy,r,rnd,n=9,j=.35){ const a=[]; for(let i=0;i<n;i++){ const t=i/n*Math.PI*2, rr=r*(1-j/2+rnd()*j); a.push([cx+Math.cos(t)*rr*1.15, cy+Math.sin(t)*rr]); } return a; }
function fieldShape(p){ // local metres, y up
  if(p.beacons.length>=3){ const prev=P; P=p; const R=compute(); P=prev; return {pts:R.B.map(b=>[b.E,b.N]), real:true}; }
  const rnd=seeded(p.id+"shape"); const ha=areaHa(p)||1; const r=Math.sqrt(ha*10000/Math.PI);
  return {pts:blob(0,0,r,rnd,10,.3), real:false};
}
function artDefs(id){
  return `<defs>
  <pattern id="bg${id}" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><rect width="7" height="7" fill="#edf2e8"/><line x1="0" y1="0" x2="0" y2="7" stroke="#dbe5d3" stroke-width="1.4"/></pattern>
  <pattern id="fh${id}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-35)"><line x1="0" y1="0" x2="0" y2="6" stroke="#b9dd94" stroke-width="1.2"/></pattern>
  <pattern id="oh${id}" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(60)"><rect width="5" height="5" fill="#e4ecdd"/><line x1="0" y1="0" x2="0" y2="5" stroke="#cfdcc6" stroke-width="1"/></pattern></defs>`;
}
function fieldArt(p, W, H, o={}){
  const id=(p.id+"").replace(/\W/g,"")+(o.k||"");
  const rnd=seeded(p.id+"bg");
  const {pts,real}=fieldShape(p);
  const xs=pts.map(q=>q[0]), ys=pts.map(q=>q[1]);
  const minx=Math.min(...xs),maxx=Math.max(...xs),miny=Math.min(...ys),maxy=Math.max(...ys);
  const fillW=o.fill||0.55, s=Math.min(W*fillW/(maxx-minx||1), H*fillW/(maxy-miny||1));
  const cx=W/2+(o.dx||0), cy=H/2+(o.dy||0), mx=(minx+maxx)/2, my=(miny+maxy)/2;
  const T=q=>[cx+(q[0]-mx)*s, cy-(q[1]-my)*s];
  const sp=pts.map(T);
  let g=`<rect width="${W}" height="${H}" fill="url(#bg${id})"/>`;
  // decorative neighbouring plots & tracks
  for(let i=0;i<5;i++){ const bx=rnd()*W, by=rnd()*H, br=Math.min(W,H)*(.18+rnd()*.22); g+=`<path d="${smoothPath(blob(bx,by,br,rnd,8,.45))}" fill="url(#oh${id})" stroke="#bccbb3" stroke-width="1" stroke-dasharray="4 4"/>`; }
  const road=(y0,y1)=>`<path d="M-20,${y0} C${W*.3},${y0+(rnd()-.5)*H*.4} ${W*.6},${y1+(rnd()-.5)*H*.4} ${W+20},${y1}" fill="none" stroke="#fff" stroke-width="${o.small?4:9}" stroke-linecap="round" opacity=".9"/>`;
  g+=road(H*(.1+rnd()*.2),H*(.7+rnd()*.25));
  // contour rings
  const ccw=(()=>{let a=0;for(let i=0;i<sp.length;i++){const q=sp[i],r=sp[(i+1)%sp.length];a+=q[0]*r[1]-r[0]*q[1];}return a>0;})();
  [o.small?6:14,o.small?12:30].forEach((d,k)=>{
    const ring = real? offsetPolygon(sp,-d,ccw) : sp.map(q=>[cx+(q[0]-cx)*(1+d/60), cy+(q[1]-cy)*(1+d/60)]);
    g+=`<path d="${real? "M"+ring.map(q=>q.map(v=>v.toFixed(1)).join(",")).join("L")+"Z" : smoothPath(ring)}" fill="none" stroke="#a9bf9d" stroke-width="1" stroke-dasharray="${k?"2 5":"5 4"}" stroke-linejoin="round"/>`;
  });
  const d = real? "M"+sp.map(q=>q.map(v=>v.toFixed(1)).join(",")).join("L")+"Z" : smoothPath(sp);
  g+=`<path d="${d}" fill="#d4edb8"/><path d="${d}" fill="url(#fh${id})"/><path d="${d}" fill="none" stroke="#2c5a3d" stroke-width="${o.small?1.4:1.8}" stroke-linejoin="round"/>`;
  return {svg:`<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" class="${o.cls||""}" xmlns="http://www.w3.org/2000/svg">${artDefs(id)}${g}</svg>`, cx, cy, real};
}

/* ---------------- tasks ---------------- */
function allTasks(p, from, to){
  const td=todayYmd(), cutoff=ymd(new Date(Date.now()-14*DAY));
  let gen=genTasks(p,from,to).map(t=>({...t,status:p.taskState[t.id]||"todo"}))
    .filter(t=>t.status==="done" || t.date>=cutoff);           // old auto tasks you never ticked drop off
  // a repeating task that's overdue: keep only its most recent missed round
  const lastOver={}; gen.forEach(t=>{ if(t.status!=="done"&&t.date<td) lastOver[t.rule]=t.id; });
  gen=gen.filter(t=>!(t.status!=="done"&&t.date<td&&lastOver[t.rule]!==t.id));
  const cus=p.tasks.filter(t=>{ const d=parseYmd(t.date); return d>=from&&d<=to; }).map(t=>({...t,fieldId:p.id,auto:false}));
  return [...gen,...cus].sort((a,b)=>a.date.localeCompare(b.date));
}
function taskWindow(){ const t=new Date(); t.setHours(0,0,0,0); return [new Date(t.getTime()-30*DAY), new Date(t.getTime()+120*DAY)]; }
function setTaskStatus(fid,tid,status){
  const p=fieldById(fid); if(!p) return;
  const c=p.tasks.find(t=>t.id===tid);
  if(c) c.status=status; else p.taskState[tid]=status;
  touch(p);
}
const nextStatus=s=>s==="todo"?"doing":s==="doing"?"done":"todo";
const statusLabel=s=>({todo:"Not started",doing:"In progress",done:"Done"}[s]);
function relDay(s){ const d=Math.round((parseYmd(s)-parseYmd(todayYmd()))/DAY); return d===0?"Today":d===1?"Tomorrow":d===-1?"Yesterday":d<0?`${-d} days ago`:d<7?parseYmd(s).toLocaleDateString("en-GB",{weekday:"long"}):fmtDate(s); }
function taskRow(t, showField=false, brief=false){
  const over=t.status!=="done" && t.date<todayYmd(); const p=fieldById(t.fieldId);
  return `<div class="li ${t.status==="done"?"done":""}">
    <button class="check ${t.status==="done"?"on":""}" data-act="tdone" data-f="${t.fieldId}" data-t="${esc(t.id)}" aria-label="Mark done">${t.status==="done"?ic("check"):""}</button>
    <div class="b"><div class="t">${esc(t.title)}</div>
      <div class="s">${showField&&p?esc(p.f.name)+" · ":""}${t.every&&brief?"Every "+t.every+" days, next "+relDay(t.date).toLowerCase():relDay(t.date)}${t.detail&&!brief?" · "+esc(t.detail):""}</div></div>
    <button class="status ${t.status==="done"?"done":over?"over":t.status==="todo"?"todo":""}" data-act="tcycle" data-f="${t.fieldId}" data-t="${esc(t.id)}">${over&&t.status==="todo"?"Overdue":statusLabel(t.status)}</button>
  </div>`;
}
function groupTasks(list){
  const td=todayYmd(), wk=ymd(new Date(Date.now()+7*DAY));
  const g={Overdue:[],Today:[],"This week":[],Later:[],Done:[]};
  list.forEach(t=>{ if(t.status==="done"){ if(t.date>=ymd(new Date(Date.now()-30*DAY))) g.Done.push(t); return; }
    if(t.date<td) g.Overdue.push(t); else if(t.date===td) g.Today.push(t); else if(t.date<=wk) g["This week"].push(t); else g.Later.push(t); });
  g.Done.reverse(); return g;
}
function tasksBlock(list, showField){
  const g=groupTasks(list); let h="";
  // later: show each repeating job once ("every 12 days")
  const seen=new Set(); g.Later=g.Later.filter(t=>{ if(!t.rule) return true; if(seen.has(t.rule)) return false; seen.add(t.rule); return true; });
  const near=new Set(); ["Overdue","Today","This week"].forEach(k=>g[k].forEach(t=>t.rule&&near.add(t.rule)));
  g.Later=g.Later.filter(t=>!(t.every&&near.has(t.rule)));
  for(const [k,v] of Object.entries(g)) if(v.length) h+=`<div class="group-h">${k} · ${v.length}</div><div class="card" style="padding:4px 14px">${v.slice(0,40).map(t=>taskRow(t,showField,k==="Later")).join("")}</div>`;
  return h || `<div class="card empty">${ic("tasks")}<div>Nothing scheduled.</div></div>`;
}

/* ================================================================
   HOME
   ================================================================ */
function greeting(){ const h=new Date().getHours(); return h<12?"Good morning":h<17?"Good afternoon":"Good evening"; }
function homeView(){
  const prim=fields.find(f=>f.kind==="crop")||fields[0];
  if(prim) refreshWx(prim);
  const wx=prim? wxFor(prim):null, S=wxSummary(wx), cur=wx?.current;
  const loc=prim? (prim.f.area||prim.f.lga||prim.f.state||settings.state) : settings.state;
  const [cond,cic]=WMO(cur?.weather_code);
  const [from,to]=taskWindow();
  const tasks=fields.flatMap(f=>allTasks(f,from,to)).filter(t=>t.status!=="done" && t.date<=ymd(new Date(Date.now()+7*DAY)))
    .sort((a,b)=>(a.status==="doing"?-1:0)-(b.status==="doing"?-1:0) || a.date.localeCompare(b.date)).slice(0,10);
  const meId=Sync.me?.id; const isMine=f=>!f._synced||!f._owner||f._owner===meId;
  const mine=fields.filter(isMine), others=fields.filter(f=>!isMine(f));
  const alerts=fields.filter(f=>f.kind==="crop").flatMap(f=>insights(f,wxFor(f)).filter(i=>i.level==="high").map(i=>({...i,f})) ).slice(0,4);
  return `
  <div class="topbar"><div class="loc">${ic("pin")} ${esc(loc||"Nigeria")}<span style="margin-left:auto">${Sync.chip()}</span></div><button class="avatar" data-act="go" data-r="settings">${esc((settings.name||"J")[0].toUpperCase())}</button></div>
  <div class="wrap">
    <div class="wx-hero">
      <div class="hello">${greeting()}${settings.name?", "+esc(settings.name):""}</div>
      <div class="side">${new Date().toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short"})}<br>${esc(SEASON(new Date().getMonth()+1))}</div>
      <div class="temp">${cur? Math.round(cur.temperature_2m)+"°C" : "—"}</div>
      <div class="cond">${ic(cic)} ${cur?cond:"Weather loads when you're online"} ${wx?.sample?'<span class="chip ghost">Sample weather</span>':""}</div>
      <div class="meta">
        <span>${ic("wind")} ${cur?Math.round(cur.wind_speed_10m)+" km/h":"—"}</span>
        <span>${ic("humid")} ${cur?Math.round(cur.relative_humidity_2m)+"%":"—"}</span>
        <span>${ic("rain")} ${S?Math.round(S.next7)+" mm next 7 days":"—"}</span>
      </div>
    </div>
    ${alerts.length?`<div class="card">${alerts.map(a=>`<div class="ins high" data-act="open" data-id="${a.f.id}"><div class="dot">${ic("alert")}</div><div><div class="fl">${esc(a.f.f.name)}</div><b>${esc(a.title)}</b><span>${esc(a.text)}</span></div></div>`).join("")}</div>`:""}
    ${fields.length?`
    <div class="sec-h"><h2>This week</h2><button class="link" data-act="go" data-r="tasks">All tasks</button></div>
    ${tasks.length?`<div class="hscroll">${tasks.map(t=>{const p=fieldById(t.fieldId); const over=t.date<todayYmd();
      return `<button class="tcard ${t.status==="doing"?"doing":""}" data-act="open" data-id="${t.fieldId}" data-tab="tasks"><div class="when">${ic("cal")} ${relDay(t.date)}</div><div class="tt">${esc(t.title)}</div><div class="fn">${esc(p?.f.name||"")}</div><span class="status ${t.status==="doing"?"":over?"over":"todo"}">${t.status==="doing"?"In progress":over?"Overdue":"Not started"}</span></button>`;}).join("")}</div>`
      :`<div class="card muted small">No tasks due this week.</div>`}
    <div class="sec-h"><h2>Your fields</h2><button class="link" data-act="go" data-r="map">View map</button></div>
    ${mine.map(fieldCard).join("")||`<div class="card muted small">None yet. Tap + to add one.</div>`}
    ${others.length?`<div class="sec-h"><h2>${Sync.me?.role==="admin"?"Testers' farms":"Shared with you"}</h2></div>${others.map(fieldCard).join("")}`:""}`
    :`<div class="card" style="text-align:center;padding:26px 18px">
        <div style="width:64px;height:64px;margin:0 auto 10px;color:var(--forest2)">${cropIc("cocoa")}</div>
        <h2 style="font-size:19px">Welcome to ${APP_NAME}</h2>
        <p class="muted">Add your cocoa, oil palm or cassava fields, or survey a piece of land. Everything is saved on this phone.</p>
        <button class="btn block" data-act="new">${ic("plus")} Add a field or land</button><div class="sp8"></div>
        <button class="btn soft block" data-act="demo">Load demo farms</button></div>`}
  </div>`;
}
function fieldCard(p){
  const art=fieldArt(p,220,220,{small:true,k:"t",fill:.62});
  const c=CROPS[p.crop?.id], st=c? cropStage(p.crop.id,p.crop.planted):null, ha=areaHa(p);
  const [from,to]=taskWindow(); const open=allTasks(p,from,to).filter(t=>t.status!=="done"&&t.date<=ymd(new Date(Date.now()+30*DAY))).length;
  const cc=centroid(p);
  return `<button class="fcard" data-act="open" data-id="${p.id}"><div class="thumb">${art.svg}</div>
    <div class="body"><div class="nm">${esc(p.f.name||"Untitled")}</div>
      <div class="co">${cc&&cc.src!=="state"?`${cc.lat.toFixed(4)}°N, ${cc.lon.toFixed(4)}°E`:esc([p.f.area,p.f.state].filter(Boolean).join(", "))}</div>
      <div>${c?`<span class="chip">${esc(c.name)} · ${esc(st?.label||"Not planted")}</span>`:`<span class="chip grey">Land</span>`}${p._synced&&p._owner&&p._owner!==Sync.me?.id?` <span class="chip grey">${esc(p._ownerName||"Shared")}</span>`:""}</div>
      <div class="meta">${ha?`<span class="mini">${ic("ruler")} ${ha<10?ha.toFixed(2):ha.toFixed(1)} ha</span>`:""}
        ${p.crop?`<span class="mini">${ic("tasks")} ${open} tasks</span>`:`<span class="mini">${ic("pin")} ${p.beacons.length} beacons</span>`}
        ${p.scouts.length?`<span class="mini">${ic("leaf")} ${p.scouts.length}</span>`:""}</div></div></button>`;
}

/* ================================================================
   FIELD
   ================================================================ */
function tabsFor(p){ return p.kind==="crop"? [["overview","Overview"],["scout","Scouting"],["tasks","Tasks"],["records","Records"],["land","Land"]] : [["land","Land"],["tasks","Tasks"],["records","Records"]]; }
function fieldView(){
  const p=P, tabs=tabsFor(p); let tab=route.tab||tabs[0][0]; if(!tabs.some(t=>t[0]===tab)) tab=tabs[0][0];
  const c=CROPS[p.crop?.id], st=c?cropStage(p.crop.id,p.crop.planted):null, ha=areaHa(p);
  const art=fieldArt(p,420,300,{fill:.5,dy:-18,cls:"map"});
  const sub=[c?.name, st?.label, ha?(ha<10?ha.toFixed(2):ha.toFixed(1))+" ha":null].filter(Boolean).join(" • ");
  return `<div class="wrap">
  <div class="hero">${art.svg}
    <div style="position:absolute;left:50%;top:${(art.cy/300*100).toFixed(1)}%;transform:translate(-50%,-50%);text-align:center;pointer-events:none;width:70%">
      <div style="width:42px;height:42px;border-radius:50%;border:1.5px solid #2c5a3d;margin:0 auto 6px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.55);color:#2c5a3d"><div style="width:24px;height:24px">${cropIc(p.crop?.id||"land")}</div></div>
      <div style="font-weight:700;font-size:18px;color:#1d3d29;line-height:1.15;text-shadow:0 0 8px #eef2ea,0 0 3px #eef2ea">${esc(p.f.name||"Untitled")}</div>
      <div style="font-size:12px;color:#3c6248;margin-top:3px;text-shadow:0 0 6px #eef2ea,0 0 2px #eef2ea">${esc(fieldCode(p))}${sub?" • "+esc(sub):""}</div>
    </div>
    <div class="tl"><button class="ibtn glass" data-act="back" aria-label="Back">${ic("back")}</button></div>
    <div class="tr">${p.kind==="crop"?`<button class="ibtn glass" data-act="ask" aria-label="Ask ${APP_NAME} about this field">${ic("chat")}</button>`:""}<button class="ibtn glass" data-act="editfield" aria-label="Edit">${ic("edit")}</button><button class="ibtn glass" data-act="mapfield" aria-label="Show on map">${ic("expand")}</button></div>
  </div>
  <div class="tabs">${tabs.map(([k,l])=>`<button class="${k===tab?"on":""}" data-act="tab" data-tab="${k}">${l}</button>`).join("")}</div>
  <div id="tabBody">${tab==="overview"?overviewTab(p):tab==="scout"?scoutTab(p):tab==="tasks"?fieldTasksTab(p):tab==="records"?recordsTab(p):landTab(p)}</div>
  </div>`;
}
function afterField(){
  const p=P; if(p.kind==="crop"){ refreshWx(p); Sat.maybeRefresh(p); }
  if((route.tab||"")==="land"||p.kind==="land"&&!route.tab) afterLand();
}

/* ---------- overview ---------- */
let rainMode="30d";
function overviewTab(p){
  const wx=wxFor(p), S=wxSummary(wx), c=CROPS[p.crop.id], st=cropStage(p.crop.id,p.crop.planted), ha=areaHa(p);
  const est=yieldEstimate(p.crop.id,p.crop.planted,ha);
  const photo=p.scouts.slice().reverse().find(s=>s.photo)?.photo;
  const m=new Date().getMonth()+1;
  const ins=insights(p,wx);
  const fmtY=v=> c.unit.startsWith("t")? (v<10?v.toFixed(1):Math.round(v)) : nf.format(Math.round(v));
  let stageCard="";
  if(st){
    if(c.perennial){
      stageCard=`<div class="card"><div class="row"><div class="grow"><b>${esc(st.ageText)} · ${esc(st.label)}</b><div class="muted small">${esc(c.harvestNote)}</div></div><span class="chip ${st.bearing?"lime":"grey"}">${st.bearing?"Bearing":"Not yet bearing"}</span></div>
        <div class="monthbar">${MONTHS.map((n,i)=>`<div class="${c.peakMonths.includes(i+1)?"p":c.harvestMonths.includes(i+1)?"h":""} ${i+1===m?"now":""}">${n[0]}</div>`).join("")}</div>
        <div class="row tiny muted" style="margin-top:8px;gap:12px"><span><span class="chip lime" style="padding:2px 7px">&nbsp;</span> Peak harvest</span><span><span class="chip" style="padding:2px 7px">&nbsp;</span> Harvest</span><span>Outlined: this month</span></div></div>`;
    } else {
      const dth=st.daysToHarvest;
      stageCard=`<div class="card"><div class="row"><div class="grow"><b>${esc(st.ageText)} · ${esc(st.label)}</b><div class="muted small">${dth>0?`About ${dth} days to harvest (${st.harvestDate.toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"})})`:`Harvest window: up to ${Math.round(c.harvestWindow[1]/30.44)} months after planting`}</div></div>
        <span class="chip ${dth<=30?"lime":""}">${Math.round(st.days)}/${c.harvestDays} days</span></div><div class="sp8"></div><div class="progress"><i style="width:${(st.progress*100).toFixed(0)}%"></i></div></div>`;
    }
  } else stageCard=`<div class="card"><b>Add a planting date</b><p class="muted small">So ${APP_NAME} can work out the growth stage, harvest timing and task calendar.</p><button class="btn sm" data-act="editfield">Set planting date</button></div>`;
  return `
  ${wx?.sample?`<div class="row" style="margin:-4px 2px 10px"><span class="chip warn">Sample weather: live weather loads in the installed app</span></div>`:""}
  <div class="metrics">
    <div class="metric"><div class="ic">${ic("rain")}</div><div class="l">Rain 7 days</div><div class="v">${S?Math.round(S.rain7):"—"}<small> mm</small></div></div>
    <div class="metric"><div class="ic">${ic("thermo")}</div><div class="l">Temp</div><div class="v">${wx?.current?Math.round(wx.current.temperature_2m):"—"}<small>°C</small></div></div>
    <div class="metric"><div class="ic">${ic("humid")}</div><div class="l">Humidity</div><div class="v">${wx?.current?Math.round(wx.current.relative_humidity_2m):"—"}<small>%</small></div></div>
    <div class="metric"><div class="ic">${ic("soil")}</div><div class="l">Soil moisture</div><div class="v">${wx?.soil!=null?Math.round(wx.soil*100):"—"}<small>%</small></div></div>
  </div>
  <div class="card"><div class="crop-card">
    <div class="pic">${photo?`<img src="${photoSrc(photo)}" alt="">`:cropIc(p.crop.id)}</div>
    <div class="grow" style="flex:1;min-width:0"><div class="t">${esc(c.name)} ${esc(fieldCode(p))}</div>
      <div class="s">${esc(p.crop.variety||c.latin)}${p.crop.planted?` · planted ${fmtDate(p.crop.planted,{month:"short",year:"numeric"})}`:""}</div>
      <div class="s" style="margin-top:4px">${c.perennial? "Harvest: "+esc(c.harvestNote) : st&&st.daysToHarvest>0? "Expected harvest: "+st.harvestDate.toLocaleDateString("en-GB",{month:"long",year:"numeric"}) : "In harvest window"}</div>
      ${est&&est[1]>0?`<div class="y">${ic("sprout")} ~${fmtY(est[1])} ${esc(c.unit)}${c.perennial?"/yr":""}</div><div class="tiny muted">typical · range ${fmtY(est[0])}–${fmtY(est[2])}</div>`:est?`<div class="y muted">${ic("sprout")} Not bearing yet</div>`:`<div class="s">Add the area to estimate yield</div>`}
    </div>
    <button class="ibtn dark" data-act="tab" data-tab="records" aria-label="Records">${ic("arrow")}</button></div></div>
  ${stageCard}
  <button class="card ask-card" data-act="ask"><div class="dot">${ic("chat")}</div><div class="grow"><b>Ask ${APP_NAME} about this field</b><span>Uses its stage, weather, scouting and records</span></div>${ic("arrow")}</button>
  <div class="card"><h2>What needs attention</h2>${ins.length?ins.map(i=>`<div class="ins ${i.level}"><div class="dot">${ic(i.level==="high"?"alert":i.level==="med"?"bug":"info")}</div><div><b>${esc(i.title)}</b><span>${esc(i.text)}</span></div></div>`).join(""):`<p class="muted small">All clear for now.</p>`}</div>
  ${Sat.card(p)}
  ${rainCard(p,S)}
  ${healthCard(p)}
  <div class="card"><h2>${esc(c.name)} notes</h2>${c.tips.map(t=>`<div class="ins info"><div class="dot">${ic("leaf")}</div><div><span style="color:var(--ink)">${esc(t)}</span></div></div>`).join("")}
    <p class="tiny muted" style="margin:10px 0 0">Planning guide only. Follow product labels and your ADP / extension officer for chemicals and rates.</p></div>`;
}
function bars(vals, labels, W=340, H=130, o={}){
  const max=Math.max(...vals.map(v=>v||0), o.min||1); const n=vals.length, gap=n>20?2:5, bw=(W-gap*(n-1))/n;
  let g="";
  vals.forEach((v,i)=>{ const h=Math.max(3,(v||0)/max*(H-22)); const t=(v||0)/max;
    const col= o.future&&i>=o.future ? "#d9ecc0" : `rgb(${Math.round(201-(201-22)*t)},${Math.round(236-(236-83)*t)},${Math.round(111-(111-58)*t)})`;
    g+=`<rect x="${(i*(bw+gap)).toFixed(1)}" y="${(H-18-h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(bw/2,5)}" fill="${col}"><title>${labels[i]}: ${Math.round(v||0)} mm</title></rect>`; });
  if(o.future) g+=`<line x1="${(o.future*(bw+gap)-gap/2).toFixed(1)}" y1="0" x2="${(o.future*(bw+gap)-gap/2).toFixed(1)}" y2="${H-18}" stroke="#163b27" stroke-dasharray="3 3"/>`;
  g+=`<text x="0" y="${H-2}" font-size="11" font-weight="600" fill="#13241a">${labels[0]}</text><text x="${W}" y="${H-2}" font-size="11" font-weight="600" fill="#13241a" text-anchor="end">${labels[n-1]}</text>`;
  return `<svg viewBox="0 0 ${W} ${H}">${g}</svg>`;
}
function rainCard(p,S){
  const wx=wxFor(p); if(!wx) return `<div class="card"><h2>Rainfall</h2><p class="muted small">Weather loads when you're online.</p></div>`;
  const D=wx.daily; const t=S.t; let vals,labels,total,prev,cap,opt={};
  const lab=s=>fmtDate(s);
  if(rainMode==="7d"){ vals=D.precipitation_sum.slice(t-7,t+7); labels=D.time.slice(t-7,t+7).map(lab); opt.future=7; total=S.rain7; prev=D.precipitation_sum.slice(t-14,t-7).reduce((a,b)=>a+(b||0),0); cap="Last 7 days and the 7-day forecast"; }
  else if(rainMode==="12m"){ const ms=wx.monthly?.months; if(!ms){ refreshMonthly(p); vals=null; } else { vals=ms.map(x=>x[1]); labels=ms.map(x=>MONTHS[+x[0].slice(5)-1]+" "+x[0].slice(2,4)); total=vals.reduce((a,b)=>a+b,0); cap="Monthly totals, last 12 months"; } }
  else { vals=D.precipitation_sum.slice(t-30,t); labels=D.time.slice(t-30,t).map(lab); total=S.rain30; prev=null; cap="Daily rainfall, last 30 days"; }
  const delta = prev!=null&&rainMode==="7d" ? total-prev : null;
  return `<div class="card chart"><div class="row"><div class="grow"><b>Rainfall</b><div class="big-num">${vals?Math.round(total)+" mm":"…"} ${delta!=null?`<span class="${delta>=0?"up":"down"}" style="font-size:16px">${delta>=0?"↑":"↓"} ${Math.abs(Math.round(delta))}</span>`:""}</div></div>
    <div class="seg">${[["7d","W"],["30d","M"],["12m","Y"]].map(([k,l])=>`<button class="${rainMode===k?"on":""}" data-act="rain" data-m="${k}">${l}</button>`).join("")}</div></div>
    <div class="sp8"></div>${vals?bars(vals,labels,340,130,opt):`<p class="muted small">Loading the last 12 months…</p>`}
    <div class="tiny muted" style="margin-top:4px">${cap||""}${S&&rainMode!=="12m"?` · water balance (30 days): ${S.balance30>=0?"+":""}${Math.round(S.balance30)} mm`:""}</div></div>`;
}
function healthCard(p){
  const sc=p.scouts.slice().sort((a,b)=>a.date.localeCompare(b.date)).slice(-12); if(sc.length<2) return "";
  const W=340,H=110; const x=i=>i/(sc.length-1)*(W-20)+10, y=v=>H-20-(v-1)/4*(H-36);
  const pts=sc.map((s,i)=>[x(i),y(s.health||3)]);
  const d="M"+pts.map(q=>q.map(v=>v.toFixed(1)).join(",")).join("L");
  const last=sc[sc.length-1].health, first=sc[0].health;
  return `<div class="card chart"><div class="row"><div class="grow"><b>Crop health</b><div class="big-num">${last}/5 <span class="${last>=first?"up":"down"}" style="font-size:16px">${last>=first?"↑":"↓"}</span></div></div><span class="muted small">${sc.length} scoutings</span></div>
  <svg viewBox="0 0 ${W} ${H}"><path d="${d}L${pts[pts.length-1][0]},${H-20}L${pts[0][0]},${H-20}Z" fill="#e6f7bd"/><path d="${d}" fill="none" stroke="#24533a" stroke-width="2.4" stroke-linejoin="round"/>${pts.map(q=>`<circle cx="${q[0]}" cy="${q[1]}" r="3.5" fill="#fff" stroke="#24533a" stroke-width="2"/>`).join("")}
  <text x="0" y="${H-2}" font-size="11" font-weight="600">${fmtDate(sc[0].date)}</text><text x="${W}" y="${H-2}" font-size="11" font-weight="600" text-anchor="end">${fmtDate(sc[sc.length-1].date)}</text></svg></div>`;
}

/* ---------- scouting ---------- */
function scoutTab(p){
  const list=p.scouts.slice().sort((a,b)=>b.date.localeCompare(a.date)); const c=CROPS[p.crop.id];
  return `<button class="btn block" data-act="scout">${ic("plus")} New scouting walk</button><div class="sp12"></div>
  ${list.length?`<div class="card" style="padding:4px 14px">${list.map(s=>`<div class="li" data-act="scout" data-id="${s.id}">
    <div class="bul ${s.health<=2?"amber":"dark"}">${s.health}/5</div>
    <div class="b"><div class="t">${fmtDate(s.date,{weekday:"short",day:"numeric",month:"short",year:"numeric"})}</div>
      <div class="s">${s.issues?.length?s.issues.map(esc).join(" · "):"No problems seen"}</div>
      ${Object.entries(s.m||{}).filter(([,v])=>v!==""&&v!=null).length?`<div class="s">${Object.entries(s.m).filter(([,v])=>v!==""&&v!=null).map(([k,v])=>`${esc(c.measures.find(x=>x.k===k)?.l||k)}: <b>${esc(v)}</b>`).join(" · ")}</div>`:""}
      ${s.notes?`<div class="s">${esc(s.notes)}</div>`:""}</div>
    ${s.photo?`<img src="${photoSrc(s.photo)}" alt="">`:""}</div>`).join("")}</div>`
  :`<div class="card empty">${ic("leaf")}<div>Walk the field every 1–2 weeks and log what you see: pests, disease, plant health. It builds a history you can compare.</div></div>`}`;
}
function scoutSheet(id){
  const p=P, c=CROPS[p.crop.id]; const s=id? p.scouts.find(x=>x.id===id) : {id:uid(),date:todayYmd(),health:4,issues:[],m:{},notes:""};
  window._scout={...s,issues:[...(s.issues||[])],m:{...(s.m||{})},isNew:!id};
  sheet(`<div class="head"><h2>${id?"Scouting":"New scouting"}</h2><button class="ibtn" data-close>✕</button></div>
  <label class="f">Date</label><input type="date" id="scDate" value="${s.date}">
  <label class="f">Overall crop health</label><div class="rate" id="scRate">${[1,2,3,4,5].map(n=>`<button data-v="${n}" class="${n===s.health?"on":""}">${n}</button>`).join("")}</div>
  <div class="tiny muted" style="margin-top:4px">1 = very poor · 5 = excellent</div>
  <label class="f">What did you see?</label><div class="pills" id="scIss">${c.issues.map(i=>`<button class="${s.issues?.includes(i)?"on":""}">${esc(i)}</button>`).join("")}</div>
  ${c.measures.map(mm=>`<label class="f">${esc(mm.l)}</label><input inputmode="decimal" data-m="${mm.k}" value="${esc(s.m?.[mm.k]??"")}">`).join("")}
  <label class="f">Notes</label><textarea id="scNotes" placeholder="Where in the field, how bad, what you did">${esc(s.notes||"")}</textarea>
  <label class="f">Photo</label><div class="row"><img id="scImg" class="${s.photo?"":"hidden"}" src="${photoSrc(s.photo)}" style="width:72px;height:72px;object-fit:cover;border-radius:14px" alt="">
  <label class="btn sec sm" style="margin:0">${ic("camera")} ${s.photo?"Change":"Add photo"}<input type="file" accept="image/*" capture="environment" class="hidden" id="scPhoto"></label></div>
  <div class="sp16"></div><div class="grid2">${id?`<button class="btn danger" data-act="scdel">Delete</button>`:`<button class="btn sec" data-close>Cancel</button>`}<button class="btn" data-act="scsave">Save</button></div>`);
  $("#scRate").onclick=e=>{ const b=e.target.closest("button"); if(!b) return; window._scout.health=+b.dataset.v; $$("#scRate button").forEach(x=>x.classList.toggle("on",x===b)); };
  $("#scIss").onclick=e=>{ const b=e.target.closest("button"); if(!b) return; b.classList.toggle("on"); const t=b.textContent; const a=window._scout.issues; const i=a.indexOf(t); i<0?a.push(t):a.splice(i,1); };
  $("#scPhoto").onchange=async e=>{ const f=e.target.files[0]; if(!f) return; try{ window._scout.photo=await downscale(f,1024,.72); $("#scImg").src=window._scout.photo; $("#scImg").classList.remove("hidden"); }catch(err){ toast("Couldn't read that photo"); } };
}

/* ---------- field tasks ---------- */
function fieldTasksTab(p){
  const [from,to]=taskWindow(); const list=allTasks(p,from,to);
  const mStart=ymd(new Date(new Date().getFullYear(),new Date().getMonth(),1)), mEnd=ymd(new Date(new Date().getFullYear(),new Date().getMonth()+1,0));
  const month=list.filter(t=>t.date>=mStart&&t.date<=mEnd), done=month.filter(t=>t.status==="done").length;
  return `<div class="card" style="background:var(--lime)"><div class="row"><div class="grow"><b>${MONTHS[new Date().getMonth()]} activity</b><div class="small">${p.kind==="crop"?`${esc(CROPS[p.crop.id].name)} calendar for southern Nigeria`:"Your tasks"}</div></div><b style="font-size:20px">${done}/${month.length}</b></div>
    <div class="sp8"></div><div class="progress" style="background:rgba(22,59,39,.15)"><i style="width:${month.length?done/month.length*100:0}%"></i></div></div>
    <button class="btn sec block" data-act="addtask">${ic("plus")} Add your own task</button>
    ${tasksBlock(list,false)}`;
}
function addTaskSheet(fid){
  sheet(`<div class="head"><h2>New task</h2><button class="ibtn" data-close>✕</button></div>
  ${fid?"":`<label class="f">Field</label><select id="tkF">${fields.map(f=>`<option value="${f.id}">${esc(f.f.name)}</option>`).join("")}</select>`}
  <label class="f">What needs doing?</label><input id="tkT" placeholder="e.g. Hire 4 labourers for weeding">
  <label class="f">Date</label><input type="date" id="tkD" value="${todayYmd()}">
  <label class="f">Details</label><textarea id="tkN"></textarea>
  <div class="sp16"></div><button class="btn block" data-act="tksave" data-f="${fid||""}">Save task</button>`);
}

/* ---------- records ---------- */
const UNITS=["kg","tonnes","bags (64 kg cocoa)","bags (50 kg)","bunches","litres","kegs (25 L)","tubers","heaps"];
const COSTS=["Labour","Fertiliser","Agrochemicals","Seedlings / stems","Transport","Equipment / tools","Land / rent","Processing","Other"];
function toCropUnit(qty,unit,cropUnit){
  const kg = unit==="kg"?qty : unit==="tonnes"?qty*1000 : unit.startsWith("bags (64")?qty*64 : unit.startsWith("bags (50")?qty*50 : null;
  if(kg==null) return null; return cropUnit.startsWith("t")? kg/1000 : kg;
}
function recordsTab(p){
  const y=String(new Date().getFullYear()); const rec=p.records.slice().sort((a,b)=>b.date.localeCompare(a.date));
  const yr=rec.filter(r=>r.date.startsWith(y));
  const rev=yr.filter(r=>r.type==="harvest").reduce((s,r)=>s+Math.round((r.qty||0)*(r.priceKobo||0)),0);
  const cost=yr.filter(r=>r.type==="cost").reduce((s,r)=>s+(r.amountKobo||0),0);
  const c=CROPS[p.crop?.id], ha=areaHa(p);
  let yieldLine="";
  if(c){ const tot=yr.filter(r=>r.type==="harvest").map(r=>toCropUnit(r.qty||0,r.unit,c.unit)).filter(v=>v!=null).reduce((a,b)=>a+b,0);
    if(tot>0){ const per=ha?tot/ha:null; yieldLine=`<div class="stat" style="grid-column:1/-1"><b>${tot<10?tot.toFixed(2):nf.format(Math.round(tot))} ${esc(c.unit)}${per?` · ${per<10?per.toFixed(2):nf.format(Math.round(per))}/ha`:""}</b><span>Harvested in ${y}${per?` · typical ${c.yieldPerHa[0]}–${c.yieldPerHa[2]} ${esc(c.unit)}/ha`:""}</span></div>`; } }
  return `<div class="card"><div class="stats">
    <div class="stat"><b>${naira(rev)}</b><span>Sales ${y}</span></div><div class="stat"><b>${naira(cost)}</b><span>Costs ${y}</span></div>
    <div class="stat" style="grid-column:1/-1;background:${rev-cost>=0?"var(--lime2)":"var(--redbg)"}"><b>${rev-cost<0?"−":""}${naira(Math.abs(rev-cost))}</b><span>Profit so far this year</span></div>${yieldLine}</div></div>
  <div class="grid2"><button class="btn" data-act="rec" data-type="harvest">${ic("sprout")} Harvest / sale</button><button class="btn sec" data-act="rec" data-type="cost">${ic("coin")} Cost</button></div>
  <div class="sp12"></div>
  ${rec.length?`<div class="card" style="padding:4px 14px">${rec.map(r=>`<div class="li" data-act="rec" data-id="${r.id}"><div class="bul ${r.type==="harvest"?"dark":""}">${ic(r.type==="harvest"?"sprout":"coin")}</div>
    <div class="b"><div class="t">${r.type==="harvest"?`${nf.format(r.qty)} ${esc(r.unit)}`:esc(r.category)}</div><div class="s">${fmtDate(r.date,{day:"numeric",month:"short",year:"numeric"})}${r.notes?" · "+esc(r.notes):""}</div></div>
    <b class="${r.type==="harvest"?"up":""}">${r.type==="harvest"?(r.priceKobo?"+"+naira(Math.round(r.qty*r.priceKobo)):""):"−"+naira(r.amountKobo)}</b></div>`).join("")}</div>`
  :`<div class="card empty">${ic("coin")}<div>Log harvests, sales and costs (labour, fertiliser, chemicals) to see what the field really earns.</div></div>`}`;
}
function recSheet(type,id){
  const r=id? P.records.find(x=>x.id===id) : {id:uid(),type,date:todayYmd(),unit:P.crop?.id==="oilpalm"?"bunches":P.crop?.id==="cocoa"?"bags (64 kg cocoa)":"kg",category:"Labour"};
  type=r.type;
  sheet(`<div class="head"><h2>${type==="harvest"?"Harvest / sale":"Cost"}</h2><button class="ibtn" data-close>✕</button></div>
  <label class="f">Date</label><input type="date" id="rcD" value="${r.date}">
  ${type==="harvest"?`<div class="grid2"><div><label class="f">Quantity</label><input id="rcQ" inputmode="decimal" value="${r.qty??""}"></div><div><label class="f">Unit</label><select id="rcU">${UNITS.map(u=>`<option ${u===r.unit?"selected":""}>${u}</option>`).join("")}</select></div></div>
    <label class="f">Price per unit (₦), if sold</label><input id="rcP" inputmode="numeric" value="${r.priceKobo?Math.round(r.priceKobo/100):""}">`
  :`<label class="f">Category</label><select id="rcC">${COSTS.map(u=>`<option ${u===r.category?"selected":""}>${u}</option>`).join("")}</select>
    <label class="f">Amount (₦)</label><input id="rcA" inputmode="numeric" value="${r.amountKobo?Math.round(r.amountKobo/100):""}">`}
  <label class="f">Notes</label><input id="rcN" value="${esc(r.notes||"")}" placeholder="${type==="harvest"?"Buyer, grade, mill…":"Who / what for"}">
  <div class="sp16"></div><div class="grid2">${id?`<button class="btn danger" data-act="recdel" data-id="${id}">Delete</button>`:`<button class="btn sec" data-close>Cancel</button>`}<button class="btn" data-act="recsave" data-id="${r.id}" data-type="${type}" data-new="${id?"":"1"}">Save</button></div>`);
}
const toKobo=s=>{ const n=parseFloat(String(s).replace(/[₦,\s]/g,"")); return isFinite(n)? Math.round(n*100) : 0; };

/* ---------- land tab ---------- */
function landTab(p){
  const R=compute(); const ap=accessPoint(p);
  const pin = ap? `<div class="pin-card"><div class="row"><div class="grow"><div class="small" style="opacity:.8">Drive-to pin · ${esc(ap.label)}</div>
      <div style="font-weight:700;font-size:17px">${esc(p.f.name||"Site")}</div><div class="co">${ap.lat.toFixed(6)}, ${ap.lon.toFixed(6)}</div></div>
      <div style="width:40px;height:40px;color:var(--lime)">${ic("pin")}</div></div>
    ${ap.src==="state"?`<div class="small" style="margin-top:8px;opacity:.85">This is only the state capital. Pin the gate or walk the boundary for an exact location.</div>`:""}
    <div class="acts"><a class="main" href="${mapsDir(ap)}" target="_blank" rel="noopener">${ic("nav")}Directions</a>
      <a href="${earthUrl(ap)}" target="_blank" rel="noopener">${ic("globe")}Google Earth</a>
      <button data-act="sharepin">${ic("share")}Share pin</button></div>
    <div class="grid2" style="margin-top:8px"><button class="btn sm" style="background:rgba(255,255,255,.12)" data-act="pinhere">${ic("target")} Pin my location</button><button class="btn sm" style="background:rgba(255,255,255,.12)" data-act="gpsgate">${ic("pin")} Mark the gate</button></div></div>` : "";
  const plotSize=parseFloat(p.f.plotSize)||648;
  return `${pin}
  <div class="card"><div class="row"><h2 class="grow" style="margin:0">Boundary beacons <span class="muted small">${p.beacons.length||""}</span></h2></div>
    <p class="muted small" style="margin:4px 0 6px">Add the corners in order as you walk round. The last one joins back to the first.</p>
    <div id="beaconList">${pointsList(p.beacons,"b")}</div>
    <div class="grid2" style="margin-top:10px"><button class="btn" data-act="gpsb">${ic("target")} GPS here</button><button class="btn sec" data-act="manb">Type coords</button></div></div>
  <div class="card"><h2>Site features <span class="muted small">${p.features.length||""}</span></h2>
    <div id="featList">${pointsList(p.features,"f")}</div>
    <div class="grid2" style="margin-top:10px"><button class="btn lime" data-act="gpsf">${ic("target")} GPS here</button><button class="btn sec" data-act="manf">Type coords</button></div></div>
  ${R.B.length>=3?`<div class="card"><div class="stats">
      <div class="stat"><b>${f0(R.area)} m²</b><span>Area</span></div><div class="stat"><b>${(R.area/10000).toFixed(4)} ha</b><span>${(R.area/4046.856).toFixed(3)} acres</span></div>
      <div class="stat"><b>${(R.area/plotSize).toFixed(2)}</b><span>× ${f0(plotSize)} m² plots</span></div><div class="stat"><b>${f2(R.per)} m</b><span>Perimeter</span></div>
      ${R.inset?`<div class="stat"><b>${f0(R.insetArea)} m²</b><span>Inside ${esc(p.f.setback)} m setback</span></div>`:""}
      <div class="stat"><b>${R.worstAcc!=null?"±"+R.worstAcc.toFixed(1)+" m":(p.beacons.every(b=>b.src==="utmm")?"Survey plan":"Typed")}</b><span>${R.worstAcc!=null?"Worst GPS beacon":"Coordinate source"}</span></div></div></div>`:""}
  ${R.B.length+R.F.length?`<div class="card"><svg class="plan" id="planSvg" viewBox="0 0 400 400"></svg><p class="tiny muted" style="margin:8px 0 0">Grid bearings and distances in UTM metres. Pinch or drag to zoom; double-tap to reset.</p></div>`:""}
  ${R.legs.length?`<div class="card"><h2>Boundary legs</h2><table><tr><th>Leg</th><th class="num">Bearing</th><th class="num">Distance</th></tr>${R.legs.map(l=>`<tr><td>${esc(l.from.label)} → ${esc(l.to.label)}</td><td class="num">${fmtDMS(l.brg)}</td><td class="num">${f2(l.dist)} m</td></tr>`).join("")}</table></div>`:""}
  <div class="card"><h2>For the architect</h2>
    <div class="seg" id="dxfMode"><button data-m="local" class="${dxfMode==="local"?"on":""}">Local (B1 = 0,0)</button><button data-m="utm" class="${dxfMode==="utm"?"on":""}">True UTM</button></div>
    <div class="sp12"></div><div class="col">
    <button class="btn block" data-x="dxf">${ic("dl")} DXF drawing (AutoCAD / ArchiCAD)</button>
    <button class="btn sec block" data-act="report">${ic("doc")} Site report (view / print to PDF)</button></div>
    <div class="sp8"></div><div class="grid2"><button class="btn soft sm" data-x="report">Report file</button><button class="btn soft sm" data-x="csv">Coordinates CSV</button><button class="btn soft sm" data-x="kml">Google Earth KML</button><button class="btn soft sm" data-x="geojson">GeoJSON</button></div>
    <div id="copyArea"></div></div>
  ${siteForm(p)}
  <div class="warnbox">Phone GPS is usually only accurate to ±3–10 m: fine for feasibility and early design. For detailed design, type in the beacon coordinates from the registered survey plan. This is not a legal survey: anything for title or approval needs a SURCON-registered surveyor.</div>`;
}
function pointsList(arr,kind){
  if(!arr.length) return `<p class="muted small" style="margin:6px 0">${kind==="b"?"No beacons yet.":"Trees, poles, gate, structures, drains…"}</p>`;
  const prev=P; const z=projZone();
  return arr.map((pt,i)=>{ const xy=utmFwd(pt.lat,pt.lon,z,ELL.WGS84);
    return `<div class="li"><div class="bul ${kind==="b"?"dark":"amber"}">${kind==="b"?i+1:ic("pin")}</div>
    <div class="b"><div class="t">${esc(pt.label||(kind==="b"?"B"+(i+1):pt.type))}${kind==="f"&&pt.type&&pt.label!==pt.type?` <span class="muted small">${esc(pt.type)}</span>`:""}</div>
      <div class="s">E ${f2(xy.E)} · N ${f2(xy.N)} (UTM ${z}N)</div>
      <div style="margin-top:3px">${accChip(pt)} ${pt.notes?`<span class="s">${esc(pt.notes)}</span>`:""}</div></div>
    ${pt.photo?`<img src="${photoSrc(pt.photo)}" alt="">`:""}
    <div class="col" style="gap:4px"><button class="btn soft sm" data-act="editpt" data-k="${kind}" data-id="${pt.id}">Edit</button>
      ${kind==="b"?`<div class="row" style="gap:4px"><button class="btn soft sm" data-act="mv" data-id="${pt.id}" data-d="-1" ${i===0?"disabled":""}>↑</button><button class="btn soft sm" data-act="mv" data-id="${pt.id}" data-d="1" ${i===arr.length-1?"disabled":""}>↓</button></div>`:""}</div></div>`; }).join("");
}
function accChip(p){
  if(p.src!=="gps") return `<span class="chip grey">${{ll:"lat/lon",utmw:"UTM WGS84",utmm:"Survey plan"}[p.src]||"typed"}</span>`;
  const a=p.acc||99; return `<span class="chip ${a<=5?"":a<=10?"warn":"bad"}">GPS ±${a.toFixed(1)} m</span>`;
}
function siteForm(p){
  const F=(k,l,ph="",type="text")=>`<label class="f">${l}</label><input data-f="${k}" type="${type}" ${type==="number"?'inputmode="decimal"':""} placeholder="${ph}" value="${esc(p.f[k]??"")}">`;
  const S=(k,l,opts)=>`<label class="f">${l}</label><select data-f="${k}">${opts.map(o=>{const [v,t]=Array.isArray(o)?o:[o,o]; return `<option value="${esc(v)}" ${String(p.f[k]??"")===String(v)?"selected":""}>${esc(t)}</option>`;}).join("")}</select>`;
  const T=(k,l,ph="")=>`<label class="f">${l}</label><textarea data-f="${k}" placeholder="${ph}">${esc(p.f[k]??"")}</textarea>`;
  return `<details class="card"><summary>Site details & title</summary>
    ${F("client","Client / owner")}${F("address","Address / directions","Landmarks a driver will recognise")}
    <div class="grid2"><div>${F("area","Town / area","Idanre")}</div><div>${F("lga","LGA")}</div></div>
    <div class="grid2"><div>${S("state","State",["",...Object.keys(STATES)])}</div><div>${F("date","Survey date","","date")}</div></div>
    ${F("by","Captured by")}
    <div class="grid2"><div>${F("planNo","Survey plan no.","LS/D/LA 1234")}</div><div>${F("surveyor","Registered surveyor")}</div></div>
    ${S("title","Title document",["","Certificate of Occupancy (C of O)","Governor's Consent","Deed of Assignment","Excision / Gazette","Registered Survey only","Customary / family land","Receipt / Contract of Sale","Other"])}
    ${S("planDatum","Survey-plan coordinates are in",[["","Not known / no plan"],["minna","UTM – Minna datum (most Nigerian plans)"],["wgs84","UTM – WGS84"],["ntm","Nigerian Transverse Mercator / local"]])}
  </details>
  <details class="card"><summary>Site conditions</summary>
    ${S("terrain","Terrain",["","Flat","Gentle slope","Steep slope","Undulating","Low-lying / swampy"])}
    ${S("soil","Soil (visual)",["","Sandy","Loamy","Laterite","Clay","Peat / marshy","Sand-filled (reclaimed)","Rocky"])}
    <label class="f">Present on or at the site</label><div class="checks">${CHECKS.map(c=>`<label><input type="checkbox" data-c="${esc(c)}" ${p.checks[c]?"checked":""}>${esc(c)}</label>`).join("")}</div>
    ${T("access","Access road & frontage","Road name, tarred or not, width, which side")}${T("flood","Flooding / drainage")}${T("neighbours","Neighbours & surroundings")}${T("notes","Other notes")}
  </details>
  <details class="card"><summary>Survey settings</summary>
    <div class="grid2"><div>${F("plotSize","Standard plot (m²)","648","number")}</div><div>${F("setback","Setback to draw (m)","0","number")}</div></div>
    <div class="grid2"><div>${F("gpsSecs","GPS averaging (s)","30","number")}</div><div>${F("gpsMax","Reject fixes over (m)","15","number")}</div></div>
  </details>`;
}
function afterLand(){
  const svg=$("#planSvg"); if(svg){ svg.innerHTML=planSVG(compute()).svg; panZoom(svg,[0,0,400,400]); }
  $$("#dxfMode button").forEach(b=>b.onclick=()=>{ dxfMode=b.dataset.m; $$("#dxfMode button").forEach(x=>x.classList.toggle("on",x===b)); });
}
function bindForms(){
  $$("[data-f]").forEach(el=>{ if(el.tagName==="BUTTON") return; el.addEventListener(el.tagName==="SELECT"?"change":"input",()=>{ if(!P) return; P.f[el.dataset.f]=el.value; touch(); }); });
  $$("[data-c]").forEach(el=>el.addEventListener("change",()=>{ if(!P) return; P.checks[el.dataset.c]=el.checked; touch(); }));
}

/* ---------- pin / directions ---------- */
const mapsDir=ap=>`https://www.google.com/maps/dir/?api=1&destination=${ap.lat.toFixed(6)},${ap.lon.toFixed(6)}`;
const mapsPin=ap=>`https://www.google.com/maps/search/?api=1&query=${ap.lat.toFixed(6)},${ap.lon.toFixed(6)}`;
const earthUrl=ap=>`https://earth.google.com/web/search/${ap.lat.toFixed(6)},${ap.lon.toFixed(6)}`;
function pinText(p){ const ap=accessPoint(p); return `📍 ${p.f.name||"Site"}${p.f.address?"\n"+p.f.address:""}\n${ap.label}: ${ap.lat.toFixed(6)}, ${ap.lon.toFixed(6)}\nDirections: ${mapsDir(ap)}`; }
function sharePinSheet(){
  const t=pinText(P);
  sheet(`<div class="head"><h2>Share drive-to pin</h2><button class="ibtn" data-close>✕</button></div>
  <pre class="copy" style="font-size:13px">${esc(t)}</pre>
  <div class="col"><a class="btn block" style="background:#1f8f4e" href="https://wa.me/?text=${encodeURIComponent(t)}" target="_blank" rel="noopener">${ic("wa")} Send on WhatsApp</a>
  <button class="btn sec block" data-act="copypin">Copy text</button>
  <a class="btn soft block" href="${mapsPin(accessPoint(P))}" target="_blank" rel="noopener">Open pin in Google Maps</a></div>`);
}

/* ================================================================
   MAP
   ================================================================ */
let mapLayer="art", mapFocus=null, leafMap=null;
function mapView(){
  return `<div class="mapscreen"><svg class="map" id="worldSvg"></svg><div id="leaf" class="${mapLayer==="sat"?"":"hidden"}"></div>
  <div class="top"><button class="ibtn" data-act="back">${ic("back")}</button><div class="search">${ic("map")}<span class="grow" style="flex:1">Your fields</span><span class="chip">${fields.length}</span></div></div>
  <div class="ctrls"><button class="ibtn" data-act="layer" aria-label="Layers">${ic("layers")}</button><button class="ibtn" data-act="zoom" data-z="0.6" aria-label="Zoom in">${ic("plus")}</button><button class="ibtn" data-act="zoom" data-z="1.6" aria-label="Zoom out">${ic("minus")}</button><button class="ibtn dark" data-act="locate" aria-label="My location">${ic("target")}</button></div>
  <div class="legend"><span class="chip dark">${mapLayer==="sat"?"Satellite":"Field map"}</span></div></div>`;
}
let worldVB=null, worldProj=null;
function afterMap(){
  if(mapLayer==="sat") return initLeaflet();
  const svg=$("#worldSvg"); const W=innerWidth, H=innerHeight; svg.setAttribute("viewBox",`0 0 ${W} ${H}`);
  const pts=fields.map(p=>({p,c:centroid(p)})).filter(x=>x.c);
  const lat0=pts.length? pts.reduce((s,x)=>s+x.c.lat,0)/pts.length : 7; const k=Math.cos(lat0*D2R);
  const X=lon=>lon*111320*k, Y=lat=>-lat*110540;
  let all=pts.length? pts.map(x=>[X(x.c.lon),Y(x.c.lat)]) : [[X(4),Y(7)]];
  let minx=Math.min(...all.map(a=>a[0])),maxx=Math.max(...all.map(a=>a[0])),miny=Math.min(...all.map(a=>a[1])),maxy=Math.max(...all.map(a=>a[1]));
  const span=Math.max(maxx-minx,maxy-miny,1500);
  const cx=(minx+maxx)/2, cy=(miny+maxy)/2, s=Math.min(W,H)*0.62/span;
  worldProj=(lat,lon)=>[W/2+(X(lon)-cx)*s, H/2+(Y(lat)-cy)*s];
  const rnd=seeded("world"); let g=artDefs("w")+`<rect x="-5000" y="-5000" width="${W+10000}" height="${H+10000}" fill="url(#bgw)"/>`;
  for(let i=0;i<26;i++){ const bx=rnd()*W*1.6-W*.3, by=rnd()*H*1.6-H*.3; g+=`<path d="${smoothPath(blob(bx,by,60+rnd()*110,rnd,8,.5))}" fill="url(#ohw)" stroke="#bccbb3" stroke-dasharray="4 4"/>`; }
  for(let i=0;i<3;i++){ const y0=rnd()*H, y1=rnd()*H; g+=`<path d="M-200,${y0} C${W*.3},${y0+(rnd()-.5)*300} ${W*.7},${y1+(rnd()-.5)*300} ${W+200},${y1}" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round" opacity=".85"/>`; }
  Object.entries(STATES).forEach(([n,[la,lo]])=>{ const [x,y]=worldProj(la,lo); g+=`<text x="${x}" y="${y}" font-size="11" fill="#9aab92" text-anchor="middle" font-weight="600" letter-spacing=".08em">${n.toUpperCase()}</text>`; });
  pts.forEach(({p,c})=>{
    const prev=P; P=p; let poly="";
    if(p.beacons.length>=3){ const sp=p.beacons.map(b=>worldProj(b.lat,b.lon)); poly=`<path d="M${sp.map(q=>q.map(v=>v.toFixed(1)).join(",")).join("L")}Z" fill="#d4edb8" stroke="#2c5a3d" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`; }
    P=prev;
    const [x,y]=worldProj(c.lat,c.lon); const crop=CROPS[p.crop?.id];
    g+=`${poly}<g data-act="open" data-id="${p.id}" style="cursor:pointer" class="wf" transform="translate(${x.toFixed(1)},${y.toFixed(1)})">
      <circle r="18" fill="#d4edb8" stroke="#2c5a3d" stroke-width="1.5" vector-effect="non-scaling-stroke"/>
      <g transform="translate(-10,-10) scale(.84)" color="#2c5a3d">${cropIc(p.crop?.id||"land",24)}</g>
      <g transform="translate(0,28)"><rect x="-70" y="-11" width="140" height="34" rx="12" fill="#fff" stroke="#e1e7dc"/>
      <text y="3" text-anchor="middle" font-size="12" font-weight="700" fill="#13241a">${esc((p.f.name||"Untitled").slice(0,20))}</text>
      <text y="17" text-anchor="middle" font-size="10" fill="#6b786f">${esc(fieldCode(p))}${crop?" · "+esc(crop.name):""}</text></g></g>`;
  });
  svg.innerHTML=g;
  let vb=[0,0,W,H];
  if(mapFocus){ const p=fieldById(mapFocus), c=p&&centroid(p); if(c){ const [x,y]=worldProj(c.lat,c.lon); vb=[x-W*.15,y-H*.15,W*.3,H*.3]; } mapFocus=null; }
  worldVB=panZoom(svg,[0,0,W,H],vb);
}
function initLeaflet(){
  const start=()=>{
    try{
      if(leafMap){ leafMap.remove(); leafMap=null; }
      leafMap=L.map("leaf",{zoomControl:false,attributionControl:true});
      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",{maxZoom:19,attribution:"Imagery © Esri, Maxar, Earthstar Geographics"}).addTo(leafMap);
      const b=[];
      fields.forEach(p=>{ const c=centroid(p); if(!c) return;
        if(p.beacons.length>=3){ const ll=p.beacons.map(x=>[x.lat,x.lon]); L.polygon(ll,{color:"#c8ec6f",weight:2,fillOpacity:.15}).addTo(leafMap); b.push(...ll); }
        L.marker([c.lat,c.lon],{icon:L.divIcon({className:"",html:`<button class="flabel" data-act="open" data-id="${p.id}">${esc(p.f.name||"Untitled")}</button>`,iconSize:null})}).addTo(leafMap); b.push([c.lat,c.lon]); });
      const foc=mapFocus&&fieldById(mapFocus); mapFocus=null;
      if(foc){ const c=centroid(foc); leafMap.setView([c.lat,c.lon],17); } else if(b.length) leafMap.fitBounds(b,{padding:[60,60],maxZoom:17}); else leafMap.setView([7,5],7);
    }catch(e){ mapLayer="art"; render(); toast("Satellite view isn't available here"); }
  };
  if(window.L) return start();
  if(!$("#leafcss")){ const l=document.createElement("link"); l.id="leafcss"; l.rel="stylesheet"; l.href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css"; document.head.appendChild(l); }
  const s=document.createElement("script"); s.src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
  s.onload=start; s.onerror=()=>{ mapLayer="art"; render(); toast("Satellite view needs an internet connection"); }; document.head.appendChild(s);
}
function panZoom(svg, base, init){
  let vb=[...(init||base)]; svg.setAttribute("viewBox",vb.join(" "));
  let ptrs=new Map(), start=null, lastTap=0, moved=false;
  const set=()=>svg.setAttribute("viewBox",vb.map(v=>v.toFixed(2)).join(" "));
  svg.addEventListener("pointerdown",e=>{ ptrs.set(e.pointerId,[e.clientX,e.clientY]); start={vb:[...vb],ptrs:new Map(ptrs)}; moved=false;
    const now=Date.now(); if(now-lastTap<280){ vb=[...base]; set(); } lastTap=now; });
  svg.addEventListener("pointermove",e=>{ if(!ptrs.has(e.pointerId)||!start) return; ptrs.set(e.pointerId,[e.clientX,e.clientY]);
    const r=svg.getBoundingClientRect(), k=start.vb[2]/r.width, ids=[...ptrs.keys()];
    if(ids.length===1&&start.ptrs.size===1){ const [x0,y0]=start.ptrs.get(ids[0]),[x1,y1]=ptrs.get(ids[0]); if(Math.hypot(x1-x0,y1-y0)>4){ moved=true; try{svg.setPointerCapture(e.pointerId)}catch(_){} } vb=[start.vb[0]-(x1-x0)*k,start.vb[1]-(y1-y0)*k,start.vb[2],start.vb[3]]; }
    else if(ids.length>=2&&start.ptrs.size>=2){ moved=true; const a0=start.ptrs.get(ids[0]),b0=start.ptrs.get(ids[1]),a1=ptrs.get(ids[0]),b1=ptrs.get(ids[1]); if(!a0||!b0) return;
      const z=Math.min(40,Math.max(.02,Math.hypot(a0[0]-b0[0],a0[1]-b0[1])/Math.hypot(a1[0]-b1[0],a1[1]-b1[1])));
      const mx=(a0[0]+b0[0])/2-r.left, my=(a0[1]+b0[1])/2-r.top, sx=start.vb[0]+mx*k, sy=start.vb[1]+my*(start.vb[3]/r.height);
      const w=start.vb[2]*z,h=start.vb[3]*z; vb=[sx-mx/r.width*w, sy-my/r.height*h, w, h]; }
    set(); });
  const up=e=>{ ptrs.delete(e.pointerId); start={vb:[...vb],ptrs:new Map(ptrs)}; };
  svg.addEventListener("pointerup",up); svg.addEventListener("pointercancel",up);
  svg.addEventListener("click",e=>{ if(moved){ e.stopPropagation(); e.preventDefault(); moved=false; } },true);
  svg.addEventListener("wheel",e=>{ e.preventDefault(); const r=svg.getBoundingClientRect(); const px=vb[0]+(e.clientX-r.left)/r.width*vb[2], py=vb[1]+(e.clientY-r.top)/r.height*vb[3], z=e.deltaY>0?1.15:1/1.15;
    vb=[px-(px-vb[0])*z, py-(py-vb[1])*z, vb[2]*z, vb[3]*z]; set(); },{passive:false});
  return { zoom(z){ const cx=vb[0]+vb[2]/2, cy=vb[1]+vb[3]/2; vb=[cx-vb[2]*z/2, cy-vb[3]*z/2, vb[2]*z, vb[3]*z]; set(); }, center(x,y){ vb=[x-vb[2]/2,y-vb[3]/2,vb[2],vb[3]]; set(); } };
}

/* ================================================================
   TASKS + SETTINGS
   ================================================================ */
let taskFilter="all";
function tasksView(){
  const [from,to]=taskWindow();
  const list=fields.filter(f=>taskFilter==="all"||f.id===taskFilter).flatMap(f=>allTasks(f,from,to));
  return `<div class="topbar"><h1 style="margin:0;font-size:24px;flex:1">Tasks</h1><button class="ibtn dark" data-act="addtask" aria-label="Add task">${ic("plus")}</button></div>
  <div class="wrap">${fields.length>1?`<div class="pills" style="margin-bottom:6px"><button class="${taskFilter==="all"?"on":""}" data-act="tfilter" data-id="all">All fields</button>${fields.map(f=>`<button class="${taskFilter===f.id?"on":""}" data-act="tfilter" data-id="${f.id}">${esc(f.f.name)}</button>`).join("")}</div>`:""}
  ${fields.length?tasksBlock(list,true):`<div class="card empty">${ic("tasks")}<div>Add a field and its crop calendar shows up here.</div></div>`}</div>`;
}
function settingsView(){
  return `<div class="topbar"><h1 style="margin:0;font-size:24px;flex:1">Settings</h1></div><div class="wrap">${Sync.settingsCards()}
  <div class="card"><label class="f" style="margin-top:0">Your name</label><input id="stName" value="${esc(settings.name||"")}" placeholder="Jay">
    <label class="f">Default state (for weather before a field is located)</label><select id="stState">${Object.keys(STATES).map(s=>`<option ${s===settings.state?"selected":""}>${s}</option>`).join("")}</select></div>
  <div class="card"><h2>Your data</h2><p class="muted small">${Sync.mode==="on"?"Your fields sync to yarnOga's server, so they're safe if you lose or change phones. Demo farms stay on this phone only. A backup file is still handy to keep.":"Fields are saved on this phone only. Back up now and then, especially before changing phones."}</p>
    <div class="col"><button class="btn block" data-act="backupall">${ic("dl")} Back up everything</button>
    <label class="btn sec block" style="margin:0">Restore a backup<input type="file" id="importFile" accept=".json,application/json" class="hidden"></label>
    ${fields.some(f=>f.demo)?`<button class="btn danger block" data-act="cleardemo">Remove demo farms</button>`:`<button class="btn soft block" data-act="demo">Load demo farms</button>`}</div><div id="copyArea"></div></div>
  <div class="card"><h2>About</h2><p class="small muted">${APP_NAME} by yarnOga. A personal farm and land tool for southern Nigeria: cocoa, oil palm, cassava, plantain, maize and yam. Crop calendars and risk alerts are planning guides based on common extension advice (CRIN, NIFOR, IITA). Always follow product labels and your local ADP / extension officer.</p>
  <p class="small muted">Weather data by <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo.com</a> (CC BY 4.0). Satellite imagery © Esri and its partners. Land survey results are preliminary and are not a registered survey.</p></div></div>`;
}

/* ================================================================
   NEW / EDIT FIELD
   ================================================================ */
function newFieldSheet(edit=false){
  const p=edit?P:null; const cr=p?.crop||{};
  window._nf={kind:p?.kind||"crop", crop:cr.id||"cocoa"};
  const varOpts=id=>CROPS[id].varieties.map(v=>`<option ${v===cr.variety?"selected":""}>${esc(v)}</option>`).join("");
  sheet(`<div class="head"><h2>${edit?"Edit field":"Add a field or land"}</h2><button class="ibtn" data-close>✕</button></div>
  <div class="seg" id="nfKind" style="width:100%;display:flex"><button data-k="crop" style="flex:1" class="${window._nf.kind==="crop"?"on":""}">Crop field</button><button data-k="land" style="flex:1" class="${window._nf.kind==="land"?"on":""}">Land only</button></div>
  <label class="f">Name</label><input id="nfName" value="${esc(p?.f.name||"")}" placeholder="e.g. Idanre cocoa farm">
  <div id="nfCrop" class="${window._nf.kind==="crop"?"":"hidden"}">
    <label class="f">Crop</label><div class="cropgrid" id="nfCrops">${CROP_ORDER.map(id=>`<button data-c="${id}" class="${id===window._nf.crop?"on":""}">${cropIc(id)}${CROPS[id].name}</button>`).join("")}</div>
    <label class="f">Variety</label><select id="nfVar">${varOpts(window._nf.crop)}</select>
    <div class="grid2"><div><label class="f">Planting date</label><input type="date" id="nfPlanted" value="${esc(cr.planted||"")}"></div><div><label class="f">Area (ha)</label><input id="nfArea" inputmode="decimal" placeholder="${p&&p.beacons.length>=3?"from boundary":"e.g. 2.5"}" value="${esc(cr.areaHa||"")}"></div></div>
    <div class="tiny muted" style="margin-top:4px">Not sure of the exact date? Pick the month. For old cocoa or palm, an approximate year is fine.</div>
  </div>
  <div class="grid2"><div><label class="f">State</label><select id="nfState">${Object.keys(STATES).map(s=>`<option ${s===(p?.f.state||settings.state)?"selected":""}>${s}</option>`).join("")}</select></div><div><label class="f">Town / area</label><input id="nfTown" value="${esc(p?.f.area||"")}"></div></div>
  <div class="sp16"></div>
  <button class="btn block" data-act="nfsave" data-edit="${edit?1:""}">${edit?"Save changes":"Create"}</button>
  ${edit?`<div id="helpersWrap"></div><div class="sp8"></div><button class="btn danger block" data-act="delfield">${p._role==="helper"?"Leave this farm":"Delete this field"}</button>`:""}`);
  if(edit) Sync.helpersBlock(p).then(h=>{ const w=$("#helpersWrap"); if(w){ w.innerHTML=h; Sync.loadHelpers(p); } });
  $("#nfKind").onclick=e=>{ const b=e.target.closest("button"); if(!b) return; window._nf.kind=b.dataset.k; $$("#nfKind button").forEach(x=>x.classList.toggle("on",x===b)); $("#nfCrop").classList.toggle("hidden",b.dataset.k!=="crop"); };
  $("#nfCrops").onclick=e=>{ const b=e.target.closest("button"); if(!b) return; window._nf.crop=b.dataset.c; $$("#nfCrops button").forEach(x=>x.classList.toggle("on",x===b)); $("#nfVar").innerHTML=varOpts(b.dataset.c); };
}
async function saveFieldSheet(edit){
  const name=$("#nfName").value.trim(); if(!name) return toast("Give it a name");
  const p=edit?P:normalize({id:uid(),created:Date.now(),f:{date:todayYmd()},beacons:[],features:[]});
  p.f.name=name; p.f.state=$("#nfState").value; p.f.area=$("#nfTown").value.trim(); p.kind=window._nf.kind;
  if(p.kind==="crop"){ const prevId=p.crop?.id; p.crop={...(p.crop||{}),id:window._nf.crop,variety:$("#nfVar").value,planted:$("#nfPlanted").value||"",areaHa:$("#nfArea").value.trim()}; if(prevId!==p.crop.id) p.code=null; }
  else { p.crop=null; p.code=null; }
  fieldCode(p);
  if(!edit) fields.unshift(p);
  touch(p); await Store.put(p); closeSheet(); P=p;
  if(!edit){ go({name:"field",id:p.id,tab:p.kind==="crop"?"overview":"land"}); toast(p.kind==="crop"?"Field created: the crop calendar is in Tasks":"Land created: walk the boundary or type the beacons"); }
  else { route.tab=tabsFor(p).some(t=>t[0]===route.tab)?route.tab:tabsFor(p)[0][0]; render(); }
}

/* ================================================================
   SURVEY POINT EDITOR + GPS (ported)
   ================================================================ */
function downscale(file,max,q){ return new Promise((res,rej)=>{ const img=new Image(), url=URL.createObjectURL(file);
  img.onload=()=>{ const s=Math.min(1,max/Math.max(img.width,img.height)), c=document.createElement("canvas"); c.width=Math.round(img.width*s); c.height=Math.round(img.height*s);
    c.getContext("2d").drawImage(img,0,0,c.width,c.height); URL.revokeObjectURL(url); res(c.toDataURL("image/jpeg",q)); };
  img.onerror=rej; img.src=url; }); }
let edit=null;
function editPoint(kind,point,isNew=false){
  edit={kind,point:{...point},isNew}; const p=edit.point;
  $("#ptTitle").textContent=(isNew?"New ":"")+(kind==="b"?"beacon":"feature");
  $("#pTypeWrap").classList.toggle("hidden",kind==="b");
  $("#pLabel").value=p.label||(kind==="b"?"B"+(P.beacons.length+(isNew?1:0)):"");
  $("#pType").value=p.type||"Gate / access";
  $("#pNotes").value=p.notes||"";
  $("#pMode").value=p.src||"ll";
  $("#pMode").querySelector('[value="gps"]').disabled=p.src!=="gps";
  fillCoordInputs(); setPhoto(p.photo); $("#pDelete").classList.toggle("hidden",isNew); openM("#mPoint");
}
function fillCoordInputs(){
  const p=edit.point, m=$("#pMode").value;
  $("#pLL").classList.toggle("hidden",m==="utmw"||m==="utmm"); $("#pUTM").classList.toggle("hidden",!(m==="utmw"||m==="utmm"));
  $("#pGpsInfo").textContent=(p.src==="gps"&&m==="gps")?`Averaged from ${p.n||1} GPS fixes, estimated ±${(p.acc||0).toFixed(1)} m.`:(m==="utmm"?"Enter the beacon coordinates exactly as printed on the registered survey plan.":"");
  const hasLL=p.lat!=null&&isFinite(p.lat);
  if(m==="gps"||m==="ll"){ $("#pLat").value=hasLL?p.lat.toFixed(7):""; $("#pLon").value=hasLL?p.lon.toFixed(7):""; $("#pLat").disabled=$("#pLon").disabled=(m==="gps"); }
  else { const z=(p.raw&&p.raw.zone)||(hasLL?zoneFor(p.lon):(P.beacons[0]?zoneFor(P.beacons[0].lon):31)); $("#pZone").value=String(Math.min(33,Math.max(31,z)));
    if(p.raw&&p.src===m){ $("#pE").value=p.raw.E; $("#pN").value=p.raw.N; }
    else if(hasLL){ const src=m==="utmm"?wgsToMinna(p.lat,p.lon):p; const u=utmFwd(src.lat,src.lon,z,m==="utmm"?ELL.CLARKE:ELL.WGS84); $("#pE").value=u.E.toFixed(2); $("#pN").value=u.N.toFixed(2); }
    else { $("#pE").value=""; $("#pN").value=""; } }
}
$("#pMode").onchange=fillCoordInputs;
function setPhoto(src){ edit.point.photo=src||null; $("#pImg").src=photoSrc(src); $("#pImg").classList.toggle("hidden",!src); $("#pPhotoDel").classList.toggle("hidden",!src); }
$("#pPhotoDel").onclick=()=>setPhoto(null);
$("#pPhoto").onchange=async e=>{ const f=e.target.files[0]; e.target.value=""; if(!f) return; try{ setPhoto(await downscale(f,1024,.72)); }catch(err){ toast("Couldn't read that photo"); } };
$("#pSave").onclick=()=>{
  const p=edit.point, m=$("#pMode").value;
  p.label=$("#pLabel").value.trim(); p.notes=$("#pNotes").value.trim(); if(edit.kind==="f"){ p.type=$("#pType").value; if(!p.label) p.label=p.type; }
  if(m==="ll"){ const lat=parseFloat($("#pLat").value), lon=parseFloat($("#pLon").value);
    if(!(Math.abs(lat)<=90&&Math.abs(lon)<=180)) return toast("Enter a valid latitude and longitude");
    if(lat<3||lat>14.5||lon<2.5||lon>15) toast("Heads up: that point is outside Nigeria");
    p.lat=lat; p.lon=lon; p.src="ll"; p.raw=null; p.acc=null; }
  else if(m==="utmw"||m==="utmm"){ const E=parseFloat($("#pE").value.replace(/,/g,"")), N=parseFloat($("#pN").value.replace(/,/g,"")), z=+$("#pZone").value;
    if(!(E>100000&&E<900000&&N>0&&N<2000000)) return toast("Easting should be 6 digits and Northing up to 7 digits (metres)");
    let ll=utmInv(E,N,z,m==="utmm"?ELL.CLARKE:ELL.WGS84); if(m==="utmm") ll=minnaToWgs(ll.lat,ll.lon);
    p.lat=ll.lat; p.lon=ll.lon; p.src=m; p.raw={E,N,zone:z}; p.acc=null; }
  if(p.lat==null) return toast("Add coordinates first");
  const arr=edit.kind==="b"?P.beacons:P.features;
  if(edit.isNew) arr.push(p); else arr[arr.findIndex(x=>x.id===p.id)]=p;
  touch(); closeM("#mPoint"); render(); toast("Saved");
};
$("#pDelete").onclick=async()=>{ if(!await confirmBox("Delete point?",`"${edit.point.label}" will be removed.`)) return;
  const k=edit.kind==="b"?"beacons":"features"; forget(P,edit.point.id); P[k]=P[k].filter(x=>x.id!==edit.point.id); touch(); closeM("#mPoint"); render(); };

let gpsWatch=null;
function startGps(kind, onDone){
  if(!("geolocation" in navigator)) return toast("No GPS access in this browser. Type the coordinates instead.");
  const secs=onDone?12:Math.max(5,parseFloat(P.f.gpsSecs)||30), maxAcc=Math.max(3,parseFloat(P.f.gpsMax)||15);
  const fixes=[]; let t0=null, timer=null;
  $("#gpsTitle").textContent= onDone? "Finding your location" : kind==="b"?`Capturing beacon B${P.beacons.length+1}`:"Capturing feature";
  $("#gpsAcc").textContent="—"; $("#gpsInfo").textContent="Waiting for GPS… (allow location access if asked)"; $("#gpsBar").style.width="0"; $("#gpsDone").disabled=true; openM("#mGps");
  const finish=save=>{
    if(gpsWatch!=null) navigator.geolocation.clearWatch(gpsWatch); gpsWatch=null; clearInterval(timer); closeM("#mGps");
    if(!save) return; const good=fixes.filter(f=>f.acc<=maxAcc), use=good.length?good:fixes; if(!use.length) return toast("No GPS fix received");
    let sw=0,la=0,lo=0; use.forEach(f=>{ const w=1/(f.acc*f.acc); sw+=w; la+=f.lat*w; lo+=f.lon*w; });
    const best=Math.min(...use.map(f=>f.acc)); const accEst=Math.max(best/Math.sqrt(Math.min(use.length,6)),1.5);
    const pt={id:uid(),lat:la/sw,lon:lo/sw,acc:accEst,n:use.length,src:"gps",t:Date.now()};
    if(!good.length) toast(`No fix was better than ±${maxAcc} m. Saved anyway; consider re-capturing.`,4000);
    if(onDone) return onDone(pt);
    editPoint(kind,pt,true);
  };
  $("#gpsCancel").onclick=()=>finish(false); $("#gpsDone").onclick=()=>finish(true);
  gpsWatch=navigator.geolocation.watchPosition(pos=>{
    const c=pos.coords; fixes.push({lat:c.latitude,lon:c.longitude,acc:Math.max(.5,c.accuracy||.5)});
    if(!t0){ t0=Date.now(); timer=setInterval(()=>{ const el=(Date.now()-t0)/1000; $("#gpsBar").style.width=Math.min(100,el/secs*100)+"%"; if(el>=secs) finish(true); },250); }
    $("#gpsDone").disabled=false; $("#gpsAcc").textContent=`±${(c.accuracy||0).toFixed(1)} m`;
    $("#gpsInfo").textContent=`${fixes.length} fixes · ${fixes.filter(f=>f.acc<=maxAcc).length} usable (≤ ${maxAcc} m) · averaging ${secs}s`;
  }, err=>{ finish(false);
    toast(err.code===1?"Location is blocked here. Open the app from its own web address and allow location, or type the coordinates.":err.code===3?"GPS timed out. Move into open sky and try again.":"Couldn't get a GPS fix. Try again outdoors.",6000);
  }, {enableHighAccuracy:true,maximumAge:0,timeout:30000});
}

/* ================================================================
   DOWNLOADS
   ================================================================ */
let dlCap=null;
if(window.claude && typeof window.claude.use==="function"){ dlCap=window.claude.use("downloads").catch(()=>null); }
async function saveFile(name,data,mime){
  if(dlCap){ const d=await dlCap; if(d){ try{ await d.save({filename:name,data}); toast("Saved "+name); return; }catch(e){ if(/declin|cancel|reject/i.test(String(e&&(e.message||e.code)||e))) return; } } }
  try{ const blob=new Blob([data],{type:mime}), url=URL.createObjectURL(blob), a=document.createElement("a");
    a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),4000); toast("Downloading "+name);
  }catch(e){ const el=$("#copyArea"); if(el) el.innerHTML=`<label class="f">${esc(name)}: copy and paste into a file</label><pre class="copy">${esc(data.slice(0,200000))}</pre>`; }
}

/* ================================================================
   ACTIONS
   ================================================================ */
const ACT={
  go:d=>go({name:d.r}), back:()=>back(), new:()=>newFieldSheet(), demo:()=>loadDemo(),
  open:d=>{ P=fieldById(d.id); go({name:"field",id:d.id,tab:d.tab||null}); },
  tab:d=>{ route={...route,tab:d.tab}; try{ history.replaceState(route,""); }catch(e){} render(); },
  editfield:()=>newFieldSheet(true), nfsave:d=>saveFieldSheet(!!d.edit),
  delfield:async()=>{ closeSheet(); const helper=P._role==="helper";
    if(!await confirmBox(helper?"Leave this farm?":"Delete field?", helper?`You'll stop seeing "${P.f.name}". The owner keeps it.`:`"${P.f.name}" and all its records will be deleted${P._synced?" for everyone on it":" from this phone"}.`, helper?"Leave":"Delete")) return;
    await Sync.deleteField(P); await Store.del(P.id); fields=fields.filter(f=>f!==P); P=null; go({name:"home"}); },
  leavefield:()=>ACT.delfield(),
  syncnow:()=>{ Sync.run(); toast("Syncing…"); },
  logout:async()=>{ if(!await confirmBox("Log out?","Synced fields are removed from this phone; they come back when you log in again. Changes not yet synced will be lost.","Log out")) return; Sync.logout(); },
  invitetester:()=>Sync.invite("app",$("#invName")?.value.trim()),
  toggleuser:d=>Sync.toggleUser(d.id,!!d.off),
  invitehelper:()=>{ closeSheet(); Sync.invite("field"); },
  rmhelper:d=>Sync.removeHelper(d.id),
  gatelink:()=>{ const v=$("#gateLink").value; const t=(v.match(/invite=([A-Za-z0-9_-]{30,60})/)||[])[1]; if(!t) return toast("That doesn't look like an invite link"); Sync.joinSheet(t); },
  localonly:async()=>{ settings.localOnly=true; saveSettings(); Sync.mode="local"; if(!fields.length) await loadDemo(); else render(); },
  mapfield:()=>{ mapFocus=P.id; go({name:"map"}); },
  rain:d=>{ rainMode=d.m; const y=scrollY; render(); scrollTo(0,y); },
  scout:d=>scoutSheet(d.id),
  ask:()=>Ask.open(P),
  scsave:()=>{ const s=window._scout; s.date=$("#scDate").value||todayYmd(); s.notes=$("#scNotes").value.trim();
    $$("#sheetBody [data-m]").forEach(i=>s.m[i.dataset.m]=i.value.trim());
    const isNew=s.isNew; delete s.isNew; if(isNew) P.scouts.push(s); else P.scouts[P.scouts.findIndex(x=>x.id===s.id)]=s;
    touch(); closeSheet(); render(); toast("Scouting saved"); },
  scdel:async()=>{ closeSheet(); if(!await confirmBox("Delete scouting?","This entry will be removed.")) return; forget(P,window._scout.id); P.scouts=P.scouts.filter(x=>x.id!==window._scout.id); touch(); render(); },
  tdone:d=>{ const p=fieldById(d.f); const cur=(p.tasks.find(t=>t.id===d.t)?.status)||p.taskState[d.t]||"todo"; setTaskStatus(d.f,d.t,cur==="done"?"todo":"done"); const y=scrollY; render(); scrollTo(0,y); },
  tcycle:d=>{ const p=fieldById(d.f); const cur=(p.tasks.find(t=>t.id===d.t)?.status)||p.taskState[d.t]||"todo"; setTaskStatus(d.f,d.t,nextStatus(cur)); const y=scrollY; render(); scrollTo(0,y); },
  addtask:()=>{ if(!fields.length) return toast("Add a field first"); addTaskSheet(route.name==="field"?P.id:null); },
  tksave:d=>{ const fid=d.f||$("#tkF").value; const p=fieldById(fid); const t=$("#tkT").value.trim(); if(!t) return toast("What needs doing?");
    p.tasks.push({id:uid(),title:t,date:$("#tkD").value||todayYmd(),detail:$("#tkN").value.trim(),status:"todo"}); touch(p); closeSheet(); render(); toast("Task added"); },
  tfilter:d=>{ taskFilter=d.id; render(); },
  rec:d=>recSheet(d.type,d.id),
  recsave:d=>{ const r={id:d.id,type:d.type,date:$("#rcD").value||todayYmd(),notes:$("#rcN").value.trim()};
    if(d.type==="harvest"){ r.qty=parseFloat($("#rcQ").value); if(!(r.qty>0)) return toast("Enter the quantity"); r.unit=$("#rcU").value; r.priceKobo=toKobo($("#rcP").value); }
    else { r.category=$("#rcC").value; r.amountKobo=toKobo($("#rcA").value); if(!(r.amountKobo>0)) return toast("Enter the amount"); }
    if(d.new) P.records.push(r); else P.records[P.records.findIndex(x=>x.id===r.id)]=r; touch(); closeSheet(); render(); },
  recdel:async d=>{ closeSheet(); if(!await confirmBox("Delete record?","")) return; forget(P,d.id); P.records=P.records.filter(x=>x.id!==d.id); touch(); render(); },
  gpsb:()=>startGps("b"), gpsf:()=>startGps("f"),
  manb:()=>editPoint("b",{id:uid(),src:P.f.planDatum==="minna"?"utmm":P.f.planDatum==="wgs84"?"utmw":"ll"},true),
  manf:()=>editPoint("f",{id:uid(),src:"ll",type:"Gate / access"},true),
  editpt:d=>editPoint(d.k,(d.k==="b"?P.beacons:P.features).find(x=>x.id===d.id)),
  mv:d=>{ const i=P.beacons.findIndex(b=>b.id===d.id), j=i+(+d.d); if(j<0||j>=P.beacons.length) return; [P.beacons[i],P.beacons[j]]=[P.beacons[j],P.beacons[i]]; touch(); render(); },
  pinhere:()=>startGps("f",pt=>{ P.loc={lat:pt.lat,lon:pt.lon,acc:pt.acc}; touch(); render(); refreshWx(P,true); toast("Location pinned"); }),
  gpsgate:()=>startGps("f",pt=>{ editPoint("f",{...pt,type:"Gate / access",label:"Gate"},true); }),
  sharepin:()=>sharePinSheet(),
  copypin:async()=>{ try{ await navigator.clipboard.writeText(pinText(P)); toast("Copied"); }catch(e){ toast("Copy blocked: select the text and copy it"); } },
  report:()=>{ const {css,body}=buildReport(false); $("#repBody").innerHTML=`<style>${css}</style>${body}`; openM("#mReport"); },
  layer:()=>{ mapLayer=mapLayer==="art"?"sat":"art"; render(); },
  zoom:d=>{ if(mapLayer==="sat"&&leafMap) return +d.z<1?leafMap.zoomIn():leafMap.zoomOut(); worldVB&&worldVB.zoom(+d.z); },
  locate:()=>{ if(!navigator.geolocation) return toast("No GPS here"); navigator.geolocation.getCurrentPosition(pos=>{
      if(mapLayer==="sat"&&leafMap){ leafMap.setView([pos.coords.latitude,pos.coords.longitude],16); L.circleMarker([pos.coords.latitude,pos.coords.longitude],{radius:8,color:"#fff",fillColor:"#3d7ea6",fillOpacity:1}).addTo(leafMap); return; }
      const [x,y]=worldProj(pos.coords.latitude,pos.coords.longitude); worldVB.center(x,y);
      $("#worldSvg").insertAdjacentHTML("beforeend",`<circle cx="${x}" cy="${y}" r="8" fill="#3d7ea6" stroke="#fff" stroke-width="3" vector-effect="non-scaling-stroke"/>`); },
      ()=>toast("Location is blocked here"),{enableHighAccuracy:true,timeout:15000}); },
  backupall:()=>saveFile(`oko_backup_${todayYmd()}.json`,JSON.stringify({app:"oko",v:2,settings,fields}),"application/json"),
  cleardemo:async()=>{ for(const f of fields.filter(f=>f.demo)) await Store.del(f.id); fields=fields.filter(f=>!f.demo); render(); toast("Demo farms removed"); }
};
document.addEventListener("click",e=>{
  const x=e.target.closest("[data-x]"); if(x&&P){ const k=x.dataset.x, s=slug();
    try{ if(k==="dxf") saveFile(`${s}_${dxfMode}.dxf`,buildDXF(),"application/dxf");
      if(k==="csv") saveFile(`${s}_coordinates.csv`,buildCSV(),"text/csv");
      if(k==="kml") saveFile(`${s}.kml`,buildKML(),"application/vnd.google-earth.kml+xml");
      if(k==="geojson") saveFile(`${s}.geojson`,buildGeoJSON(),"application/geo+json");
      if(k==="report") saveFile(`${s}_site_report.html`,buildReport(),"text/html");
    }catch(err){ toast(err.message||"Export failed"); } return; }
  const a=e.target.closest("[data-act]"); if(!a) return;
  const fn=ACT[a.dataset.act]; if(fn){ e.preventDefault(); fn(a.dataset); }
});
document.addEventListener("change",async e=>{
  if(e.target.id==="stName"){ settings.name=e.target.value.trim(); saveSettings(); }
  if(e.target.id==="stState"){ settings.state=e.target.value; saveSettings(); }
  if(e.target.id==="importFile"){ const f=e.target.files[0]; e.target.value=""; if(!f) return;
    try{ const j=JSON.parse(await f.text()); let list=j.fields||(j.project?[j.project]:null); if(!list) throw 0;
      for(const p of list){ normalize(p); if(fieldById(p.id)) p.id=uid(); delete p._synced; delete p._ver; p._dirty=!p.demo; await Store.put(p); }
      Sync.schedule();
      if(j.settings){ Object.assign(settings,j.settings,{id:"__settings"}); saveSettings(); }
      await loadAll(); render(); toast(`Restored ${list.length} field${list.length>1?"s":""}`);
    }catch(err){ toast("That file isn't a backup from this app"); } }
});
$("#repPrint").onclick=()=>{ try{ const w=window.open("","_blank"); if(w){ w.document.write(buildReport()); w.document.close(); setTimeout(()=>{ try{w.print()}catch(e){} },400); return; } }catch(e){} try{ window.print(); }catch(e){ toast("Printing is blocked here. Download the report file instead."); } };

/* ================================================================
   DEMO DATA
   ================================================================ */
async function loadDemo(){
  const mk=(name,state,area,lat,lon,w,h,skew,crop)=>{
    const p=normalize({id:uid(),demo:true,created:Date.now(),f:{name,state,area,date:todayYmd(),plotSize:"648"},beacons:[],features:[],kind:crop?"crop":"land",crop});
    const z=zoneFor(lon), o=utmFwd(lat,lon,z,ELL.WGS84);
    [[0,0],[w,skew],[w+skew*1.5,h],[skew*.5,h-skew]].forEach((c,i)=>{ const ll=utmInv(o.E+c[0],o.N+c[1],z,ELL.WGS84); p.beacons.push({id:uid(),label:"B"+(i+1),lat:ll.lat,lon:ll.lon,src:"utmm"}); });
    return p;
  };
  const y=new Date().getFullYear();
  const cocoa=mk("Idanre cocoa farm","Ondo","Idanre",7.112,5.118,150,160,12,{id:"cocoa",variety:"CRIN TC1–TC8 hybrids",planted:"2017-05-20",areaHa:""});
  const palm=mk("Okomu Road oil palm","Edo","Udo",6.398,5.336,240,210,-18,{id:"oilpalm",variety:"Tenera (NIFOR hybrid)",planted:"2020-06-10",areaHa:""});
  const cass=mk("Ijebu-Ode cassava plot","Ogun","Ijebu-Ode",6.835,3.927,95,125,6,{id:"cassava",variety:"TME 419",planted:ymd(new Date(Date.now()-205*DAY)),areaHa:""});
  const land=mk("Plot 7, Lekki Phase 1","Lagos","Lekki Phase 1",6.4474,3.4723,18.3,36,0.6,null);
  land.f.setback="3"; land.f.title="Certificate of Occupancy (C of O)"; land.f.access="Fronts a 7.2 m tarred estate road on the north side."; land.f.address="Off Admiralty Way, near the roundabout";
  const addF=(p,type,label,dx,dy,notes)=>{ const z=zoneFor(p.beacons[0].lon), o=utmFwd(p.beacons[0].lat,p.beacons[0].lon,z,ELL.WGS84); const ll=utmInv(o.E+dx,o.N+dy,z,ELL.WGS84); p.features.push({id:uid(),type,label,lat:ll.lat,lon:ll.lon,src:"ll",notes}); };
  addF(land,"Gate / access","Gate",9,36.4,"Existing gate"); addF(land,"Tree","Almond tree",5,8,"Approx 40 cm trunk"); addF(cocoa,"Gate / access","Farm entrance",0,80,"Footpath from the Idanre–Owena road");
  const d=n=>ymd(new Date(Date.now()-n*DAY));
  cocoa.scouts=[{id:uid(),date:d(52),health:4,issues:[],m:{pods:"14",blackpods:"3",trees:"20"},notes:""},{id:uid(),date:d(34),health:3,issues:["Black pod"],m:{pods:"12",blackpods:"9",trees:"20"},notes:"Lower slope near the stream is worst."},{id:uid(),date:d(19),health:3,issues:["Black pod","Mirid / capsid damage"],m:{pods:"15",blackpods:"6",trees:"20"},notes:"Sprayed copper on the 14th."},{id:uid(),date:d(6),health:4,issues:["Mirid / capsid damage"],m:{pods:"17",blackpods:"2",trees:"20"},notes:"Main crop pods ripening."}];
  cocoa.records=[{id:uid(),type:"cost",date:`${y}-05-12`,category:"Agrochemicals",amountKobo:18500000,notes:"Fungicide & knapsack repairs"},{id:uid(),type:"cost",date:`${y}-08-02`,category:"Labour",amountKobo:12000000,notes:"Slashing, 6 men × 2 days"},{id:uid(),type:"harvest",date:`${y}-07-18`,qty:3,unit:"bags (64 kg cocoa)",priceKobo:38000000,notes:"Light crop, sold in Akure"},{id:uid(),type:"harvest",date:d(9),qty:5,unit:"bags (64 kg cocoa)",priceKobo:41000000,notes:"First main-crop sale"}];
  palm.scouts=[{id:uid(),date:d(40),health:4,issues:["Orange-spotted / yellow fronds (K/Mg)"],m:{bunches:"58",bunchkg:"9",palms:"40"}},{id:uid(),date:d(12),health:4,issues:["Rats on bunches"],m:{bunches:"44",bunchkg:"10",palms:"40"},notes:"Set traps on rows 6–9"}];
  palm.records=[{id:uid(),type:"harvest",date:d(26),qty:52,unit:"bunches",priceKobo:950000,notes:"Sold FFB to local mill"},{id:uid(),type:"cost",date:d(60),category:"Fertiliser",amountKobo:26000000,notes:"NPK + MOP"},{id:uid(),type:"harvest",date:d(12),qty:44,unit:"bunches",priceKobo:950000}];
  cass.scouts=[{id:uid(),date:d(150),health:4,issues:["Missing stands"],m:{stands:"96"},notes:"Replanted ~4%"},{id:uid(),date:d(95),health:5,issues:[],m:{height:"110"}},{id:uid(),date:d(30),health:4,issues:["Mosaic disease (CMD)"],m:{height:"185",cmd:"3"},notes:"Rogued affected plants"}];
  cass.records=[{id:uid(),type:"cost",date:d(205),category:"Seedlings / stems",amountKobo:9000000,notes:"TME 419 bundles"},{id:uid(),type:"cost",date:d(180),category:"Labour",amountKobo:7500000,notes:"Planting & 1st weeding"}];
  [cocoa,palm,cass].forEach(p=>{ p.wx=sampleWx(p.f.name, p.beacons[0].lat); });
  for(const p of [cocoa,palm,cass,land]){ fieldCode(p); fields.push(p); await Store.put(p); }
  fields.sort((a,b)=>(b.updated||b.created)-(a.updated||a.created)); closeSheet(); render(); toast("Demo farms loaded");
}

/* ================================================================
   BOOT
   ================================================================ */
(async()=>{
  await loadAll();
  try{ history.replaceState(route,""); }catch(e){}
  await Sync.init();
  render();
  Sync.run(); setInterval(()=>Sync.run(),60000);
  addEventListener("online",()=>Sync.run());
  document.addEventListener("visibilitychange",()=>{ if(!document.hidden) Sync.run(); });
  addEventListener("hashchange",()=>{ const t=(location.hash.match(/invite=([A-Za-z0-9_-]{30,60})/)||[])[1]; if(t) Sync.joinSheet(t); });
  if(location.protocol==="https:" && "serviceWorker" in navigator){ try{ navigator.serviceWorker.register("sw.js").catch(()=>{}); }catch(e){} }
})();
