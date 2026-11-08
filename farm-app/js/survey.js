"use strict";
/* Land survey maths and exports. Works on the global P (the open field). */
const CHECKS = ["Grid power (PHCN/DisCo)","Public water","Borehole","Tarred road","Street drainage","Fence / wall","Existing building","Trees to keep","Overhead lines","Signs of flooding","Encroachment","Squatters / shanties"];
/* point model: {id,label,lat,lon,acc,n,src:'gps'|'ll'|'utmw'|'utmm', raw:{E,N,zone}, notes, photo, type} */
function projZone(){
  if(P.zone) return P.zone;
  const p = P.beacons[0]||P.features[0];
  return p ? zoneFor(p.lon) : 31;
}
function toXY(p){ return utmFwd(p.lat,p.lon,projZone(),ELL.WGS84); }

function compute(){
  const B = P.beacons.map(b=>({...b, ...toXY(b)}));
  const F = P.features.map(f=>({...f, ...toXY(f)}));
  let area=0, per=0; const legs=[];
  if(B.length>=2){
    for(let i=0;i<B.length;i++){
      const a=B[i], b=B[(i+1)%B.length];
      if(B.length===2 && i===1) break;
      const dE=b.E-a.E, dN=b.N-a.N, dist=Math.hypot(dE,dN);
      const brg=((Math.atan2(dE,dN)*R2D)+360)%360;
      legs.push({from:a,to:b,dist,brg});
      per+=dist;
    }
  }
  if(B.length>=3){ for(let i=0;i<B.length;i++){ const a=B[i], b=B[(i+1)%B.length]; area+=a.E*b.N-b.E*a.N; } }
  const signed=area/2; area=Math.abs(signed);
  // interior angles
  if(B.length>=3){
    const ccw = signed>0;
    B.forEach((b,i)=>{
      const p=B[(i-1+B.length)%B.length], n=B[(i+1)%B.length];
      const a1=Math.atan2(p.N-b.N,p.E-b.E), a2=Math.atan2(n.N-b.N,n.E-b.E);
      let ang=(ccw? a1-a2 : a2-a1)*R2D; ang=((ang%360)+360)%360; b.angle=ang;
    });
  }
  const accs = P.beacons.filter(b=>b.src==="gps"&&b.acc).map(b=>b.acc);
  const worstAcc = accs.length? Math.max(...accs):null;
  const setback = parseFloat(P.f.setback)||0;
  const inset = (B.length>=3 && setback>0) ? offsetPolygon(B.map(b=>[b.E,b.N]), setback, signed>0) : null;
  const insetArea = inset? Math.abs(inset.reduce((s,p,i)=>{const q=inset[(i+1)%inset.length]; return s+p[0]*q[1]-q[0]*p[1];},0)/2):null;
  return {B,F,area,per,legs,worstAcc,inset,insetArea,signed,zone:projZone()};
}
function offsetPolygon(pts,d,ccw){
  // inward offset by d (simple polygons; good for typical plots)
  const n=pts.length, lines=[];
  for(let i=0;i<n;i++){
    const a=pts[i], b=pts[(i+1)%n]; let dx=b[0]-a[0], dy=b[1]-a[1]; const L=Math.hypot(dx,dy)||1; dx/=L; dy/=L;
    const nx = ccw? -dy : dy, ny = ccw? dx : -dx;   // inward normal
    lines.push([[a[0]+nx*d,a[1]+ny*d],[dx,dy]]);
  }
  const out=[];
  for(let i=0;i<n;i++){
    const [p1,d1]=lines[(i-1+n)%n], [p2,d2]=lines[i];
    const den=d1[0]*d2[1]-d1[1]*d2[0];
    if(Math.abs(den)<1e-9){ out.push(p2); continue; }
    const t=((p2[0]-p1[0])*d2[1]-(p2[1]-p1[1])*d2[0])/den;
    out.push([p1[0]+d1[0]*t,p1[1]+d1[1]*t]);
  }
  return out;
}


const FEAT_SYM = {"Tree":"🌳","Electric pole":"⚡","Transformer":"⚡","Existing building":"▦","Gate / access":"⇥","Drain / culvert":"≈","Water / borehole":"💧","Septic / soakaway":"◎","Spot level":"+","Road edge":"═","Fence / wall corner":"┐"};
function planSVG(R, W=400, H=400, opts={}){
  const pts=[...R.B,...R.F]; if(!pts.length) return {svg:`<text x="${W/2}" y="${H/2}" text-anchor="middle" fill="#999" font-size="14">No points yet</text>`};
  let minE=Math.min(...pts.map(p=>p.E)), maxE=Math.max(...pts.map(p=>p.E)), minN=Math.min(...pts.map(p=>p.N)), maxN=Math.max(...pts.map(p=>p.N));
  const span=Math.max(maxE-minE,maxN-minN,10), pad=span*0.18;
  minE-=pad;maxE+=pad;minN-=pad;maxN+=pad;
  const s=Math.min(W/(maxE-minE),H/(maxN-minN));
  const ox=(W-(maxE-minE)*s)/2, oy=(H-(maxN-minN)*s)/2;
  const X=e=>ox+(e-minE)*s, Y=n=>H-oy-(n-minN)*s;
  const fs = opts.fs||11; let g="";
  // grid at 5/10/20 m
  const step=[1,2,5,10,20,50,100,200].find(v=>v*s>=40)||500;
  for(let e=Math.ceil(minE/step)*step;e<=maxE;e+=step) g+=`<line x1="${X(e)}" y1="0" x2="${X(e)}" y2="${H}" stroke="#ece8de" stroke-width="1"/>`;
  for(let n=Math.ceil(minN/step)*step;n<=maxN;n+=step) g+=`<line x1="0" y1="${Y(n)}" x2="${W}" y2="${Y(n)}" stroke="#ece8de" stroke-width="1"/>`;
  if(R.B.length>=2){
    const d=R.B.map((b,i)=>(i?"L":"M")+X(b.E).toFixed(1)+","+Y(b.N).toFixed(1)).join("")+(R.B.length>=3?"Z":"");
    g+=`<path d="${d}" fill="${R.B.length>=3?"rgba(47,90,70,.10)":"none"}" stroke="#163b27" stroke-width="2.2" stroke-linejoin="round"/>`;
  }
  if(R.inset) g+=`<path d="${R.inset.map((p,i)=>(i?"L":"M")+X(p[0]).toFixed(1)+","+Y(p[1]).toFixed(1)).join("")}Z" fill="none" stroke="#b8862b" stroke-width="1.4" stroke-dasharray="6 4"/>`;
  // leg labels
  const cE=R.B.reduce((s,b)=>s+b.E,0)/(R.B.length||1), cN=R.B.reduce((s,b)=>s+b.N,0)/(R.B.length||1);
  R.legs.forEach(l=>{
    const mx=(X(l.from.E)+X(l.to.E))/2, my=(Y(l.from.N)+Y(l.to.N))/2;
    let ang=Math.atan2(Y(l.to.N)-Y(l.from.N),X(l.to.E)-X(l.from.E))*R2D; if(ang>90)ang-=180; if(ang<-90)ang+=180;
    // push label outward from centroid
    let vx=mx-X(cE), vy=my-Y(cN); const vl=Math.hypot(vx,vy)||1; vx/=vl; vy/=vl;
    const lx=mx+vx*fs*1.3, ly=my+vy*fs*1.3;
    g+=`<g transform="translate(${lx.toFixed(1)},${ly.toFixed(1)}) rotate(${ang.toFixed(1)})"><text text-anchor="middle" font-size="${fs}" fill="#1d2421" y="-1">${f2(l.dist)} m</text><text text-anchor="middle" font-size="${fs*0.82}" fill="#6b736f" y="${fs*0.95}">${fmtDMS(l.brg)}</text></g>`;
  });
  R.B.forEach((b,i)=>{
    let vx=X(b.E)-X(cE), vy=Y(b.N)-Y(cN); const vl=Math.hypot(vx,vy)||1; vx/=vl; vy/=vl;
    g+=`<circle cx="${X(b.E)}" cy="${Y(b.N)}" r="4.5" fill="#fff" stroke="#163b27" stroke-width="2"/>`;
    g+=`<text x="${X(b.E)+vx*fs*1.2}" y="${Y(b.N)+vy*fs*1.2+fs*0.35}" text-anchor="middle" font-size="${fs}" font-weight="700" fill="#163b27">${esc(b.label||"B"+(i+1))}</text>`;
  });
  R.F.forEach(f=>{
    g+=`<circle cx="${X(f.E)}" cy="${Y(f.N)}" r="3.5" fill="#b8862b"/><text x="${X(f.E)+6}" y="${Y(f.N)-5}" font-size="${fs*0.85}" fill="#8a5a12">${esc(FEAT_SYM[f.type]||"•")} ${esc(f.label||f.type)}</text>`;
  });
  // north arrow
  g+=`<g transform="translate(${W-26},30)"><path d="M0,-18 L7,8 L0,3 L-7,8Z" fill="#1d2421"/><text y="22" text-anchor="middle" font-size="11" font-weight="700">N</text></g>`;
  // scale bar
  const sb=[1,2,5,10,20,50,100,200,500].reverse().find(v=>v*s<=W*0.3)||1;
  g+=`<g transform="translate(14,${H-16})"><rect width="${sb*s/2}" height="5" fill="#1d2421"/><rect x="${sb*s/2}" width="${sb*s/2}" height="5" fill="#fff" stroke="#1d2421"/><text y="-4" font-size="10">0</text><text x="${sb*s}" y="-4" font-size="10" text-anchor="middle">${sb} m</text></g>`;
  return {svg:g};
}

let dxfMode="local";
const slug = ()=> (P.f.name||"site").replace(/[^\w\-]+/g,"_").replace(/_+/g,"_").slice(0,40);
const srcName = s=>({gps:"Phone GPS",ll:"Lat/Lon typed",utmw:"UTM WGS84 typed",utmm:"Survey plan (Minna)"}[s]||s);

function buildDXF(){
  const R=compute(); if(!R.B.length && !R.F.length) throw new Error("No points to export");
  const o = R.B[0]||R.F[0];
  const T = dxfMode==="local" ? (p=>[p.E-o.E,p.N-o.N]) : (p=>[p.E,p.N]);
  const all=[...R.B,...R.F].map(T);
  const xs=all.map(p=>p[0]), ys=all.map(p=>p[1]);
  const span=Math.max(Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys),10);
  const h=Math.max(0.25,Math.round(span/70*100)/100);
  const L=[]; const add=(...a)=>{ for(let i=0;i<a.length;i+=2) L.push(String(a[i]),String(a[i+1])); };
  const n=v=>(+v).toFixed(4);
  const text=(layer,x,y,str,ht=h,rot=0,center=true)=>{ add(0,"TEXT",8,layer,10,n(x),20,n(y),30,0,40,n(ht),1,String(str).replace(/[\r\n]+/g," "),50,n(rot)); if(center) add(72,1,11,n(x),21,n(y),31,0); };
  const line=(layer,a,b)=>add(0,"LINE",8,layer,10,n(a[0]),20,n(a[1]),30,0,11,n(b[0]),21,n(b[1]),31,0);
  const poly=(layer,pts,closed)=>{ add(0,"POLYLINE",8,layer,66,1,70,closed?1:0,10,0,20,0,30,0); pts.forEach(p=>add(0,"VERTEX",8,layer,10,n(p[0]),20,n(p[1]),30,0)); add(0,"SEQEND",8,layer); };
  const layers=[["BOUNDARY",7],["BEACONS",1],["BEACON_TEXT",1],["DIMENSIONS",3],["SETBACK",30],["FEATURES",40],["FEATURE_TEXT",40],["NORTH",7],["INFO",8]];
  add(0,"SECTION",2,"HEADER",9,"$ACADVER",1,"AC1009",9,"$INSUNITS",70,6,9,"$MEASUREMENT",70,1,
      9,"$EXTMIN",10,n(Math.min(...xs)-span*.3),20,n(Math.min(...ys)-span*.3),30,0,9,"$EXTMAX",10,n(Math.max(...xs)+span*.3),20,n(Math.max(...ys)+span*.3),30,0,0,"ENDSEC");
  add(0,"SECTION",2,"TABLES",0,"TABLE",2,"LTYPE",70,2,
      0,"LTYPE",2,"CONTINUOUS",70,0,3,"Solid line",72,65,73,0,40,0.0,
      0,"LTYPE",2,"DASHED",70,0,3,"Dashed",72,65,73,2,40,n(h*3),49,n(h*2),49,n(-h),0,"ENDTAB");
  add(0,"TABLE",2,"LAYER",70,layers.length); layers.forEach(([nm,c])=>add(0,"LAYER",2,nm,70,0,62,c,6,nm==="SETBACK"?"DASHED":"CONTINUOUS")); add(0,"ENDTAB",0,"ENDSEC");
  add(0,"SECTION",2,"ENTITIES");
  const BP=R.B.map(T);
  if(BP.length>=2) poly("BOUNDARY",BP,BP.length>=3);
  if(R.inset){ const ip=R.inset.map(p=>dxfMode==="local"?[p[0]-o.E,p[1]-o.N]:p); add(0,"POLYLINE",8,"SETBACK",6,"DASHED",66,1,70,1,10,0,20,0,30,0); ip.forEach(p=>add(0,"VERTEX",8,"SETBACK",10,n(p[0]),20,n(p[1]),30,0)); add(0,"SEQEND",8,"SETBACK"); }
  const cx=BP.reduce((s,p)=>s+p[0],0)/(BP.length||1), cy=BP.reduce((s,p)=>s+p[1],0)/(BP.length||1);
  R.B.forEach((b,i)=>{ const p=BP[i]; add(0,"POINT",8,"BEACONS",10,n(p[0]),20,n(p[1]),30,0); add(0,"CIRCLE",8,"BEACONS",10,n(p[0]),20,n(p[1]),30,0,40,n(h*0.6));
    let vx=p[0]-cx, vy=p[1]-cy; const vl=Math.hypot(vx,vy)||1; vx/=vl; vy/=vl; text("BEACON_TEXT",p[0]+vx*h*2.2,p[1]+vy*h*2.2,b.label||"B"+(i+1),h*1.1); });
  R.legs.forEach(l=>{ const a=T(l.from), b=T(l.to); const mx=(a[0]+b[0])/2, my=(a[1]+b[1])/2;
    let rot=Math.atan2(b[1]-a[1],b[0]-a[0])*R2D; if(rot>90)rot-=180; if(rot<-90)rot+=180;
    let vx=mx-cx, vy=my-cy; const vl=Math.hypot(vx,vy)||1; vx/=vl; vy/=vl;
    text("DIMENSIONS",mx+vx*h*1.4,my+vy*h*1.4,`${l.dist.toFixed(2)}m`,h,rot);
    text("DIMENSIONS",mx+vx*h*2.9,my+vy*h*2.9,fmtDMS(l.brg).replace("′","'").replace("″",'"').replace("°","%%d"),h*0.8,rot); });
  R.F.forEach(f=>{ const p=T(f); add(0,"POINT",8,"FEATURES",10,n(p[0]),20,n(p[1]),30,0);
    if(f.type==="Tree") add(0,"CIRCLE",8,"FEATURES",10,n(p[0]),20,n(p[1]),30,0,40,n(Math.max(1.5,h*3)));
    else add(0,"CIRCLE",8,"FEATURES",10,n(p[0]),20,n(p[1]),30,0,40,n(h*0.4));
    text("FEATURE_TEXT",p[0]+h,p[1]+h*0.6,`${f.label||f.type}${f.label&&f.label!==f.type?" ("+f.type+")":""}`,h*0.8,0,false); });
  // north arrow
  const nx=Math.max(...xs)+span*0.15, ny=Math.max(...ys);
  poly("NORTH",[[nx,ny],[nx-h*1.2,ny-h*4],[nx,ny-h*3],[nx+h*1.2,ny-h*4]],true); line("NORTH",[nx,ny-h*3],[nx,ny-h*7]); text("NORTH",nx,ny+h*1.5,"N",h*1.6);
  // info block
  const ix=Math.min(...xs), iy=Math.min(...ys)-span*0.12; const ll=[];
  ll.push(`SITE: ${P.f.name||""}`.toUpperCase());
  if(P.f.client) ll.push(`CLIENT: ${P.f.client}`);
  ll.push(`LOCATION: ${[P.f.area,P.f.lga,P.f.state].filter(Boolean).join(", ")}`);
  if(R.B.length>=3) ll.push(`AREA: ${R.area.toFixed(1)} sq.m (${(R.area/10000).toFixed(4)} ha)   PERIMETER: ${R.per.toFixed(2)} m`);
  ll.push(`COORDINATES: UTM ZONE ${R.zone}N, WGS84, metres. ${dxfMode==="local"?`LOCAL ORIGIN (0,0) = ${o.label||"B1"} AT E ${o.E.toFixed(2)} N ${o.N.toFixed(2)}`:"TRUE UTM COORDINATES"}`);
  ll.push(`SOURCE: ${[...new Set(P.beacons.map(b=>srcName(b.src)))].join(", ")}${R.worstAcc!=null?`  (GPS accuracy approx +/-${R.worstAcc.toFixed(1)} m)`:""}`);
  if(P.f.planNo) ll.push(`SURVEY PLAN: ${P.f.planNo}${P.f.surveyor?" - "+P.f.surveyor:""}`);
  ll.push(`CAPTURED: ${P.f.date||""}${P.f.by?" by "+P.f.by:""}. PRELIMINARY - NOT A REGISTERED SURVEY.`);
  ll.forEach((s,i)=>text("INFO",ix,iy-i*h*1.7,s,h*0.85,0,false));
  add(0,"ENDSEC",0,"EOF");
  return L.join("\r\n")+"\r\n";
}

function buildCSV(){
  const R=compute(), o=R.B[0]||R.F[0];
  const rows=[["kind","label","type","lat_wgs84","lon_wgs84",`utm${R.zone}n_E`,`utm${R.zone}n_N`,"minna_utm_E","minna_utm_N","local_x","local_y","source","gps_accuracy_m","notes"]];
  [...R.B.map(b=>["beacon",b]),...R.F.map(f=>["feature",f])].forEach(([k,p])=>{
    const m=wgsToMinna(p.lat,p.lon), mu=utmFwd(m.lat,m.lon,R.zone,ELL.CLARKE);
    rows.push([k,p.label||"",p.type||"",p.lat.toFixed(8),p.lon.toFixed(8),p.E.toFixed(3),p.N.toFixed(3),mu.E.toFixed(3),mu.N.toFixed(3),(p.E-o.E).toFixed(3),(p.N-o.N).toFixed(3),srcName(p.src),p.acc?p.acc.toFixed(1):"",p.notes||""]);
  });
  return rows.map(r=>r.map(v=>/[",\n]/.test(v)?`"${String(v).replace(/"/g,'""')}"`:v).join(",")).join("\r\n");
}
function buildKML(){
  const R=compute(); const c=p=>`${p.lon.toFixed(8)},${p.lat.toFixed(8)},0`;
  let k=`<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${esc(P.f.name||"Site")}</name>
<Style id="b"><LineStyle><color>ff2e3a1f</color><width>3</width></LineStyle><PolyStyle><color>4046b42f</color></PolyStyle></Style>`;
  if(R.B.length>=3) k+=`<Placemark><name>Boundary</name><description>${R.area.toFixed(1)} m²</description><styleUrl>#b</styleUrl><Polygon><outerBoundaryIs><LinearRing><coordinates>${[...R.B,R.B[0]].map(c).join(" ")}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`;
  const _ap=(typeof accessPoint==="function")?accessPoint(P):null; if(_ap) k+=`<Placemark><name>${esc("Drive here: "+(P.f.name||"Site"))}</name><description>${esc(_ap.label)}</description><Point><coordinates>${_ap.lon.toFixed(8)},${_ap.lat.toFixed(8)},0</coordinates></Point></Placemark>`;
  [...R.B,...R.F].forEach(p=>k+=`<Placemark><name>${esc(p.label||p.type)}</name><description>${esc((p.type?p.type+". ":"")+(p.notes||""))}</description><Point><coordinates>${c(p)}</coordinates></Point></Placemark>`);
  return k+"</Document></kml>";
}
function buildGeoJSON(){
  const R=compute(), feats=[];
  if(R.B.length>=3) feats.push({type:"Feature",properties:{name:"Boundary",area_m2:+R.area.toFixed(2),perimeter_m:+R.per.toFixed(2)},geometry:{type:"Polygon",coordinates:[[...R.B,R.B[0]].map(p=>[+p.lon.toFixed(8),+p.lat.toFixed(8)])]}});
  [...R.B.map(b=>["beacon",b]),...R.F.map(f=>["feature",f])].forEach(([k,p])=>feats.push({type:"Feature",properties:{kind:k,label:p.label,type:p.type||null,source:srcName(p.src),gps_accuracy_m:p.acc||null,notes:p.notes||""},geometry:{type:"Point",coordinates:[+p.lon.toFixed(8),+p.lat.toFixed(8)]}}));
  return JSON.stringify({type:"FeatureCollection",name:P.f.name||"site",features:feats},null,1);
}
function buildReport(standalone=true){
  const R=compute(), plotSize=parseFloat(P.f.plotSize)||648;
  const sv=planSVG(R,600,600,{fs:13}).svg;
  const info=[["Client",P.f.client],["Location",[P.f.address,P.f.area,P.f.lga,P.f.state].filter(Boolean).join(", ")],["Survey date",P.f.date],["Captured by",P.f.by],["Title document",P.f.title],["Survey plan",[P.f.planNo,P.f.surveyor].filter(Boolean).join(" – ")],["Terrain",P.f.terrain],["Soil (visual)",P.f.soil]].filter(r=>r[1]);
  const _ap=(typeof accessPoint==="function")?accessPoint(P):null;
  if(P.crop&&typeof CROPS!=="undefined"&&CROPS[P.crop.id]){ const _c=CROPS[P.crop.id]; info.unshift(["Crop",[_c.name,P.crop.variety,P.crop.planted?"planted "+P.crop.planted:""].filter(Boolean).join(" · ")]); }
  const pinRow=_ap?`<tr><th>Drive-to pin</th><td>${esc(_ap.label)}: ${_ap.lat.toFixed(6)}, ${_ap.lon.toFixed(6)} · <a href="https://www.google.com/maps/dir/?api=1&destination=${_ap.lat.toFixed(6)},${_ap.lon.toFixed(6)}">Directions in Google Maps</a> · <a href="https://earth.google.com/web/search/${_ap.lat.toFixed(6)},${_ap.lon.toFixed(6)}">Google Earth</a></td></tr>`:"";
  const present=CHECKS.filter(c=>P.checks[c]);
  const body=`
<div class="r">
<h1>${esc(P.f.name||"Site record")}</h1>
<p class="sub">Preliminary site record for design. Generated ${new Date().toLocaleString("en-NG")}</p>
<table class="kv">${info.map(([k,v])=>`<tr><th>${k}</th><td>${esc(v)}</td></tr>`).join("")}${pinRow}</table>
${R.B.length>=3?`<div class="kpis"><div><b>${f0(R.area)} m²</b>Area</div><div><b>${(R.area/10000).toFixed(4)} ha</b>${(R.area/4046.856).toFixed(3)} acres</div><div><b>${(R.area/plotSize).toFixed(2)}</b>× ${f0(plotSize)} m² plots</div><div><b>${f2(R.per)} m</b>Perimeter</div>${R.inset?`<div><b>${f0(R.insetArea)} m²</b>Inside ${esc(P.f.setback)} m setback</div>`:""}</div>`:""}
<h2>Site plan</h2>
<svg viewBox="0 0 600 600" class="plan">${sv}</svg>
<p class="small">Grid bearings and distances on UTM Zone ${R.zone}N (WGS84). The dashed line is an indicative uniform setback, not a planning approval.</p>
${R.legs.length?`<h2>Boundary schedule</h2><table><tr><th>Leg</th><th class="num">Bearing</th><th class="num">Distance (m)</th></tr>${R.legs.map(l=>`<tr><td>${esc(l.from.label)} → ${esc(l.to.label)}</td><td class="num">${fmtDMS(l.brg)}</td><td class="num">${f2(l.dist)}</td></tr>`).join("")}</table>`:""}
<h2>Beacon coordinates</h2>
<table><tr><th>Beacon</th><th class="num">Easting</th><th class="num">Northing</th><th class="num">Lat</th><th class="num">Lon</th><th>Source</th>${R.B.length>=3?'<th class="num">Angle</th>':""}</tr>
${R.B.map(b=>`<tr><td>${esc(b.label)}</td><td class="num">${b.E.toFixed(2)}</td><td class="num">${b.N.toFixed(2)}</td><td class="num">${b.lat.toFixed(6)}</td><td class="num">${b.lon.toFixed(6)}</td><td>${srcName(b.src)}${b.acc?` ±${b.acc.toFixed(1)} m`:""}</td>${R.B.length>=3?`<td class="num">${fmtDMS(b.angle)}</td>`:""}</tr>`).join("")}</table>
${R.F.length?`<h2>Site features</h2><table><tr><th>Feature</th><th>Type</th><th class="num">Easting</th><th class="num">Northing</th><th>Notes</th></tr>${R.F.map(f=>`<tr><td>${esc(f.label)}</td><td>${esc(f.type)}</td><td class="num">${f.E.toFixed(2)}</td><td class="num">${f.N.toFixed(2)}</td><td>${esc(f.notes)}</td></tr>`).join("")}</table>`:""}
<h2>Site conditions</h2>
${present.length?`<p><b>Present:</b> ${present.map(esc).join(" · ")}</p>`:""}
${[["Access & frontage",P.f.access],["Flooding / drainage",P.f.flood],["Neighbours & surroundings",P.f.neighbours],["Notes",P.f.notes]].filter(r=>r[1]).map(([k,v])=>`<p><b>${k}:</b> ${esc(v)}</p>`).join("")}
${[...R.B,...R.F].some(p=>p.photo)?`<h2>Photos</h2><div class="photos">${[...R.B,...R.F].filter(p=>p.photo).map(p=>`<figure><img src="${new URL(photoSrc(p.photo),location.href).href}"><figcaption>${esc(p.label||p.type)}${p.notes?" – "+esc(p.notes):""}</figcaption></figure>`).join("")}</div>`:""}
<p class="disc">Preliminary record captured with Oko by yarnOga${R.worstAcc!=null?`; phone-GPS positions are accurate to roughly ±${R.worstAcc.toFixed(1)} m or worse`:""}. This is not a registered survey. For title, C of O, building-plan approval or setting out, use a survey plan signed by a SURCON-registered surveyor.</p>
</div>`;
  const css=`.r{font:13px/1.45 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1d2421;max-width:820px;margin:0 auto}
.r h1{font-size:22px;margin:0}.r h2{font-size:15px;margin:22px 0 8px;border-bottom:2px solid #163b27;padding-bottom:4px}.r .sub{color:#6b736f;margin:2px 0 12px}
.r table{width:100%;border-collapse:collapse;font-size:12px}.r th,.r td{text-align:left;padding:5px;border-bottom:1px solid #e3dfd5;vertical-align:top}.r th{color:#6b736f}
.r .num{text-align:right;font-variant-numeric:tabular-nums}.r .kv th{width:140px}
.r .kpis{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.r .kpis div{flex:1;min-width:110px;background:#f4f2ec;border-radius:8px;padding:8px;font-size:11px;color:#6b736f}.r .kpis b{display:block;font-size:17px;color:#1d2421}
.r .plan{width:100%;max-width:600px;border:1px solid #e3dfd5;background:#fbfaf6;display:block;margin:0 auto}.r .small{font-size:11px;color:#6b736f}
.r .photos{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px}.r figure{margin:0}.r figure img{width:100%;border-radius:6px}.r figcaption{font-size:11px;color:#6b736f}
.r .disc{margin-top:22px;font-size:11px;color:#6b736f;border-top:1px solid #e3dfd5;padding-top:8px}
@media print{.r h2{break-after:avoid}.r table,.r figure,.r .plan{break-inside:avoid}}`;
  if(!standalone) return {css,body};
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(P.f.name||"Site report")}</title><style>body{margin:20px}${css}</style></head><body>${body}</body></html>`;
}

