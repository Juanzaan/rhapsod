import type { PanelStatus } from "./panel-server.js";
import {
  AMBIENCE_JS,
  DASHBOARD_CSS,
  songHue,
  AMBIENT_LAYER_HTML,
  SCENE_TOOLS_HTML,
} from "./dashboard-design.js";
import { PAGE_CSS } from "./page-design.js";
import { panelScript } from "./panel-scripts.js";

// Shared ON AIR console chrome: flat zinc backdrop, green signal accents,
// tabular mono readouts. Every page interpolates this so the whole
// panel looks like one instrument instead of four themes.
const CHROME_CSS = `
:root{--bg:#09090B;--pn:#101014;--ln:#1F1F23;--tx:#F4F4F5;--dm:#A1A1AA;--ft:#71717A;--ac:#1ED760;--wn:#FBBF24;--rd:#F87171;--bl:#60A5FA;--mn:ui-monospace,'SF Mono','Cascadia Mono',Menlo,Consolas,monospace}
*{margin:0;padding:0;box-sizing:border-box}
::selection{background:var(--ac);color:#05240F}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--tx);min-height:100vh}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
:focus-visible{outline:2px solid var(--bl);outline-offset:2px}
.nv{background:#0b0b0d;border-bottom:1px solid var(--ln);padding:0 1.5rem;display:flex;align-items:center;height:52px;gap:1.5rem;position:sticky;top:0;z-index:10}
.nb{font-weight:800;font-size:.9rem;letter-spacing:.35em;color:var(--tx);text-decoration:none}
.nb b{color:var(--ac);font-weight:800}
.nl{display:flex;gap:.25rem}
.nk{padding:.4rem .75rem;border-radius:6px;color:var(--dm);text-decoration:none;font-size:.85rem;transition:background .15s,color .15s}
.nk:hover,.nk.a{background:#1e1e22;color:var(--tx)}
.cd{background:var(--pn);border:1px solid var(--ln);border-radius:10px;padding:1.1rem 1.25rem}
.ct{font-size:.7rem;color:var(--dm);text-transform:uppercase;letter-spacing:.24em;margin-bottom:1rem}
.em{color:var(--ft);font-size:.85rem;text-align:center;padding:1rem}
.lk{color:var(--bl);text-decoration:none}
.toast{position:fixed;bottom:1.5rem;right:1.5rem;background:#0b0b0d;border:1px solid var(--ln);border-left:3px solid var(--ac);color:var(--tx);padding:.75rem 1rem;border-radius:8px;font-size:.85rem;opacity:0;transform:translateY(8px);transition:opacity .25s,transform .25s;pointer-events:none;z-index:99;max-width:min(420px,90vw)}
.toast.show{opacity:1;transform:none}
.chrow{border:1px solid var(--ln);border-radius:10px;padding:.7rem .9rem;margin-bottom:.5rem;background:#0f0f12;cursor:pointer;transition:border-color .15s,transform .15s}
.chrow:hover{border-color:var(--ac)}
.chrow:active{transform:translateY(1px)}
.chrow.here{border-color:var(--ac);background:#141207}
.chhead{display:flex;align-items:center;gap:.6rem}
.chnm{font-weight:650;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.chct{font-family:var(--mn);font-size:.72rem;color:var(--dm)}
.botpill{font-family:var(--mn);font-size:.62rem;letter-spacing:.18em;background:var(--ac);color:#0b0b0d;border-radius:4px;padding:.15rem .45rem;font-weight:700}
.spacer{text-align:center;color:var(--ft);font-size:.72rem;letter-spacing:.3em;text-transform:uppercase;padding:.9rem 0 .4rem}
.users{margin:.5rem 0 0 1.2rem;padding:0;list-style:none}
.users li{font-size:.82rem;color:var(--dm);padding:.12rem 0;display:flex;gap:.45rem;align-items:center}
.users li::before{content:'';width:6px;height:6px;border-radius:50%;background:var(--bl);flex-shrink:0}
.kids{margin-left:.85rem;border-left:1px solid var(--ln);padding-left:.65rem;margin-top:.5rem}
.chev{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:4px;color:var(--ft);font-size:.75rem;flex-shrink:0;cursor:pointer}
.chev:hover{color:var(--tx);background:#1e1e22}
.chev.closed{transform:rotate(-90deg)}
.chev.leaf{visibility:hidden}
.channel-move{display:flex;align-items:center;gap:8px;flex:1;min-width:0;text-align:left;background:none;border:0;color:inherit;cursor:pointer}.channel-symbol{color:var(--ft)}
`;

// Shared server-tree renderer (dashboard card + server page): nested
// channels in TeamSpeak order, users, BOT pill. Spacers are decoration,
// never channels: a spacer with a label renders as a plain section header
// (no row, no move, no counts) and its subchannels move up to the
// spacer's parent; line spacers render nothing. opts.interactive adds
// collapse chevrons + click-move.
const SERVER_TREE_JS = panelScript("server-tree");

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderSetupWizard(): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Rhapsod - Configuracion</title>
  <style>${CHROME_CSS}
    body{min-height:100vh;display:flex;align-items:center;justify-content:center}
    .w{background:var(--pn);border:1px solid var(--ln);border-radius:12px;padding:2rem;width:100%;max-width:520px;box-shadow:0 25px 50px -12px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,.04)}
    .p{display:flex;gap:4px;margin-bottom:1.5rem}
    .p .s{flex:1;height:3px;background:#2b2b30;border-radius:2px}
    .p .s.d{background:var(--ac)}
    .p .s.c{background:var(--ac);animation:p 1.5s infinite}
    @keyframes p{0%,100%{opacity:1}50%{opacity:.5}}
    h1{font-size:1.5rem;margin-bottom:.5rem}
    .sub{color:var(--dm);margin-bottom:1.5rem;font-size:.9rem}
    .f{margin-bottom:1rem}
    .f label{display:block;font-size:.85rem;color:var(--dm);margin-bottom:.3rem}
    .f input,.f select{width:100%;padding:.6rem .8rem;background:#0b0b0d;border:1px solid var(--ln);border-radius:6px;color:var(--tx);font-size:.95rem}
    .f input:focus{outline:none;border-color:var(--ac)}
    .f .h{font-size:.75rem;color:var(--ft);margin-top:.2rem}
    .f .e{font-size:.75rem;color:var(--rd);margin-top:.2rem;display:none}
    .f.i .e{display:block}
    .f.i input{border-color:var(--rd)}
    .a{display:flex;gap:.75rem;margin-top:1.5rem}
    .b{flex:1;padding:.7rem;border:none;border-radius:6px;font-size:.95rem;font-weight:600;cursor:pointer}
    .bp{background:var(--ac);color:#0b0b0d}
    .bp:active{transform:translateY(1px)}
    .bs{background:#232327;color:var(--tx);border:1px solid #3a3a40}
    .b:disabled{opacity:.5;cursor:not-allowed}
    .sk{text-align:center;margin-top:.75rem}
    .sk a{color:var(--ft);font-size:.8rem;cursor:pointer;text-decoration:none}
    .tr{margin-top:.5rem;padding:.5rem .75rem;border-radius:6px;font-size:.8rem;display:none}
    .tr.ok{display:block;background:#0b1f14;color:var(--ac);border:1px solid #14532d}
    .tr.fl{display:block;background:#220d0d;color:var(--rd);border:1px solid #7f1d1d}
    .tr.ld{display:block;background:#0b0b0d;color:var(--dm);border:1px solid var(--ln)}
    .ob{display:inline-block;background:#0f0f12;color:var(--dm);border:1px solid var(--ln);font-size:.7rem;padding:.1rem .4rem;border-radius:4px;margin-left:.3rem}
    .wt{text-align:center;margin-bottom:1.5rem}
    .wt h1{font-size:1.8rem;margin-bottom:.5rem}
    .wt p{color:var(--dm);font-size:.9rem;line-height:1.5}
    .fe{display:flex;align-items:center;gap:.75rem;padding:.5rem 0}
    .fi{width:32px;height:32px;background:#0f0f12;border:1px solid var(--ln);border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:1rem;flex-shrink:0}
    .fi .fn{font-family:var(--mn);font-size:.7rem;font-weight:700;color:var(--ac);letter-spacing:.05em}
    .ft{font-size:.85rem}
    .ft strong{color:var(--tx)}
    .ft span{color:var(--dm)}
    .dv{height:1px;background:var(--ln);margin:1rem 0}
    ${PAGE_CSS}
  </style>
</head>
<body class="setup-page">
  ${AMBIENT_LAYER_HTML}
  <nav class="nv"><a class="nb" href="/">RHAPSOD<b>.</b></a><div class="nl"><a class="nk" href="/">Consola</a><a class="nk" href="/server">Servidor</a><a class="nk" href="/settings">Config</a><a class="nk" href="/commands">Comandos</a></div><div class="nr">${SCENE_TOOLS_HTML}</div></nav>
  <main class="setup-shell"><section class="setup-story"><div class="setup-art" aria-hidden="true"><span>r.</span></div><div class="eyebrow">Tu próximo espacio de escucha</div><h1>Conectá.<br>Elegí un tema.<br>Compartilo.</h1><p>Prepará tu servidor, ajustá el sonido y dejá todo listo para escuchar en compañía.</p></section><div class="w" id="w"></div></main>
  <script>
${AMBIENCE_JS}
${panelScript("setup")}  </script>
</body>
</html>`;
}

export function renderDashboard(status: PanelStatus): string {
  const connected = status.connected;
  const title = esc(status.currentTitle || "Tu próxima canción empieza acá.");
  const channel = status.currentChannelId || "-";
  const queueLen = status.queueLength;
  const playerState = status.playerState || "idle";
  const lampClass =
    playerState === "playing" ? "on" : playerState === "idle" ? "" : "buf";
  const stateLabel =
    playerState === "playing"
      ? "PLAYING"
      : playerState === "paused"
        ? "PAUSED"
        : playerState === "buffering"
          ? "BUFFERING"
          : "STANDBY";
  const fmtT = (ms: number | undefined): string => {
    if (ms === undefined || !Number.isFinite(ms) || ms < 0) return "--:--";
    const s = Math.floor(ms / 1000);
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  };
  const timeCur = fmtT(status.positionMs);
  const timeDur = fmtT(status.durationMs);
  const ppIcon = playerState === "playing" ? "&#9208;" : "&#9654;";
  const volInit = status.volume ?? 50;
  const fmtUp = (ms: number | undefined): string => {
    if (ms === undefined) return "";
    const m = Math.floor(ms / 60000);
    if (m < 60) return m + " min";
    const h = Math.floor(m / 60);
    return h < 48 ? h + " h" : Math.floor(h / 24) + " d";
  };
  const uptimeInit = fmtUp(status.uptimeMs);
  const tracksInit = status.tracksPlayed ?? 0;
  const version = esc(status.version);
  const hue = songHue(status.currentTitle);
  return `<!DOCTYPE html>
<html lang="es" style="--song-h:${hue}" data-live="${playerState === "playing"}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Rhapsod</title>
  <style>${CHROME_CSS}
    .nr{margin-left:auto;display:flex;align-items:center;gap:.6rem}
    .lamp{font-family:var(--mn);font-size:.62rem;letter-spacing:.22em;padding:.32rem .6rem;border:1px solid #3a3a40;border-radius:4px;color:var(--ft);white-space:nowrap}
    .lamp.on{color:#05240F;background:var(--ac);border-color:var(--ac);box-shadow:0 0 12px rgba(30,215,96,.35)}
    .lamp.buf{color:var(--wn);border-color:var(--wn);animation:blk 1s steps(2) infinite}
    @keyframes blk{50%{opacity:.3}}
    .dot{width:8px;height:8px;border-radius:50%}
    .dot.on{background:var(--ac)}
    .dot.off{background:var(--rd)}
    .st{font-size:.8rem;color:var(--dm)}
    .mn{max-width:980px;margin:0 auto;padding:1.5rem}
    .g{display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem}
    @media(max-width:680px){.g{grid-template-columns:1fr}}
    .fw{grid-column:1/-1}
    .ct{display:flex;justify-content:space-between;align-items:center}
    .ct .rv{color:var(--ft);letter-spacing:.05em;text-transform:none}
    .deck{background:#0b0b0d;border:1px solid var(--ln);border-radius:8px;padding:1rem 1.1rem;margin-bottom:1rem;box-shadow:inset 0 2px 10px rgba(0,0,0,.65)}
    .nt{font-size:1.5rem;font-weight:650;letter-spacing:-.01em;margin-bottom:.25rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .ns{font-family:var(--mn);font-size:.72rem;letter-spacing:.25em;color:var(--ac);margin-bottom:.75rem;min-height:1rem}
    .tm{display:flex;justify-content:space-between;font-family:var(--mn);font-size:.8rem;color:var(--ac);margin:.45rem 0 1rem;font-variant-numeric:tabular-nums}
    .tm .tt{color:var(--ft)}
    .sk{height:14px;background:#0a0a0c;border:1px solid var(--ln);border-radius:7px;cursor:pointer;position:relative;overflow:hidden}
    .skf{position:absolute;top:0;bottom:0;left:0;width:0%;background:var(--ac)}
    .sk.live .skf{background:repeating-linear-gradient(115deg,var(--ac) 0 8px,#15803D 8px 16px);animation:mv 1s linear infinite}
    @keyframes mv{to{background-position:18px 0}}
    .tp{display:flex;gap:.6rem;align-items:center;flex-wrap:wrap}
    .tb{width:54px;height:54px;border-radius:12px;background:#232327;border:1px solid #3a3a40;color:var(--tx);font-size:1.2rem;cursor:pointer;box-shadow:0 3px 0 #000;display:flex;align-items:center;justify-content:center}
    .tb:active{transform:translateY(2px);box-shadow:none}
    .tb.main{width:66px;height:66px;background:var(--ac);border-color:var(--ac);color:#0b0b0d;font-size:1.5rem}
    .tb.dng{border-color:#5a2320;color:var(--rd)}
    .vg{display:flex;align-items:center;gap:.6rem;margin-left:auto}
    .vg .vv{font-family:var(--mn);font-size:.8rem;color:var(--ac);min-width:44px;text-align:right;font-variant-numeric:tabular-nums}
    .vg input[type=range]{width:110px;accent-color:var(--ac);-webkit-appearance:none;appearance:none;height:4px;border-radius:2px;background:#2b2b30;outline-offset:4px}
    .vg input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:14px;height:14px;border-radius:50%;background:var(--ac);border:2px solid #0b0b0d;box-shadow:0 0 0 1px var(--ac);cursor:pointer}
    .vg input[type=range]::-moz-range-thumb{width:12px;height:12px;border-radius:50%;background:var(--ac);border:2px solid #0b0b0d;box-shadow:0 0 0 1px var(--ac);cursor:pointer}
    .vg input[type=range]::-moz-range-track{height:4px;border-radius:2px;background:#2b2b30}
    .ql::-webkit-scrollbar,.dw::-webkit-scrollbar{width:8px}
    .ql::-webkit-scrollbar-thumb,.dw::-webkit-scrollbar-thumb{background:#2b2b30;border-radius:4px}
    .ql::-webkit-scrollbar-track,.dw::-webkit-scrollbar-track{background:transparent}
    .sg{display:flex;border:1px solid #3a3a40;border-radius:8px;overflow:hidden}
    .sg button{flex:1;background:transparent;border:none;color:var(--dm);padding:.55rem .2rem;font-size:.72rem;letter-spacing:.12em;cursor:pointer}
    .sg button.on{background:var(--ac);color:#0b0b0d;font-weight:700}
    .ql{list-style:none;max-height:230px;overflow-y:auto}
    .qi{padding:.45rem 0;border-bottom:1px solid #232327;font-size:.85rem;display:flex;gap:.6rem;align-items:center}
    .qi:last-child{border-bottom:none}
    .qn{font-family:var(--mn);color:var(--ft);min-width:24px;font-size:.75rem}
    .qt{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
    .qr{color:var(--bl);font-size:.72rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:120px;flex-shrink:0}
    .qx{background:none;border:1px solid #3a3a40;color:var(--dm);border-radius:6px;width:26px;height:26px;cursor:pointer;font-size:.8rem;line-height:1;flex-shrink:0}
    .qx:hover{color:var(--rd);border-color:var(--rd)}
    .cnm{color:var(--bl);font-weight:600;white-space:nowrap;flex-shrink:0}
    .cmB{color:var(--ac);font-weight:600;white-space:nowrap;flex-shrink:0}
    .cmt{flex:1;word-break:break-word;white-space:pre-wrap;min-width:0}
    .ir{display:flex;gap:.5rem;margin-bottom:.6rem}
    .ir input{flex:1;padding:.6rem .8rem;background:#0b0b0d;border:1px solid var(--ln);border-radius:6px;color:var(--tx);font-size:.9rem;min-width:0}
    .ir input:focus{outline:none;border-color:var(--ac)}
    .go{padding:.6rem 1rem;background:var(--ac);color:#0b0b0d;border:none;border-radius:6px;font-weight:700;cursor:pointer;white-space:nowrap}
    .go:active{transform:translateY(1px)}
    .nx{display:flex;align-items:center;gap:.5rem;font-size:.8rem;color:var(--dm)}
    .nx input{accent-color:var(--ac);width:16px;height:16px}
    .sg3{display:grid;grid-template-columns:repeat(3,1fr);gap:.5rem}
    .stt{background:#0b0b0d;border:1px solid var(--ln);border-radius:8px;padding:.7rem .4rem;text-align:center}
    .sv{font-family:var(--mn);font-size:1.25rem;color:var(--tx);font-variant-numeric:tabular-nums}
    .sv.am{color:var(--ac)}
    .sl{font-size:.62rem;color:var(--dm);text-transform:uppercase;letter-spacing:.15em;margin-top:.25rem}
    .dw{background:#0a0a0c;border:1px solid var(--ln);border-radius:8px;padding:1rem;font-family:var(--mn);font-size:.78rem;line-height:1.5;white-space:pre-wrap;word-break:break-word;max-height:280px;overflow-y:auto;display:none;color:#c9c9ce}
    .dw.open{display:block}
    .dwb{display:flex;justify-content:flex-end;margin-bottom:.5rem}
    .fc{display:flex;gap:.4rem;flex-wrap:wrap;margin-bottom:.75rem}
    .fc:last-child{margin-bottom:0}
    .ch{padding:.32rem .65rem;border-radius:6px;font-size:.75rem;background:#0f0f12;color:var(--dm);border:1px solid var(--ln);cursor:pointer}
    .ch:hover{color:var(--tx);border-color:#3a3a40}
    ${DASHBOARD_CSS}
  </style>
</head>
<body>
  ${AMBIENT_LAYER_HTML}
  <nav class="nv">
    <div class="nb">RHAPSOD<b>.</b></div>
    <div class="nl">
      <a class="nk a" href="/" id="nd">Consola</a>
      <a class="nk" href="/server" id="nv2">Servidor</a>
      <a class="nk" href="/settings" id="ns">Config</a>
      <a class="nk" href="/commands" id="nc">Comandos</a>
    </div>
    <div class="nr">
      <div class="lamp ${lampClass}" id="lamp">ON AIR</div>
      <div class="dot ${connected ? "on" : "off"}" id="dot"></div>
      <span class="st" id="stxt">${connected ? "Conectado" : "Desconectado"}</span>
    </div>
  </nav>
  <main class="mn">
    <header class="page-intro">
      <div><div class="eyebrow">Tu espacio de escucha / TeamSpeak</div><h1>Buena música. <span>En compañía.</span></h1><p class="intro-note">La sesión, el sonido y tu canal. Todo en un lugar.</p></div>
      ${SCENE_TOOLS_HTML}
    </header>
    <div class="g">
      <div class="cd player-card" id="playerCard" data-playing="${playerState === "playing"}">
        <div class="ct"><span><span class="section-no">01 /</span> En reproducción</span><span class="rv" id="nc2">Canal ${channel}</span></div>
        <div class="deck">
          <div class="record-stage" aria-hidden="true"><div class="record" id="record"><div class="record-label"><b>r.</b>RHAPSOD</div></div><i class="shine"></i><div class="tonearm"><i class="arm"></i><i class="head"></i><i class="pivot"></i></div></div>
          <div class="ns-row"><div class="ns" id="nsState">${stateLabel}</div><span class="eq" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span></div>
          <div class="nt" id="nt">${title}</div>
          <div class="track-detail" id="trackDetail">${esc(status.currentArtist || "Elegí un tema y compartí el momento.")}</div>
          <div class="progress-block"><div class="sk" id="seek" role="slider" tabindex="0" aria-label="Posición de reproducción" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" title="Cambiar posición"><div class="skf" id="seekf"></div><span class="sk-tip" id="skTip" aria-hidden="true"></span></div>
          <div class="tm"><span id="tcur">${timeCur}</span><span class="tt" id="tdur">${timeDur}</span></div></div>
        </div>
        <div class="tp">
          <button class="tb" onclick="cmd('previous')" title="Anterior" aria-label="Anterior">&#9198;</button>
          <button class="tb main" id="ppBtn" onclick="togglePlay()" title="Pausar/Reanudar" aria-label="Pausar o reanudar">${ppIcon}</button>
          <button class="tb" onclick="cmd('skip')" title="Saltar" aria-label="Saltar">&#9197;</button>
          <button class="tb dng" onclick="cmd('stop')" title="Detener" aria-label="Detener">&#9724;</button>
          <div class="player-links"><button class="ch" onclick="showOut('lyrics')">Letra</button><button class="ch" onclick="showOut('history')">Historial</button></div>
          <div class="vg">
            <label class="volume-label" for="vol">VOLUMEN</label>
            <span class="vv" id="volv">${volInit}%</span>
            <input type="range" min="0" max="100" value="${volInit}" id="vol" style="--v:${volInit}">
          </div>
        </div>
      </div>
      <div class="cd request-card">
          <div class="ct"><label for="pi">¿Qué escuchamos?</label><span class="rv">Búsqueda o enlace</span></div>
        <div class="ir">
          <input id="pi" placeholder="Un artista, una canción o un enlace…" onkeydown="if(event.key==='Enter')play()">
          <button class="go" id="addTrack" onclick="play()">Agregar a la cola</button>
        </div>
          <label class="nx"><input type="checkbox" id="nxChk"> Poner como próxima</label>
      </div>
      <div class="cd queue-card">
        <div class="ct"><span><span class="section-no">02 /</span> A continuación</span><span class="rv" id="qc">${queueLen} pistas</span></div>
        <ul class="ql" id="ql"></ul>
        <div class="em" id="qe" style="display:${queueLen === 0 ? "block" : "none"}"><span class="empty-mark" aria-hidden="true">＋</span>Hay lugar para otro tema.<br>Agregá música para seguir la sesión.</div>
        <div class="queue-footer"><button class="ch" onclick="cmd('shuffle')">Mezclar cola</button><button class="ch" onclick="cmd('clear')">Vaciar cola</button></div>
      </div>
      <div class="cd sound-card">
        <div class="ct"><span><span class="section-no">03 /</span> Tu sonido</span></div>
        <div class="ct" style="margin-bottom:.5rem"><span style="letter-spacing:.1em">Loop</span></div>
        <div class="sg" id="loopSeg" style="margin-bottom:1rem">
          <button data-l="off" onclick="cmd('loop off')">SIN REPETIR</button><button data-l="track" onclick="cmd('loop track')">PISTA</button><button data-l="queue" onclick="cmd('loop queue')">COLA</button>
        </div>
        <div class="fc" style="margin-top:1rem">
          <button class="ch" onclick="cmd('shuffle')">Mezclar</button>
          <button class="ch" onclick="cmd('clear')">Vaciar</button>
          <button class="ch" onclick="cmd('test-tone')">Tono</button>
        </div>
        <div class="fc">
          <button class="ch" onclick="showOut('stats')">Info</button>
          <button class="ch" onclick="showOut('lyrics')">Letra</button>
          <button class="ch" onclick="showOut('history')">Historial</button>
        </div>
      </div>
      <div class="cd discovery-card">
        <div class="ct"><span><span class="section-no">04 /</span> Seguí descubriendo</span></div>
        <p class="helper">Dejá que la música siga cuando termine la cola.</p>
        <div class="sg"><button onclick="cmd('autoplay on')">ACTIVAR AUTOPLAY</button><button onclick="cmd('autoplay off')">DESACTIVAR</button></div>
        <div class="mini-label"><label for="radioQuery">Radio en directo</label></div>
        <div class="ir"><input id="radioQuery" placeholder="Nombre o género…" onkeydown="if(event.key==='Enter')tuneRadio()"><button class="go" id="radioTune" onclick="tuneRadio()">Sintonizar</button></div>
        <div class="mini-label">Biblioteca del bot</div>
        <div class="fc"><button class="ch" onclick="showOut('tops')">Más escuchados</button><button class="ch" onclick="showOut('playlist list')">Playlists</button><button class="ch" onclick="showOut('stats')">Estadísticas</button></div>
      </div>
      <div class="cd server-card">
        <div class="ct"><span>Tu servidor</span><span class="rv" id="srvCount"></span></div>
        <div id="srvTree"><div class="em">Conectando…</div></div>
      </div>
      <div class="cd chat-card">
          <div class="ct"><span>Chat del canal</span></div>
        <ul class="ql" id="chat" style="max-height:240px"></ul>
        <div class="em" id="chatEmpty">Sin mensajes todavía</div>
        <div class="ir" style="margin-top:.75rem;margin-bottom:0">
          <input id="chatIn" aria-label="Mensaje al canal" placeholder="Escribir como el bot..." onkeydown="if(event.key==='Enter')sendChat()">
          <button class="go" onclick="sendChat()">Enviar</button>
        </div>
      </div>
      <div class="cd system-card">
        <div class="ct"><span>Sistema</span><span class="rv" id="uptime">${uptimeInit}</span></div>
        <div class="sg3">
          <div class="stt"><div class="sv am" id="stTracks" data-v="0">${tracksInit}</div><div class="sl">Temas</div></div>
          <div class="stt"><div class="sv" id="stVer">${version}</div><div class="sl">Versión</div></div>
          <div class="stt"><div class="sv" id="ytRes">—</div><div class="sl">YouTube</div></div>
        </div>
        <div class="fc" style="margin-top:1rem;margin-bottom:0">
          <button class="ch" onclick="checkYt(true)">Probar YouTube</button>
        </div>
      </div>
      <div class="cd fw" id="dwCard" style="display:none">
        <div class="ct"><span>Salida</span><span class="rv"><a href="#" onclick="closeOut();return false;" class="lk">cerrar</a></span></div>
        <pre class="dw open" id="dw"></pre>
      </div>
      <div class="cd errors-card">
        <div class="ct"><span>Errores</span><span class="rv" id="ec">0 total</span></div>
        <div class="fc" id="ek"></div>
        <ul class="ql" id="el"></ul>
        <div class="em" id="ee">Sin errores registrados</div>
      </div>
    </div>
    <footer class="page-footer"><span>RHAPSOD / HECHO PARA ESCUCHAR JUNTOS</span><a href="/commands">Explorá todos los comandos ↗</a></footer>
  </main>
  <div class="toast" id="toast" role="status" aria-live="polite"></div>
  <script>${SERVER_TREE_JS}
    ${AMBIENCE_JS}
    var H={'content-type':'application/json'};
    var PP='idle',POS=0,DUR=0,volDrag=false,lastTracks=-1,lastQ='',lastE='',lastQLen=0,lastC='',lastS='',fails=0;
    var anchorPos=0,anchorAt=0,lastTitle=null,lastChatLen=-1;

    function fmtT(ms){
      if(ms==null||!isFinite(ms)||ms<0)return '--:--';
      var s=Math.floor(ms/1000);
      return Math.floor(s/60)+':'+('0'+(s%60)).slice(-2);
    }

    function esc(s){
      return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function cmd(c){
      fetch('/api/command',{method:'POST',headers:Object.assign({},H,{'content-type':'application/json'}),body:JSON.stringify({command:c})})
        .then(function(r){return r.json();})
        .then(function(d){toast(d.ok?(d.response||'OK'):'Error: '+(d.error||'desconocido'));if(d.ok)setTimeout(refresh,500);})
        .catch(function(){toast('Error de conexion');});
    }

    function run(c){
      return fetch('/api/command',{method:'POST',headers:Object.assign({},H,{'content-type':'application/json'}),body:JSON.stringify({command:c})})
        .then(function(r){return r.json();})
        .then(function(d){if(!d.ok)throw new Error(d.error||'desconocido');return d.response||'OK';});
    }

    function play(){
      var el=document.getElementById('pi');
      var q=el.value.trim();
      if(!q)return;
      var button=document.getElementById('addTrack');
      if(button.disabled)return;
      button.disabled=true;button.textContent='Agregando…';
      var nx=document.getElementById('nxChk');
      run(((nx&&nx.checked)?'playnext ':'play ')+q).then(function(message){
        if(el.value.trim()===q)el.value='';
        toast(message);refresh();
      }).catch(function(error){toast('Error: '+error.message);}).finally(function(){button.disabled=false;button.textContent='Agregar a la cola';});
    }

    function tuneRadio(){
      var el=document.getElementById('radioQuery');
      var query=el.value.trim();
      var button=document.getElementById('radioTune');
      if(!query||button.disabled)return;
      button.disabled=true;
      run('radio '+query).then(function(message){toast(message);refresh();}).catch(function(error){toast('Error: '+error.message);}).finally(function(){button.disabled=false;});
    }

    function togglePlay(){
      cmd((PP==='playing'||PP==='buffering')?'pause':'resume');
    }

    function rmQ(n,button){
      var row=button&&button.closest?button.closest('.qi'):null;
      var exit=row?fx(row,[{opacity:1,transform:'none'},{opacity:0,transform:'translateX(28px)'}],{duration:260,easing:'ease-in',fill:'forwards'}):null;
      // A refused removal (someone else's track) must bring the row back,
      // and a successful one redraws the list so no faded row lingers.
      run('remove '+n).then(function(message){toast(message);lastQ='';refresh();})
        .catch(function(error){if(exit)exit.cancel();toast('Error: '+error.message);});
    }

    function paintVolume(value){
      document.getElementById('volv').textContent=value+'%';
      var vol=document.getElementById('vol');
      if(vol.style&&vol.style.setProperty)vol.style.setProperty('--v',String(value));
    }

    function moveBot(cid){
      fetch('/api/move',{method:'POST',headers:Object.assign({},H,{'content-type':'application/json'}),body:JSON.stringify({cid:cid})})
        .then(function(r){return r.json();})
        .then(function(d){toast(d.ok?'Bot en movimiento':'Error: '+(d.error||'desconocido'));if(d.ok)setTimeout(refresh,800);})
        .catch(function(){toast('Error de conexion');});
    }

    function renderServerCard(view){
      var box=document.getElementById('srvTree');
      if(!view||!view.channels||view.channels.length===0){
        box.innerHTML='<div class="em">Sin datos — ¿bot conectado?</div>';
        document.getElementById('srvCount').textContent='';
        return;
      }
      var built=serverTreeHtml(view,{interactive:false,collapsed:{}});
      var n=0;
      var cls=view.clients||[];
      for(var i=0;i<cls.length;i++){n++;}
      document.getElementById('srvCount').textContent=n+(n===1?' usuario':' usuarios');
      box.innerHTML=built.html;
    }

    function sendChat(){
      var el=document.getElementById('chatIn');
      var q=el.value.trim();
      if(!q)return;
      el.value='';
      fetch('/api/chat',{method:'POST',headers:Object.assign({},H,{'content-type':'application/json'}),body:JSON.stringify({text:q})})
        .then(function(r){return r.json();})
        .then(function(d){if(!d.ok)toast('Error: '+(d.error||'desconocido'));else setTimeout(refresh,500);})
        .catch(function(){toast('Error de conexion');});
    }

    function renderChat(msgs){
      var list=document.getElementById('chat');
      var empty=document.getElementById('chatEmpty');
      if(!msgs||msgs.length===0){list.innerHTML='';empty.style.display='block';return;}
      empty.style.display='none';
      var nearBottom=list.scrollHeight-list.scrollTop-list.clientHeight<60;
      var h='';
      for(var i=0;i<msgs.length;i++){
        var m=msgs[i];
        var who=m.outgoing?'BOT':(m.from||'?');
        var tint=m.outgoing?'':' style="color:hsl('+nameHue(who)+' 62% 76%)"';
        h+='<li class="qi"><span class="qn">'+esc(new Date(m.ts).toLocaleTimeString())+'</span><span class="'+(m.outgoing?'cmB':'cnm')+'"'+tint+'>'+esc(who)+'</span><span class="cmt">'+esc(m.text)+'</span></li>';
      }
      list.innerHTML=h;
      if(lastChatLen>=0&&msgs.length>lastChatLen&&list.children)fxRise(Array.prototype.slice.call(list.children,list.children.length-(msgs.length-lastChatLen)),60);
      lastChatLen=msgs.length;
      if(nearBottom)list.scrollTop=list.scrollHeight;
    }

    function seekEv(e){
      if(!DUR||DUR<=0)return;
      var bar=document.getElementById('seek');
      var r=bar.getBoundingClientRect();
      var x=(e.touches&&e.touches[0]?e.touches[0].clientX:e.clientX)-r.left;
      var ratio=Math.max(0,Math.min(1,x/r.width));
      var sec=Math.floor(ratio*DUR/1000);
      POS=ratio*DUR;anchorPos=POS;anchorAt=Date.now();
      paintTime();
      cmd('seek '+sec);
    }

    function showOut(c){
      var card=document.getElementById('dwCard');
      var pre=document.getElementById('dw');
      var wasOpen=card.style.display==='block';
      card.style.display='block';
      pre.textContent='...';
      card.scrollIntoView({block:'nearest'});
      if(!wasOpen)fx(card,[{opacity:0,transform:'translateY(14px) scale(.98)'},{opacity:1,transform:'none'}],{duration:420,easing:'cubic-bezier(.2,.8,.2,1)'});
      run(c).then(function(t){pre.textContent=t;}).catch(function(e){pre.textContent='Error: '+e.message;});
    }

    function closeOut(){
      document.getElementById('dwCard').style.display='none';
    }

    var toastTimer=0;
    function toast(m){
      var el=document.getElementById('toast');
      el.textContent=m;
      if(/^Error/.test(String(m)))el.classList.add('err');else el.classList.remove('err');
      el.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer=setTimeout(function(){el.classList.remove('show');},3200);
    }

    function nameHue(name){return hashHue(String(name||'?').toLowerCase());}

    function avatar(name){
      var n=String(name||'?');
      return '<span class="av" style="--h:'+nameHue(n)+'" aria-hidden="true">'+esc(n.charAt(0).toUpperCase())+'</span>';
    }

    function livePos(){
      return (PP==='playing'&&DUR>0)?Math.min(DUR,anchorPos+(Date.now()-anchorAt)):POS;
    }

    function paintBar(){
      if(DUR<=0)return;
      document.getElementById('seekf').style.width=Math.min(100,livePos()/DUR*100)+'%';
    }

    function setOffline(off){
      var root=document.documentElement;
      if(root&&root.setAttribute)root.setAttribute('data-offline',off?'true':'false');
    }

    function onTrackChange(title,first){
      setSongHue(title);
      if(first)return;
      var ease='cubic-bezier(.2,.8,.2,1)';
      fx(document.getElementById('nt'),[{opacity:0,transform:'translateY(18px)',filter:'blur(8px)'},{opacity:1,transform:'none',filter:'blur(0)'}],{duration:620,easing:ease});
      fx(document.getElementById('trackDetail'),[{opacity:0,transform:'translateY(10px)'},{opacity:1,transform:'none'}],{duration:620,delay:90,easing:ease,fill:'backwards'});
      fx(document.getElementById('record'),[{transform:'scale(.9)'},{transform:'scale(1.04)'},{transform:'scale(1)'}],{duration:700,easing:ease,composite:'add'});
    }

    function paintTime(){
      document.getElementById('tcur').textContent=fmtT(POS);
      document.getElementById('tdur').textContent=fmtT(DUR>0?DUR:undefined);
      var f=document.getElementById('seekf');
      var bar=document.getElementById('seek');
      bar.setAttribute('aria-valuenow',String(DUR>0?Math.min(100,Math.round(POS/DUR*100)):0));
      bar.setAttribute('aria-valuetext',DUR>0?fmtT(POS)+' de '+fmtT(DUR):'Sin duración disponible');
      bar.setAttribute('aria-disabled',String(DUR<=0));
      if(DUR>0){bar.classList.remove('live');f.style.width=Math.min(100,livePos()/DUR*100)+'%';}
      else if(PP==='playing'||PP==='buffering'){bar.classList.add('live');f.style.width='100%';}
      else{bar.classList.remove('live');f.style.width='0%';}
    }

    var lampState=null;
    function setLamp(state){
      var lamp=document.getElementById('lamp');
      if(lampState!==null&&lampState!==state)fx(document.getElementById('ppBtn'),[{transform:'scale(.78) rotate(-24deg)'},{transform:'none'}],{duration:420,easing:'cubic-bezier(.2,1.4,.4,1)'});
      lampState=state;
      var lab=document.getElementById('nsState');
      var pp=document.getElementById('ppBtn');
      document.getElementById('playerCard').setAttribute('data-playing',String(state==='playing'));
      setLive(state==='playing');
      pp.setAttribute('aria-label',(state==='playing'||state==='buffering')?'Pausar':'Reanudar');
      if(state==='playing'){lamp.className='lamp on';lab.textContent='PLAYING';pp.innerHTML='&#9208;';}
      else if(state==='buffering'){lamp.className='lamp buf';lab.textContent='BUFFERING';pp.innerHTML='&#9208;';}
      else if(state==='paused'){lamp.className='lamp';lab.textContent='PAUSED';pp.innerHTML='&#9654;';}
      else{lamp.className='lamp';lab.textContent='STANDBY';pp.innerHTML='&#9654;';}
    }

    function syncSeg(id,attr,val){
      var btns=document.getElementById(id).querySelectorAll('button');
      for(var i=0;i<btns.length;i++){
        var b=btns[i];
        if(b.getAttribute(attr)===val)b.classList.add('on');
        else b.classList.remove('on');
      }
    }

    function checkYt(manual){
      var el=document.getElementById('ytRes');
      if(manual){el.textContent='...';el.className='sv';}
      fetch('/api/youtube-health',{headers:H}).then(function(r){return r.json();}).then(function(d){
        if(d.ok){el.textContent='OK';el.className='sv am';}
        else{el.textContent='FALLA';el.className='sv';el.style.color='var(--rd)';}
      }).catch(function(){el.textContent='?';});
    }

    function refresh(){
      fetch('/api/state',{headers:H}).then(function(r){return r.json();}).then(function(d){
        fails=0;
        setOffline(false);
        PP=d.playerState||'idle';
        POS=(typeof d.positionMs==='number'&&d.positionMs>=0)?d.positionMs:0;
        DUR=(typeof d.durationMs==='number'&&d.durationMs>0)?d.durationMs:0;
        anchorPos=POS;anchorAt=Date.now();
        setLamp(PP);
        var titleNow=d.currentTitle||'';
        if(titleNow!==lastTitle){onTrackChange(titleNow,lastTitle===null);lastTitle=titleNow;}
        paintTime();
        document.getElementById('nt').textContent=d.currentTitle||'Tu próxima canción empieza acá.';
        document.getElementById('trackDetail').textContent=d.currentArtist||(d.currentTitle?'Una sesión para compartir.':'Elegí un tema y compartí el momento.');
        document.getElementById('nt').title=d.currentTitle||'';
        document.getElementById('nc2').textContent='Canal '+(d.currentChannelId||'-');
        fxCount(document.getElementById('qc'),d.queueLength,d.queueLength===1?' pista':' pistas');
        if(!volDrag&&typeof d.volume==='number'){
          document.getElementById('vol').value=d.volume;
          paintVolume(d.volume);
        }
        syncSeg('loopSeg','data-l',d.loopMode||'off');
        if(typeof d.tracksPlayed==='number'&&d.tracksPlayed!==lastTracks){
          lastTracks=d.tracksPlayed;
          fxCount(document.getElementById('stTracks'),d.tracksPlayed);
        }
        if(typeof d.uptimeMs==='number'){
          var m=Math.floor(d.uptimeMs/60000);
          var up=m<60?('up '+m+' min'):('up '+Math.floor(m/60)+' h');
          var dc=(d.disconnects&&typeof d.disconnects.count==='number')?d.disconnects.count:0;
          document.getElementById('uptime').textContent=dc>0?(up+' · '+dc+(dc===1?' corte':' cortes')):up;
        }
        var dot=document.getElementById('dot');
        var txt=document.getElementById('stxt');
        dot.className='dot '+(d.connected?'on':'off');
        txt.textContent=d.connected?'Conectado':'Desconectado';
        var qj=JSON.stringify(d.queue||[]);
        if(qj!==lastQ){
          lastQ=qj;
          var list=document.getElementById('ql');
          var empty=document.getElementById('qe');
          if(!d.queue||d.queue.length===0){list.innerHTML='';empty.style.display='block';}
          else{
          empty.style.display='none';
          var prevLen=lastQLen;
          var grew=d.queue.length>prevLen;
          lastQLen=d.queue.length;
          var h='';
          for(var i=0;i<d.queue.length;i++){
            var t=d.queue[i];
            var title=t.title||'Sin titulo';
            var by=t.requestedBy?' <span class="qr">'+avatar(t.requestedBy)+esc(t.requestedBy)+'</span>':'';
            h+='<li class="qi"><span class="qn">'+(i+1)+'</span><span class="qt" title="'+esc(title)+'">'+esc(title)+'</span>'+by+'<button class="qx" title="Quitar" aria-label="Quitar pista '+(i+1)+'" onclick="rmQ('+(i+1)+',this)">&times;</button></li>';
          }
          list.innerHTML=h;
          if(grew&&list.children)fxRise(Array.prototype.slice.call(list.children,prevLen),45);
          }
        }
        renderErrors(d.errors||{totalErrors:0,byCategory:{},recent:[]});
        var cj=JSON.stringify(d.chat||[]);
        if(cj!==lastC){lastC=cj;renderChat(d.chat||[]);}
        var sj=JSON.stringify(d.server||null);
        if(sj!==lastS){lastS=sj;renderServerCard(d.server);}
      }).catch(function(){
        // Never fail silently: a stalled tunnel or a waking VPS looks like a
        // dead page otherwise. The 5s poll keeps retrying on its own.
        fails++;
        if(fails>1){
          setOffline(true);
          var txt=document.getElementById('stxt');
          if(txt)txt.textContent='Reconectando…';
          var dotEl=document.getElementById('dot');
          if(dotEl)dotEl.className='dot off';
        }
      });
    }

    function renderErrors(e){
        var ej=JSON.stringify(e);
        if(ej===lastE)return;
        lastE=ej;
        var ec=document.getElementById('ec');
        ec.textContent=(e.totalErrors||0)+' total';
        ec.style.color=e.totalErrors>0?'var(--rd)':'';
        var k=document.getElementById('ek');
        var cats=e.byCategory||{};
        var names=Object.keys(cats);
        var kh='';
        for(var i=0;i<names.length;i++){var n=names[i];kh+='<span class="ch">'+esc(n)+' '+cats[n]+'</span>';}
        k.innerHTML=kh;
        var list=document.getElementById('el');
        var empty=document.getElementById('ee');
        var rec=e.recent||[];
        if(rec.length===0){list.innerHTML='';empty.style.display='block';return;}
        empty.style.display='none';
        var h='';
        for(var j=rec.length-1;j>=0;j--){
          var r2=rec[j];
          var t=new Date(r2.ts).toLocaleTimeString();
          var ti=r2.trackTitle||r2.trackId||'';
          h+='<li class="qi"><span class="qn">'+esc(t)+'</span><span class="qt" title="'+esc(r2.message)+'">['+esc(r2.category)+'] '+esc(ti)+' — '+esc(r2.message)+'</span></li>';
        }
        list.innerHTML=h;
    }

    (function init(){
      initAmbience();
      var seek=document.getElementById('seek');
      seek.addEventListener('click',seekEv);
      seek.addEventListener('keydown',function(event){
        if(DUR<=0)return;
        var next=POS;
        if(event.key==='ArrowRight'||event.key==='ArrowUp')next+=5000;
        else if(event.key==='ArrowLeft'||event.key==='ArrowDown')next-=5000;
        else if(event.key==='Home')next=0;
        else if(event.key==='End')next=DUR;
        else return;
        event.preventDefault();POS=Math.max(0,Math.min(DUR,next));anchorPos=POS;anchorAt=Date.now();paintTime();cmd('seek '+Math.floor(POS/1000));
      });
      var vol=document.getElementById('vol');
      vol.addEventListener('pointerdown',function(){volDrag=true;});
      window.addEventListener('pointerup',function(){volDrag=false;});
      vol.addEventListener('input',function(){paintVolume(vol.value);});
      vol.addEventListener('change',function(){
        paintVolume(vol.value);
        cmd('volume '+vol.value);
      });
      seek.addEventListener('pointermove',function(event){
        var tip=document.getElementById('skTip');
        if(DUR<=0||!seek.getBoundingClientRect){tip.textContent='';return;}
        var r=seek.getBoundingClientRect(),x=Math.max(0,Math.min(r.width,event.clientX-r.left));
        tip.style.left=x+'px';
        tip.textContent=fmtT(x/r.width*DUR);
      });
      function tick(){
        if(document.hidden)return;
        refresh();
      }
      refresh();
      setInterval(tick,5000);
      document.addEventListener('visibilitychange',function(){if(!document.hidden)refresh();});
      setInterval(function(){
        if(PP==='playing'&&DUR>0){POS=livePos();paintTime();}
      },1000);
      // The bar glides between one-second text updates; the text stays on
      // whole seconds so the readout never jitters.
      if(typeof requestAnimationFrame==='function'){
        var glide=function(){
          if(PP==='playing'&&!document.hidden&&motionOn())paintBar();
          requestAnimationFrame(glide);
        };
        requestAnimationFrame(glide);
      }
    })();
  </script>
</body>
</html>`;
}

export function renderSettingsPage(): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Rhapsod - Config</title>
  <style>${CHROME_CSS}
    .mn{max-width:640px;margin:0 auto;padding:1.5rem}
    .cd{margin-bottom:1rem}
    .f{margin-bottom:.75rem}
    .f label{display:block;font-size:.85rem;color:var(--dm);margin-bottom:.2rem}
    .f input{width:100%;padding:.5rem .7rem;background:#0b0b0d;border:1px solid var(--ln);border-radius:6px;color:var(--tx);font-size:.9rem}
    .f input:focus{outline:none;border-color:var(--ac)}
    .f .h{font-size:.75rem;color:var(--ft);margin-top:.15rem}
    .btn{padding:.6rem 1.5rem;background:var(--ac);color:#0b0b0d;border:none;border-radius:6px;font-weight:700;cursor:pointer;font-size:.9rem}
    .btn:active{transform:translateY(1px)}
    ${PAGE_CSS}
  </style>
</head>
<body>
  ${AMBIENT_LAYER_HTML}
  <nav class="nv">
    <div class="nb">RHAPSOD<b>.</b></div>
    <div class="nl">
      <a class="nk" href="/">Consola</a>
      <a class="nk" href="/server">Servidor</a>
      <a class="nk a" href="/settings">Config</a>
      <a class="nk" href="/commands">Comandos</a>
    </div>
  </nav>
  <main class="mn"><header class="page-heading"><div><div class="eyebrow">A tu manera / Configuración</div><h1>Los detalles hacen la sesión.</h1><p>Conexión, sonido y servicios. Los secretos sin modificar se conservan al guardar.</p></div><div class="page-tools">${SCENE_TOOLS_HTML}<a href="/setup">Abrir asistente ↗</a></div></header><div class="settings-grid" id="ct"><div class="cd"><div class="em">Cargando...</div></div></div></main>
  <div class="toast" id="toast"></div>
  <script>
${AMBIENCE_JS}
${panelScript("settings")}  </script>
</body>
</html>`;
}

export function renderCommandsPage(): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Rhapsod - Comandos</title>
  <style>${CHROME_CSS}
    .mn{max-width:640px;margin:0 auto;padding:1.5rem}
    .cd{margin-bottom:1rem}
    .sr{width:100%;padding:.6rem .8rem;background:#0b0b0d;border:1px solid var(--ln);border-radius:6px;color:var(--tx);font-size:.9rem;margin-bottom:1rem}
    .sr:focus{outline:none;border-color:var(--ac)}
    .ci{padding:.5rem 0;border-bottom:1px solid #232327}
    .ci:last-child{border-bottom:none}
    .cn{color:var(--ac);font-family:var(--mn);font-size:.9rem;font-weight:600}
    .ca{color:var(--ft);font-size:.8rem;font-family:var(--mn)}
    .cd2{color:var(--dm);font-size:.85rem;margin-top:.15rem}
    .cg{font-size:.65rem;background:#0f0f12;color:var(--dm);border:1px solid var(--ln);padding:.1rem .4rem;border-radius:4px;margin-left:.5rem;letter-spacing:.1em}
    ${PAGE_CSS}
  </style>
</head>
<body>
  ${AMBIENT_LAYER_HTML}
  <nav class="nv">
    <div class="nb">RHAPSOD<b>.</b></div>
    <div class="nl">
      <a class="nk" href="/">Consola</a>
      <a class="nk" href="/server">Servidor</a>
      <a class="nk" href="/settings">Config</a>
      <a class="nk a" href="/commands">Comandos</a>
    </div>
  </nav>
  <main class="mn"><header class="page-heading"><div><div class="eyebrow">La música bajo tu control</div><h1>Un comando. Otra posibilidad.</h1><p>Explorá reproducción, cola y herramientas del bot. Usá estos comandos en el chat de TeamSpeak.</p></div><div class="page-tools">${SCENE_TOOLS_HTML}<span class="command-count" id="commandCount"></span></div></header>
    <label class="field-label" for="sr">Buscar por nombre, alias o descripción</label><input class="sr" id="sr" placeholder="Probá con play, radio o playlist…" oninput="filter()">
    <div class="command-grid" id="ls"><div class="cd"><div class="em">Cargando comandos…</div></div></div>
  </main>
  <div class="toast" id="toast" role="status" aria-live="polite"></div>
  <script>
${AMBIENCE_JS}
${panelScript("commands")}  </script>
</body>
</html>`;
}

export function renderServerPage(): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Rhapsod - Servidor</title>
  <style>${CHROME_CSS}
    .mn{max-width:720px;margin:0 auto;padding:1.5rem}
    .liveb{font-family:var(--mn);font-size:.62rem;letter-spacing:.22em;padding:.32rem .6rem;border:1px solid #3a3a40;border-radius:4px;color:var(--ft);white-space:nowrap}
    .liveb.on{color:var(--ac);border-color:var(--ac)}
    .liveb.fb{color:var(--ac);border-color:var(--ac)}
    ${PAGE_CSS}
  </style>
</head>
<body>
  ${AMBIENT_LAYER_HTML}
  <nav class="nv">
    <div class="nb">RHAPSOD<b>.</b></div>
    <div class="nl">
      <a class="nk" href="/">Consola</a>
      <a class="nk a" href="/server">Servidor</a>
      <a class="nk" href="/settings">Config</a>
      <a class="nk" href="/commands">Comandos</a>
    </div>
    <div class="nr">
      <div class="liveb" id="live">···</div>
    </div>
  </nav>
  <main class="mn"><header class="page-heading"><div><div class="eyebrow">Tu comunidad / TeamSpeak</div><h1>Cada canal tiene su lugar.</h1><p>Explorá el servidor, encontrá a tus amigos y elegí dónde suena Rhapsod.</p></div><div class="page-tools">${SCENE_TOOLS_HTML}</div></header>
    <div class="server-metrics"><div class="metric"><strong id="channelCount">0</strong><span>Canales conocidos</span></div><div class="metric"><strong id="peopleCount">0</strong><span>Usuarios visibles</span></div><div class="metric"><strong id="emptyCount">0</strong><span>Sin usuarios visibles</span></div></div>
    <div class="server-layout"><div class="cd">
      <label class="field-label" for="channelSearch">Buscar un canal o usuario</label><div class="toolbar"><input class="sr" id="channelSearch" placeholder="Nombre del canal o usuario…" oninput="filterChannels()"><button class="btn secondary" onclick="expandChannels(true)">Expandir</button><button class="btn secondary" onclick="expandChannels(false)">Contraer</button></div>
      <div class="ct"><span>Canales</span><span class="rv" id="ucount"></span></div>
      <div id="tree"><div class="em">Conectando…</div></div>
      <div class="em" id="treeHint" style="font-size:.75rem">Click en un canal para mover el bot ahí</div>
    </div><aside class="cd server-side"><div class="ct">Visibilidad del servidor</div><p class="visibility-note" id="visibilityNote">Consultando los canales disponibles para la identidad del bot.</p><p>Los canales vacíos también aparecen cuando TeamSpeak entrega la lista completa. La visibilidad de usuarios puede depender de las suscripciones del bot.</p><p>El árbol completo se descubre en segundo plano al iniciar y cada diez minutos; una vista limitada significa que el análisis aún no termina o falló. No requiere permisos especiales.</p><button class="btn secondary" onclick="poll()">Actualizar vista</button></aside></div>
  </main>
  <div class="toast" id="toast"></div>
  <script>
${SERVER_TREE_JS}
${AMBIENCE_JS}
${panelScript("server")}  </script>
</body>
</html>`;
}
