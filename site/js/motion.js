// Plays the hero chats message by message, with the "behind the chat" log ticking along
// and any back-office records ([data-after] = bubble number) appearing as the chat reaches them.
// Without JavaScript, or with reduced motion switched on, everything shows complete and still.
(function () {
  if (!window.matchMedia || !matchMedia("(prefers-reduced-motion: no-preference)").matches || !("IntersectionObserver" in window)) return;
  document.documentElement.classList.add("js");

  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  function watch(el, cb) {
    new IntersectionObserver(function (e) { cb(e[0].isIntersecting); }, { threshold: 0.3 }).observe(el);
  }

  function play(chat) {
    var art = chat.closest(".hero-art");
    var log = art && art.querySelector(".runlog");
    var bubbles = [].slice.call(chat.children).filter(function (b) { return b.classList.contains("b"); });
    var lines = log ? [].slice.call(log.querySelectorAll("li[data-with]")) : [];
    var recs = art ? [].slice.call(art.querySelectorAll("[data-after]")) : [];
    var typing = document.createElement("div");
    typing.className = "b in typing";
    typing.innerHTML = "<i></i><i></i><i></i>";

    var visible = false, wake = null;
    watch(chat, function (on) {
      visible = on;
      if (on && wake) { wake(); wake = null; }
    });
    var inView = function () { return visible && !document.hidden ? Promise.resolve() : new Promise(function (r) { wake = r; }); };

    chat.style.height = chat.offsetHeight + "px";

    (async function loop() {
      for (;;) {
        await inView();
        chat.classList.remove("fade");
        chat.classList.add("playing");
        if (log) log.classList.add("playing");
        bubbles.forEach(function (b) { b.classList.remove("on"); });
        lines.forEach(function (l) { l.classList.remove("on"); });
        recs.forEach(function (r) { r.classList.remove("on"); });
        if (art) art.classList.add("playing");

        for (var i = 0; i < bubbles.length; i++) {
          var b = bubbles[i], bot = b.classList.contains("in");
          var mine = lines.filter(function (l) { return +l.dataset.with === i; });
          if (bot) chat.insertBefore(typing, b);
          for (var k = 0; k < mine.length; k++) { mine[k].classList.add("on"); await wait(450); }
          await wait(bot ? Math.max(500, 1300 - mine.length * 450) : 700);
          typing.remove();
          b.classList.add("on");
          recs.forEach(function (r) { if (+r.dataset.after === i) r.classList.add("on"); });
          await wait(b.querySelector(".voice, img") ? 2200 : bot ? 2200 : 1100);
        }
        await wait(4500);
        chat.classList.add("fade");
        await wait(600);
      }
    })();
  }

  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll(".hero-art .chat").forEach(play);
    document.querySelectorAll(".flow").forEach(function (f) {
      watch(f, function (on) { f.classList.toggle("on", on); });
    });
  });
})();
