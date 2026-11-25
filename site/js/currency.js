// Plan prices in other currencies. These are fixed prices jay approved for each
// currency (30 Oct 2026; Rwanda, Uganda, Tanzania and Malawi 7 Nov 2026; Zambia 13 Nov 2026; quote plans raised 25 Nov 2026), not live exchange rates: change a number here and it changes on the page.
// Each plan is [monthly, monthly when paid yearly]. Without JavaScript the page shows naira.
(function () {
  var PRICES = {
    GHS: {
      quote: { free: [0], starter: [150, 125], pro: [430, 365], growth: [930, 790], enterprise: [3180, 2700] },
      flyers: { free: [0], standard: [45, 25], premium: [80, 65], deluxe: [100, 85], organisation: [730] }
    },
    XOF: {
      quote: { free: [0], starter: [7500, 6400], pro: [22500, 19000], growth: [47000, 40000], enterprise: [160000, 135000] },
      flyers: { free: [0], standard: [2500, 1400], premium: [4000, 3250], deluxe: [5000, 4250], organisation: [37000] }
    },
    ZMW: {
      quote: { free: [0], starter: [360, 310], pro: [990, 840], growth: [2150, 1850], enterprise: [7450, 6350] },
      flyers: { free: [0], standard: [110, 60], premium: [190, 150], deluxe: [240, 200], organisation: [1700] }
    },
    KES: {
      quote: { free: [0], starter: [1800, 1550], pro: [4950, 4200], growth: [11000, 9350], enterprise: [37500, 32000] },
      flyers: { free: [0], standard: [550, 300], premium: [950, 750], deluxe: [1200, 1000], organisation: [8500] }
    },
    RWF: {
      quote: { free: [0], starter: [20500, 17500], pro: [56000, 47500], growth: [120000, 100000], enterprise: [415000, 355000] },
      flyers: { free: [0], standard: [6000, 3500], premium: [11000, 8500], deluxe: [13000, 11000], organisation: [95000] }
    },
    UGX: {
      quote: { free: [0], starter: [51500, 44000], pro: [140000, 120000], growth: [305000, 260000], enterprise: [1050000, 890000] },
      flyers: { free: [0], standard: [16000, 8500], premium: [27000, 21000], deluxe: [34000, 28000], organisation: [240000] }
    },
    TZS: {
      quote: { free: [0], starter: [36500, 31000], pro: [97000, 82500], growth: [215000, 185000], enterprise: [735000, 625000] },
      flyers: { free: [0], standard: [11000, 6000], premium: [19000, 15000], deluxe: [24000, 20000], organisation: [170000] }
    },
    MWK: {
      quote: { free: [0], starter: [25500, 21500], pro: [67500, 57500], growth: [155000, 130000], enterprise: [500000, 425000] },
      flyers: { free: [0], standard: [7500, 4000], premium: [13000, 10000], deluxe: [16000, 14000], organisation: [120000] }
    },
    USD: {
      quote: { free: [0], starter: [13, 11], pro: [37, 31], growth: [85, 72], enterprise: [290, 250] },
      flyers: { free: [0], standard: [3.5, 2.5], premium: [7, 6], deluxe: [9, 8], organisation: [65] }
    }
  };
  var LABELS = { NGN: "₦ Nigeria", GHS: "GH₵ Ghana", XOF: "FCFA West & Central", KES: "KSh Kenya", UGX: "USh Uganda", TZS: "TSh Tanzania", RWF: "RWF Rwanda", MWK: "MK Malawi", ZMW: "K Zambia", USD: "$ Other" };
  var SIGNS = { GHS: "GH₵", ZMW: "K", KES: "KSh ", UGX: "USh ", TZS: "TSh ", RWF: "RWF ", MWK: "MK ", USD: "$" };

  // CFA francs are written after the number; the rest go in front.
  function money(code, n) {
    if (code === "XOF") return n.toLocaleString("fr-FR").replace(/\s/g, "\u00a0") + "\u00a0FCFA";
    return SIGNS[code] + n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0 });
  }

  // A first guess from the visitor's time zone, so someone in Nairobi sees shillings.
  function guess() {
    var tz = "";
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) {}
    if (tz === "Africa/Nairobi") return "KES";
    if (tz === "Africa/Kampala") return "UGX";
    if (tz === "Africa/Dar_es_Salaam") return "TZS";
    if (tz === "Africa/Kigali") return "RWF";
    if (tz === "Africa/Blantyre") return "MWK";
    if (tz === "Africa/Lusaka") return "ZMW";
    if (tz === "Africa/Accra") return "GHS";
    if (/^Africa\/(Dakar|Abidjan|Porto-Novo|Lome|Bamako|Ouagadougou|Niamey|Bissau|Douala|Libreville|Brazzaville|Ndjamena|Bangui|Malabo)$/.test(tz)) return "XOF";
    if (tz === "Africa/Lagos" || tz.indexOf("Africa/") === 0) return "NGN";
    return tz ? "USD" : "NGN";
  }

  var stored;
  try { stored = localStorage.getItem("yarnoga-currency"); } catch (e) {}

  var cells = [].slice.call(document.querySelectorAll("[data-plan]"));
  if (!cells.length) return;
  cells.forEach(function (el) { el.setAttribute("data-ngn", el.innerHTML); });

  function show(code) {
    cells.forEach(function (el) {
      var p = el.getAttribute("data-plan").split(".");
      var row = code !== "NGN" && PRICES[code][p[0]][p[1]];
      if (!row) { el.innerHTML = el.getAttribute("data-ngn"); return; }
      var yearly = el.classList.contains("yr");
      if (yearly && row.length < 2) return;
      var n = money(code, row[yearly ? 1 : 0]);
      if (yearly) { el.textContent = "or " + n + "/month paid yearly"; return; }
      var ngn = el.getAttribute("data-ngn"), cut = ngn.indexOf("<");
      if (code === "XOF" && cut > 0) n = n.replace("\u00a0FCFA", '<span class="unit">FCFA</span>');
      el.innerHTML = (ngn.indexOf("From") === 0 ? "From " : "") + n + (cut > 0 ? ngn.slice(cut) : "");
    });
    document.querySelectorAll("[data-cur-note]").forEach(function (el) { el.hidden = code === "NGN"; });
    document.querySelectorAll(".cur button").forEach(function (b) { b.setAttribute("aria-pressed", b.value === code); });
  }

  document.querySelectorAll("[data-currency-picker]").forEach(function (box) {
    box.className = "cur";
    box.setAttribute("role", "group");
    box.setAttribute("aria-label", "Show prices in");
    Object.keys(LABELS).forEach(function (code) {
      var b = document.createElement("button");
      b.type = "button";
      b.value = code;
      b.textContent = LABELS[code];
      b.addEventListener("click", function () {
        try { localStorage.setItem("yarnoga-currency", code); } catch (e) {}
        show(code);
      });
      box.appendChild(b);
    });
    box.hidden = false;
  });

  show(LABELS[stored] ? stored : guess());
})();
