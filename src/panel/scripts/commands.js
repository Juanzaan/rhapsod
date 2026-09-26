var H = { "content-type": "application/json" };
var cmds = [];
var gn = {
  music: "Reproduccion",
  queue: "Cola",
  admin: "Administracion",
  misc: "Otros",
};
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function load() {
  fetch("/api/commands", { headers: H })
    .then(function (r) {
      if (!r.ok) throw new Error("http");
      return r.json();
    })
    .then(function (d) {
      cmds = d.commands;
      render(cmds);
    })
    .catch(function () {
      document.getElementById("ls").innerHTML =
        '<div class="cd"><div class="em">No se pudieron cargar los comandos.</div><button class="btn" onclick="load()">Reintentar</button></div>';
    });
}

var shownCount = -1;
function hl(text, q) {
  var raw = String(text == null ? "" : text);
  if (!q) return esc(raw);
  var low = raw.toLowerCase(),
    out = "",
    from = 0,
    at = low.indexOf(q);
  while (at !== -1) {
    out +=
      esc(raw.slice(from, at)) +
      "<mark>" +
      esc(raw.slice(at, at + q.length)) +
      "</mark>";
    from = at + q.length;
    at = low.indexOf(q, from);
  }
  return out + esc(raw.slice(from));
}

function render(list, q) {
  var el = document.getElementById("ls");
  fxCount(document.getElementById("commandCount"), list.length, " comandos");
  if (!list.length) {
    el.innerHTML =
      '<div class="cd"><div class="em">No se encontraron comandos</div></div>';
    return;
  }
  var groups = {};
  for (var i = 0; i < list.length; i++) {
    var entry = list[i];
    if (!groups[entry.group]) groups[entry.group] = [];
    groups[entry.group].push(entry);
  }
  var h = "";
  var order = ["music", "queue", "admin", "misc"];
  for (var gi = 0; gi < order.length; gi++) {
    var g = order[gi];
    var items = groups[g];
    if (!items) continue;
    h +=
      '<div class="cd"><div class="ct"><span>' +
      (gn[g] || g) +
      '</span><span class="rv">' +
      items.length +
      "</span></div>";
    for (var j = 0; j < items.length; j++) {
      var c = items[j];
      h +=
        '<div class="ci" data-cmd="!' +
        esc(c.name) +
        '" title="Copiar !' +
        esc(c.name) +
        '"><span class="copy-hint" aria-hidden="true">COPIAR</span><div><span class="cn">!' +
        hl(c.usage, q) +
        "</span>" +
        (c.aliases.length
          ? ' <span class="ca">(!' + hl(c.aliases.join(", !"), q) + ")</span>"
          : "") +
        (c.adminOnly ? ' <span class="cg">admin</span>' : "") +
        '</div><div class="cd2">' +
        hl(c.summary, q) +
        "</div></div>";
    }
    h += "</div>";
  }
  el.innerHTML = h;
  if (document.querySelectorAll && list.length !== shownCount) {
    var cards = document.querySelectorAll("#ls .cd");
    if (shownCount === -1) fxReveal(cards);
    else fxRise(cards, 40);
  }
  shownCount = list.length;
}

function filter() {
  var q = /** @type {HTMLInputElement} */ (document.getElementById("sr")).value
    .toLowerCase()
    .trim()
    .replace(/^!/, "");
  if (!q) {
    render(cmds);
    return;
  }
  render(
    cmds.filter(function (c) {
      return (
        c.name.indexOf(q) !== -1 ||
        c.aliases.some(function (a) {
          return a.indexOf(q) !== -1;
        }) ||
        c.summary.toLowerCase().indexOf(q) !== -1
      );
    }),
    q,
  );
}

initAmbience();
var commandList = document.getElementById("ls");
if (commandList && commandList.addEventListener)
  commandList.addEventListener("click", function (event) {
    var target = /** @type {Element|null} */ (event.target);
    var row = target && target.closest ? target.closest(".ci") : null;
    if (row) copyText(row.getAttribute("data-cmd"));
  });
load();
