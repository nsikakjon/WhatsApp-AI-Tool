import type { NavItem } from "./layout.js";

// A short guided tour of the menu for people new to the app (OWNER_APP_TOUR).
// It starts by itself the first time someone opens the dashboard in a browser,
// and Help > "Show me around" plays it again. Seen-or-not is kept in the
// browser, per login, so there's nothing to store on our side.

const STEPS: Record<string, { title: string; text: string }> = {
  "/home": { title: "Dashboard", text: "What's happening today: new orders, chats and anything waiting on you." },
  "/home/inbox": { title: "Inbox", text: "Every customer chat. Read what the bot said, and press Take over to reply yourself." },
  "/home/orders": { title: "Orders", text: "Every order from quote to delivered. Mark a transfer paid here and the customer gets their receipt." },
  "/home/counter": { title: "Counter sale", text: "Ring up a walk-in customer. Stock goes down by itself." },
  "/home/prices": { title: "Price list", text: "Your products and prices. The bot only ever quotes from this list, so keep it up to date." },
  "/home/delivery": { title: "Riders & delivery", text: "Add your riders and delivery areas, then send a rider out with an order." },
  "/home/test": { title: "Test your bot", text: "Chat with your bot here before customers do. Test orders aren't real." },
  "/home/settings": { title: "Settings", text: "The bank account on your invoices, who gets order alerts, and your team." },
  "/home/help": { title: "Help", text: "Answers, WhatsApp commands and support. You can take this tour again from here." },
};

/** The tour for the menu items this person can see, or "" when none of them have a step. */
export function tour(items: NavItem[], userId: string, start: boolean): string {
  const steps = items.filter((n) => STEPS[n.href]).map((n) => ({ href: n.href, ...STEPS[n.href]! }));
  if (!steps.length) return "";
  const data = JSON.stringify({ key: `yarnoga-tour:${userId}`, start, steps }).replace(/</g, "\\u003c");
  return `<style>${CSS}</style>
<div class="tour" id="tour" hidden><div class="tourback"></div><div class="tourspot"></div>
<div class="tourcard" role="dialog" aria-modal="true" aria-labelledby="tourtitle"><p class="tourcount"></p><h2 id="tourtitle"></h2><p class="tourtext"></p>
<div class="tourbtns"><button type="button" class="ghost small" data-go="skip">Skip tour</button><span><button type="button" class="ghost small" data-go="-1">Back</button> <button type="button" class="small" data-go="1">Next</button></span></div></div></div>
<script>
(function () {
  var t = ${data};
  var box = document.getElementById("tour"), spot = box.querySelector(".tourspot"), card = box.querySelector(".tourcard");
  var welcome = { title: "Welcome to your app", text: "A quick look around. It takes a minute, and you can skip it any time." };
  var steps = [welcome].concat(t.steps), at = 0;
  var seen = true;
  try { seen = localStorage.getItem(t.key) === "1"; localStorage.setItem(t.key, "1"); } catch (e) {}
  if (!t.start && seen) return;

  function shown(el) { return el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden"; }
  function target(step) {
    if (!step.href) return null;
    var links = document.querySelectorAll('.side a[href="' + step.href + '"], .tabs > a[href="' + step.href + '"]');
    for (var i = 0; i < links.length; i++) if (shown(links[i])) return { el: links[i] };
    var more = document.querySelector(".moretab > summary");
    return shown(more) ? { el: more, more: true } : null;
  }
  function place() {
    var step = steps[at], found = target(step);
    card.querySelector(".tourcount").textContent = at ? "Step " + at + " of " + t.steps.length : "Quick tour";
    card.querySelector("h2").textContent = step.title;
    card.querySelector(".tourtext").textContent = (found && found.more ? "Under More: " : "") + step.text;
    card.querySelector('[data-go="-1"]').hidden = at === 0;
    card.querySelector('[data-go="1"]').textContent = at === 0 ? "Start" : at === steps.length - 1 ? "Done" : "Next";
    card.style.left = card.style.top = card.style.bottom = "";
    card.className = "tourcard";
    if (!found) {
      spot.hidden = true;
      card.classList.add("centre");
      return;
    }
    found.el.scrollIntoView({ block: "nearest" });
    var r = found.el.getBoundingClientRect(), pad = 6;
    spot.hidden = false;
    spot.style.cssText = "left:" + (r.left - pad) + "px;top:" + (r.top - pad) + "px;width:" + (r.width + pad * 2) + "px;height:" + (r.height + pad * 2) + "px";
    if (found.el.closest(".side")) {
      card.classList.add("beside");
      card.style.left = r.right + 20 + "px";
      card.style.top = Math.max(16, Math.min(r.top - 12, innerHeight - card.offsetHeight - 16)) + "px";
    } else {
      card.classList.add("above");
      card.style.bottom = innerHeight - r.top + 18 + "px";
    }
  }
  function go(n) {
    if (n === "skip" || at + n >= steps.length) {
      box.hidden = true;
      document.removeEventListener("keydown", keys);
      return;
    }
    at = Math.max(0, at + n);
    place();
    card.querySelector('[data-go="1"]').focus();
  }
  function keys(e) {
    if (e.key === "Escape") go("skip");
    else if (e.key === "ArrowRight") go(1);
    else if (e.key === "ArrowLeft") go(-1);
  }
  card.addEventListener("click", function (e) {
    var b = e.target.closest("[data-go]");
    if (b) go(b.dataset.go === "skip" ? "skip" : Number(b.dataset.go));
  });
  document.addEventListener("keydown", keys);
  addEventListener("resize", function () { if (!box.hidden) place(); });
  box.hidden = false;
  go(0);
})();
</script>`;
}

const CSS = `
.tour{position:fixed;inset:0;z-index:50}.tour[hidden],.tourspot[hidden],.tourcard [hidden]{display:none}
.tourback{position:absolute;inset:0}
.tourspot{position:fixed;border-radius:var(--r);box-shadow:0 0 0 2px var(--lime),0 0 0 9999px rgba(5,7,6,.72);pointer-events:none;transition:all .25s ease}
.tourcard{position:fixed;width:min(360px,calc(100vw - 32px));padding:20px;border-radius:var(--r);background:var(--glass),var(--surface2);border:1px solid rgba(198,255,31,.25);box-shadow:0 20px 60px rgba(0,0,0,.6)}
.tourcard.centre{left:50%;top:50%;transform:translate(-50%,-50%);box-shadow:0 0 0 9999px rgba(5,7,6,.72),0 20px 60px rgba(0,0,0,.6)}
.tourcard.above{left:16px;right:16px;margin:0 auto}
.tourcard h2{margin:0 0 8px;font:700 1.3rem/1.2 var(--display)}
.tourcount{margin:0 0 8px;color:var(--mint);font:600 11px/1.4 var(--body);letter-spacing:.12em;text-transform:uppercase}
.tourtext{color:var(--muted)}
.tourbtns{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:16px}
`;
