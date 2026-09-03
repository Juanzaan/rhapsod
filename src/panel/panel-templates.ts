import type { PanelStatus } from "./panel-server.js";

// Shared ON AIR console chrome: dotted charcoal backdrop, amber signal
// accents, tabular mono readouts. Every page interpolates this so the whole
// panel looks like one instrument instead of four themes.
const CHROME_CSS = `
:root{--bg:#0E0E11;--pn:#16161A;--ln:#26262C;--tx:#EDEDE8;--dm:#9BA0A6;--ft:#5C5C64;--am:#FBBF24;--gn:#4ADE80;--rd:#F87171;--bl:#60A5FA;--mn:ui-monospace,'SF Mono','Cascadia Mono',Menlo,Consolas,monospace}
*{margin:0;padding:0;box-sizing:border-box}
::selection{background:var(--am);color:#0b0b0d}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:var(--bg);background-image:radial-gradient(#1B1B1F 1px,transparent 1.2px);background-size:22px 22px;color:var(--tx);min-height:100vh}
:focus-visible{outline:2px solid var(--bl);outline-offset:2px}
.nv{background:#0b0b0d;border-bottom:1px solid var(--ln);padding:0 1.5rem;display:flex;align-items:center;height:52px;gap:1.5rem;position:sticky;top:0;z-index:10}
.nb{font-weight:800;font-size:.9rem;letter-spacing:.35em;color:var(--tx);text-decoration:none}
.nb b{color:var(--am);font-weight:800}
.nl{display:flex;gap:.25rem}
.nk{padding:.4rem .75rem;border-radius:6px;color:var(--dm);text-decoration:none;font-size:.85rem;transition:background .15s,color .15s}
.nk:hover,.nk.a{background:#1e1e22;color:var(--tx)}
.cd{background:var(--pn);border:1px solid var(--ln);border-radius:14px;padding:1.35rem;box-shadow:inset 0 1px 0 rgba(255,255,255,.04)}
.ct{font-size:.7rem;color:var(--dm);text-transform:uppercase;letter-spacing:.24em;margin-bottom:1rem}
.em{color:var(--ft);font-size:.85rem;text-align:center;padding:1rem}
.lk{color:var(--bl);text-decoration:none}
.toast{position:fixed;bottom:1.5rem;right:1.5rem;background:#0b0b0d;border:1px solid var(--ln);border-left:3px solid var(--am);color:var(--tx);padding:.75rem 1rem;border-radius:8px;font-size:.85rem;opacity:0;transform:translateY(8px);transition:opacity .25s,transform .25s;pointer-events:none;z-index:99;max-width:min(420px,90vw)}
.toast.show{opacity:1;transform:none}`;

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function js(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n");
}

export function renderSetupWizard(
  panelUser: string,
  panelPassword: string,
): string {
  const cred = js(`${panelUser}:${panelPassword}`);
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
    .p .s.d{background:var(--am)}
    .p .s.c{background:var(--am);animation:p 1.5s infinite}
    @keyframes p{0%,100%{opacity:1}50%{opacity:.5}}
    h1{font-size:1.5rem;margin-bottom:.5rem}
    .sub{color:var(--dm);margin-bottom:1.5rem;font-size:.9rem}
    .f{margin-bottom:1rem}
    .f label{display:block;font-size:.85rem;color:var(--dm);margin-bottom:.3rem}
    .f input,.f select{width:100%;padding:.6rem .8rem;background:#0b0b0d;border:1px solid var(--ln);border-radius:6px;color:var(--tx);font-size:.95rem}
    .f input:focus{outline:none;border-color:var(--am)}
    .f .h{font-size:.75rem;color:var(--ft);margin-top:.2rem}
    .f .e{font-size:.75rem;color:var(--rd);margin-top:.2rem;display:none}
    .f.i .e{display:block}
    .f.i input{border-color:var(--rd)}
    .a{display:flex;gap:.75rem;margin-top:1.5rem}
    .b{flex:1;padding:.7rem;border:none;border-radius:6px;font-size:.95rem;font-weight:600;cursor:pointer}
    .bp{background:var(--am);color:#0b0b0d}
    .bp:active{transform:translateY(1px)}
    .bs{background:#232327;color:var(--tx);border:1px solid #3a3a40}
    .b:disabled{opacity:.5;cursor:not-allowed}
    .sk{text-align:center;margin-top:.75rem}
    .sk a{color:var(--ft);font-size:.8rem;cursor:pointer;text-decoration:none}
    .tr{margin-top:.5rem;padding:.5rem .75rem;border-radius:6px;font-size:.8rem;display:none}
    .tr.ok{display:block;background:#0b1f14;color:var(--gn);border:1px solid #14532d}
    .tr.fl{display:block;background:#220d0d;color:var(--rd);border:1px solid #7f1d1d}
    .tr.ld{display:block;background:#0b0b0d;color:var(--dm);border:1px solid var(--ln)}
    .ob{display:inline-block;background:#0f0f12;color:var(--dm);border:1px solid var(--ln);font-size:.7rem;padding:.1rem .4rem;border-radius:4px;margin-left:.3rem}
    .wi{font-size:3rem;text-align:center;margin-bottom:1rem}
    .wt{text-align:center;margin-bottom:1.5rem}
    .wt h1{font-size:1.8rem;margin-bottom:.5rem}
    .wt p{color:var(--dm);font-size:.9rem;line-height:1.5}
    .fe{display:flex;align-items:center;gap:.75rem;padding:.5rem 0}
    .fi{width:32px;height:32px;background:#0f0f12;border:1px solid var(--ln);border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:1rem;flex-shrink:0}
    .ft{font-size:.85rem}
    .ft strong{color:var(--tx)}
    .ft span{color:var(--dm)}
    .dv{height:1px;background:var(--ln);margin:1rem 0}
  </style>
</head>
<body>
  <div class="w" id="w"></div>
  <script>
    var A='Basic '+btoa('${cred}');
    var H={authorization:A};
    var S=[
      {id:'welcome',r:rW},
      {id:'ts3',r:rT},
      {id:'channel',r:rC},
      {id:'audio',r:rA},
      {id:'youtube',r:rY},
      {id:'optional',r:rO},
      {id:'review',r:rR}
    ];
    var cur=0,vals={};

    function render(){
      var h='';
      for(var i=0;i<S.length;i++){
        var c='s';if(i<cur)c+=' d';if(i===cur)c+=' c';
        h+='<div class="'+c+'"></div>';
      }
      document.getElementById('w').innerHTML='<div class="p">'+h+'</div>'+S[cur].r();
      bind();
    }

    function rW(){
      return '<div class="wi">&#127925;</div><div class="wt"><h1>Rhapsod</h1><p>Bot de musica para TeamSpeak 3.<br>Configuremoslo en unos pasos.</p></div>'+
        '<div class="fe"><div class="fi">&#127911;</div><div class="ft"><strong>YouTube, Spotify, SoundCloud</strong><br><span>Reproduce musica desde multiples fuentes</span></div></div>'+
        '<div class="fe"><div class="fi">&#128256;</div><div class="ft"><strong>Cola inteligente</strong><br><span>Playlists, shuffle, loops y mas</span></div></div>'+
        '<div class="fe"><div class="fi">&#9889;</div><div class="ft"><strong>Facil de usar</strong><br><span>Comandos simples desde el chat de TS3</span></div></div>'+
        '<div class="a"><button class="b bp" onclick="next()">Empezar</button></div>';
    }

    function rT(){
      return '<h1>Servidor TeamSpeak</h1><p class="sub">Datos de conexion al servidor TS3</p>'+
        '<div class="f" id="fh"><label>Direccion del servidor</label><input id="ih" placeholder="ts.example.com" value="'+(vals.RHAPSOD_TS3_HOST||'')+'"><div class="h">Hostname o IP del servidor</div><div class="e">Requerido</div></div>'+
        '<div class="f"><label>Puerto</label><input id="ip" type="number" placeholder="9987" value="'+(vals.RHAPSOD_TS3_PORT||'9987')+'"><div class="h">Default: 9987</div></div>'+
        '<div class="f"><label>Nombre del bot</label><input id="in" placeholder="Rhapsod" value="'+(vals.RHAPSOD_TS3_NICKNAME||'Rhapsod')+'"><div class="h">Maximo 30 caracteres</div></div>'+
        '<div class="f"><label>Contrasena <span class="ob">opcional</span></label><input id="iw" type="password" placeholder="Si el servidor tiene contrasena"></div>'+
        '<div id="tt" class="tr"></div>'+
        '<div class="a"><button class="b bs" onclick="prev()">Atras</button><button class="b bp" onclick="testTs3()">Probar y siguiente</button></div>';
    }

    function rC(){
      var useId=vals.RHAPSOD_TS3_CHANNEL_ID?'block':'none';
      return '<h1>Canal</h1><p class="sub">A que canal debe unirse el bot</p>'+
        '<div class="f"><label>Nombre del canal</label><input id="ic" placeholder="Musica" value="'+(vals.RHAPSOD_TS3_CHANNEL_NAME||'')+'"><div class="h">El bot buscara este canal al conectarse</div></div>'+
        '<div class="f"><label style="display:flex;align-items:center;gap:.5rem"><input type="checkbox" id="iu"'+(vals.RHAPSOD_TS3_CHANNEL_ID?' checked':'')+'> Usar ID del canal en vez de nombre</label></div>'+
        '<div class="f" id="fid" style="display:'+useId+'"><label>Channel ID</label><input id="icid" type="number" placeholder="110" value="'+(vals.RHAPSOD_TS3_CHANNEL_ID||'')+'"><div class="h">Lo podes encontrar en el cliente TS3</div></div>'+
        '<div class="f"><label>Contrasena del canal <span class="ob">opcional</span></label><input id="icp" type="password" placeholder="Si el canal tiene contrasena"></div>'+
        '<div class="a"><button class="b bs" onclick="prev()">Atras</button><button class="b bp" onclick="next()">Siguiente</button></div>';
    }

    function rA(){
      var br=vals.RHAPSOD_OPUS_BITRATE||'96000';
      return '<h1>Audio</h1><p class="sub">Configuracion de calidad de audio</p>'+
        '<div class="f"><label>Bitrate (kbps)</label><select id="ibr"><option value="64000"'+(br==='64000'?' selected':'')+'>64 kbps</option><option value="96000"'+(br==='96000'?' selected':'')+'>96 kbps (default)</option><option value="128000"'+(br==='128000'?' selected':'')+'>128 kbps</option></select><div class="h">Mas alto = mejor calidad, mas ancho de banda</div></div>'+
        '<div class="f"><label>Volumen normalizado (LUFS)</label><input id="il" type="number" min="-30" max="0" step="1" placeholder="-14" value="'+(vals.RHAPSOD_LOUDNESS_TARGET_LUFS||'-14')+'"><div class="h">-14 es estandar de streaming. -16 es mas conservador.</div></div>'+
        '<div class="f"><label>Modo verbose</label><select id="iv"><option value="false"'+(vals.RHAPSOD_VERBOSE!=='true'?' selected':'')+'>No (minimalista)</option><option value="true"'+(vals.RHAPSOD_VERBOSE==='true'?' selected':'')+'>Si (mensajes detallados)</option></select><div class="h">Verbose muestra mensajes de progreso</div></div>'+
        '<div class="a"><button class="b bs" onclick="prev()">Atras</button><button class="b bp" onclick="next()">Siguiente</button></div>';
    }

    function rY(){
      setTimeout(checkYt,50);
      var st=vals._ytOk===true?'<div class="tr ok">YouTube OK'+(vals._ytMs?' ('+vals._ytMs+' ms)':'')+'</div>':(vals._ytOk===false?'<div class="tr fl">Fallo: '+escJs(vals._ytErr||'desconocido')+'</div>':'<div class="tr ld">Probando YouTube...</div>');
      return '<h1>YouTube</h1><p class="sub">Sin esto el bot no reproduce musica de YouTube</p>'+
        '<div id="yh">'+st+'</div>'+
        '<div class="f"><label>Cookies de YouTube (cookies.txt) <span class="ob">recomendado</span></label><textarea id="ick2" rows="4" style="width:100%;padding:.6rem .8rem;background:#0b0b0d;border:1px solid #2b2b30;border-radius:6px;color:var(--tx);font-size:.8rem" placeholder="Pega aca el contenido de tu cookies.txt"></textarea><div class="h">En tu navegador: extension Get cookies.txt LOCALLY, exportar estando logueado en youtube.com, pegar el contenido</div></div>'+
        '<div id="yts" class="tr"></div>'+
        '<div class="a"><button class="b bs" onclick="prev()">Atras</button><button class="b bs" onclick="saveCookies()">Guardar cookies</button><button class="b bp" onclick="next()">Siguiente</button></div>';
    }

    function escJs(s){
      return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    function checkYt(){
      var el=document.getElementById('yh');
      if(!el)return;
      el.innerHTML='<div class="tr ld">Probando YouTube...</div>';
      fetch('/api/youtube-health',{headers:H}).then(function(r){return r.json();}).then(function(d){
        if(d.ok){vals._ytOk=true;vals._ytMs=d.ms;el.innerHTML='<div class="tr ok">YouTube OK ('+d.ms+' ms)</div>';}
        else{vals._ytOk=false;vals._ytErr=d.error;el.innerHTML='<div class="tr fl">Fallo: '+escJs(d.error||'desconocido')+'. Pega tus cookies abajo y proba de nuevo.</div>';}
      }).catch(function(e){vals._ytOk=false;vals._ytErr=e.message;el.innerHTML='<div class="tr fl">No se pudo probar: '+escJs(e.message)+'</div>';});
    }

    function saveCookies(){
      var t=document.getElementById('ick2');
      var body=t?t.value.trim():'';
      if(!body){toast('Pega el contenido de cookies.txt primero');return;}
      var el=document.getElementById('yts');
      el.className='tr ld';el.textContent='Guardando...';
      fetch('/api/cookies',{method:'PUT',headers:Object.assign({},H,{'content-type':'application/json'}),body:JSON.stringify({content:body})})
        .then(function(r){return r.json();}).then(function(d){
          if(d.ok){el.className='tr ok';el.textContent='Cookies guardadas. Probando de nuevo...';vals.RHAPSOD_YTDLP_COOKIES_PATH=d.path;checkYt();}
          else{el.className='tr fl';el.textContent='Error: '+(d.error||'desconocido');}
        }).catch(function(e){el.className='tr fl';el.textContent='No se pudo guardar: '+e.message;});
    }

    function rO(){
      return '<h1>Opcional</h1><p class="sub">Funciones adicionales</p>'+
        '<div class="f"><label>Spotify Client ID <span class="ob">opcional</span></label><input id="isi" placeholder="Para playlists de Spotify" value="'+(vals.RHAPSOD_SPOTIFY_CLIENT_ID||'')+'"></div>'+
        '<div class="f"><label>Spotify Client Secret <span class="ob">opcional</span></label><input id="iss" type="password" placeholder="Client Secret" value="'+(vals.RHAPSOD_SPOTIFY_CLIENT_SECRET||'')+'"></div>'+
        '<div class="dv"></div>'+
        '<div class="f"><label>Cookies de YouTube <span class="ob">opcional</span></label><input id="ick" placeholder="Ruta al archivo cookies.txt" value="'+(vals.RHAPSOD_YTDLP_COOKIES_PATH||'')+'"><div class="h">Para evitar limitaciones de rate-limit</div></div>'+
        '<div class="f"><label>yt-dlp Daemon URL <span class="ob">opcional</span></label><input id="ida" placeholder="http://127.0.0.1:8765" value="'+(vals.RHAPSOD_YTDLP_DAEMON_URL||'')+'"><div class="h">Para resolucion mas rapida de URLs</div></div>'+
        '<div class="dv"></div>'+
        '<div class="f"><label>UIDs de admin <span class="ob">opcional</span></label><input id="iua" placeholder="uid1,uid2,uid3" value="'+(vals.RHAPSOD_ADMIN_UIDS||'')+'"><div class="h">Separados por coma. Dan acceso a !move, !diag, etc.</div></div>'+
        '<div class="a"><button class="b bs" onclick="prev()">Atras</button><button class="b bp" onclick="next()">Siguiente</button></div>';
    }

    function rR(){
      var rows=[
        ['Servidor TS3',vals.RHAPSOD_TS3_HOST||'(no seteado)'],
        ['Puerto',vals.RHAPSOD_TS3_PORT||'9987'],
        ['Nombre',vals.RHAPSOD_TS3_NICKNAME||'Rhapsod'],
        ['Canal',vals.RHAPSOD_TS3_CHANNEL_NAME||vals.RHAPSOD_TS3_CHANNEL_ID||'(default)'],
        ['Bitrate',((vals.RHAPSOD_OPUS_BITRATE||'96000')/1000)+' kbps'],
        ['Normalizacion',(vals.RHAPSOD_LOUDNESS_TARGET_LUFS||'-14')+' LUFS'],
        ['Spotify',vals.RHAPSOD_SPOTIFY_CLIENT_ID?'Configurado':'No'],
        ['YouTube',vals._ytOk===true?'OK':(vals._ytOk===false?'Falla (ver paso YouTube)':'Sin probar')],
        ['Cookies',vals.RHAPSOD_YTDLP_COOKIES_PATH?'Configurado':'No'],
        ['Daemon',vals.RHAPSOD_YTDLP_DAEMON_URL?'Configurado':'No'],
        ['Admins',vals.RHAPSOD_ADMIN_UIDS||'(ninguno)']
      ];
      var h='<h1>Resumen</h1><p class="sub">Revisa la configuracion antes de guardar</p>';
      for(var i=0;i<rows.length;i++){
        h+='<div style="display:flex;justify-content:space-between;padding:.4rem 0;border-bottom:1px solid #2b2b30;font-size:.85rem"><span style="color:var(--dm)">'+rows[i][0]+'</span><span>'+rows[i][1]+'</span></div>';
      }
      h+='<div class="a"><button class="b bs" onclick="prev()">Atras</button><button class="b bp" onclick="save()">Guardar y reiniciar</button></div>';
      return h;
    }

    function bind(){
      var c=document.getElementById('iu');
      if(c)c.onchange=function(){document.getElementById('fid').style.display=this.checked?'block':'none';};
    }

    function g(id){var e=document.getElementById(id);return e?e.value.trim():'';}
    function collect(){
      vals.RHAPSOD_TS3_HOST=g('ih');
      vals.RHAPSOD_TS3_PORT=g('ip')||'9987';
      vals.RHAPSOD_TS3_NICKNAME=g('in')||'Rhapsod';
      if(g('iw'))vals.RHAPSOD_TS3_PASSWORD=g('iw');
      vals.RHAPSOD_TS3_CHANNEL_NAME=g('ic');
      if(g('icid'))vals.RHAPSOD_TS3_CHANNEL_ID=g('icid');
      if(g('icp'))vals.RHAPSOD_TS3_CHANNEL_PASSWORD=g('icp');
      vals.RHAPSOD_OPUS_BITRATE=g('ibr')||'96000';
      vals.RHAPSOD_LOUDNESS_TARGET_LUFS=g('il')||'-14';
      vals.RHAPSOD_VERBOSE=g('iv')||'false';
      if(g('isi'))vals.RHAPSOD_SPOTIFY_CLIENT_ID=g('isi');
      if(g('iss'))vals.RHAPSOD_SPOTIFY_CLIENT_SECRET=g('iss');
      if(g('ick'))vals.RHAPSOD_YTDLP_COOKIES_PATH=g('ick');
      if(g('ida'))vals.RHAPSOD_YTDLP_DAEMON_URL=g('ida');
      if(g('iua'))vals.RHAPSOD_ADMIN_UIDS=g('iua');
    }

    function next(){collect();if(cur<S.length-1){cur++;render();}}
    function prev(){collect();if(cur>0){cur--;render();}}

    function testTs3(){
      collect();
      if(!vals.RHAPSOD_TS3_HOST){document.getElementById('fh').classList.add('i');return;}
      var el=document.getElementById('tt');
      el.className='tr ld';el.textContent='Probando conexion...';el.style.display='block';
      fetch('/api/test-connection',{method:'POST',headers:Object.assign({},H,{'content-type':'application/json'}),body:JSON.stringify(vals)})
        .then(function(r){return r.json();})
        .then(function(d){
          if(d.ok){el.className='tr ok';el.textContent='Conexion exitosa: '+d.serverName;}
          else{el.className='tr fl';el.textContent='Error: '+d.error;}
        })
        .catch(function(e){el.className='tr fl';el.textContent='No se pudo probar: '+e.message;});
    }

    function save(){
      collect();
      var btn=document.querySelector('.bp');
      btn.disabled=true;btn.textContent='Guardando...';
      fetch('/api/env',{method:'PUT',headers:Object.assign({},H,{'content-type':'application/json'}),body:JSON.stringify(vals)})
        .then(function(r){return r.json();})
        .then(function(d){
          if(d.ok){btn.textContent='Reiniciando...';fetch('/api/restart',{method:'POST',headers:H});setTimeout(function(){window.location.href='/';},3000);}
          else{btn.textContent='Error al guardar';btn.disabled=false;}
        })
        .catch(function(e){btn.textContent='Error: '+e.message;btn.disabled=false;});
    }

    render();
  </script>
</body>
</html>`;
}

export function renderDashboard(
  status: PanelStatus,
  panelUser: string,
  panelPassword: string,
): string {
  const cred = js(`${panelUser}:${panelPassword}`);
  const connected = status.connected;
  const title = esc(status.currentTitle || "Sin reproducir");
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
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Rhapsod</title>
  <style>${CHROME_CSS}
    .nr{margin-left:auto;display:flex;align-items:center;gap:.6rem}
    .lamp{font-family:var(--mn);font-size:.62rem;letter-spacing:.22em;padding:.32rem .6rem;border:1px solid #3a3a40;border-radius:4px;color:var(--ft);white-space:nowrap}
    .lamp.on{color:#0b0b0d;background:var(--am);border-color:var(--am);box-shadow:0 0 12px rgba(251,191,36,.4)}
    .lamp.buf{color:var(--am);border-color:var(--am);animation:blk 1s steps(2) infinite}
    @keyframes blk{50%{opacity:.3}}
    .dot{width:8px;height:8px;border-radius:50%}
    .dot.on{background:var(--gn)}
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
    .ns{font-family:var(--mn);font-size:.72rem;letter-spacing:.25em;color:var(--am);margin-bottom:.75rem;min-height:1rem}
    .tm{display:flex;justify-content:space-between;font-family:var(--mn);font-size:.8rem;color:var(--am);margin:.45rem 0 1rem;font-variant-numeric:tabular-nums}
    .tm .tt{color:var(--ft)}
    .sk{height:14px;background:#0a0a0c;border:1px solid var(--ln);border-radius:7px;cursor:pointer;position:relative;overflow:hidden}
    .skf{position:absolute;top:0;bottom:0;left:0;width:0%;background:var(--am)}
    .sk.live .skf{background:repeating-linear-gradient(115deg,var(--am) 0 8px,#B45309 8px 16px);animation:mv 1s linear infinite}
    @keyframes mv{to{background-position:18px 0}}
    .tp{display:flex;gap:.6rem;align-items:center;flex-wrap:wrap}
    .tb{width:54px;height:54px;border-radius:12px;background:#232327;border:1px solid #3a3a40;color:var(--tx);font-size:1.2rem;cursor:pointer;box-shadow:0 3px 0 #000;display:flex;align-items:center;justify-content:center}
    .tb:active{transform:translateY(2px);box-shadow:none}
    .tb.main{width:66px;height:66px;background:var(--am);border-color:var(--am);color:#0b0b0d;font-size:1.5rem}
    .tb.dng{border-color:#5a2320;color:var(--rd)}
    .vg{display:flex;align-items:center;gap:.6rem;margin-left:auto}
    .vg .vv{font-family:var(--mn);font-size:.8rem;color:var(--am);min-width:44px;text-align:right;font-variant-numeric:tabular-nums}
    .vg input[type=range]{width:110px;accent-color:var(--am);-webkit-appearance:none;appearance:none;height:4px;border-radius:2px;background:#2b2b30;outline-offset:4px}
    .vg input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:14px;height:14px;border-radius:50%;background:var(--am);border:2px solid #0b0b0d;box-shadow:0 0 0 1px var(--am);cursor:pointer}
    .vg input[type=range]::-moz-range-thumb{width:12px;height:12px;border-radius:50%;background:var(--am);border:2px solid #0b0b0d;box-shadow:0 0 0 1px var(--am);cursor:pointer}
    .vg input[type=range]::-moz-range-track{height:4px;border-radius:2px;background:#2b2b30}
    .ql::-webkit-scrollbar,.dw::-webkit-scrollbar{width:8px}
    .ql::-webkit-scrollbar-thumb,.dw::-webkit-scrollbar-thumb{background:#2b2b30;border-radius:4px}
    .ql::-webkit-scrollbar-track,.dw::-webkit-scrollbar-track{background:transparent}
    .sg{display:flex;border:1px solid #3a3a40;border-radius:8px;overflow:hidden}
    .sg button{flex:1;background:transparent;border:none;color:var(--dm);padding:.55rem .2rem;font-size:.72rem;letter-spacing:.12em;cursor:pointer}
    .sg button.on{background:var(--am);color:#0b0b0d;font-weight:700}
    .swl{display:grid;grid-template-columns:1fr 1fr;gap:.5rem}
    .sw{display:flex;align-items:center;gap:.55rem;background:#0f0f12;border:1px solid var(--ln);border-radius:8px;padding:.55rem .7rem;cursor:pointer;color:var(--dm);font-size:.8rem;width:100%;text-align:left}
    .sw .led{width:8px;height:8px;border-radius:50%;background:#3a3a40;flex-shrink:0}
    .sw.on{color:var(--tx);border-color:var(--am)}
    .sw.on .led{background:var(--am);box-shadow:0 0 8px rgba(251,191,36,.8)}
    .ql{list-style:none;max-height:230px;overflow-y:auto}
    .qi{padding:.45rem 0;border-bottom:1px solid #232327;font-size:.85rem;display:flex;gap:.6rem;align-items:center}
    .qi:last-child{border-bottom:none}
    .qn{font-family:var(--mn);color:var(--ft);min-width:24px;font-size:.75rem}
    .qt{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
    .qr{color:var(--bl);font-size:.72rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:120px;flex-shrink:0}
    .qx{background:none;border:1px solid #3a3a40;color:var(--dm);border-radius:6px;width:26px;height:26px;cursor:pointer;font-size:.8rem;line-height:1;flex-shrink:0}
    .qx:hover{color:var(--rd);border-color:var(--rd)}
    .ir{display:flex;gap:.5rem;margin-bottom:.6rem}
    .ir input{flex:1;padding:.6rem .8rem;background:#0b0b0d;border:1px solid var(--ln);border-radius:6px;color:var(--tx);font-size:.9rem;min-width:0}
    .ir input:focus{outline:none;border-color:var(--am)}
    .go{padding:.6rem 1rem;background:var(--am);color:#0b0b0d;border:none;border-radius:6px;font-weight:700;cursor:pointer;white-space:nowrap}
    .go:active{transform:translateY(1px)}
    .nx{display:flex;align-items:center;gap:.5rem;font-size:.8rem;color:var(--dm)}
    .nx input{accent-color:var(--am);width:16px;height:16px}
    .sg3{display:grid;grid-template-columns:repeat(3,1fr);gap:.5rem}
    .stt{background:#0b0b0d;border:1px solid var(--ln);border-radius:8px;padding:.7rem .4rem;text-align:center}
    .sv{font-family:var(--mn);font-size:1.25rem;color:var(--tx);font-variant-numeric:tabular-nums}
    .sv.am{color:var(--am)}
    .sl{font-size:.62rem;color:var(--dm);text-transform:uppercase;letter-spacing:.15em;margin-top:.25rem}
    .dw{background:#0a0a0c;border:1px solid var(--ln);border-radius:8px;padding:1rem;font-family:var(--mn);font-size:.78rem;line-height:1.5;white-space:pre-wrap;word-break:break-word;max-height:280px;overflow-y:auto;display:none;color:#c9c9ce}
    .dw.open{display:block}
    .dwb{display:flex;justify-content:flex-end;margin-bottom:.5rem}
    .fc{display:flex;gap:.4rem;flex-wrap:wrap;margin-bottom:.75rem}
    .fc:last-child{margin-bottom:0}
    .ch{padding:.32rem .65rem;border-radius:6px;font-size:.75rem;background:#0f0f12;color:var(--dm);border:1px solid var(--ln);cursor:pointer}
    .ch:hover{color:var(--tx);border-color:#3a3a40}
  </style>
</head>
<body>
  <nav class="nv">
    <div class="nb">RHAPSOD<b>.</b></div>
    <div class="nl">
      <a class="nk a" href="/" id="nd">Consola</a>
      <a class="nk" href="/settings" id="ns">Config</a>
      <a class="nk" href="/commands" id="nc">Comandos</a>
    </div>
    <div class="nr">
      <div class="lamp ${lampClass}" id="lamp">ON AIR</div>
      <div class="dot ${connected ? "on" : "off"}" id="dot"></div>
      <span class="st" id="stxt">${connected ? "Conectado" : "Desconectado"}</span>
    </div>
  </nav>
  <div class="mn">
    <div class="g">
      <div class="cd fw">
        <div class="ct"><span>Program</span><span class="rv" id="nc2">Canal ${channel}</span></div>
        <div class="deck">
          <div class="ns" id="nsState">${stateLabel}</div>
          <div class="nt" id="nt">${title}</div>
          <div class="tm"><span id="tcur">${timeCur}</span><span class="tt" id="tdur">${timeDur}</span></div>
          <div class="sk" id="seek" title="Saltar"><div class="skf" id="seekf"></div></div>
        </div>
        <div class="tp">
          <button class="tb" onclick="cmd('previous')" title="Anterior">&#9198;</button>
          <button class="tb main" id="ppBtn" onclick="togglePlay()" title="Pausar/Reanudar">${ppIcon}</button>
          <button class="tb" onclick="cmd('skip')" title="Saltar">&#9197;</button>
          <button class="tb dng" onclick="cmd('stop')" title="Detener">&#9724;</button>
          <div class="vg">
            <span class="vv" id="volv">${volInit}%</span>
            <input type="range" min="0" max="100" value="${volInit}" id="vol">
          </div>
        </div>
      </div>
      <div class="cd fw">
        <div class="ct"><span>Agregar</span><span class="rv">URL o busqueda</span></div>
        <div class="ir">
          <input id="pi" placeholder="YouTube, Spotify, SoundCloud..." onkeydown="if(event.key==='Enter')play()">
          <button class="go" onclick="play()">Al aire</button>
        </div>
        <label class="nx"><input type="checkbox" id="nxChk"> Como próxima (playnext)</label>
      </div>
      <div class="cd">
        <div class="ct"><span>Cola</span><span class="rv" id="qc">${queueLen} pistas</span></div>
        <ul class="ql" id="ql"></ul>
        <div class="em" id="qe" style="display:${queueLen === 0 ? "block" : "none"}">Cola vacía — pedí un tema arriba</div>
      </div>
      <div class="cd">
        <div class="ct"><span>Consola</span></div>
        <div class="ct" style="margin-bottom:.5rem"><span style="letter-spacing:.1em">Loop</span></div>
        <div class="sg" id="loopSeg" style="margin-bottom:1rem">
          <button data-l="off" onclick="cmd('loop off')">OFF</button><button data-l="track" onclick="cmd('loop track')">TRACK</button><button data-l="queue" onclick="cmd('loop queue')">QUEUE</button>
        </div>
        <div class="ct" style="margin-bottom:.5rem"><span style="letter-spacing:.1em">Filtros</span></div>
        <div class="swl" id="fxRow">
          <button class="sw" data-f="bassboost" onclick="cmd('bassboost')"><span class="led"></span>Bass</button>
          <button class="sw" data-f="nightcore" onclick="cmd('nightcore')"><span class="led"></span>Nightcore</button>
          <button class="sw" data-f="vaporwave" onclick="cmd('vaporwave')"><span class="led"></span>Vapor</button>
          <button class="sw" data-f="8d" onclick="cmd('8d')"><span class="led"></span>8D</button>
        </div>
        <div class="fc" style="margin-top:1rem">
          <button class="ch" onclick="cmd('filter off')">Quitar filtro</button>
          <button class="ch" onclick="cmd('shuffle')">Shuffle</button>
          <button class="ch" onclick="cmd('clear')">Clear</button>
          <button class="ch" onclick="cmd('test-tone')">Test Tone</button>
        </div>
        <div class="fc">
          <button class="ch" onclick="showOut('stats')">Stats</button>
          <button class="ch" onclick="showOut('lyrics')">Letra</button>
          <button class="ch" onclick="showOut('history')">Historial</button>
        </div>
      </div>
      <div class="cd fw">
        <div class="ct"><span>Sistema</span><span class="rv" id="uptime">${uptimeInit}</span></div>
        <div class="sg3">
          <div class="stt"><div class="sv am" id="stTracks">${tracksInit}</div><div class="sl">Temas</div></div>
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
      <div class="cd fw">
        <div class="ct"><span>Errores</span><span class="rv" id="ec">0 total</span></div>
        <div class="fc" id="ek"></div>
        <ul class="ql" id="el"></ul>
        <div class="em" id="ee">Sin errores registrados</div>
      </div>
    </div>
  </div>
  <div class="toast" id="toast"></div>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js" defer></script>
  <script>
    var A='Basic '+btoa('${cred}');
    var H={authorization:A};
    var RM=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    function gs(){return (window.gsap&&!RM)?window.gsap:null;}
    var PP='idle',POS=0,DUR=0,volDrag=false,lastTracks=-1,lastQ='',lastE='',lastQLen=0;

    function fmtT(ms){
      if(ms==null||!isFinite(ms)||ms<0)return '--:--';
      var s=Math.floor(ms/1000);
      return Math.floor(s/60)+':'+('0'+(s%60)).slice(-2);
    }

    function esc(s){
      return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function cmd(c){
      pressAnim();
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
      el.value='';
      var nx=document.getElementById('nxChk');
      cmd(((nx&&nx.checked)?'playnext ':'play ')+q);
    }

    function togglePlay(){
      cmd((PP==='playing'||PP==='buffering')?'pause':'resume');
    }

    function rmQ(n){
      cmd('remove '+n);
    }

    function seekEv(e){
      if(!DUR||DUR<=0)return;
      var bar=document.getElementById('seek');
      var r=bar.getBoundingClientRect();
      var x=(e.touches&&e.touches[0]?e.touches[0].clientX:e.clientX)-r.left;
      var ratio=Math.max(0,Math.min(1,x/r.width));
      var sec=Math.floor(ratio*DUR/1000);
      POS=ratio*DUR;
      paintTime();
      cmd('seek '+sec);
    }

    function showOut(c){
      var card=document.getElementById('dwCard');
      var pre=document.getElementById('dw');
      card.style.display='block';
      pre.textContent='...';
      card.scrollIntoView({block:'nearest'});
      run(c).then(function(t){pre.textContent=t;}).catch(function(e){pre.textContent='Error: '+e.message;});
    }

    function closeOut(){
      document.getElementById('dwCard').style.display='none';
    }

    function toast(m){
      var el=document.getElementById('toast');
      el.textContent=m;el.classList.add('show');
      setTimeout(function(){el.classList.remove('show');},3000);
    }

    function pressAnim(){
      var g=gs();
      if(!g)return;
      var b=document.activeElement;
      if(b&&b.classList&&b.classList.contains('tb'))g.fromTo(b,{scale:.93},{scale:1,duration:.25,ease:'back.out(3)'});
    }

    function countUp(el,to,suffix){
      var g=gs();
      if(!g){el.textContent=to+(suffix||'');return;}
      var o={v:parseFloat(el.getAttribute('data-v')||'0')};
      g.to(o,{v:to,duration:.8,ease:'power1.out',overwrite:true,onUpdate:function(){el.textContent=Math.round(o.v)+(suffix||'');}});
      el.setAttribute('data-v',String(to));
    }

    function paintTime(){
      document.getElementById('tcur').textContent=fmtT(POS);
      document.getElementById('tdur').textContent=fmtT(DUR>0?DUR:undefined);
      var f=document.getElementById('seekf');
      var bar=document.getElementById('seek');
      if(DUR>0){bar.classList.remove('live');f.style.width=Math.min(100,POS/DUR*100)+'%';}
      else{bar.classList.add('live');f.style.width='100%';}
    }

    function setLamp(state){
      var lamp=document.getElementById('lamp');
      var lab=document.getElementById('nsState');
      var pp=document.getElementById('ppBtn');
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
        PP=d.playerState||'idle';
        POS=(typeof d.positionMs==='number'&&d.positionMs>=0)?d.positionMs:0;
        DUR=(typeof d.durationMs==='number'&&d.durationMs>0)?d.durationMs:0;
        setLamp(PP);
        paintTime();
        document.getElementById('nt').textContent=d.currentTitle||'Sin reproducir';
        document.getElementById('nt').title=d.currentTitle||'';
        document.getElementById('nc2').textContent='Canal '+(d.currentChannelId||'-');
        document.getElementById('qc').textContent=d.queueLength+' pistas';
        if(!volDrag&&typeof d.volume==='number'){
          document.getElementById('vol').value=d.volume;
          document.getElementById('volv').textContent=d.volume+'%';
        }
        syncSeg('loopSeg','data-l',d.loopMode||'off');
        syncSeg('fxRow','data-f',d.currentFilter||'off');
        if(typeof d.tracksPlayed==='number'&&d.tracksPlayed!==lastTracks){
          lastTracks=d.tracksPlayed;
          countUp(document.getElementById('stTracks'),d.tracksPlayed);
        }
        if(typeof d.uptimeMs==='number'){
          var m=Math.floor(d.uptimeMs/60000);
          document.getElementById('uptime').textContent=m<60?('up '+m+' min'):('up '+Math.floor(m/60)+' h');
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
          var grew=d.queue.length>lastQLen;
          lastQLen=d.queue.length;
          var h='';
          for(var i=0;i<d.queue.length;i++){
            var t=d.queue[i];
            var title=t.title||'Sin titulo';
            var by=t.requestedBy?' <span class="qr">'+esc(t.requestedBy)+'</span>':'';
            h+='<li class="qi"><span class="qn">'+(i+1)+'</span><span class="qt" title="'+esc(title)+'">'+esc(title)+'</span>'+by+'<button class="qx" title="Quitar" onclick="rmQ('+(i+1)+')">&times;</button></li>';
          }
          list.innerHTML=h;
          if(grew){var gg=gs();if(gg)gg.from(list.children,{y:8,opacity:0,duration:.35,stagger:.04,ease:'power2.out',clearProps:'all',overwrite:true});}
          }
        }
        renderErrors(d.errors||{totalErrors:0,byCategory:{},recent:[]});
      }).catch(function(){});
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
      var seek=document.getElementById('seek');
      seek.addEventListener('click',seekEv);
      var vol=document.getElementById('vol');
      vol.addEventListener('pointerdown',function(){volDrag=true;});
      window.addEventListener('pointerup',function(){volDrag=false;});
      vol.addEventListener('change',function(){
        document.getElementById('volv').textContent=vol.value+'%';
        cmd('volume '+vol.value);
      });
      function entrance(){
        var g=gs();
        if(!g)return;
        g.from('.cd',{y:16,opacity:0,duration:.5,stagger:.07,ease:'power2.out',clearProps:'all'});
      }
      if(document.readyState==='complete')entrance();
      else window.addEventListener('load',entrance);
      function tick(){
        if(document.hidden)return;
        refresh();
      }
      refresh();
      setInterval(tick,5000);
      document.addEventListener('visibilitychange',function(){if(!document.hidden)refresh();});
      setInterval(function(){
        if(PP==='playing'&&DUR>0&&POS<DUR){POS+=1000;paintTime();}
      },1000);
    })();
  </script>
</body>
</html>`;
}

export function renderSettingsPage(
  panelUser: string,
  panelPassword: string,
): string {
  const cred = js(`${panelUser}:${panelPassword}`);
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
    .f input:focus{outline:none;border-color:var(--am)}
    .f .h{font-size:.75rem;color:var(--ft);margin-top:.15rem}
    .btn{padding:.6rem 1.5rem;background:var(--am);color:#0b0b0d;border:none;border-radius:6px;font-weight:700;cursor:pointer;font-size:.9rem}
    .btn:active{transform:translateY(1px)}
  </style>
</head>
<body>
  <nav class="nv">
    <div class="nb">RHAPSOD<b>.</b></div>
    <div class="nl">
      <a class="nk" href="/">Consola</a>
      <a class="nk a" href="/settings">Config</a>
      <a class="nk" href="/commands">Comandos</a>
    </div>
  </nav>
  <div class="mn" id="ct"><div class="cd"><div class="em">Cargando...</div></div></div>
  <div class="toast" id="toast"></div>
  <script>
    var A='Basic '+btoa('${cred}');
    var H={authorization:A};

    function toast(m){var el=document.getElementById('toast');el.textContent=m;el.classList.add('show');setTimeout(function(){el.classList.remove('show');},3000);}

    function load(){
      fetch('/api/env',{headers:H}).then(function(r){return r.json();}).then(function(d){
        if(!d.entries||d.entries.length===0){
          document.getElementById('ct').innerHTML='<div class="cd"><div class="em">El bot no puede leer su archivo de entorno. Revisá que el usuario del servicio tenga permiso de lectura sobre RHAPSOD_ENV_FILE.</div></div>';
          return;
        }
        var groups={};
        var order=['TeamSpeak 3','Audio','Spotify','Panel','General'];
        for(var i=0;i<d.entries.length;i++){
          var e=d.entries[i];
          var g=e.key.indexOf('RHAPSOD_TS3')===0?'TeamSpeak 3':e.key.indexOf('RHAPSOD_SPOT')===0?'Spotify':e.key.indexOf('RHAPSOD_OPUS')===0||e.key.indexOf('RHAPSOD_LOUD')===0?'Audio':e.key.indexOf('RHAPSOD_PANEL')===0?'Panel':'General';
          if(!groups[g])groups[g]=[];
          groups[g].push(e);
        }
        var h='';
        for(var gi=0;gi<order.length;gi++){
          var gn=order[gi];
          var entries=groups[gn];
          if(!entries)continue;
          h+='<div class="cd"><div class="ct">'+gn+'</div>';
          for(var j=0;j<entries.length;j++){
            var e=entries[j];
            var val=e.masked?'':(e.value||'');
            var desc=e.description?'<div class="h">'+e.description+'</div>':'';
            h+='<div class="f"><label>'+e.key+'</label><input data-key="'+e.key+'" value="'+val.replace(/"/g,'&quot;')+'"'+(e.masked?' placeholder="(sin cambios)"':'')+'>'+desc+'</div>';
          }
          h+='</div>';
        }
        h+='<button class="btn" onclick="save()">Guardar</button>';
        document.getElementById('ct').innerHTML=h;
      }).catch(function(){document.getElementById('ct').innerHTML='<div class="cd"><div class="em">Error al cargar config</div></div>';});
    }

    function save(){
      var inputs=document.querySelectorAll('input[data-key]');
      var vals={};
      for(var i=0;i<inputs.length;i++){
        var v=inputs[i].value.trim();
        if(v||inputs[i].placeholder==='(sin cambios)')vals[inputs[i].dataset.key]=v;
      }
      fetch('/api/env',{method:'PUT',headers:Object.assign({},H,{'content-type':'application/json'}),body:JSON.stringify(vals)})
        .then(function(r){return r.json();})
        .then(function(d){toast(d.ok?'Config guardada':'Error al guardar');})
        .catch(function(){toast('Error de conexion');});
    }

    load();
  </script>
</body>
</html>`;
}

export function renderCommandsPage(
  panelUser: string,
  panelPassword: string,
): string {
  const cred = js(`${panelUser}:${panelPassword}`);
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
    .sr:focus{outline:none;border-color:var(--am)}
    .ci{padding:.5rem 0;border-bottom:1px solid #232327}
    .ci:last-child{border-bottom:none}
    .cn{color:var(--am);font-family:var(--mn);font-size:.9rem;font-weight:600}
    .ca{color:var(--ft);font-size:.8rem;font-family:var(--mn)}
    .cd2{color:var(--dm);font-size:.85rem;margin-top:.15rem}
    .cg{font-size:.65rem;background:#0f0f12;color:var(--dm);border:1px solid var(--ln);padding:.1rem .4rem;border-radius:4px;margin-left:.5rem;letter-spacing:.1em}
  </style>
</head>
<body>
  <nav class="nv">
    <div class="nb">RHAPSOD<b>.</b></div>
    <div class="nl">
      <a class="nk" href="/">Consola</a>
      <a class="nk" href="/settings">Config</a>
      <a class="nk a" href="/commands">Comandos</a>
    </div>
  </nav>
  <div class="mn">
    <input class="sr" id="sr" placeholder="Buscar comandos..." oninput="filter()">
    <div id="ls"></div>
  </div>
  <script>
    var A='Basic '+btoa('${cred}');
    var H={authorization:A};
    var cmds=[];
    var gn={music:'Reproduccion',queue:'Cola',admin:'Administracion',misc:'Otros'};

    function load(){
      fetch('/api/commands',{headers:H}).then(function(r){return r.json();}).then(function(d){cmds=d.commands;render(cmds);}).catch(function(){});
    }

    function render(list){
      var el=document.getElementById('ls');
      if(!list.length){el.innerHTML='<div class="cd"><div class="em">No se encontraron comandos</div></div>';return;}
      var groups={};
      for(var i=0;i<list.length;i++){var c=list[i];if(!groups[c.group])groups[c.group]=[];groups[c.group].push(c);}
      var h='';
      var order=['music','queue','admin','misc'];
      for(var gi=0;gi<order.length;gi++){
        var g=order[gi];
        var items=groups[g];
        if(!items)continue;
        h+='<div class="cd"><div class="ct">'+(gn[g]||g)+'</div>';
        for(var j=0;j<items.length;j++){
          var c=items[j];
          h+='<div class="ci"><div><span class="cn">!'+c.usage+'</span>'+
            (c.aliases.length?' <span class="ca">(!'+c.aliases.join(', !')+')</span>':'')+
            (c.adminOnly?' <span class="cg">admin</span>':'')+
            '</div><div class="cd2">'+c.summary+'</div></div>';
        }
        h+='</div>';
      }
      el.innerHTML=h;
    }

    function filter(){
      var q=document.getElementById('sr').value.toLowerCase();
      if(!q){render(cmds);return;}
      render(cmds.filter(function(c){return c.name.indexOf(q)!==-1||c.aliases.some(function(a){return a.indexOf(q)!==-1;})||c.summary.toLowerCase().indexOf(q)!==-1;}));
    }

    load();
  </script>
</body>
</html>`;
}
