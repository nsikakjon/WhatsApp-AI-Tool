// Fills in "₦X paid through yarnOga" on the home page from the real total.
// The bot sends nothing until the total is big enough, so the line stays hidden.
(function () {
  var line = document.querySelector("[data-processed]");
  if (!line || !window.fetch) return;
  var fr = document.documentElement.lang === "fr";

  function words(naira) {
    var big = [[1e9, fr ? " milliard" : " billion"], [1e6, fr ? " million" : " million"]];
    for (var i = 0; i < big.length; i++) {
      if (naira >= big[i][0]) {
        var n = naira / big[i][0];
        var shown = (Math.floor(n * 10) / 10).toLocaleString(fr ? "fr-FR" : "en-NG");
        return "₦" + shown + big[i][1] + (fr && n >= 2 ? "s" : "");
      }
    }
    return "₦" + naira.toLocaleString(fr ? "fr-FR" : "en-NG");
  }

  fetch("https://app.yarnoga.com/processed")
    .then(function (r) { return r.ok ? r.json() : {}; })
    .then(function (d) {
      if (typeof d.naira !== "number" || d.naira <= 0) return;
      line.querySelector("b").textContent = words(d.naira);
      line.hidden = false;
    })
    .catch(function () {});
})();
