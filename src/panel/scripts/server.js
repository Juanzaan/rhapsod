var H = { "content-type": "application/json" };
var lastV = -1;
var lastView = null;
var collapsed = {};

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toast(m) {
  var el = document.getElementById("toast");
  el.textContent = m;
  el.classList.add("show");
  setTimeout(function () {
    el.classList.remove("show");
  }, 3000);
}

function render(view) {
  var box = document.getElementById("tree");
  var chs = (view && view.channels) || [];
  lastView = view;
  var total = 0;
  var cls = (view && view.clients) || [];
  for (var j = 0; j < cls.length; j++) {
    total++;
  }
  fxCount(document.getElementById("channelCount"), chs.length);
  fxCount(document.getElementById("peopleCount"), total);
  fxCount(
    document.getElementById("emptyCount"),
    chs.filter(function (ch) {
      return !cls.some(function (client) {
        return client.cid === ch.cid;
      });
    }).length,
  );
  document.getElementById("visibilityNote").textContent =
    view && view.mode === "full"
      ? "Lista completa, incluidos canales vacíos."
      : "Vista limitada: el análisis de canales aún no termina o falló. Se muestran canales con usuarios visibles.";
  document.getElementById("treeHint").textContent =
    view && view.mode === "full"
      ? "Click en un canal para mover el bot ahí"
      : "Vista parcial: revisá permisos limitados o la conexión · click para mover el bot";
  if (chs.length === 0) {
    setHtml(
      box,
      '<div class="em">Sin canales disponibles. Comprobá la conexión del bot.</div>',
    );
    return;
  }
  var query = String(
    /** @type {HTMLInputElement} */ (document.getElementById("channelSearch"))
      .value || "",
  )
    .trim()
    .toLowerCase();
  var filtered = chs;
  if (query) {
    var keep = {};
    var byId = {};
    chs.forEach(function (ch) {
      byId[ch.cid] = ch;
    });
    chs.forEach(function (ch) {
      if (
        ch.name.toLowerCase().indexOf(query) !== -1 ||
        cls.some(function (client) {
          return (
            client.cid === ch.cid &&
            client.name.toLowerCase().indexOf(query) !== -1
          );
        })
      ) {
        var current = ch;
        var path = {};
        while (current && !path[current.cid]) {
          path[current.cid] = true;
          keep[current.cid] = true;
          current = byId[current.parentCid];
        }
      }
    });
    filtered = chs.filter(function (ch) {
      return keep[ch.cid];
    });
  }
  var built = serverTreeHtml(Object.assign({}, view, { channels: filtered }), {
    interactive: true,
    collapsed: query ? {} : collapsed,
  });
  if (!filtered.length) {
    setHtml(
      box,
      '<div class="em">No hay canales ni usuarios que coincidan.</div>',
    );
    return;
  }
  setHtml(box, built.html);
  if (lastV === -1 && document.querySelectorAll)
    fxRise(document.querySelectorAll("#tree .chrow"), 30);
  lastV = view.version;
}

function filterChannels() {
  if (lastView) render(lastView);
}
function expandChannels(expand) {
  collapsed = {};
  if (lastView) {
    if (!expand)
      (lastView.channels || []).forEach(function (channel) {
        collapsed[channel.cid] = true;
      });
    render(lastView);
  }
}

function toggleCh(e, cid) {
  if (e && e.stopPropagation) e.stopPropagation();
  collapsed[cid] = !collapsed[cid];
  if (lastView) render(lastView);
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
      if (d.ok) setTimeout(poll, 800);
    })
    .catch(function () {
      toast("Error de conexión");
    });
}

function poll() {
  return fetch("/api/server", { headers: H })
    .then(function (r) {
      if (r.ok === false) throw new Error("http");
      return r.json();
    })
    .then(function (d) {
      render(d);
      var badge = document.getElementById("live");
      badge.textContent = "EN VIVO";
      badge.className = "liveb on";
    })
    .catch(function () {
      var badge = document.getElementById("live");
      badge.textContent = "SIN CONEXIÓN";
      badge.className = "liveb";
    });
}

function live() {
  poll();
  setInterval(function () {
    if (!document.hidden) poll();
  }, 2500);
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) poll();
  });
}

(function init() {
  initAmbience();
  if (document.readyState === "complete") live();
  else window.addEventListener("load", live);
})();
