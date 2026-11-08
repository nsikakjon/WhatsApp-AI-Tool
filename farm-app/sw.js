// Offline support: serve the app from cache when there's no signal on the farm.
const C="oko-v2";
const FILES=["./","index.html","css/app.css","js/geo.js","js/crops.js","js/survey.js","js/sync.js","js/app.js","manifest.json","icon.svg","icon-192.png"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(FILES)).catch(()=>{}));self.skipWaiting();});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))));self.clients.claim();});
self.addEventListener("fetch",e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=="GET") return;
  if(/open-meteo\.com$/.test(u.hostname)) return; // weather: always live; the app keeps its own copy
  if(u.origin===location.origin && u.pathname.includes("/api/") && !u.pathname.includes("/api/photos/")) return; // sync: always live
  e.respondWith(fetch(e.request).then(r=>{ if(r.ok&&(u.origin===location.origin||/cdnjs|fonts\.(googleapis|gstatic)|arcgisonline/.test(u.hostname))){const cp=r.clone();caches.open(C).then(c=>c.put(e.request,cp));} return r; })
    .catch(()=>caches.match(e.request,{ignoreSearch:true}).then(r=>r||(e.request.mode==="navigate"?caches.match("index.html"):undefined))));
});
