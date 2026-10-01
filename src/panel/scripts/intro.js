// Runs inline right after the #intro overlay, before first paint, so a
// skipped intro never flashes. Plays once per tab session: navigating
// between panel pages should not replay it.
(function () {
  var intro = document.getElementById("intro");
  if (!intro) return;
  var root = document.documentElement;
  function drop() {
    if (intro.parentNode) intro.parentNode.removeChild(intro);
  }
  var pref = null;
  var seen = false;
  try {
    pref = window.localStorage.getItem("rhapsod.motion");
    seen = window.sessionStorage.getItem("rhapsod.intro") === "1";
    window.sessionStorage.setItem("rhapsod.intro", "1");
  } catch (e) {}
  var reduced =
    pref === "paused" ||
    (pref !== "running" &&
      !!window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  if (seen || reduced || !root || !root.classList || !intro.classList) {
    drop();
    return;
  }
  root.classList.add("intro-on");
  function finish() {
    root.classList.remove("intro-on");
    drop();
  }
  function fly() {
    var mark = /** @type {HTMLElement|null} */ (
      intro.querySelector(".intro-mark")
    );
    var target = document.querySelector(".nv .nb");
    if (!mark || !target) return finish();
    var from = mark.getBoundingClientRect();
    var to = target.getBoundingClientRect();
    var scale = to.width / from.width;
    mark.style.transform =
      "translate(" +
      (to.left - from.left) +
      "px," +
      (to.top - from.top) +
      "px) scale(" +
      scale +
      ")";
    intro.classList.add("land");
    setTimeout(finish, 700);
  }
  function start() {
    // "r." alone first, then the rest of the name opens between the
    // letter and the dot, then the whole word lands on the nav.
    setTimeout(function () {
      intro.classList.add("open");
      setTimeout(fly, 750);
    }, 380);
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", start);
  else start();
})();
