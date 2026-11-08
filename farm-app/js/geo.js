"use strict";
/* Geodesy + formatting (shared) */
const D2R = Math.PI/180, R2D = 180/Math.PI;
const ELL = {
  WGS84:  {a:6378137,     f:1/298.257223563},
  CLARKE: {a:6378249.145, f:1/293.465}      // Clarke 1880 (RGS) – Minna datum
};
// Minna -> WGS84 3-parameter shift used for Nigeria (EPSG:26331/26332 towgs84)
const MINNA_SHIFT = [-92, -93, 122];

function utmFwd(lat, lon, zone, ell){
  const {a,f} = ell, k0 = 0.9996, e2 = f*(2-f), ep2 = e2/(1-e2);
  const phi = lat*D2R, lam = lon*D2R, lam0 = ((zone-1)*6-180+3)*D2R;
  const s = Math.sin(phi), c = Math.cos(phi), t = Math.tan(phi);
  const N = a/Math.sqrt(1-e2*s*s), T = t*t, C = ep2*c*c, A = (lam-lam0)*c;
  const e4=e2*e2, e6=e4*e2;
  const M = a*((1-e2/4-3*e4/64-5*e6/256)*phi - (3*e2/8+3*e4/32+45*e6/1024)*Math.sin(2*phi)
            + (15*e4/256+45*e6/1024)*Math.sin(4*phi) - (35*e6/3072)*Math.sin(6*phi));
  const E = k0*N*(A+(1-T+C)*A**3/6+(5-18*T+T*T+72*C-58*ep2)*A**5/120)+500000;
  const Nn = k0*(M+N*t*(A*A/2+(5-T+9*C+4*C*C)*A**4/24+(61-58*T+T*T+600*C-330*ep2)*A**6/720));
  return {E, N:Nn};
}
function utmInv(E, Nn, zone, ell){
  const {a,f} = ell, k0 = 0.9996, e2 = f*(2-f), ep2 = e2/(1-e2);
  const e1 = (1-Math.sqrt(1-e2))/(1+Math.sqrt(1-e2));
  const x = E-500000, M = Nn/k0, e4=e2*e2, e6=e4*e2;
  const mu = M/(a*(1-e2/4-3*e4/64-5*e6/256));
  const p1 = mu+(3*e1/2-27*e1**3/32)*Math.sin(2*mu)+(21*e1*e1/16-55*e1**4/32)*Math.sin(4*mu)
           +(151*e1**3/96)*Math.sin(6*mu)+(1097*e1**4/512)*Math.sin(8*mu);
  const s=Math.sin(p1), c=Math.cos(p1), t=Math.tan(p1);
  const C1=ep2*c*c, T1=t*t, N1=a/Math.sqrt(1-e2*s*s), R1=a*(1-e2)/Math.pow(1-e2*s*s,1.5), D=x/(N1*k0);
  const phi = p1-(N1*t/R1)*(D*D/2-(5+3*T1+10*C1-4*C1*C1-9*ep2)*D**4/24+(61+90*T1+298*C1+45*T1*T1-252*ep2-3*C1*C1)*D**6/720);
  const lam0 = ((zone-1)*6-180+3)*D2R;
  const lam = lam0+(D-(1+2*T1+C1)*D**3/6+(5-2*C1+28*T1-3*C1*C1+8*ep2+24*T1*T1)*D**5/120)/c;
  return {lat:phi*R2D, lon:lam*R2D};
}
function geo2ecef(lat,lon,h,ell){
  const {a,f}=ell, e2=f*(2-f), p=lat*D2R, l=lon*D2R, N=a/Math.sqrt(1-e2*Math.sin(p)**2);
  return [(N+h)*Math.cos(p)*Math.cos(l),(N+h)*Math.cos(p)*Math.sin(l),(N*(1-e2)+h)*Math.sin(p)];
}
function ecef2geo(X,Y,Z,ell){
  const {a,f}=ell, e2=f*(2-f), lon=Math.atan2(Y,X), p=Math.hypot(X,Y);
  let lat=Math.atan2(Z,p*(1-e2)), h=0;
  for(let i=0;i<8;i++){ const N=a/Math.sqrt(1-e2*Math.sin(lat)**2); h=p/Math.cos(lat)-N; lat=Math.atan2(Z,p*(1-e2*N/(N+h))); }
  return {lat:lat*R2D, lon:lon*R2D, h};
}
function minnaToWgs(lat,lon){ const [X,Y,Z]=geo2ecef(lat,lon,0,ELL.CLARKE); return ecef2geo(X+MINNA_SHIFT[0],Y+MINNA_SHIFT[1],Z+MINNA_SHIFT[2],ELL.WGS84); }
function wgsToMinna(lat,lon){ const [X,Y,Z]=geo2ecef(lat,lon,0,ELL.WGS84); return ecef2geo(X-MINNA_SHIFT[0],Y-MINNA_SHIFT[1],Z-MINNA_SHIFT[2],ELL.CLARKE); }
function zoneFor(lon){ return Math.max(1,Math.min(60,Math.floor((lon+180)/6)+1)); }

function fmtDMS(deg){
  deg = ((deg%360)+360)%360;
  let d=Math.floor(deg), mf=(deg-d)*60, m=Math.floor(mf), s=Math.round((mf-m)*60);
  if(s===60){s=0;m++} if(m===60){m=0;d++} if(d===360)d=0;
  return `${String(d).padStart(3,"0")}°${String(m).padStart(2,"0")}′${String(s).padStart(2,"0")}″`;
}
const f2 = n => (Math.round(n*100)/100).toLocaleString("en-NG",{minimumFractionDigits:2,maximumFractionDigits:2});
const f0 = n => Math.round(n).toLocaleString("en-NG");
const esc = s => String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

