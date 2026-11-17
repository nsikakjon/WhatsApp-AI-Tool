// "Which plan fits me?" on the quotes pricing section. It reads the plan cards
// already on the page, so prices follow the currency picker and change only there.
// Limits match the quote plans: Free 50 orders and 500 AI replies; paid plans have
// unlimited orders, so they are sized by AI replies, at about 10 replies per order.
(function () {
  var box = document.querySelector("[data-plan-fit]");
  if (!box) return;

  var STOPS = [10, 25, 50, 100, 150, 250, 400, 500, 750, 1000, 1500, 2500, 4000, 6000, 10000];
  var PER_ORDER = 10;
  var PLANS = [
    { code: "free", name: "Free", ai: 500, orders: 50 },
    { code: "starter", name: "Starter", ai: 2500 },
    { code: "pro", name: "Pro", ai: 7500 },
    { code: "growth", name: "Growth", ai: 25000 },
    { code: "enterprise", name: "Enterprise", ai: 100000 }
  ];

  var slider = box.querySelector("#fit-orders");
  var delivery = box.querySelector("[data-fit-delivery]");
  var branches = box.querySelector("[data-fit-branches]");
  var out = function (k) { return box.querySelector("[data-fit-" + k + "]"); };
  var cards = {};
  document.querySelectorAll(".plans .plan").forEach(function (card) {
    var price = card.querySelector(".price");
    if (price) cards[price.getAttribute("data-plan").split(".")[1]] = card;
  });
  var fmt = function (n) { return n.toLocaleString("en-US"); };

  function pick(orders) {
    var ai = orders * PER_ORDER;
    var i = PLANS.findIndex(function (p) { return ai <= p.ai && (!p.orders || orders <= p.orders); });
    if (i < 0) i = PLANS.length - 1;
    var why = "About " + fmt(ai) + " AI replies a month, counting chats that don't end in an order. " + PLANS[i].name + " includes " + fmt(PLANS[i].ai) + ".";
    if (i === 0) why = "Free covers up to 50 orders and 500 AI replies a month.";
    if (delivery.checked && i < 2) { i = 2; why = "Delivery zones, riders and tracking start on Pro."; }
    if (branches.checked && i < 3) { i = 3; why = "Branches start on Growth: up to 3 numbers, with one order board for all of them."; }
    if (orders >= STOPS[STOPS.length - 1]) why = "Enterprise includes 100,000 AI replies. Busier than that? Email support@yarnoga.com and we will size a plan with you.";
    return { plan: PLANS[i], why: why };
  }

  function render() {
    var orders = STOPS[slider.value];
    var last = +slider.value === STOPS.length - 1;
    var label = (last ? fmt(orders) + " or more" : fmt(orders)) + " orders a month";
    box.querySelector(".fit-count").textContent = label;
    slider.setAttribute("aria-valuetext", label);

    var r = pick(orders), card = cards[r.plan.code];
    out("name").textContent = r.plan.name;
    out("why").textContent = r.why;
    out("cmd").innerHTML = '<a href="https://wa.me/2347048971600?text=sign%20up">Sign up on WhatsApp</a>' +
      (r.plan.code === "free" ? ", free." : ", then send <b>upgrade " + r.plan.code + "</b> to your bot.");
    var price = card && card.querySelector(".price"), yr = card && card.querySelector(".yr");
    out("price").innerHTML = price ? price.innerHTML : "";
    out("yr").textContent = yr ? yr.textContent : "";
    out("yr").hidden = !yr;
    Object.keys(cards).forEach(function (code) { cards[code].classList.toggle("pick", code === r.plan.code); });
  }

  [slider, delivery, branches].forEach(function (el) { el.addEventListener("input", render); });
  document.addEventListener("click", function (e) { if (e.target.closest(".cur")) render(); });
  box.hidden = false;
  render();
})();
