"use strict";
/* =====================================================================
   SATELLITE CROP HEALTH (Sentinel-2 NDVI), shown on a field's Overview.
   The server does the satellite work; the phone keeps the last answer so
   it still shows offline.
   ===================================================================== */
const Sat = (()=>{
  const busy={};
  const RAMP=[[-0.1,"#8c510a"],[0.15,"#d8b365"],[0.3,"#f6e8c3"],[0.45,"#c7e9b4"],[0.6,"#7fbc41"],[0.75,"#2c7a3c"],[0.9,"#0b4d22"]];
  const label=v=> v<0.2?"Bare soil or very thin cover" : v<0.4?"Thin or stressed" : v<0.6?"Moderate" : v<0.75?"Healthy" : "Dense, healthy canopy";
  const ink=v=> v<0.3?"#8c510a" : v<0.45?"#9a6a12" : v<0.6?"#4f8a2a" : "#2c7a3c";
  const color=v=>{ for(let i=RAMP.length-1;i>=0;i--) if(v>=RAMP[i][0]) return RAMP[i][1]; return RAMP[0][1]; };

  function card(p){
    const s=p.sat;
    if(p.demo && !s) p.sat=sample(p);
    const d=p.sat;
    if(!d && !(Sync.mode==="on" && p._synced)) return "";
    if(!d || d.loading) { load(p); return `<div class="card" id="satCard"><h2>Satellite crop health</h2><p class="muted small">Checking the latest satellite pictures…</p></div>`; }
    if(d.configured===false) return "";
    if(d.needsBoundary) return `<div class="card" id="satCard"><h2>Satellite crop health</h2><p class="muted small">Walk the field's boundary (or type the survey-plan beacons) in the Land tab to see how green your crop looks from space, every 5 days or so.</p><button class="btn sm" data-act="tab" data-tab="land">Go to Land</button></div>`;
    if(d.error && !d.series) return `<div class="card" id="satCard"><h2>Satellite crop health</h2><p class="muted small">${esc(d.error)}</p></div>`;
    if(!d.latest) return `<div class="card" id="satCard"><h2>Satellite crop health</h2><p class="muted small">No clear satellite view of this field in the last 12 months. Clouds cover much of southern Nigeria in the rains, so check back in the dry season.</p></div>`;
    const L=d.latest, prev=d.series.length>1? d.series[d.series.length-2] : null, delta=prev? L.mean-prev.mean : null;
    const days=Math.round((Date.now()-parseYmd(L.date))/DAY);
    return `<div class="card chart" id="satCard"><div class="row"><div class="grow"><b>Satellite crop health</b>${d.sample?' <span class="chip warn">Sample</span>':""}
        <div class="big-num">${L.mean.toFixed(2)} <span style="font-size:15px;color:${ink(L.mean)};font-weight:700">${esc(label(L.mean))}</span> ${delta!=null?`<span class="${delta>=0?"up":"down"}" style="font-size:15px">${delta>=0?"↑":"↓"} ${Math.abs(delta).toFixed(2)}</span>`:""}</div>
        <div class="tiny muted">Greenness (NDVI) on ${fmtDate(L.date,{day:"numeric",month:"short",year:"numeric"})} · ${days<=1?"latest":days+" days ago"} · ${Math.round(L.clear*100)}% of the field clear of cloud</div></div></div>
      <div class="sp12"></div>
      <div style="display:flex;gap:12px;align-items:center">
        <div style="flex:0 0 132px;height:132px;border-radius:16px;background:#eef2ea;overflow:hidden;display:flex;align-items:center;justify-content:center">${d.sample? sampleImage(p,L.mean) : d.imageUrl? `<img src="${esc(d.imageUrl)}" alt="NDVI map of the field" style="max-width:100%;max-height:100%;image-rendering:pixelated">`:""}</div>
        <div class="grow" style="flex:1;min-width:0">${trend(d.series)}</div></div>
      <div style="height:8px;border-radius:9px;margin-top:12px;background:linear-gradient(90deg,${RAMP.map(r=>r[1]).join(",")})"></div>
      <div class="row tiny muted" style="justify-content:space-between;margin-top:3px"><span>Bare</span><span>Thin</span><span>Healthy</span><span>Dense</span></div>
      <p class="tiny muted" style="margin:8px 0 0">From the Sentinel-2 satellites (about 10 m per pixel). Grey squares were hidden by cloud. Compare a field with itself over time: young cassava or a freshly pruned farm reads lower than a mature canopy.${d.stale?" Showing the last saved result; the satellite service didn't answer just now.":""}</p></div>`;
  }
  function trend(series){
    const pts=series.slice(-24); if(pts.length<2) return `<p class="tiny muted">The trend appears after two clear views.</p>`;
    const W=200,H=110, t0=parseYmd(pts[0].date).getTime(), t1=parseYmd(pts[pts.length-1].date).getTime()||t0+1;
    const x=d=>6+(parseYmd(d).getTime()-t0)/Math.max(1,t1-t0)*(W-12), y=v=>H-18-Math.max(0,Math.min(1,v))*(H-26);
    const path="M"+pts.map(p=>`${x(p.date).toFixed(1)},${y(p.mean).toFixed(1)}`).join("L");
    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%"><line x1="0" x2="${W}" y1="${y(0.6)}" y2="${y(0.6)}" stroke="#c8ec6f" stroke-dasharray="3 3"/><path d="${path}" fill="none" stroke="#24533a" stroke-width="2"/>${pts.map(p=>`<circle cx="${x(p.date).toFixed(1)}" cy="${y(p.mean).toFixed(1)}" r="3" fill="${color(p.mean)}" stroke="#fff"/>`).join("")}
      <text x="0" y="${H-2}" font-size="10" font-weight="600">${fmtDate(pts[0].date,{month:"short",year:"2-digit"})}</text><text x="${W}" y="${H-2}" font-size="10" font-weight="600" text-anchor="end">${fmtDate(pts[pts.length-1].date,{month:"short",year:"2-digit"})}</text></svg>`;
  }
  async function load(p){
    if(busy[p.id] || p.demo) return; busy[p.id]=true;
    try{
      const r=await fetch(`api/fields/${encodeURIComponent(p.id)}/satellite`,{credentials:"same-origin"});
      const j=await r.json().catch(()=>({}));
      if(r.ok||j.series){ p.sat={...j,at:Date.now()}; }
      else p.sat={error:j.error||"The satellite service didn't answer. Try again later.",at:Date.now()};
      saveLocal(p);
    }catch(e){ if(!p.sat) p.sat={error:"Satellite pictures load when you have signal.",at:Date.now()}; }
    finally{ busy[p.id]=false; const el=$("#satCard"); if(el && P && P.id===p.id && (route.tab||"overview")==="overview") el.outerHTML=card(p); }
  }
  /** Refreshes in the background when the saved answer is more than 12 hours old. */
  function maybeRefresh(p){ if(Sync.mode==="on" && p._synced && !p.demo && (!p.sat || Date.now()-(p.sat.at||0)>12*3600e3)) load(p); }

  /* ---------- demo farms: an invented example so the card can be seen ---------- */
  function sample(p){
    const rnd=seeded(p.id+"sat"); const base={cocoa:0.74,oilpalm:0.78,cassava:0.55,plantain:0.66,maize:0.5,yam:0.45}[p.crop?.id]||0.6;
    const series=[]; const t=new Date(); t.setHours(0,0,0,0);
    for(let d=360; d>=4; d-=5){ const date=new Date(t.getTime()-d*DAY), m=date.getMonth()+1;
      const cloudy=[6,7,9,10].includes(m)? rnd()<0.8 : [4,5,8].includes(m)? rnd()<0.55 : rnd()<0.2; if(cloudy) continue;
      const season=[11,12,1,2].includes(m)? -0.07 : 0.03; series.push({date:ymd(date),mean:Math.round((base+season+(rnd()-.5)*0.06)*1000)/1000,min:0,max:1,clear:Math.round((0.55+rnd()*0.45)*100)/100}); }
    return {sample:true,configured:true,series,latest:series[series.length-1],at:Date.now()};
  }
  function sampleImage(p,mean){
    const {pts}=fieldShape(p); const rnd=seeded(p.id+"px");
    const xs=pts.map(q=>q[0]), ys=pts.map(q=>q[1]); const minx=Math.min(...xs),maxx=Math.max(...xs),miny=Math.min(...ys),maxy=Math.max(...ys);
    const s=120/Math.max(maxx-minx,maxy-miny), T=q=>[6+(q[0]-minx)*s, 6+(maxy-q[1])*s];
    const d="M"+pts.map(q=>T(q).map(v=>v.toFixed(1)).join(",")).join("L")+"Z"; const n=Math.max(8,Math.min(26,Math.round((maxx-minx)/10)));
    let cells=""; const cw=120/n;
    for(let i=0;i<n;i++) for(let j=0;j<n;j++){ const v=mean+(rnd()-.5)*0.22-(rnd()<.05?0.25:0); cells+=`<rect x="${(6+i*cw).toFixed(1)}" y="${(6+j*cw).toFixed(1)}" width="${(cw+.3).toFixed(1)}" height="${(cw+.3).toFixed(1)}" fill="${color(v)}"/>`; }
    return `<svg viewBox="0 0 132 132" width="132" height="132"><defs><clipPath id="sc${p.id}"><path d="${d}"/></clipPath></defs><g clip-path="url(#sc${p.id})">${cells}</g><path d="${d}" fill="none" stroke="#163b27" stroke-width="1.2"/></svg>`;
  }
  return {card, maybeRefresh, label};
})();
