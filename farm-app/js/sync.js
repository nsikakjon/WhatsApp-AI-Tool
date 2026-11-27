"use strict";
/* =====================================================================
   SYNC: keeps this phone's fields in step with yarnOga's server.
   The phone is always the working copy (it must work offline on a farm);
   changes are pushed when there's signal and other people's changes pulled.
   ===================================================================== */
const Sync = (()=>{
  const API = "api/";
  let me = null;            // {id,name,role} when logged in
  let mode = "local";       // local: no server (preview / not switched on) · gate: needs an invite · on: syncing
  let status = "idle";      // idle | busy | offline | error
  let lastAt = null, pushT = null, running = false, again = false;
  const ls = { get(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }, set(k,v){ try{ v==null?localStorage.removeItem(k):localStorage.setItem(k,v); }catch(e){} } };

  async function call(path, opt={}){
    const init={method:opt.method||"GET", headers:{}, credentials:"same-origin"};
    if(init.method!=="GET") init.headers["x-oko"]="1";
    if(opt.json!==undefined){ init.headers["content-type"]="application/json"; init.body=JSON.stringify(opt.json); }
    if(opt.body){ init.body=opt.body; init.headers["content-type"]=opt.type; }
    const r=await fetch(API+path, init);
    let j=null; try{ j=await r.json(); }catch(e){}
    return {ok:r.ok, status:r.status, j: j||{}};
  }

  /* ---------- start-up ---------- */
  async function init(){
    const cached=ls.get("oko_me"); if(cached) try{ me=JSON.parse(cached); }catch(e){}
    lastAt=ls.get("oko_last")||null;
    let r=null; try{ r=await call("me"); }catch(e){ r=null; }
    if(r && r.ok){ me=r.j.user; ls.set("oko_me",JSON.stringify(me)); mode="on"; }
    else if(r && r.status===401 && r.j.error==="login"){ me=null; ls.set("oko_me",null); mode = settings.localOnly? "local" : "gate"; }
    else if(me){ mode="on"; status="offline"; }        // no signal, but logged in before
    else mode="local";                                   // preview, or the server isn't set up
    const inv=(location.hash.match(/invite=([A-Za-z0-9_-]{30,60})/)||[])[1];
    if(inv && r) await joinSheet(inv);
  }

  /* ---------- invites ---------- */
  async function joinSheet(token){
    let peek; try{ peek=(await call("invites/peek?token="+encodeURIComponent(token))).j; }catch(e){ peek=null; }
    clearHash();
    if(!peek || !peek.valid){ sheet(`<h2>This invite link has expired</h2><p class="muted">Invite links work once and expire after a week or two. Ask ${peek&&peek.from?esc(peek.from):"the person who sent it"} for a new one.</p><button class="btn block" data-close>OK</button>`); return; }
    const what = peek.kind==="field" ? `<b>${esc(peek.from||"Someone")}</b> invited you to help on <b>${esc(peek.fieldName||"a farm")}</b>.` : `<b>${esc(peek.from||"Jay")}</b> invited you to try ${APP_NAME}, a farm and land app for southern Nigeria.`;
    sheet(`<div style="width:56px;height:56px;color:var(--forest2);margin:4px 0 8px">${cropIc("cocoa")}</div>
      <h2>Welcome to ${APP_NAME}</h2><p>${what}</p>
      ${me?`<p class="muted small">You're logged in as <b>${esc(me.name)}</b>.</p>`:`<label class="f">Your name</label><input id="joinName" value="${esc(peek.nameHint||"")}" placeholder="e.g. Tunde Bakare" autocomplete="name">`}
      <p class="tiny muted">${APP_NAME} is in a trial run by yarnOga. Your fields sync to yarnOga's server so they're safe if you change phones, and Jay (who runs the trial) can see farms in the trial to help improve the app.</p>
      <button class="btn block" id="joinGo">${peek.kind==="field"?"Join this farm":"Start"}</button>`);
    $("#joinGo").onclick=async()=>{
      const name=$("#joinName")?.value.trim(); if(!me && !name) return toast("Type your name");
      $("#joinGo").disabled=true;
      try{
        const r=await call("invites/accept",{method:"POST",json:{token,name}});
        if(!r.ok){ toast(r.j.error||"That didn't work. Try again."); $("#joinGo").disabled=false; return; }
        me=r.j.user; ls.set("oko_me",JSON.stringify(me)); mode="on"; settings.localOnly=false; saveSettings();
        closeSheet(); toast(`Welcome, ${me.name}`); await run(); render();
        if(r.j.fieldId && fieldById(r.j.fieldId)) go({name:"field",id:r.j.fieldId});
      }catch(e){ toast("No connection. Try again when you have signal."); $("#joinGo").disabled=false; }
    };
  }
  function clearHash(){ try{ history.replaceState(history.state,"",location.pathname+location.search); }catch(e){} }

  /* ---------- photos ---------- */
  function dataUrlBlob(u){ const [h,b]=u.split(","); const type=(h.match(/data:([^;]+)/)||[])[1]||"image/jpeg"; const bin=atob(b); const a=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) a[i]=bin.charCodeAt(i); return {blob:new Blob([a],{type}),type}; }
  async function uploadPhotos(p){
    const holders=[...p.scouts,...p.beacons,...p.features];
    for(const h of holders){
      if(typeof h.photo==="string" && h.photo.startsWith("data:image/")){
        const {blob,type}=dataUrlBlob(h.photo);
        const r=await call("photos?field="+encodeURIComponent(p.id),{method:"POST",body:blob,type});
        if(!r.ok) throw new Error(r.j.error||"photo upload failed");
        h.photo="ph:"+r.j.id;
      }
    }
  }

  /* ---------- push / pull ---------- */
  const strip=p=>{ const d={...p}; ["wx","sat","demo","_dirty","_rev","_ver","_synced","_owner","_ownerName","_role","updated","created"].forEach(k=>delete d[k]); return d; };
  function adopt(local, row){
    const keep={wx:local?.wx, sat:local?.sat};
    const p=normalize({...row.data, id:row.id});
    if(keep.wx) p.wx=keep.wx; if(keep.sat) p.sat=keep.sat;
    p._synced=true; p._ver=row.version; p._owner=row.ownerId; p._ownerName=row.ownerName; p._role=row.access; p._dirty=false; p._rev=local?._rev||0;
    p.updated=Date.parse(row.updatedAt)||Date.now(); p.created=local?.created||p.updated;
    return p;
  }
  function replaceLocal(p){
    const i=fields.findIndex(f=>f.id===p.id); if(i<0) fields.push(p); else fields[i]=p;
    if(P && P.id===p.id) P=p;
    Store.put(p);
  }
  async function push(){
    for(const p of fields.filter(f=>f._dirty && !f.demo)){
      const rev=p._rev||0;
      await uploadPhotos(p);
      const r=await call("fields/"+encodeURIComponent(p.id),{method:"PUT",json:{data:strip(p)}});
      if(r.status===410){ removeLocal(p.id); continue; }
      if(r.status===403){ p._dirty=false; toast(`You no longer have access to “${p.f.name}”.`); removeLocal(p.id); continue; }
      if(!r.ok) throw new Error(r.j.message||r.j.error||"save failed");
      const fresh=adopt(p,r.j.field);
      if((p._rev||0)!==rev){ fresh._dirty=true; fresh._rev=p._rev; mergeLocal(fresh,p); }   // changed again while saving
      replaceLocal(fresh);
    }
    const dels=pendingDeletes();
    for(const id of dels){ const r=await call("fields/"+encodeURIComponent(id),{method:"DELETE"}); if(r.ok||r.status===403) setPendingDeletes(pendingDeletes().filter(x=>x!==id)); }
  }
  function mergeLocal(into, newer){ // keep edits made on this phone during the save
    ["f","checks","taskState"].forEach(k=>into[k]={...into[k],...newer[k]});
    ["beacons","features","scouts","records","tasks"].forEach(k=>{ const seen=new Set(); into[k]=[...newer[k],...into[k]].filter(x=>!seen.has(x.id)&&seen.add(x.id)&&!(newer.deleted||[]).includes(x.id)); });
    ["name","kind","crop","loc","code"].forEach(k=>{ if(newer[k]!==undefined) into[k]=newer[k]; });
    into.deleted=[...new Set([...(into.deleted||[]),...(newer.deleted||[])])];
  }
  async function pull(){
    const since = lastAt ? new Date(Date.parse(lastAt)-120000).toISOString() : "";
    const r=await call("sync"+(since?"?since="+encodeURIComponent(since):""));
    if(r.status===401){ me=null; ls.set("oko_me",null); mode="gate"; render(); return; }
    if(!r.ok) throw new Error(r.j.error||"sync failed");
    for(const row of r.j.fields){
      const local=fieldById(row.id);
      if(row.deleted){ if(local) removeLocal(row.id); continue; }
      if(local && local._dirty) continue;              // our next push combines them
      if(local && local._ver===row.version) { if(local._role!==row.access||local._ownerName!==row.ownerName){ local._role=row.access; local._ownerName=row.ownerName; Store.put(local);} continue; }
      replaceLocal(adopt(local,row));
    }
    const access=new Set(r.j.access);
    for(const f of fields.filter(f=>f._synced && !f._dirty && !access.has(f.id))) removeLocal(f.id);
    lastAt=r.j.now; ls.set("oko_last",lastAt);
  }
  function removeLocal(id){ fields=fields.filter(f=>f.id!==id); Store.del(id); if(P&&P.id===id){ P=null; if(route.name==="field") route={name:"home"}; } }
  const pendingDeletes=()=>{ try{ return JSON.parse(ls.get("oko_dels")||"[]"); }catch(e){ return []; } };
  const setPendingDeletes=a=>ls.set("oko_dels",JSON.stringify(a));

  async function run(){
    if(mode!=="on") return;
    if(running){ again=true; return; }
    running=true; status="busy"; paintStatus();
    try{ await push(); await pull(); status="idle"; }
    catch(e){ status = navigator.onLine===false || e instanceof TypeError ? "offline" : "error"; console.warn("sync:",e); }
    finally{ running=false; paintStatus(); if(again){ again=false; setTimeout(run,300); } else softRender(); }
  }
  let lastPaint=0;
  function softRender(){ if(Date.now()-lastPaint<400) return; lastPaint=Date.now(); if($("#mSheet.on,#mPoint.on,#mGps.on")) return; const y=scrollY; render(); scrollTo(0,y); }
  function schedule(){ if(mode!=="on") return; clearTimeout(pushT); pushT=setTimeout(run,1500); }
  function paintStatus(){ const el=$("#syncChip"); if(el) el.outerHTML=chip(); }
  function chip(){
    if(mode!=="on") return "";
    const n=fields.filter(f=>f._dirty&&!f.demo).length;
    const [cls,t]= status==="busy"?["","Syncing…"] : status==="offline"?["warn",n?`Offline · ${n} to sync`:"Offline"] : status==="error"?["bad","Sync problem"] : n?["warn",`${n} to sync`]:["","Synced"];
    return `<button id="syncChip" class="chip ${cls}" data-act="syncnow" style="border:0">${t}</button>`;
  }

  /* ---------- sharing ---------- */
  async function helpersBlock(p){
    if(mode!=="on" || p.demo) return "";
    const own = !p._synced || p._role==="owner" || p._role==="admin";
    return `<div class="card flat" style="margin-top:14px"><b>People on this farm</b><div id="helpers" class="small muted" style="margin:6px 0 10px">${p._synced?"Loading…":"Syncs first, then you can invite helpers."}</div>
      ${own?`<button class="btn sec block" data-act="invitehelper">${ic("share")} Invite a helper</button>`:`<button class="btn danger block" data-act="leavefield">Leave this farm</button>`}</div>`;
  }
  async function loadHelpers(p){
    const el=$("#helpers"); if(!el||!p._synced) return;
    try{ const r=await call(`fields/${p.id}/members`); if(!r.ok) throw 0;
      const own = p._role==="owner"||p._role==="admin";
      el.innerHTML=`<div class="li" style="padding:6px 0"><div class="bul dark">${ic("user")}</div><div class="b"><div class="t">${esc(r.j.owner?.name||"?")}</div><div class="s">Owner</div></div></div>`+
        r.j.members.map(m=>`<div class="li" style="padding:6px 0"><div class="bul">${ic("user")}</div><div class="b"><div class="t">${esc(m.name)}</div><div class="s">Helper</div></div>${own?`<button class="btn soft sm" data-act="rmhelper" data-id="${m.userId}">Remove</button>`:""}</div>`).join("");
    }catch(e){ el.textContent="Couldn't load: no connection."; }
  }
  async function makeInvite(body, title){
    try{ if(body.kind==="field"){ await run(); }
      const r=await call("invites",{method:"POST",json:body}); if(!r.ok) return toast(r.j.error||"Couldn't make a link");
      const msg = body.kind==="field" ? `Join me on ${APP_NAME} to help with “${P.f.name}”. Open this link on your phone:\n${r.j.url}` : `Hi${body.nameHint?" "+body.nameHint:""}, here's your invite to try ${APP_NAME}, a farm and land app. Open this link on your phone:\n${r.j.url}`;
      sheet(`<div class="head"><h2>${esc(title)}</h2><button class="ibtn" data-close>✕</button></div>
        <p class="muted small">Works once, for ${r.j.expiresInDays} days. Send it by WhatsApp to the person's phone.</p><pre class="copy" style="font-size:13px">${esc(msg)}</pre>
        <div class="col"><a class="btn block" style="background:#1f8f4e" href="https://wa.me/?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">${ic("wa")} Send on WhatsApp</a>
        <button class="btn sec block" id="cpInv">Copy</button></div>`);
      $("#cpInv").onclick=async()=>{ try{ await navigator.clipboard.writeText(msg); toast("Copied"); }catch(e){ toast("Copy blocked: select the text"); } };
    }catch(e){ toast("No connection. Try again when you have signal."); }
  }

  /* ---------- admin + account ---------- */
  function settingsCards(){
    if(mode==="local") return "";
    if(mode==="gate") return `<div class="card"><b>Not logged in</b><p class="muted small">Open the invite link you were sent to sync your fields.</p></div>`;
    return `<div class="card"><div class="row"><div class="grow"><b>${esc(me.name)}</b><div class="muted small">${me.role==="admin"?"Admin · sees every farm in the trial":"Tester"}${lastAt?" · last synced "+new Date(lastAt).toLocaleString("en-GB",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}):""}</div></div>${chip()}</div>
      <div class="grid2" style="margin-top:10px"><button class="btn soft sm" data-act="syncnow">Sync now</button><button class="btn soft sm" data-act="logout">Log out</button></div></div>
      ${me.role==="admin"?`<div class="card"><h2>Trial testers</h2><div class="row"><input id="invName" placeholder="Tester's name (optional)"><button class="btn sm" data-act="invitetester" style="flex:0 0 auto">Invite</button></div><div id="adminUsers" class="small muted" style="margin-top:10px">Loading…</div></div>`:""}`;
  }
  async function loadAdmin(){
    const el=$("#adminUsers"); if(!el) return;
    try{ const r=await call("admin/users"); if(!r.ok) throw 0;
      el.innerHTML=r.j.users.filter(u=>u.role!=="admin").map(u=>`<div class="li"><div class="bul ${u.disabled?"":"dark"}">${esc(u.name[0]||"?")}</div><div class="b"><div class="t">${esc(u.name)}</div><div class="s">${u.fields} field${u.fields===1?"":"s"} · ${u.lastSeen?"last seen "+new Date(u.lastSeen).toLocaleDateString("en-GB",{day:"numeric",month:"short"}):"not opened yet"}${u.disabled?" · switched off":""}</div></div>
        <button class="btn soft sm" data-act="toggleuser" data-id="${u.id}" data-off="${u.disabled?"":"1"}">${u.disabled?"Switch on":"Switch off"}</button></div>`).join("") || "No testers yet. Invite one above.";
    }catch(e){ el.textContent="Couldn't load: no connection."; }
  }

  function gateView(){
    return `<div class="wrap" style="padding-top:calc(40px + env(safe-area-inset-top))"><div class="wx-hero" style="padding:26px 20px">
      <div style="width:64px;height:64px;color:var(--lime);margin-bottom:10px">${cropIc("cocoa")}</div>
      <div class="temp" style="font-size:40px">${APP_NAME}</div><div class="cond" style="opacity:.9">Farms &amp; land, by yarnOga</div></div>
      <div class="card"><h2>Private trial</h2><p class="muted">${APP_NAME} is being tested with a few farms. To join, open the invite link you were sent on WhatsApp.</p>
      <label class="f">Or paste the link here</label><div class="row"><input id="gateLink" placeholder="https://…/farm/#invite=…"><button class="btn sm" data-act="gatelink" style="flex:0 0 auto">Open</button></div></div>
      <button class="btn soft block" data-act="localonly">Look around with demo farms (this phone only)</button></div>`;
  }

  return {
    init, run, schedule, call, chip, gateView, settingsCards, loadAdmin, helpersBlock, loadHelpers, joinSheet,
    get me(){ return me; }, get mode(){ return mode; }, set mode(v){ mode=v; },
    async deleteField(p){ if(mode==="on" && p._synced){ setPendingDeletes([...new Set([...pendingDeletes(),p.id])]); run(); } },
    invite(kind,name){ return makeInvite(kind==="field"?{kind,fieldId:P.id}:{kind,nameHint:name},kind==="field"?"Invite a helper":"Invite a tester"); },
    async removeHelper(id){ try{ const r=await call(`fields/${P.id}/members/${id}`,{method:"DELETE"}); if(!r.ok) return toast(r.j.error||"Couldn't remove"); toast("Removed"); loadHelpers(P); }catch(e){ toast("No connection"); } },
    async toggleUser(id,off){ try{ await call(`admin/users/${id}/disable`,{method:"POST",json:{disabled:off}}); loadAdmin(); }catch(e){ toast("No connection"); } },
    async logout(){ try{ await call("logout",{method:"POST"}); }catch(e){}
      for(const f of fields.filter(f=>f._synced)) await Store.del(f.id);
      fields=fields.filter(f=>!f._synced); me=null; ls.set("oko_me",null); ls.set("oko_last",null); lastAt=null; mode="gate"; P=null; go({name:"home"}); }
  };
})();
const photoSrc = s => typeof s==="string" && s.startsWith("ph:") ? "api/photos/"+s.slice(3) : (s||"");
