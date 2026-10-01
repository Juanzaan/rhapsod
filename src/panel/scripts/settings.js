var H = { "content-type": "application/json" };

function toast(m) {
  var el = document.getElementById("toast");
  el.textContent = m;
  el.classList.add("show");
  setTimeout(function () {
    el.classList.remove("show");
  }, 3000);
}
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function load() {
  fetch("/api/env", { headers: H })
    .then(function (r) {
      if (r.status === 401) throw new Error("auth");
      if (!r.ok) throw new Error("http" + r.status);
      return r.json();
    })
    .then(function (d) {
      if (!d.entries || d.entries.length === 0) {
        document.getElementById("ct").innerHTML =
          '<div class="cd"><div class="em">El bot no puede leer su archivo de entorno. Revisá que el usuario del servicio tenga permiso de lectura sobre RHAPSOD_ENV_FILE.</div></div>';
        return;
      }
      var groups = {};
      var order = ["TeamSpeak 3", "Audio", "Spotify", "Panel", "General"];
      for (var i = 0; i < d.entries.length; i++) {
        var entry = d.entries[i];
        var g =
          entry.key.indexOf("RHAPSOD_TS3") === 0
            ? "TeamSpeak 3"
            : entry.key.indexOf("RHAPSOD_SPOT") === 0
              ? "Spotify"
              : entry.key.indexOf("RHAPSOD_OPUS") === 0 ||
                  entry.key.indexOf("RHAPSOD_LOUD") === 0
                ? "Audio"
                : entry.key.indexOf("RHAPSOD_PANEL") === 0
                  ? "Panel"
                  : "General";
        if (!groups[g]) groups[g] = [];
        groups[g].push(entry);
      }
      var h = "";
      for (var gi = 0; gi < order.length; gi++) {
        var gn = order[gi];
        var entries = groups[gn];
        if (!entries) continue;
        h += '<div class="cd"><div class="ct">' + gn + "</div>";
        for (var j = 0; j < entries.length; j++) {
          var e = entries[j];
          if (e.editable === false) {
            h +=
              '<div class="f"><label>' +
              esc(e.key) +
              ' (solo lectura)</label><div class="h">' +
              esc(e.value || "") +
              "</div></div>";
            continue;
          }
          var val = e.masked ? "" : e.value || "";
          h +=
            '<div class="f"><label class="fl" for="setting-' +
            esc(e.key) +
            '"><span>' +
            esc(e.description || e.key) +
            '</span><code class="fk">' +
            esc(e.key) +
            '</code></label><input id="setting-' +
            esc(e.key) +
            '" data-key="' +
            esc(e.key) +
            '" value="' +
            esc(val) +
            '"' +
            (e.masked
              ? ' type="password" autocomplete="new-password" placeholder="(sin cambios)"'
              : "") +
            "></div>";
        }
        h += "</div>";
      }
      h +=
        '<div class="save-bar" id="saveBar"><span id="saveNote">Los cambios se aplican al reiniciar el bot.</span><button class="btn" id="saveSettings" onclick="save()">Guardar cambios</button></div>';
      document.getElementById("ct").innerHTML = h;
      if (document.querySelectorAll)
        fxReveal(document.querySelectorAll("#ct .cd"));
    })
    .catch(function (e) {
      loadFailed(e);
    });
}

var loadRetried = false;
function loadFailed(error) {
  var msg =
    error && error.message === "auth"
      ? "No autorizado: revisá el usuario y la contraseña del panel."
      : error && String(error.message || "").indexOf("http") === 0
        ? "El bot respondió un error (" + error.message + ")."
        : null;
  document.getElementById("ct").innerHTML =
    '<div class="cd"><div class="em">' +
    (msg || "Sin conexión con el bot. Revisá el túnel SSH.") +
    '</div><button class="btn" onclick="load()">Reintentar</button></div>';
  if (!loadRetried && (!error || error.message !== "auth")) {
    loadRetried = true;
    setTimeout(load, 3000);
  }
}

function save() {
  var inputs = /** @type {NodeListOf<HTMLInputElement>} */ (
    document.querySelectorAll("input[data-key]")
  );
  var button = /** @type {HTMLButtonElement|null} */ (
    document.getElementById("saveSettings")
  );
  if (button && button.disabled) return;
  if (button) {
    button.disabled = true;
    button.textContent = "Guardando…";
  }
  var vals = {};
  for (var i = 0; i < inputs.length; i++) {
    var v = inputs[i].value.trim();
    // Masked secrets render empty: never submit them untouched, or the
    // server would delete them from the env file on every save.
    if (!v && inputs[i].placeholder === "(sin cambios)") continue;
    vals[inputs[i].dataset.key] = v;
  }
  fetch("/api/env", {
    method: "PUT",
    headers: Object.assign({}, H, { "content-type": "application/json" }),
    body: JSON.stringify(vals),
  })
    .then(function (r) {
      return r.json();
    })
    .then(function (d) {
      toast(
        d.ok
          ? "Config guardada"
          : "Error al guardar: " + (d.error || "desconocido"),
      );
      if (d.ok) markSaved();
    })
    .catch(function () {
      toast("Error de conexión");
    })
    .finally(function () {
      if (button) {
        button.disabled = false;
        button.textContent = "Guardar cambios";
      }
    });
}

// Edited fields and the save bar light up until the change is saved, so
// a forgotten edit is visible before navigating away.
function markDirty() {
  var inputs = document.querySelectorAll
    ? document.querySelectorAll("input[data-key]")
    : [];
  var changed = 0;
  for (var i = 0; i < inputs.length; i++) {
    var input = inputs[i],
      dirty = input.value !== input.defaultValue;
    if (dirty) changed++;
    if (input.parentNode && input.parentNode.classList)
      input.parentNode.classList.toggle("dirty", dirty);
  }
  var bar = document.getElementById("saveBar"),
    note = document.getElementById("saveNote");
  if (bar && bar.classList) {
    bar.classList.toggle("dirty", changed > 0);
    bar.classList.remove("saved");
  }
  if (note)
    note.textContent =
      changed > 0
        ? (changed === 1
            ? "1 cambio sin guardar"
            : changed + " cambios sin guardar") +
          ". Se aplican al reiniciar el bot."
        : "Los cambios se aplican al reiniciar el bot.";
}

function markSaved() {
  var inputs = document.querySelectorAll
    ? document.querySelectorAll("input[data-key]")
    : [];
  for (var i = 0; i < inputs.length; i++)
    inputs[i].defaultValue = inputs[i].value;
  markDirty();
  var bar = document.getElementById("saveBar"),
    note = document.getElementById("saveNote");
  if (bar && bar.classList) {
    bar.classList.add("saved");
    fx(
      bar,
      [
        { transform: "scale(1)" },
        { transform: "scale(1.015)" },
        { transform: "scale(1)" },
      ],
      { duration: 420, easing: "ease-out" },
    );
  }
  if (note) note.textContent = "Guardado. Se aplica al reiniciar el bot.";
}

initAmbience();
var settingsRoot = document.getElementById("ct");
if (settingsRoot && settingsRoot.addEventListener)
  settingsRoot.addEventListener("input", markDirty);
load();
