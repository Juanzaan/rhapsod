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
  var paused = pref === "paused";
  if (seen || paused || !root || !root.classList || !intro.classList) {
    drop();
    return;
  }
  root.classList.add("intro-on");
  var done = false;
  function finish() {
    if (done) return;
    done = true;
    root.classList.remove("intro-on");
    drop();
    document.removeEventListener("keydown", finish);
  }
  // A click or any key skips the intro: it is the largest motion on the
  // panel and the OS reduced-motion setting no longer stops it.
  intro.addEventListener("pointerdown", finish);
  document.addEventListener("keydown", finish);
  function fly() {
    var mark = /** @type {HTMLElement|null} */ (
      intro.querySelector(".intro-mark")
    );
    var target = document.querySelector(".nv .nb");
    if (done) return;
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
  function sequence() {
    intro.classList.remove("wait");
    // "r." alone first, then the rest of the name opens between the
    // letter and the dot, then the whole word lands on the nav.
    setTimeout(function () {
      if (done) return;
      intro.classList.add("open");
      // fly() measures the word, so it waits for the expansion to end: on
      // a fixed timer a slow machine measured it half open and the mark
      // landed off the nav, then jumped into place.
      var rest = intro.querySelector(".intro-rest");
      var flown = false;
      var once = function () {
        if (flown) return;
        flown = true;
        fly();
      };
      if (rest) rest.addEventListener("transitionend", once);
      setTimeout(once, 1200);
    }, 380);
  }
  function start() {
    // On a cold cache the mark drew in a system font and swapped to the
    // display face mid-animation; wait for the faces, but not for long.
    var fonts = document.fonts;
    if (!fonts || !fonts.ready) return sequence();
    intro.classList.add("wait");
    var go = false;
    var once = function () {
      if (go) return;
      go = true;
      sequence();
    };
    fonts.ready.then(once);
    setTimeout(once, 600);
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", start);
  else start();
})();
