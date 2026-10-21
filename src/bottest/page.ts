import { BOT_LABELS, DEFAULT_QUESTIONS, MAX_QUESTION, type TestBotId } from "./questions.js";

// The test screen itself: one page, with a little script that sends each
// question to /bot-test/ask and saves marks to /bot-test/marks.

export function renderTestPage(bots: TestBotId[]): string {
  const data = {
    bots: bots.map((id) => ({ id, label: BOT_LABELS[id], questions: DEFAULT_QUESTIONS[id] })),
    maxQuestion: MAX_QUESTION,
  };
  // Safe inside <script>: no "<" can close the tag early.
  const json = JSON.stringify(data).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>yarnOga bot test</title>
<style>
:root { --bg:#f6f7f3; --panel:#ffffff; --line:#e1e3dc; --text:#151614; --muted:#5d6159; --accent:#3d6b00; --accent-soft:#e6f5c9; --good:#2f7d1f; --poor:#b3261e; --poor-soft:#fbe4e2; }
@media (prefers-color-scheme: dark) {
  :root { --bg:#0c0d0d; --panel:#191a1a; --line:#2e302f; --text:#f3f4ef; --muted:#a1a49d; --accent:#c6ff1f; --accent-soft:#2a3310; --good:#8fdc6b; --poor:#ff8a80; --poor-soft:#3a1d1b; }
}
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--text); font:15px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 860px; margin: 0 auto; padding: 24px 16px 48px; }
h1 { margin: 0; font-size: 26px; letter-spacing: -0.02em; }
h1 b { color: var(--accent); }
.intro { margin: 4px 0 0; color: var(--muted); }
.tabs { display:flex; flex-wrap:wrap; gap:8px; margin-top:18px; }
.tabs button { border:1px solid var(--line); background:var(--panel); color:var(--text); }
.tabs button[aria-pressed="true"] { background:var(--accent-soft); border-color:var(--accent); font-weight:600; }
button { font:inherit; padding:8px 14px; border-radius:10px; border:1px solid var(--accent); background:var(--accent); color:var(--bg); cursor:pointer; }
button.plain { background:transparent; color:var(--text); border-color:var(--line); }
button:disabled { opacity:.5; cursor:default; }
.box { margin-top:16px; background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:14px; }
label { font-weight:600; }
.hint { color:var(--muted); font-size:13px; margin:2px 0 8px; }
textarea, input[type=text], select { width:100%; font:inherit; color:var(--text); background:var(--bg); border:1px solid var(--line); border-radius:8px; padding:8px; }
textarea { min-height: 180px; }
.row { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-top:10px; }
.summary { font-weight:600; }
.status { color:var(--muted); font-size:14px; }
ol { list-style:none; padding:0; margin:0; }
.item { margin-top:12px; background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:14px; }
.item.good { border-color:var(--good); }
.item.poor { border-color:var(--poor); background:linear-gradient(var(--poor-soft), var(--panel) 60%); }
.q { font-weight:600; }
.q span { color:var(--muted); font-weight:400; margin-right:6px; }
.a { margin-top:8px; padding:10px 12px; border-radius:10px; background:var(--accent-soft); white-space:pre-wrap; overflow-wrap:anywhere; }
.a.waiting { background:transparent; color:var(--muted); padding-left:0; }
.a.error { background:var(--poor-soft); }
.extra { color:var(--muted); font-size:13px; margin-top:6px; }
.marks button.good[aria-pressed="true"] { background:var(--good); border-color:var(--good); color:var(--bg); }
.marks button.poor[aria-pressed="true"] { background:var(--poor); border-color:var(--poor); color:var(--bg); }
.saved { color:var(--muted); font-size:13px; }
.empty { color:var(--muted); margin-top:16px; }
</style>
</head>
<body>
<main>
<h1><b>yarnOga</b> bot test</h1>
<p class="intro">Try your bot on the questions customers ask most, before it goes live. Read each answer and mark it good or poor. Nothing here is sent on WhatsApp, and test quotes, orders and leads are not saved.</p>
<div id="app"></div>
</main>
<script>
const DATA = ${json};
const app = document.getElementById("app");
let current = DATA.bots[0];
let saved = new Map();
let running = false;
// Businesses on the quote bot, when it runs several; the picked one's id.
let businesses = null;
let business = null;
const forBusiness = () => (current.id === "quote" ? business : null);

function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const child of children) if (child != null) node.append(child);
  return node;
}

function storageKey(bot) { const b = bot === current ? forBusiness() : null; return "bot-test-questions-" + bot.id + (b ? "-" + b : ""); }
function loadQuestions(bot) {
  try { const s = localStorage.getItem(storageKey(bot)); if (s) return s; } catch {}
  return bot.questions.join("\\n");
}
function keepQuestions(bot, text) {
  try { localStorage.setItem(storageKey(bot), text); } catch {}
}
function key(q) { return q.trim().toLowerCase(); }

// The page lives at /bot-test (no slash at the end), so "ask" on its own
// would mean /ask. Every request is made from the page's own address instead.
const BASE = location.pathname.replace(/\\/+$/, "") + "/";

async function call(path, options) {
  const res = await fetch(BASE + path, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Something went wrong.");
  return body;
}
const post = (path, body) => call(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

function render() {
  app.replaceChildren();
  if (!current) {
    app.append(el("p", { class: "empty" }, "No bot is switched on for testing on this server. The sales assistant (ACTIVE_PRODUCT=quote) or the lead qualifier (LEADS_PHONE_NUMBER_ID) needs to be set up first."));
    return;
  }
  if (DATA.bots.length > 1) {
    app.append(el("div", { class: "tabs" }, ...DATA.bots.map((b) =>
      el("button", { "aria-pressed": String(b === current), onclick: () => { if (!running) { current = b; start(); } } }, b.label))));
  }

  if (current.id === "quote" && businesses && businesses.length > 1) {
    const pick = el("select", { id: "business", onchange: () => { business = pick.value; start(); } },
      ...businesses.map((b) => {
        const opt = el("option", { value: b.id }, b.name + (b.live ? "" : " (not live yet)"));
        opt.selected = b.id === business;
        return opt;
      }));
    app.append(el("div", { class: "box" }, el("label", { for: "business" }, "Business to test"),
      el("p", { class: "hint" }, "Each business is tested with its own price list. A business that isn't live yet can be tested before it's switched on."), pick));
  }

  const area = el("textarea", { id: "questions", spellcheck: "true" });
  area.value = loadQuestions(current);
  area.addEventListener("input", () => keepQuestions(current, area.value));
  const runBtn = el("button", { onclick: () => runAll(area.value) }, "Ask all questions");
  const resetBtn = el("button", { class: "plain", onclick: () => { area.value = current.questions.join("\\n"); keepQuestions(current, area.value); } }, "Back to the starter questions");
  app.append(el("div", { class: "box" },
    el("label", { for: "questions" }, "Questions for the " + current.label.toLowerCase()),
    el("p", { class: "hint" }, "One question per line, written the way your customers write. Add your own or change these. Each question is a new chat."),
    area,
    el("div", { class: "row" }, runBtn, resetBtn, el("span", { class: "status", id: "status" }))));
  app.append(el("p", { class: "summary", id: "summary" }));
  app.append(el("ol", { id: "results" }));
  showSaved();
}

async function start() {
  saved = new Map();
  if (current.id === "quote" && businesses === null) {
    try {
      businesses = (await call("businesses")).businesses;
      if (businesses.length) business = businesses[0].id;
    } catch (err) {
      businesses = [];
      render();
      return setStatus(err.message);
    }
  }
  render();
  try {
    const b = forBusiness();
    const { marks } = await call("marks?bot=" + current.id + (b ? "&business=" + encodeURIComponent(b) : ""));
    for (const m of marks) saved.set(key(m.question), m);
  } catch (err) {
    setStatus(err.message);
  }
  showSaved();
}

function setStatus(text) { const s = document.getElementById("status"); if (s) s.textContent = text; }

// Before a run, show the answers marked last time.
function showSaved() {
  const list = document.getElementById("results");
  if (!list || running || list.childElementCount) return updateSummary();
  for (const m of saved.values()) list.append(item(m.question, { text: m.answer }, m));
  updateSummary();
}

function updateSummary() {
  const s = document.getElementById("summary");
  if (!s) return;
  const items = [...document.querySelectorAll(".item")];
  if (!items.length) { s.textContent = ""; return; }
  const good = items.filter((i) => i.classList.contains("good")).length;
  const poor = items.filter((i) => i.classList.contains("poor")).length;
  s.textContent = good + " good, " + poor + " poor, " + (items.length - good - poor) + " not marked yet";
}

function item(question, answer, mark) {
  const li = el("li", { class: "item" + (mark ? " " + mark.mark : "") });
  li.append(el("div", { class: "q" }, el("span", {}, "Customer:"), question));
  const a = el("div", { class: "a waiting" }, "Asking the bot...");
  li.append(a);
  const extra = el("div", { class: "extra" });
  li.append(extra);
  const note = el("input", { type: "text", placeholder: "What should it have said? (optional)", maxlength: "500" });
  note.style.display = mark && mark.mark === "poor" ? "" : "none";
  if (mark && mark.note) note.value = mark.note;
  const savedNote = el("span", { class: "saved" }, mark ? "Marked " + mark.mark + " on " + new Date(mark.markedAt).toLocaleDateString() : "");
  const good = el("button", { class: "plain good", "aria-pressed": String(mark?.mark === "good") }, "Good");
  const poor = el("button", { class: "plain poor", "aria-pressed": String(mark?.mark === "poor") }, "Poor");
  const marks = el("div", { class: "row marks" }, good, poor, savedNote);
  li.append(marks, note);
  li.setAnswer = (ans) => {
    li.answer = ans;
    a.className = "a";
    a.textContent = ans.text || "(The bot sent no text.)";
    const bits = [];
    if (ans.pictures) bits.push(ans.pictures + " picture" + (ans.pictures > 1 ? "s" : "") + " (for example an invoice)");
    if (ans.choices && ans.choices.length) bits.push("a list to tap: " + ans.choices.join(", "));
    if (ans.alerts) bits.push("you or your agents would get an alert on WhatsApp");
    extra.textContent = bits.length ? "Also sends " + bits.join("; ") + "." : "";
    good.disabled = poor.disabled = false;
  };
  li.setError = (msg) => { a.className = "a error"; a.textContent = msg; good.disabled = poor.disabled = true; };
  const choose = async (value) => {
    li.className = "item " + value;
    good.setAttribute("aria-pressed", String(value === "good"));
    poor.setAttribute("aria-pressed", String(value === "poor"));
    note.style.display = value === "poor" ? "" : "none";
    updateSummary();
    await saveMark(question, li.answer, value, note.value, savedNote);
  };
  good.addEventListener("click", () => choose("good"));
  poor.addEventListener("click", () => choose("poor"));
  note.addEventListener("change", () => { if (li.classList.contains("poor")) saveMark(question, li.answer, "poor", note.value, savedNote); });
  if (answer) li.setAnswer(answer);
  else good.disabled = poor.disabled = true;
  return li;
}

async function saveMark(question, answer, mark, note, label) {
  label.textContent = "Saving...";
  try {
    await post("marks", { bot: current.id, business: forBusiness(), question, answer: answer ? answer.text : "", mark, note });
    label.textContent = "Saved";
  } catch (err) {
    label.textContent = err.message;
  }
}

async function runAll(text) {
  if (running) return;
  const questions = [...new Set(text.split("\\n").map((q) => q.trim()).filter(Boolean))];
  const tooLong = questions.find((q) => q.length > DATA.maxQuestion);
  if (!questions.length) return setStatus("Add at least one question.");
  if (tooLong) return setStatus("One question is longer than " + DATA.maxQuestion + " characters.");
  running = true;
  document.querySelectorAll("button, select").forEach((b) => b.disabled = true);
  const list = document.getElementById("results");
  list.replaceChildren();
  const items = questions.map((q) => { const li = item(q, null, null); list.append(li); return [q, li]; });
  updateSummary();
  let done = 0;
  for (const [q, li] of items) {
    setStatus("Asking " + (done + 1) + " of " + items.length + "...");
    try {
      li.setAnswer(await post("ask", { bot: current.id, business: forBusiness(), question: q }));
    } catch (err) {
      li.setError(err.message);
      if (/used up/.test(err.message)) { items.slice(done + 1).forEach(([, rest]) => rest.setError(err.message)); break; }
    }
    done += 1;
  }
  running = false;
  document.querySelectorAll(".tabs button, .box button, select").forEach((b) => b.disabled = false);
  setStatus("Done. Mark each answer good or poor.");
}

start();
</script>
</body>
</html>`;
}
