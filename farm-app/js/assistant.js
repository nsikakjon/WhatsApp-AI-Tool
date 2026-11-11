"use strict";
/* =====================================================================
   ASK OKO: the AI farm assistant on each crop field.
   The phone sums up what it knows about the field (crop, stage, weather,
   alerts, tasks, scouting, records, satellite greenness) and sends it with
   the question; the server checks access and asks Claude. Chats stay in
   memory on this phone only: they're never saved or synced.
   ===================================================================== */
const Ask = (()=>{
  const chats={};          // field id -> [{role:"user"|"assistant", text}]
  let busy=false, fid=null;
  const r1=v=>v==null||!isFinite(v)? null : Math.round(v*10)/10;
  const nice=v=>Math.abs(v)>=10? Math.round(v) : r1(v);

  function suggestions(p){
    const c=CROPS[p.crop?.id], m=new Date().getMonth()+1;
    const out=["What should I do on this field in the next 2 weeks?","Is the weather right for spraying this week?"];
    const last=p.scouts.slice().sort((a,b)=>b.date.localeCompare(a.date))[0];
    if(last?.issues?.length) out.push(`My last scouting found ${last.issues[0].toLowerCase()}. What should I check?`);
    else if(c) out.push(`What problems should I watch for on ${c.name.toLowerCase()} in ${MONTHS[m-1]}?`);
    if(p.sat?.latest) out.push("What does the satellite greenness tell me?");
    else if(p.records.length) out.push("How is this field doing on costs and sales this year?");
    return out.slice(0,4);
  }

  /** What the assistant knows about the field. Money goes as naira text so the AI never does kobo sums. */
  function context(p){
    const c=CROPS[p.crop?.id], now=new Date(), st=c? cropStage(p.crop.id,p.crop.planted,now) : null, ha=areaHa(p);
    const wx=wxFor(p), S=wxSummary(wx), est=c? yieldEstimate(p.crop.id,p.crop.planted,ha,now) : null;
    const y=String(now.getFullYear()), yr=p.records.filter(r=>r.date.startsWith(y));
    const sales=yr.filter(r=>r.type==="harvest").reduce((s,r)=>s+Math.round((r.qty||0)*(r.priceKobo||0)),0);
    const costs=yr.filter(r=>r.type==="cost").reduce((s,r)=>s+(r.amountKobo||0),0);
    const from=new Date(now.getTime()-7*DAY), to=new Date(now.getTime()+30*DAY);
    const sat=p.sat&&p.sat.latest? p.sat : null;
    return {
      today: todayYmd(), season: SEASON(now.getMonth()+1), state: settings.state||null,
      field: { name:p.f.name||"Untitled", kind:p.kind, crop:c?.name||null, variety:p.crop?.variety||null, planted:p.crop?.planted||null,
        stage: st? [st.ageText,st.label].filter(Boolean).join(" · ") : (c?"No planting date yet":null),
        bearing: st&&c?.perennial? !!st.bearing : undefined,
        daysToHarvest: st&&!c?.perennial? st.daysToHarvest : undefined,
        harvestNote: c?.harvestNote||undefined, areaHa: ha? r1(ha) : null,
        typicalYield: est&&est[1]>0? `${nice(est[0])}–${nice(est[2])} ${c.unit}${c.perennial?" a year":""} (typical ${nice(est[1])})` : undefined },
      weather: S? { sample:!!wx.sample, rainLast7DaysMm:r1(S.rain7), rainLast30DaysMm:r1(S.rain30), wetDaysLast7:S.rainDays7,
        rainNext3DaysMm:r1(S.next3), rainNext7DaysMm:r1(S.next7), rainTomorrowMm:r1(S.tomorrow), avgHumidityLast7Pct:r1(S.rhAvg7),
        waterBalance30DaysMm:r1(S.balance30), tempNowC:r1(wx.current?.temperature_2m), humidityNowPct:r1(wx.current?.relative_humidity_2m),
        soilMoisturePct: wx.soil!=null? Math.round(wx.soil*100) : null, maxTodayC:r1(S.tmax), minTodayC:r1(S.tmin) } : null,
      alerts: c? insights(p,wx,now).map(i=>`${i.title}: ${i.text}`) : [],
      tasks: allTasks(p,from,to).filter(t=>t.status!=="done").slice(0,10).map(t=>({date:t.date, task:t.title||t.t, status:t.status})),
      scouts: p.scouts.slice().sort((a,b)=>b.date.localeCompare(a.date)).slice(0,5).map(s=>({date:s.date, health:`${s.health}/5`, problems:s.issues||[],
        counts:Object.fromEntries(Object.entries(s.m||{}).filter(([,v])=>v!==""&&v!=null).map(([k,v])=>[c?.measures.find(x=>x.k===k)?.l||k, v])),
        notes:s.notes||undefined})),
      records: { thisYear:{ sales:naira(sales), costs:naira(costs), profit:(sales-costs<0?"-":"")+naira(Math.abs(sales-costs)) },
        latest: p.records.slice().sort((a,b)=>b.date.localeCompare(a.date)).slice(0,8).map(r=> r.type==="harvest"
          ? {date:r.date, harvest:`${r.qty} ${r.unit}`, price:r.priceKobo? naira(r.priceKobo)+" each" : undefined, notes:r.notes||undefined}
          : {date:r.date, cost:r.category, amount:naira(r.amountKobo), notes:r.notes||undefined}) },
      ndvi: sat? { sample:!!sat.sample, latest:{date:sat.latest.date, ndvi:Math.round(sat.latest.mean*100)/100, clearOfCloudPct:Math.round((sat.latest.clear||0)*100)},
        recent: sat.series.slice(-6).map(s=>({date:s.date, ndvi:Math.round(s.mean*100)/100})) } : null
    };
  }

  /** The answer as safe HTML: escaped, with "- " lines as bullets. */
  function fmt(text){
    return text.split(/\n{2,}/).map(par=>{
      let html="", list=[];
      const flush=()=>{ if(list.length) html+=`<ul>${list.map(l=>`<li>${esc(l)}</li>`).join("")}</ul>`; list=[]; };
      let lines=[];
      const para=()=>{ if(lines.length) html+=`<p>${lines.map(esc).join("<br>")}</p>`; lines=[]; };
      for(const l of par.split("\n")){ if(/^\s*- /.test(l)){ para(); list.push(l.replace(/^\s*- /,"")); } else { flush(); lines.push(l); } }
      para(); flush(); return html;
    }).join("");
  }

  function blocked(){
    if(Sync.mode!=="on") return `Ask ${APP_NAME} works when you're logged in to the trial. Open your invite link from Jay to switch it on.`;
    if(navigator.onLine===false) return `Ask ${APP_NAME} needs signal. Everything else in the app keeps working offline.`;
    return "";
  }

  function msgs(){
    const list=chats[fid]||[], p=fieldById(fid);
    if(!list.length) return `<div class="ask-hello"><p>Ask anything about <b>${esc(p?.f.name||"this field")}</b>. ${APP_NAME} looks at its crop stage, weather, alerts, scouting, records and satellite greenness before answering.</p>
      <div class="ask-sugg">${(p?suggestions(p):[]).map(s=>`<button class="chip" data-ask="${esc(s)}">${esc(s)}</button>`).join("")}</div></div>`;
    return list.map(m=>m.role==="user"? `<div class="ask-msg me">${esc(m.text)}</div>` : `<div class="ask-msg ai${m.error?" err":""}">${m.error?esc(m.text):fmt(m.text)}</div>`).join("")
      + (busy? `<div class="ask-msg ai typing"><i></i><i></i><i></i></div>` : "");
  }
  function paint(){
    const box=$("#askMsgs"); if(!box) return;
    box.innerHTML=msgs(); box.scrollTop=box.scrollHeight;
    const go=$("#askGo"); if(go) go.disabled=busy;
  }

  function open(p=P){
    if(!p) return;
    fid=p.id;
    const stop=blocked();
    sheet(`<div class="head"><h2>Ask ${APP_NAME}</h2><button class="ibtn" data-close aria-label="Close">✕</button></div>
      <div class="tiny muted" style="margin-top:-2px">${esc(p.f.name||"Untitled")}${CROPS[p.crop?.id]?" · "+esc(CROPS[p.crop.id].name):""}</div>
      ${stop? `<div class="card empty" style="margin:12px 0 0">${ic("info")}<div>${esc(stop)}</div></div>` : `<div class="ask-msgs" id="askMsgs">${msgs()}</div>
      <form class="ask-bar" id="askForm"><textarea id="askQ" rows="1" maxlength="600" placeholder="Ask about this field…" aria-label="Your question"></textarea>
        <button class="ibtn dark" id="askGo" aria-label="Send">${ic("arrow")}</button></form>`}
      <p class="tiny muted" style="margin:8px 2px 0">A planning guide, not a diagnosis. For chemicals and how much to use, follow the label and your ADP / extension officer.</p>`);
    const f=$("#askForm"); if(!f) return;
    const q=$("#askQ");
    const grow=()=>{ q.style.height="auto"; q.style.height=Math.min(q.scrollHeight,120)+"px"; };
    q.addEventListener("input",grow);
    q.addEventListener("keydown",e=>{ if(e.key==="Enter"&&!e.shiftKey){ e.preventDefault(); f.requestSubmit(); } });
    f.addEventListener("submit",e=>{ e.preventDefault(); send(q.value); });
    $("#askMsgs").addEventListener("click",e=>{ const b=e.target.closest("[data-ask]"); if(b) send(b.dataset.ask); });
    paint();
  }

  async function send(text){
    text=String(text||"").trim(); if(!text||busy) return;
    const p=fieldById(fid); if(!p) return;
    const list=chats[fid]=chats[fid]||[];
    const history=list.filter(m=>!m.error).slice(-8).map(({role,text})=>({role,text}));
    list.push({role:"user",text}); busy=true;
    const q=$("#askQ"); if(q){ q.value=""; q.style.height="auto"; }
    paint();
    let reply;
    try{
      const r=await Sync.call(`fields/${encodeURIComponent(p.id)}/ask`,{method:"POST",json:{question:text.slice(0,600),history,context:context(p)}});
      reply= r.ok&&r.j.answer? {role:"assistant",text:r.j.answer} : {role:"assistant",error:true,text:r.j.error||r.j.message||"The assistant didn't answer. Try again in a minute."};
    }catch(e){ reply={role:"assistant",error:true,text:"No connection. Try again when you have signal."}; }
    busy=false; list.push(reply);
    if(fid===p.id) paint();
  }

  return { open, context, fmt };
})();
