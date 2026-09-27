var H = { "content-type": "application/json" };
var S = [
  { id: "welcome", r: rW },
  { id: "ts3", r: rT },
  { id: "channel", r: rC },
  { id: "audio", r: rA },
  { id: "youtube", r: rY },
  { id: "optional", r: rO },
  { id: "review", r: rR },
];
// vals is sent as-is to PUT /api/env, which rejects unknown keys: the
// YouTube check result lives apart in yt.
var cur = 0,
  vals = {},
  yt = {},
  shownStep = -1;

function render() {
  var h = "";
  for (var i = 0; i < S.length; i++) {
    var c = "s";
    if (i < cur) c += " d";
    if (i === cur) c += " c";
    h += '<div class="' + c + '"></div>';
  }
  var box = document.getElementById("w");
  box.innerHTML = '<div class="p">' + h + "</div>" + S[cur].r();
  bind();
  if (shownStep !== -1 && shownStep !== cur && box.children) {
    var shift = cur > shownStep ? 28 : -28,
      kids = Array.prototype.slice.call(box.children, 1);
    for (var k = 0; k < kids.length; k++)
      fx(
        kids[k],
        [
          { opacity: 0, transform: "translateX(" + shift + "px)" },
          { opacity: 1, transform: "none" },
        ],
        {
          duration: 460,
          delay: k * 50,
          easing: "cubic-bezier(.2,.8,.2,1)",
          fill: "backwards",
        },
      );
  }
  shownStep = cur;
}

function rW() {
  return (
    '<div class="wt"><h1>Rhapsod</h1><p>Bot de música para TeamSpeak 3.<br>Configuremoslo en unos pasos.</p></div>' +
    '<div class="fe"><div class="fi"><span class="fn">01</span></div><div class="ft"><strong>YouTube, Spotify, SoundCloud</strong><br><span>Música desde múltiples fuentes</span></div></div>' +
    '<div class="fe"><div class="fi"><span class="fn">02</span></div><div class="ft"><strong>Cola inteligente</strong><br><span>Colas, mezclas y repetición</span></div></div>' +
    '<div class="fe"><div class="fi"><span class="fn">03</span></div><div class="ft"><strong>Fácil de usar</strong><br><span>Comandos simples desde el chat de TS3</span></div></div>' +
    '<div class="a"><button class="b bp" onclick="next()">Empezar</button></div>'
  );
}

function rT() {
  return (
    '<h1>Servidor TeamSpeak</h1><p class="sub">Datos de conexion al servidor TS3</p>' +
    '<div class="f" id="fh"><label>Direccion del servidor</label><input id="ih" placeholder="ts.example.com" value="' +
    (vals.RHAPSOD_TS3_HOST || "") +
    '"><div class="h">Hostname o IP del servidor</div><div class="e">Requerido</div></div>' +
    '<div class="f"><label>Puerto</label><input id="ip" type="number" placeholder="9987" value="' +
    (vals.RHAPSOD_TS3_PORT || "9987") +
    '"><div class="h">Default: 9987</div></div>' +
    '<div class="f"><label>Nombre del bot</label><input id="in" placeholder="Rhapsod" value="' +
    (vals.RHAPSOD_TS3_NICKNAME || "Rhapsod") +
    '"><div class="h">Maximo 30 caracteres</div></div>' +
    '<div class="f"><label>Contrasena <span class="ob">opcional</span></label><input id="iw" type="password" placeholder="Si el servidor tiene contrasena"></div>' +
    '<div id="tt" class="tr"></div>' +
    '<div class="a"><button class="b bs" onclick="prev()">Atras</button><button class="b bp" onclick="testTs3()">Probar y siguiente</button></div>'
  );
}

function rC() {
  var useId = vals.RHAPSOD_TS3_CHANNEL_ID ? "block" : "none";
  return (
    '<h1>Canal</h1><p class="sub">A que canal debe unirse el bot</p>' +
    '<div class="f"><label>Nombre del canal</label><input id="ic" placeholder="Musica" value="' +
    (vals.RHAPSOD_TS3_CHANNEL_NAME || "") +
    '"><div class="h">El bot buscara este canal al conectarse</div></div>' +
    '<div class="f"><label style="display:flex;align-items:center;gap:.5rem"><input type="checkbox" id="iu"' +
    (vals.RHAPSOD_TS3_CHANNEL_ID ? " checked" : "") +
    "> Usar ID del canal en vez de nombre</label></div>" +
    '<div class="f" id="fid" style="display:' +
    useId +
    '"><label>Channel ID</label><input id="icid" type="number" placeholder="110" value="' +
    (vals.RHAPSOD_TS3_CHANNEL_ID || "") +
    '"><div class="h">Lo podes encontrar en el cliente TS3</div></div>' +
    '<div class="f"><label>Contrasena del canal <span class="ob">opcional</span></label><input id="icp" type="password" placeholder="Si el canal tiene contrasena"></div>' +
    '<div class="a"><button class="b bs" onclick="prev()">Atras</button><button class="b bp" onclick="next()">Siguiente</button></div>'
  );
}

function rA() {
  var br = vals.RHAPSOD_OPUS_BITRATE || "128000";
  return (
    '<h1>Audio</h1><p class="sub">Configuracion de calidad de audio</p>' +
    '<div class="f"><label>Bitrate (kbps)</label><select id="ibr"><option value="64000"' +
    (br === "64000" ? " selected" : "") +
    '>64 kbps</option><option value="96000"' +
    (br === "96000" ? " selected" : "") +
    '>96 kbps</option><option value="128000"' +
    (br === "128000" ? " selected" : "") +
    '>128 kbps (default)</option></select><div class="h">Mas alto = mejor calidad, mas ancho de banda</div></div>' +
    '<div class="f"><label>Volumen normalizado (LUFS)</label><input id="il" type="number" min="-30" max="0" step="1" placeholder="-14" value="' +
    (vals.RHAPSOD_LOUDNESS_TARGET_LUFS || "-14") +
    '"><div class="h">-14 es estandar de streaming. -16 es mas conservador.</div></div>' +
    '<div class="f"><label>Modo verbose</label><select id="iv"><option value="false"' +
    (vals.RHAPSOD_VERBOSE !== "true" ? " selected" : "") +
    '>No (minimalista)</option><option value="true"' +
    (vals.RHAPSOD_VERBOSE === "true" ? " selected" : "") +
    '>Si (mensajes detallados)</option></select><div class="h">Verbose muestra mensajes de progreso</div></div>' +
    '<div class="a"><button class="b bs" onclick="prev()">Atras</button><button class="b bp" onclick="next()">Siguiente</button></div>'
  );
}

function rY() {
  setTimeout(checkYt, 50);
  var st =
    yt.ok === true
      ? '<div class="tr ok">YouTube OK' +
        (yt.ms ? " (" + yt.ms + " ms)" : "") +
        "</div>"
      : yt.ok === false
        ? '<div class="tr fl">Fallo: ' +
          escJs(yt.err || "desconocido") +
          "</div>"
        : '<div class="tr ld">Probando YouTube...</div>';
  return (
    '<h1>YouTube</h1><p class="sub">Sin esto el bot no reproduce musica de YouTube</p>' +
    '<div id="yh">' +
    st +
    "</div>" +
    '<div class="f"><label>Cookies de YouTube (cookies.txt) <span class="ob">recomendado</span></label><textarea id="ick2" rows="4" style="width:100%;padding:.6rem .8rem;background:#0b0b0d;border:1px solid #2b2b30;border-radius:6px;color:var(--tx);font-size:.8rem" placeholder="Pega aca el contenido de tu cookies.txt"></textarea><div class="h">En tu navegador: extension Get cookies.txt LOCALLY, exportar estando logueado en youtube.com, pegar el contenido</div></div>' +
    '<div id="yts" class="tr"></div>' +
    '<div class="a"><button class="b bs" onclick="prev()">Atras</button><button class="b bs" onclick="saveCookies()">Guardar cookies</button><button class="b bp" onclick="next()">Siguiente</button></div>'
  );
}

function escJs(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function checkYt() {
  var el = document.getElementById("yh");
  if (!el) return;
  el.innerHTML = '<div class="tr ld">Probando YouTube...</div>';
  fetch("/api/youtube-health", { headers: H })
    .then(function (r) {
      return r.json();
    })
    .then(function (d) {
      if (d.ok) {
        yt.ok = true;
        yt.ms = d.ms;
        el.innerHTML = '<div class="tr ok">YouTube OK (' + d.ms + " ms)</div>";
      } else {
        yt.ok = false;
        yt.err = d.error;
        el.innerHTML =
          '<div class="tr fl">Fallo: ' +
          escJs(d.error || "desconocido") +
          ". Pega tus cookies abajo y proba de nuevo.</div>";
      }
    })
    .catch(function (e) {
      yt.ok = false;
      yt.err = e.message;
      el.innerHTML =
        '<div class="tr fl">No se pudo probar: ' + escJs(e.message) + "</div>";
    });
}

function saveCookies() {
  var t = /** @type {HTMLTextAreaElement|null} */ (
    document.getElementById("ick2")
  );
  var body = t ? t.value.trim() : "";
  if (!body) {
    toast("Pega el contenido de cookies.txt primero");
    return;
  }
  var el = document.getElementById("yts");
  el.className = "tr ld";
  el.textContent = "Guardando...";
  fetch("/api/cookies", {
    method: "PUT",
    headers: Object.assign({}, H, { "content-type": "application/json" }),
    body: JSON.stringify({ content: body }),
  })
    .then(function (r) {
      return r.json();
    })
    .then(function (d) {
      if (d.ok) {
        el.className = "tr ok";
        el.textContent = "Cookies guardadas. Probando de nuevo...";
        vals.RHAPSOD_YTDLP_COOKIES_PATH = d.path;
        checkYt();
      } else {
        el.className = "tr fl";
        el.textContent = "Error: " + (d.error || "desconocido");
      }
    })
    .catch(function (e) {
      el.className = "tr fl";
      el.textContent = "No se pudo guardar: " + e.message;
    });
}

function rO() {
  return (
    '<h1>Opcional</h1><p class="sub">Funciones adicionales</p>' +
    '<div class="f"><label>Spotify Client ID <span class="ob">opcional</span></label><input id="isi" placeholder="Para playlists de Spotify" value="' +
    (vals.RHAPSOD_SPOTIFY_CLIENT_ID || "") +
    '"></div>' +
    '<div class="f"><label>Spotify Client Secret <span class="ob">opcional</span></label><input id="iss" type="password" placeholder="Client Secret" value="' +
    (vals.RHAPSOD_SPOTIFY_CLIENT_SECRET || "") +
    '"></div>' +
    '<div class="dv"></div>' +
    '<div class="f"><label>Cookies de YouTube <span class="ob">opcional</span></label><input id="ick" placeholder="Ruta al archivo cookies.txt" value="' +
    (vals.RHAPSOD_YTDLP_COOKIES_PATH || "") +
    '"><div class="h">Para evitar limitaciones de rate-limit</div></div>' +
    '<div class="f"><label>yt-dlp Daemon URL <span class="ob">opcional</span></label><input id="ida" placeholder="http://127.0.0.1:8765" value="' +
    (vals.RHAPSOD_YTDLP_DAEMON_URL || "") +
    '"><div class="h">Para resolucion mas rapida de URLs</div></div>' +
    '<div class="dv"></div>' +
    '<p class="h">Para hacerte admin, escribí <code>!claim &lt;código&gt;</code> en el chat de TeamSpeak cuando el bot se conecte. El código está en el log del bot.</p>' +
    "<details" +
    (vals.RHAPSOD_ADMIN_UIDS ? " open" : "") +
    '><summary class="h">Avanzado: cargar UIDs de admin a mano</summary>' +
    '<div class="f"><label>UIDs de admin <span class="ob">opcional</span></label><input id="iua" placeholder="uid1,uid2,uid3" value="' +
    (vals.RHAPSOD_ADMIN_UIDS || "") +
    '"><div class="h">Separados por coma. Dan acceso a !move, !diag, etc.</div></div></details>' +
    '<div class="a"><button class="b bs" onclick="prev()">Atras</button><button class="b bp" onclick="next()">Siguiente</button></div>'
  );
}

function rR() {
  var rows = [
    ["Servidor TS3", vals.RHAPSOD_TS3_HOST || "(no seteado)"],
    ["Puerto", vals.RHAPSOD_TS3_PORT || "9987"],
    ["Nombre", vals.RHAPSOD_TS3_NICKNAME || "Rhapsod"],
    [
      "Canal",
      vals.RHAPSOD_TS3_CHANNEL_NAME ||
        vals.RHAPSOD_TS3_CHANNEL_ID ||
        "(default)",
    ],
    ["Bitrate", (vals.RHAPSOD_OPUS_BITRATE || "128000") / 1000 + " kbps"],
    ["Normalizacion", (vals.RHAPSOD_LOUDNESS_TARGET_LUFS || "-14") + " LUFS"],
    ["Spotify", vals.RHAPSOD_SPOTIFY_CLIENT_ID ? "Configurado" : "No"],
    [
      "YouTube",
      yt.ok === true
        ? "OK"
        : yt.ok === false
          ? "Falla (ver paso YouTube)"
          : "Sin probar",
    ],
    ["Cookies", vals.RHAPSOD_YTDLP_COOKIES_PATH ? "Configurado" : "No"],
    ["Daemon", vals.RHAPSOD_YTDLP_DAEMON_URL ? "Configurado" : "No"],
    ["Admins", vals.RHAPSOD_ADMIN_UIDS || "Con !claim en TeamSpeak"],
  ];
  var h =
    '<h1>Resumen</h1><p class="sub">Revisa la configuracion antes de guardar</p>';
  for (var i = 0; i < rows.length; i++) {
    h +=
      '<div style="display:flex;justify-content:space-between;padding:.4rem 0;border-bottom:1px solid #2b2b30;font-size:.85rem"><span style="color:var(--dm)">' +
      rows[i][0] +
      "</span><span>" +
      rows[i][1] +
      "</span></div>";
  }
  h +=
    '<div class="a"><button class="b bs" onclick="prev()">Atras</button><button class="b bp" onclick="save()">Guardar y reiniciar</button></div>';
  return h;
}

function bind() {
  var c = document.getElementById("iu");
  if (c)
    c.onchange = function () {
      document.getElementById("fid").style.display =
        /** @type {HTMLInputElement} */ (this).checked ? "block" : "none";
    };
}

// Each step renders only its own fields. Reading a missing field as ""
// blanked what earlier steps collected (the host was gone by the review),
// so a key is only updated when its field is on screen.
function g(id) {
  var e = /** @type {HTMLInputElement|null} */ (document.getElementById(id));
  return e ? e.value.trim() : undefined;
}
function setField(key, id, fallback) {
  var value = g(id);
  if (value !== undefined) vals[key] = value || fallback || "";
}
function setIfFilled(key, id) {
  var value = g(id);
  if (value) vals[key] = value;
}
function collect() {
  setField("RHAPSOD_TS3_HOST", "ih");
  setField("RHAPSOD_TS3_PORT", "ip", "9987");
  setField("RHAPSOD_TS3_NICKNAME", "in", "Rhapsod");
  setIfFilled("RHAPSOD_TS3_PASSWORD", "iw");
  setField("RHAPSOD_TS3_CHANNEL_NAME", "ic");
  setIfFilled("RHAPSOD_TS3_CHANNEL_ID", "icid");
  setIfFilled("RHAPSOD_TS3_CHANNEL_PASSWORD", "icp");
  setField("RHAPSOD_OPUS_BITRATE", "ibr", "128000");
  setField("RHAPSOD_LOUDNESS_TARGET_LUFS", "il", "-14");
  setField("RHAPSOD_VERBOSE", "iv", "false");
  setIfFilled("RHAPSOD_SPOTIFY_CLIENT_ID", "isi");
  setIfFilled("RHAPSOD_SPOTIFY_CLIENT_SECRET", "iss");
  setIfFilled("RHAPSOD_YTDLP_COOKIES_PATH", "ick");
  setIfFilled("RHAPSOD_YTDLP_DAEMON_URL", "ida");
  setIfFilled("RHAPSOD_ADMIN_UIDS", "iua");
}

function next() {
  collect();
  if (cur < S.length - 1) {
    cur++;
    render();
  }
}
function prev() {
  collect();
  if (cur > 0) {
    cur--;
    render();
  }
}

function testTs3() {
  collect();
  if (!vals.RHAPSOD_TS3_HOST) {
    document.getElementById("fh").classList.add("i");
    return;
  }
  var el = document.getElementById("tt");
  el.className = "tr ld";
  el.textContent = "Probando conexion...";
  el.style.display = "block";
  fetch("/api/test-connection", {
    method: "POST",
    headers: Object.assign({}, H, { "content-type": "application/json" }),
    body: JSON.stringify(vals),
  })
    .then(function (r) {
      return r.json();
    })
    .then(function (d) {
      if (d.ok) {
        el.className = "tr ok";
        el.textContent = "Conexion exitosa: " + d.serverName;
        next();
      } else {
        testFailed(el, "Error: " + d.error);
      }
    })
    .catch(function (e) {
      testFailed(el, "No se pudo probar: " + e.message);
    });
}

// The probe can fail for reasons that do not stop the bot (a firewall on
// the panel host, ICMP filtering), so a failed test offers to go on.
function testFailed(el, message) {
  el.className = "tr fl";
  el.innerHTML =
    escJs(message) +
    ' <button class="b bs" onclick="next()">Continuar sin probar</button>';
}

function save() {
  collect();
  // Completing the wizard with a real host re-enables auto-connect: the
  // installer ships AUTO_CONNECT=false so the bot boots panel-only for
  // this wizard. Saving without a host leaves that untouched.
  if (vals.RHAPSOD_TS3_HOST) vals.RHAPSOD_TS3_AUTO_CONNECT = "true";
  var btn = /** @type {HTMLButtonElement} */ (document.querySelector(".bp"));
  btn.disabled = true;
  btn.textContent = "Guardando...";
  fetch("/api/env", {
    method: "PUT",
    headers: Object.assign({}, H, { "content-type": "application/json" }),
    body: JSON.stringify(vals),
  })
    .then(function (r) {
      return r.json();
    })
    .then(function (d) {
      if (d.ok) {
        btn.textContent = "Reiniciando...";
        fetch("/api/restart", { method: "POST", headers: H });
        setTimeout(function () {
          window.location.href = "/";
        }, 3000);
      } else {
        btn.textContent = "Error al guardar";
        btn.disabled = false;
      }
    })
    .catch(function (e) {
      btn.textContent = "Error: " + e.message;
      btn.disabled = false;
    });
}

initAmbience();
render();
