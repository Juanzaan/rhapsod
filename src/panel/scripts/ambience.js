function setScene(value) {
  if (["aurora", "ember", "ocean", "off"].indexOf(value) < 0) value = "aurora";
  var layer = document.getElementById
    ? document.getElementById("ambient")
    : null;
  if (layer && layer.setAttribute) layer.setAttribute("data-scene", value);
  var sel = /** @type {HTMLSelectElement|null} */ (
    document.getElementById ? document.getElementById("scene") : null
  );
  if (sel) sel.value = value;
  try {
    if (window.localStorage)
      window.localStorage.setItem("rhapsod.scene", value);
  } catch (e) {}
}
// The OS reduced-motion setting is ignored on purpose: Windows turns it on
// with "Animation effects" off, which owners rarely know about, and the
// owner asked for the turntable and meter to move regardless. This is an
// owner console, not a public page; the button is the way to stop motion.
var motionPref = null;
function motionMode() {
  return motionPref === "paused" ? "paused" : "running";
}
function applyMotion() {
  var mode = motionMode();
  var root = document.documentElement;
  if (root && root.setAttribute)
    root.setAttribute(
      "data-motion",
      mode === "running" && document.hidden === true ? "paused" : mode,
    );
  var button = /** @type {HTMLButtonElement|null} */ (
    document.getElementById ? document.getElementById("motionToggle") : null
  );
  if (!button) return;
  button.textContent =
    mode === "running" ? "Pausar movimiento" : "Activar movimiento";
  if (button.setAttribute)
    button.setAttribute("aria-pressed", String(mode !== "running"));
  button.disabled = false;
}
function toggleMotion() {
  motionPref = motionMode() === "running" ? "paused" : "running";
  try {
    if (window.localStorage)
      window.localStorage.setItem("rhapsod.motion", motionPref);
  } catch (e) {}
  applyMotion();
}
function initAmbience() {
  var scene = "aurora";
  try {
    if (window.localStorage) {
      scene = window.localStorage.getItem("rhapsod.scene") || scene;
      motionPref = window.localStorage.getItem("rhapsod.motion");
    }
  } catch (e) {}
  setScene(scene);
  applyMotion();
  if (document.addEventListener)
    document.addEventListener("visibilitychange", applyMotion);
  restoreSongHue();
  initMotion();
  initScrollFade();
}
// Firefox and Safari lack scroll-driven animations, and with the bars
// hidden a clipped list gave no hint there was more. Same fade, set by hand.
function initScrollFade() {
  if (!window.CSS || !CSS.supports || !document.querySelectorAll) return;
  if (CSS.supports("animation-timeline", "scroll()")) return;
  var paint = function () {
    var els = document.querySelectorAll("#srvTree,.ql,.dw");
    for (var i = 0; i < els.length; i++) {
      var el = /** @type {HTMLElement} */ (els[i]);
      var rest = el.scrollHeight - el.clientHeight - el.scrollTop;
      el.style.setProperty("--sf-top", el.scrollTop > 2 ? "32px" : "0px");
      el.style.setProperty("--sf-bot", rest > 2 ? "32px" : "0px");
    }
  };
  document.addEventListener("scroll", paint, true);
  window.addEventListener("resize", paint);
  setInterval(paint, 1000);
  paint();
}
function motionOn() {
  var root = document.documentElement;
  if (!root || !root.getAttribute) return true;
  var mode = root.getAttribute("data-motion");
  return mode !== "paused";
}
function fx(el, frames, opts) {
  if (!motionOn()) return null;
  return fxAlways(el, frames, opts);
}
// Feedback to a click stays on under reduced or paused motion: it is short,
// the person caused it, and without it buttons read as unresponsive.
function fxAlways(el, frames, opts) {
  if (!el || typeof el.animate !== "function") return null;
  try {
    return el.animate(frames, opts);
  } catch (e) {
    return null;
  }
}
function fxRise(nodes, step) {
  if (!nodes) return;
  for (var i = 0; i < nodes.length; i++) {
    fx(
      nodes[i],
      [
        { opacity: 0, transform: "translateY(16px) scale(.985)" },
        { opacity: 1, transform: "none" },
      ],
      {
        duration: 640,
        delay: i * (step || 55),
        easing: "cubic-bezier(.2,.8,.2,1)",
        fill: "backwards",
      },
    );
  }
}
function fxPress(el) {
  fxAlways(
    el,
    [
      { transform: "scale(1)" },
      { transform: "scale(.92)" },
      { transform: "scale(1.03)" },
      { transform: "scale(1)" },
    ],
    { duration: 380, easing: "ease-out" },
  );
}
function fxRipple(el, ev) {
  if (!el.getBoundingClientRect || !document.createElement) return;
  var r = el.getBoundingClientRect();
  var size = Math.max(r.width, r.height) * 2.2;
  var dot = document.createElement("span");
  dot.className = "rp";
  dot.style.width = size + "px";
  dot.style.height = size + "px";
  dot.style.left = ev.clientX - r.left - size / 2 + "px";
  dot.style.top = ev.clientY - r.top - size / 2 + "px";
  el.appendChild(dot);
  var done = function () {
    if (dot.parentNode) dot.parentNode.removeChild(dot);
  };
  var a = fxAlways(
    dot,
    [
      { transform: "scale(0)", opacity: 0.3 },
      { transform: "scale(1)", opacity: 0 },
    ],
    { duration: 650, easing: "cubic-bezier(.2,.8,.2,1)" },
  );
  if (a) a.onfinish = done;
  else done();
}
function fxCount(el, to, suffix) {
  if (!el) return;
  suffix = suffix || "";
  var from = parseFloat((el.getAttribute && el.getAttribute("data-v")) || "");
  if (el.setAttribute) el.setAttribute("data-v", String(to));
  if (
    !isFinite(from) ||
    from === to ||
    !motionOn() ||
    typeof requestAnimationFrame !== "function"
  ) {
    el.textContent = to + suffix;
    return;
  }
  var start = null;
  function step(ts) {
    if (start === null) start = ts;
    var p = Math.min(1, (ts - start) / 900);
    el.textContent =
      Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3))) + suffix;
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}
function hashHue(title) {
  if (!title) return 142;
  var h = 2166136261;
  for (var i = 0; i < title.length; i++) {
    h ^= title.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 360;
}
function setSongHue(title) {
  var root = document.documentElement;
  var h = hashHue(title);
  if (root && root.style && root.style.setProperty)
    root.style.setProperty("--song-h", String(h));
  try {
    if (window.localStorage)
      window.localStorage.setItem("rhapsod.hue", String(h));
  } catch (e) {}
  return h;
}
function restoreSongHue() {
  var root = document.documentElement;
  if (
    !root ||
    !root.style ||
    !root.style.setProperty ||
    !root.style.getPropertyValue
  )
    return;
  if (root.style.getPropertyValue("--song-h")) return;
  try {
    var saved = window.localStorage
      ? window.localStorage.getItem("rhapsod.hue")
      : null;
    if (saved && /^\d{1,3}$/.test(saved))
      root.style.setProperty("--song-h", saved);
  } catch (e) {}
}
function setLive(on) {
  var root = document.documentElement;
  if (root && root.setAttribute)
    root.setAttribute("data-live", on ? "true" : "false");
}
var FX_TARGETS = ".tb,.go,.ch,.sg button,.qx,.btn,.b,.scene-tools button";
var spotEvent = null,
  spotFrame = 0;
function paintSpot() {
  spotFrame = 0;
  var ev = spotEvent,
    t = ev && ev.target;
  var card = t && t.closest ? t.closest(".cd") : null;
  if (!card || !card.getBoundingClientRect) return;
  var r = card.getBoundingClientRect();
  card.style.setProperty("--mx", ev.clientX - r.left + "px");
  card.style.setProperty("--my", ev.clientY - r.top + "px");
}
function initMotion() {
  if (!document.addEventListener) return;
  document.addEventListener(
    "pointerdown",
    function (ev) {
      var t = /** @type {Element|null} */ (ev.target),
        b = /** @type {HTMLButtonElement|null} */ (
          t && t.closest ? t.closest(FX_TARGETS) : null
        );
      if (!b || b.disabled) return;
      fxPress(b);
      fxRipple(b, ev);
    },
    { passive: true },
  );
  if (typeof requestAnimationFrame === "function") {
    document.addEventListener(
      "pointermove",
      function (ev) {
        spotEvent = ev;
        if (!spotFrame) spotFrame = requestAnimationFrame(paintSpot);
      },
      { passive: true },
    );
  }
  if (document.querySelectorAll) {
    fxRise(
      document.querySelectorAll(".page-intro,.page-heading,.setup-story"),
      0,
    );
    fxReveal(document.querySelectorAll(".cd,.metric"));
  }
}
// Cards on screen rise together; cards below the fold wait hidden and rise
// as they scroll in, so long pages keep moving past the first screen.
function fxReveal(nodes, step) {
  if (!nodes) return;
  var vh = window.innerHeight || 0,
    now = [],
    later = [];
  for (var i = 0; i < nodes.length; i++) {
    var n = nodes[i],
      r = n.getBoundingClientRect ? n.getBoundingClientRect() : null;
    if (r && vh && r.top > vh) later.push(n);
    else now.push(n);
  }
  fxRise(now, step === undefined ? 55 : step);
  if (
    !later.length ||
    typeof IntersectionObserver !== "function" ||
    !motionOn()
  )
    return;
  var io = new IntersectionObserver(
    function (entries) {
      for (var j = 0; j < entries.length; j++) {
        var en = entries[j];
        if (!en.isIntersecting) continue;
        io.unobserve(en.target);
        en.target.classList.remove("rv-wait");
        fxRise([en.target], 0);
      }
    },
    { rootMargin: "0px 0px 8% 0px" },
  );
  for (var k = 0; k < later.length; k++) {
    later[k].classList.add("rv-wait");
    io.observe(later[k]);
  }
}
var copyToastTimer = 0;
function copyText(text) {
  var done = function (ok) {
    var el = document.getElementById ? document.getElementById("toast") : null;
    if (!el) return;
    el.textContent = ok ? "Copiado: " + text : "No se pudo copiar";
    el.classList.remove("err");
    el.classList.add("copy");
    el.classList.add("show");
    clearTimeout(copyToastTimer);
    copyToastTimer = setTimeout(function () {
      el.classList.remove("show");
      el.classList.remove("copy");
    }, 2200);
  };
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () {
          done(true);
        },
        function () {
          done(false);
        },
      );
      return;
    }
  } catch (e) {}
  done(false);
}
// Polling rebuilds the same markup every few seconds; writing it anyway
// replaces the nodes under the pointer, which cuts hover and focus
// transitions mid-way and made them look broken.
var lastHtml = typeof WeakMap === "function" ? new WeakMap() : null;
function setHtml(el, html) {
  if (!el) return false;
  if (lastHtml && lastHtml.get(el) === html) return false;
  el.innerHTML = html;
  if (lastHtml) lastHtml.set(el, html);
  return true;
}

// One connection pill in the nav of every page, same words everywhere.
function paintStatus(state) {
  var lamp = document.getElementById("lamp");
  if (!lamp) return;
  lamp.className = "status" + (state === "on" ? " on" : "");
  var dot = document.getElementById("dot");
  if (dot) dot.className = "dot " + (state === "on" ? "on" : "off");
  var txt = document.getElementById("stxt");
  if (txt)
    txt.textContent =
      state === "on"
        ? "Conectado"
        : state === "retry"
          ? "Reconectando…"
          : "Desconectado";
}
function watchStatus() {
  var check = function () {
    fetch("/api/health", { headers: { "content-type": "application/json" } })
      .then(function (r) {
        return r.json();
      })
      .then(function (d) {
        paintStatus(d.connected ? "on" : d.reconnecting ? "retry" : "off");
      })
      .catch(function () {
        paintStatus("retry");
      });
  };
  check();
  setInterval(function () {
    if (!document.hidden) check();
  }, 5000);
}
