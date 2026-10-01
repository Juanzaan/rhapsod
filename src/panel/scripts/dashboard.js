var H = { "content-type": "application/json" };
var PP = "idle",
  POS = 0,
  DUR = 0,
  volDrag = false,
  lastTracks = -1,
  lastQ = "",
  lastE = "",
  lastQLen = 0,
  lastC = "",
  lastS = "",
  lastN = "",
  fails = 0;
var anchorPos = 0,
  anchorAt = 0,
  lastTitle = null,
  lastChatLen = -1;

function clock(ts) {
  return new Date(ts).toLocaleTimeString("es", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function fmtT(ms) {
  if (ms == null || !isFinite(ms) || ms < 0) return "--:--";
  var s = Math.floor(ms / 1000);
  return Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2);
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cmd(c) {
  fetch("/api/command", {
    method: "POST",
    headers: Object.assign({}, H, { "content-type": "application/json" }),
    body: JSON.stringify({ command: c }),
  })
    .then(function (r) {
      return r.json();
    })
    .then(function (d) {
      toast(d.ok ? d.response || "OK" : "Error: " + (d.error || "desconocido"));
      if (d.ok) setTimeout(refresh, 500);
    })
    .catch(function () {
      toast("Error de conexión");
    });
}

function run(c) {
  return fetch("/api/command", {
    method: "POST",
    headers: Object.assign({}, H, { "content-type": "application/json" }),
    body: JSON.stringify({ command: c }),
  })
    .then(function (r) {
      return r.json();
    })
    .then(function (d) {
      if (!d.ok) throw new Error(d.error || "desconocido");
      return d.response || "OK";
    });
}

function play() {
  var el = /** @type {HTMLInputElement} */ (document.getElementById("pi"));
  var q = el.value.trim();
  if (!q) return;
  var button = /** @type {HTMLButtonElement} */ (
    document.getElementById("addTrack")
  );
  if (button.disabled) return;
  button.disabled = true;
  button.textContent = "Agregando…";
  var nx = /** @type {HTMLInputElement|null} */ (
    document.getElementById("nxChk")
  );
  run((nx && nx.checked ? "playnext " : "play ") + q)
    .then(function (message) {
      if (el.value.trim() === q) el.value = "";
      toast(message);
      refresh();
    })
    .catch(function (error) {
      toast("Error: " + error.message);
    })
    .finally(function () {
      button.disabled = false;
      button.textContent = "Agregar a la cola";
    });
}

function tuneRadio() {
  var el = /** @type {HTMLInputElement} */ (
    document.getElementById("radioQuery")
  );
  var query = el.value.trim();
  var button = /** @type {HTMLButtonElement} */ (
    document.getElementById("radioTune")
  );
  if (!query || button.disabled) return;
  button.disabled = true;
  run("radio " + query)
    .then(function (message) {
      toast(message);
      refresh();
    })
    .catch(function (error) {
      toast("Error: " + error.message);
    })
    .finally(function () {
      button.disabled = false;
    });
}

function togglePlay() {
  cmd(PP === "playing" || PP === "buffering" ? "pause" : "resume");
}

function rmQ(n, button) {
  var row = button && button.closest ? button.closest(".qi") : null;
  var exit = row
    ? fx(
        row,
        [
          { opacity: 1, transform: "none" },
          { opacity: 0, transform: "translateX(28px)" },
        ],
        { duration: 260, easing: "ease-in", fill: "forwards" },
      )
    : null;
  // A refused removal (someone else's track) must bring the row back,
  // and a successful one redraws the list so no faded row lingers.
  run("remove " + n)
    .then(function (message) {
      toast(message);
      lastQ = "";
      refresh();
    })
    .catch(function (error) {
      if (exit) exit.cancel();
      toast("Error: " + error.message);
    });
}

function paintVolume(value) {
  document.getElementById("volv").textContent = value + "%";
  var vol = document.getElementById("vol");
  if (vol.style && vol.style.setProperty)
    vol.style.setProperty("--v", String(value));
}

function moveBot(cid) {
  fetch("/api/move", {
    method: "POST",
    headers: Object.assign({}, H, { "content-type": "application/json" }),
    body: JSON.stringify({ cid: cid }),
  })
    .then(function (r) {
      return r.json();
    })
    .then(function (d) {
      toast(
        d.ok ? "Bot en movimiento" : "Error: " + (d.error || "desconocido"),
      );
      if (d.ok) setTimeout(refresh, 800);
    })
    .catch(function () {
      toast("Error de conexión");
    });
}

function renderServerCard(view) {
  var box = document.getElementById("srvTree");
  if (!view || !view.channels || view.channels.length === 0) {
    box.innerHTML = '<div class="em">Sin datos — ¿bot conectado?</div>';
    document.getElementById("srvCount").textContent = "";
    return;
  }
  var built = serverTreeHtml(view, { interactive: false, collapsed: {} });
  var n = 0;
  var cls = view.clients || [];
  for (var i = 0; i < cls.length; i++) {
    n++;
  }
  document.getElementById("srvCount").textContent =
    n + (n === 1 ? " usuario" : " usuarios");
  box.innerHTML = built.html;
}

function sendChat() {
  var el = /** @type {HTMLInputElement} */ (document.getElementById("chatIn"));
  var q = el.value.trim();
  if (!q) return;
  el.value = "";
  fetch("/api/chat", {
    method: "POST",
    headers: Object.assign({}, H, { "content-type": "application/json" }),
    body: JSON.stringify({ text: q }),
  })
    .then(function (r) {
      return r.json();
    })
    .then(function (d) {
      if (!d.ok) toast("Error: " + (d.error || "desconocido"));
      else setTimeout(refresh, 500);
    })
    .catch(function () {
      toast("Error de conexión");
    });
}

function renderChat(msgs) {
  var list = document.getElementById("chat");
  var empty = document.getElementById("chatEmpty");
  if (!msgs || msgs.length === 0) {
    list.innerHTML = "";
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";
  var nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
  var h = "";
  for (var i = 0; i < msgs.length; i++) {
    var m = msgs[i];
    var who = m.outgoing ? "BOT" : m.from || "?";
    var tint = m.outgoing
      ? ""
      : ' style="color:hsl(' + nameHue(who) + ' 62% 76%)"';
    h +=
      '<li class="qi"><span class="qn">' +
      esc(clock(m.ts)) +
      '</span><span class="' +
      (m.outgoing ? "cmB" : "cnm") +
      '"' +
      tint +
      ">" +
      esc(who) +
      '</span><span class="cmt">' +
      esc(m.text) +
      "</span></li>";
  }
  list.innerHTML = h;
  if (lastChatLen >= 0 && msgs.length > lastChatLen && list.children)
    fxRise(
      Array.prototype.slice.call(
        list.children,
        list.children.length - (msgs.length - lastChatLen),
      ),
      60,
    );
  lastChatLen = msgs.length;
  if (nearBottom) list.scrollTop = list.scrollHeight;
}

function seekEv(e) {
  if (!DUR || DUR <= 0) return;
  var bar = document.getElementById("seek");
  var r = bar.getBoundingClientRect();
  var x =
    (e.touches && e.touches[0] ? e.touches[0].clientX : e.clientX) - r.left;
  var ratio = Math.max(0, Math.min(1, x / r.width));
  var sec = Math.floor((ratio * DUR) / 1000);
  POS = ratio * DUR;
  anchorPos = POS;
  anchorAt = Date.now();
  paintTime();
  cmd("seek " + sec);
}

function showOut(c) {
  var card = document.getElementById("dwCard");
  var pre = document.getElementById("dw");
  var wasOpen = card.style.display === "block";
  card.style.display = "block";
  pre.textContent = "...";
  card.scrollIntoView({ block: "nearest" });
  if (!wasOpen)
    fx(
      card,
      [
        { opacity: 0, transform: "translateY(14px) scale(.98)" },
        { opacity: 1, transform: "none" },
      ],
      { duration: 420, easing: "cubic-bezier(.2,.8,.2,1)" },
    );
  run(c)
    .then(function (t) {
      pre.textContent = t;
    })
    .catch(function (e) {
      pre.textContent = "Error: " + e.message;
    });
}

function closeOut() {
  document.getElementById("dwCard").style.display = "none";
}

var toastTimer = 0;
function toast(m) {
  var el = document.getElementById("toast");
  el.textContent = m;
  if (/^Error/.test(String(m))) el.classList.add("err");
  else el.classList.remove("err");
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () {
    el.classList.remove("show");
  }, 3200);
}

function nameHue(name) {
  return hashHue(String(name || "?").toLowerCase());
}

function avatar(name) {
  var n = String(name || "?");
  return (
    '<span class="av" style="--h:' +
    nameHue(n) +
    '" aria-hidden="true">' +
    esc(n.charAt(0).toUpperCase()) +
    "</span>"
  );
}

function livePos() {
  return PP === "playing" && DUR > 0
    ? Math.min(DUR, anchorPos + (Date.now() - anchorAt))
    : POS;
}

function paintBar() {
  if (DUR <= 0) return;
  document.getElementById("seekf").style.width =
    Math.min(100, (livePos() / DUR) * 100) + "%";
}

function setOffline(off) {
  var root = document.documentElement;
  if (root && root.setAttribute)
    root.setAttribute("data-offline", off ? "true" : "false");
}

function onTrackChange(title, first) {
  setSongHue(title);
  if (first) return;
  var ease = "cubic-bezier(.2,.8,.2,1)";
  fx(
    document.getElementById("nt"),
    [
      { opacity: 0, transform: "translateY(18px)", filter: "blur(8px)" },
      { opacity: 1, transform: "none", filter: "blur(0)" },
    ],
    { duration: 620, easing: ease },
  );
  fx(
    document.getElementById("trackDetail"),
    [
      { opacity: 0, transform: "translateY(10px)" },
      { opacity: 1, transform: "none" },
    ],
    { duration: 620, delay: 90, easing: ease, fill: "backwards" },
  );
  fx(
    document.getElementById("record"),
    [
      { transform: "scale(.9)" },
      { transform: "scale(1.04)" },
      { transform: "scale(1)" },
    ],
    { duration: 700, easing: ease, composite: "add" },
  );
}

function paintTime() {
  document.getElementById("tcur").textContent = fmtT(POS);
  document.getElementById("tdur").textContent = fmtT(DUR > 0 ? DUR : undefined);
  var f = document.getElementById("seekf");
  var bar = document.getElementById("seek");
  bar.setAttribute(
    "aria-valuenow",
    String(DUR > 0 ? Math.min(100, Math.round((POS / DUR) * 100)) : 0),
  );
  bar.setAttribute(
    "aria-valuetext",
    DUR > 0 ? fmtT(POS) + " de " + fmtT(DUR) : "Sin duración disponible",
  );
  bar.setAttribute("aria-disabled", String(DUR <= 0));
  if (DUR > 0) {
    bar.classList.remove("live");
    f.style.width = Math.min(100, (livePos() / DUR) * 100) + "%";
  } else if (PP === "playing" || PP === "buffering") {
    bar.classList.add("live");
    f.style.width = "100%";
  } else {
    bar.classList.remove("live");
    f.style.width = "0%";
  }
}

var lampState = null;
function setLamp(state) {
  if (lampState !== null && lampState !== state)
    fx(
      document.getElementById("ppBtn"),
      [{ transform: "scale(.78) rotate(-24deg)" }, { transform: "none" }],
      { duration: 420, easing: "cubic-bezier(.2,1.4,.4,1)" },
    );
  lampState = state;
  var lab = document.getElementById("nsState");
  var pp = document.getElementById("ppBtn");
  document
    .getElementById("playerCard")
    .setAttribute("data-playing", String(state === "playing"));
  setLive(state === "playing");
  pp.setAttribute(
    "aria-label",
    state === "playing" || state === "buffering" ? "Pausar" : "Reanudar",
  );
  if (state === "playing") {
    lab.textContent = "SONANDO";
    pp.innerHTML = "&#9208;";
  } else if (state === "buffering") {
    lab.textContent = "CARGANDO";
    pp.innerHTML = "&#9208;";
  } else if (state === "paused") {
    lab.textContent = "EN PAUSA";
    pp.innerHTML = "&#9654;";
  } else {
    lab.textContent = "EN ESPERA";
    pp.innerHTML = "&#9654;";
  }
}

function syncSeg(id, attr, val) {
  var btns = document.getElementById(id).querySelectorAll("button");
  for (var i = 0; i < btns.length; i++) {
    var b = btns[i];
    var on = b.getAttribute(attr) === val;
    if (on) b.classList.add("on");
    else b.classList.remove("on");
    b.setAttribute("aria-pressed", String(on));
  }
}

function checkYt(manual) {
  var el = document.getElementById("ytRes");
  if (manual) {
    el.textContent = "...";
    el.className = "sv";
  }
  fetch("/api/youtube-health", { headers: H })
    .then(function (r) {
      return r.json();
    })
    .then(function (d) {
      if (d.ok) {
        el.textContent = "OK";
        el.className = "sv am";
      } else {
        el.textContent = "FALLA";
        el.className = "sv";
        el.style.color = "var(--rd)";
      }
    })
    .catch(function () {
      el.textContent = "?";
    });
}

function refresh() {
  fetch("/api/state", { headers: H })
    .then(function (r) {
      return r.json();
    })
    .then(function (d) {
      fails = 0;
      setOffline(false);
      PP = d.playerState || "idle";
      POS =
        typeof d.positionMs === "number" && d.positionMs >= 0
          ? d.positionMs
          : 0;
      DUR =
        typeof d.durationMs === "number" && d.durationMs > 0 ? d.durationMs : 0;
      anchorPos = POS;
      anchorAt = Date.now();
      setLamp(PP);
      var titleNow = d.currentTitle || "";
      if (titleNow !== lastTitle) {
        onTrackChange(titleNow, lastTitle === null);
        lastTitle = titleNow;
      }
      paintTime();
      document.getElementById("nt").textContent =
        d.currentTitle || "Tu próxima canción empieza acá.";
      var detail = document.getElementById("trackDetail");
      if (d.currentArtist) detail.textContent = d.currentArtist;
      else if (d.currentRequester)
        detail.innerHTML = "Pedido por <b>" + esc(d.currentRequester) + "</b>";
      else
        detail.textContent = d.currentTitle
          ? ""
          : "Elegí un tema y compartí el momento.";
      document.getElementById("nt").title = d.currentTitle || "";
      fxCount(
        document.getElementById("qc"),
        d.queueLength,
        d.queueLength === 1 ? " pista" : " pistas",
      );
      if (!volDrag && typeof d.volume === "number") {
        /** @type {HTMLInputElement} */ (document.getElementById("vol")).value =
          d.volume;
        paintVolume(d.volume);
      }
      syncSeg("loopSeg", "data-l", d.loopMode || "off");
      syncSeg("autoSeg", "data-a", d.autoplay ? "on" : "off");
      if (typeof d.tracksPlayed === "number" && d.tracksPlayed !== lastTracks) {
        lastTracks = d.tracksPlayed;
        fxCount(document.getElementById("stTracks"), d.tracksPlayed);
      }
      if (typeof d.uptimeMs === "number") {
        var m = Math.floor(d.uptimeMs / 60000);
        var up =
          m < 60 ? "up " + m + " min" : "up " + Math.floor(m / 60) + " h";
        var dc =
          d.disconnects && typeof d.disconnects.count === "number"
            ? d.disconnects.count
            : 0;
        document.getElementById("uptime").textContent =
          dc > 0 ? up + " · " + dc + (dc === 1 ? " corte" : " cortes") : up;
      }
      // Connection only: playback state lives in the player card, and the
      // nav repeating it was the redundancy the old lamp had.
      paintStatus(d.connected ? "on" : "off");
      var qj = JSON.stringify(d.queue || []);
      if (qj !== lastQ) {
        lastQ = qj;
        var list = document.getElementById("ql");
        var empty = document.getElementById("qe");
        if (!d.queue || d.queue.length === 0) {
          list.innerHTML = "";
          empty.style.display = "block";
        } else {
          empty.style.display = "none";
          var prevLen = lastQLen;
          var grew = d.queue.length > prevLen;
          lastQLen = d.queue.length;
          var h = "";
          for (var i = 0; i < d.queue.length; i++) {
            var t = d.queue[i];
            var title = t.title || "Sin titulo";
            var by = t.requestedBy
              ? ' <span class="qr">' +
                avatar(t.requestedBy) +
                esc(t.requestedBy) +
                "</span>"
              : "";
            h +=
              '<li class="qi"><span class="qn">' +
              (i + 1) +
              '</span><span class="qt" title="' +
              esc(title) +
              '">' +
              esc(title) +
              "</span>" +
              by +
              '<button class="qx" title="Quitar" aria-label="Quitar pista ' +
              (i + 1) +
              '" onclick="rmQ(' +
              (i + 1) +
              ',this)">&times;</button></li>';
          }
          list.innerHTML = h;
          if (grew && list.children)
            fxRise(Array.prototype.slice.call(list.children, prevLen), 45);
        }
      }
      renderErrors(d.errors || { totalErrors: 0, byCategory: {}, recent: [] });
      renderNotices(d.notices || []);
      var cj = JSON.stringify(d.chat || []);
      if (cj !== lastC) {
        lastC = cj;
        renderChat(d.chat || []);
      }
      var sj = JSON.stringify(d.server || null);
      if (sj !== lastS) {
        lastS = sj;
        renderServerCard(d.server);
      }
    })
    .catch(function () {
      // Never fail silently: a stalled tunnel or a waking VPS looks like a
      // dead page otherwise. The 5s poll keeps retrying on its own.
      fails++;
      if (fails > 1) {
        setOffline(true);
        paintStatus("retry");
      }
    });
}

var SEVERITY_LABEL = {
  critical: "Crítico",
  error: "Error",
  warning: "Atención",
  info: "Info",
};

function sinceLabel(ts) {
  var mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (mins < 1) return "recién";
  if (mins < 60) return "hace " + mins + " min";
  var hours = Math.round(mins / 60);
  if (hours < 48) return "hace " + hours + " h";
  return "hace " + Math.round(hours / 24) + " días";
}

// Open notices come worst first from the registry; ignored ones stay listed,
// dimmed, so the owner still sees them until they resolve or worsen.
function renderNotices(list) {
  var nj = JSON.stringify(list);
  if (nj === lastN) return;
  lastN = nj;
  var card = document.getElementById("noticesCard");
  if (!list.length) {
    card.hidden = true;
    return;
  }
  var active = list.filter(function (n) {
    return !n.ignored;
  });
  card.hidden = false;
  card.setAttribute("data-worst", active.length ? active[0].severity : "none");
  var ignored = list.length - active.length;
  document.getElementById("noticesCount").textContent =
    active.length +
    (active.length === 1 ? " abierto" : " abiertos") +
    (ignored
      ? " · " + ignored + (ignored === 1 ? " ignorado" : " ignorados")
      : "");
  var h = "";
  for (var i = 0; i < list.length; i++) {
    var n = list[i];
    var sev = SEVERITY_LABEL[n.severity] ? n.severity : "info";
    h +=
      '<li class="notice' +
      (n.ignored ? " ignored" : "") +
      '"><span class="sev sev-' +
      sev +
      '">' +
      SEVERITY_LABEL[sev] +
      '</span><div><div class="notice-title">' +
      esc(n.title) +
      '</div><div class="notice-detail">' +
      esc(n.detail) +
      '</div><div class="notice-meta">' +
      esc(sinceLabel(n.since)) +
      (n.count > 1 ? " · " + n.count + " veces" : "") +
      (n.ignored ? " · ignorado hasta que empeore" : "") +
      "</div></div>" +
      (n.ignored
        ? "<span></span>"
        : '<button class="ch" data-key="' +
          esc(n.key) +
          '" onclick="ignoreNotice(this)" title="Ocultar hasta que empeore">Ignorar</button>') +
      "</li>";
  }
  setHtml(document.getElementById("noticeList"), h);
}

function ignoreNotice(button) {
  var key = button.getAttribute("data-key");
  button.disabled = true;
  fetch("/api/notices/ignore", {
    method: "POST",
    headers: H,
    body: JSON.stringify({ key: key }),
  })
    .then(function (r) {
      return r.json();
    })
    .then(function (d) {
      if (!d.ok) {
        button.disabled = false;
        toast("Error: " + (d.error || "desconocido"));
        return;
      }
      toast("Aviso ignorado hasta que empeore");
      lastN = "";
      refresh();
    })
    .catch(function () {
      button.disabled = false;
      toast("Error de conexión");
    });
}

function renderErrors(e) {
  var ej = JSON.stringify(e);
  if (ej === lastE) return;
  lastE = ej;
  var ec = document.getElementById("ec");
  ec.textContent = (e.totalErrors || 0) + " total";
  ec.style.color = e.totalErrors > 0 ? "var(--rd)" : "";
  var k = document.getElementById("ek");
  var cats = e.byCategory || {};
  var names = Object.keys(cats);
  var kh = "";
  for (var i = 0; i < names.length; i++) {
    var n = names[i];
    kh += '<span class="ch">' + esc(n) + " " + cats[n] + "</span>";
  }
  k.innerHTML = kh;
  var list = document.getElementById("el");
  var empty = document.getElementById("ee");
  var rec = e.recent || [];
  if (rec.length === 0) {
    list.innerHTML = "";
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";
  var h = "";
  for (var j = rec.length - 1; j >= 0; j--) {
    var r2 = rec[j];
    var t = clock(r2.ts);
    var ti = r2.trackTitle || r2.trackId || "";
    h +=
      '<li class="qi"><span class="qn">' +
      esc(t) +
      '</span><span class="qt" title="' +
      esc(r2.message) +
      '">[' +
      esc(r2.category) +
      "] " +
      esc(ti) +
      " — " +
      esc(r2.message) +
      "</span></li>";
  }
  list.innerHTML = h;
}

(function init() {
  initAmbience();
  initMore();
  var seek = document.getElementById("seek");
  seek.addEventListener("click", seekEv);
  seek.addEventListener("keydown", function (event) {
    if (DUR <= 0) return;
    var next = POS;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") next += 5000;
    else if (event.key === "ArrowLeft" || event.key === "ArrowDown")
      next -= 5000;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = DUR;
    else return;
    event.preventDefault();
    POS = Math.max(0, Math.min(DUR, next));
    anchorPos = POS;
    anchorAt = Date.now();
    paintTime();
    cmd("seek " + Math.floor(POS / 1000));
  });
  var vol = /** @type {HTMLInputElement} */ (document.getElementById("vol"));
  vol.addEventListener("pointerdown", function () {
    volDrag = true;
  });
  window.addEventListener("pointerup", function () {
    volDrag = false;
  });
  vol.addEventListener("input", function () {
    paintVolume(vol.value);
  });
  vol.addEventListener("change", function () {
    paintVolume(vol.value);
    cmd("volume " + vol.value);
  });
  seek.addEventListener("pointermove", function (event) {
    var tip = document.getElementById("skTip");
    if (DUR <= 0 || !seek.getBoundingClientRect) {
      tip.textContent = "";
      return;
    }
    var r = seek.getBoundingClientRect(),
      x = Math.max(0, Math.min(r.width, event.clientX - r.left));
    tip.style.left = x + "px";
    tip.textContent = fmtT((x / r.width) * DUR);
  });
  function tick() {
    if (document.hidden) return;
    refresh();
  }
  refresh();
  setInterval(tick, 5000);
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) refresh();
  });
  setInterval(function () {
    if (PP === "playing" && DUR > 0) {
      POS = livePos();
      paintTime();
    }
  }, 1000);
  // The bar glides between one-second text updates; the text stays on
  // whole seconds so the readout never jitters.
  if (typeof requestAnimationFrame === "function") {
    var glide = function () {
      if (PP === "playing" && !document.hidden && motionOn()) paintBar();
      requestAnimationFrame(glide);
    };
    requestAnimationFrame(glide);
  }
})();

// Hidden scrollbars left a half row as the only hint that a list went on.
function paintMore(boxId, buttonId, rowSelector) {
  var box = document.getElementById(boxId);
  var btn = document.getElementById(buttonId);
  if (!box || !btn || !box.querySelectorAll || !box.getBoundingClientRect)
    return;
  var limit = box.getBoundingClientRect().bottom + 1;
  var rows = box.querySelectorAll(rowSelector);
  var hidden = 0;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].getBoundingClientRect().bottom > limit) hidden++;
  }
  btn.hidden = hidden === 0;
  btn.textContent = hidden === 1 ? "1 más abajo" : hidden + " más abajo";
}
function paintMores() {
  paintMore("ql", "qlMore", ":scope > li");
  paintMore("srvTree", "srvMore", ".chrow");
}
function initMore() {
  ["ql", "srvTree"].forEach(function (id, i) {
    var btn = document.getElementById(i === 0 ? "qlMore" : "srvMore");
    var box = document.getElementById(id);
    if (!btn || !box || !btn.addEventListener) return;
    btn.addEventListener("click", function () {
      box.scrollBy({ top: box.clientHeight * 0.8, behavior: "smooth" });
    });
  });
  if (document.addEventListener)
    document.addEventListener("scroll", paintMores, true);
  setInterval(paintMores, 1000);
}
