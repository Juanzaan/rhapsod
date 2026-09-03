import type { PanelStatus } from "./panel-server.js";

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
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f172a;color:#e2e8f0;min-height:100vh;display:flex;align-items:center;justify-content:center}
    .w{background:#1e293b;border-radius:12px;padding:2rem;width:100%;max-width:520px;box-shadow:0 25px 50px -12px rgba(0,0,0,.5)}
    .p{display:flex;gap:4px;margin-bottom:1.5rem}
    .p .s{flex:1;height:3px;background:#334155;border-radius:2px}
    .p .s.d{background:#38bdf8}
    .p .s.c{background:#38bdf8;animation:p 1.5s infinite}
    @keyframes p{0%,100%{opacity:1}50%{opacity:.5}}
    h1{font-size:1.5rem;margin-bottom:.5rem}
    .sub{color:#94a3b8;margin-bottom:1.5rem;font-size:.9rem}
    .f{margin-bottom:1rem}
    .f label{display:block;font-size:.85rem;color:#94a3b8;margin-bottom:.3rem}
    .f input,.f select{width:100%;padding:.6rem .8rem;background:#0f172a;border:1px solid #334155;border-radius:6px;color:#e2e8f0;font-size:.95rem}
    .f input:focus{outline:none;border-color:#38bdf8}
    .f .h{font-size:.75rem;color:#64748b;margin-top:.2rem}
    .f .e{font-size:.75rem;color:#ef4444;margin-top:.2rem;display:none}
    .f.i .e{display:block}
    .f.i input{border-color:#ef4444}
    .a{display:flex;gap:.75rem;margin-top:1.5rem}
    .b{flex:1;padding:.7rem;border:none;border-radius:6px;font-size:.95rem;font-weight:600;cursor:pointer}
    .bp{background:#38bdf8;color:#0f172a}
    .bp:hover{background:#7dd3fc}
    .bs{background:#334155;color:#e2e8f0}
    .bs:hover{background:#475569}
    .b:disabled{opacity:.5;cursor:not-allowed}
    .sk{text-align:center;margin-top:.75rem}
    .sk a{color:#64748b;font-size:.8rem;cursor:pointer;text-decoration:none}
    .tr{margin-top:.5rem;padding:.5rem .75rem;border-radius:6px;font-size:.8rem;display:none}
    .tr.ok{display:block;background:#052e16;color:#22c55e;border:1px solid #166534}
    .tr.fl{display:block;background:#450a0a;color:#ef4444;border:1px solid #991b1b}
    .tr.ld{display:block;background:#1e293b;color:#94a3b8;border:1px solid #334155}
    .ob{display:inline-block;background:#334155;color:#94a3b8;font-size:.7rem;padding:.1rem .4rem;border-radius:4px;margin-left:.3rem}
    .wi{font-size:3rem;text-align:center;margin-bottom:1rem}
    .wt{text-align:center;margin-bottom:1.5rem}
    .wt h1{font-size:1.8rem;margin-bottom:.5rem}
    .wt p{color:#94a3b8;font-size:.9rem;line-height:1.5}
    .fe{display:flex;align-items:center;gap:.75rem;padding:.5rem 0}
    .fi{width:32px;height:32px;background:#334155;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:1rem;flex-shrink:0}
    .ft{font-size:.85rem}
    .ft strong{color:#e2e8f0}
    .ft span{color:#94a3b8}
    .dv{height:1px;background:#334155;margin:1rem 0}
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
        ['Cookies',vals.RHAPSOD_YTDLP_COOKIES_PATH?'Configurado':'No'],
        ['Daemon',vals.RHAPSOD_YTDLP_DAEMON_URL?'Configurado':'No'],
        ['Admins',vals.RHAPSOD_ADMIN_UIDS||'(ninguno)']
      ];
      var h='<h1>Resumen</h1><p class="sub">Revisa la configuracion antes de guardar</p>';
      for(var i=0;i<rows.length;i++){
        h+='<div style="display:flex;justify-content:space-between;padding:.4rem 0;border-bottom:1px solid #334155;font-size:.85rem"><span style="color:#94a3b8">'+rows[i][0]+'</span><span>'+rows[i][1]+'</span></div>';
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
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Rhapsod</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f172a;color:#e2e8f0}
    .nv{background:#1e293b;border-bottom:1px solid #334155;padding:0 1.5rem;display:flex;align-items:center;height:48px;gap:1.5rem}
    .nb{font-weight:700;font-size:1rem;color:#38bdf8}
    .nl{display:flex;gap:.25rem}
    .nk{padding:.4rem .75rem;border-radius:6px;color:#94a3b8;text-decoration:none;font-size:.85rem}
    .nk:hover,.nk.a{background:#334155;color:#e2e8f0}
    .nr{margin-left:auto;display:flex;align-items:center;gap:.75rem}
    .dot{width:8px;height:8px;border-radius:50%}
    .dot.on{background:#22c55e}
    .dot.off{background:#ef4444}
    .st{font-size:.8rem;color:#94a3b8}
    .mn{max-width:900px;margin:0 auto;padding:1.5rem}
    .g{display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem}
    @media(max-width:640px){.g{grid-template-columns:1fr}}
    .cd{background:#1e293b;border-radius:10px;padding:1.25rem}
    .ct{font-size:.8rem;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:1rem}
    .np{grid-column:1/-1}
    .nt{font-size:1.3rem;font-weight:600;margin-bottom:.5rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .nc{font-size:.85rem;color:#94a3b8;margin-bottom:1rem}
    .ct2{display:flex;align-items:center;gap:.5rem}
    .cb{background:#334155;border:none;color:#e2e8f0;width:40px;height:40px;border-radius:50%;font-size:1.1rem;cursor:pointer;display:flex;align-items:center;justify-content:center}
    .cb:hover{background:#475569}
    .cb.p{background:#38bdf8;color:#0f172a}
    .cb.p:hover{background:#7dd3fc}
    .cb.ac{background:#38bdf8;color:#0f172a}
    .vg{display:flex;align-items:center;gap:.5rem;margin-left:auto}
    .vg input[type=range]{width:80px;accent-color:#38bdf8}
    .ql{list-style:none;max-height:200px;overflow-y:auto}
    .qi{padding:.4rem 0;border-bottom:1px solid #334155;font-size:.85rem;display:flex;gap:.5rem}
    .qi:last-child{border-bottom:none}
    .qn{color:#64748b;min-width:20px}
    .qt{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .em{color:#64748b;font-size:.85rem;text-align:center;padding:1rem}
    .ir{display:flex;gap:.5rem;margin-bottom:1rem}
    .ir input{flex:1;padding:.6rem .8rem;background:#0f172a;border:1px solid #334155;border-radius:6px;color:#e2e8f0;font-size:.9rem}
    .ir input:focus{outline:none;border-color:#38bdf8}
    .ir button{padding:.6rem 1rem;background:#38bdf8;color:#0f172a;border:none;border-radius:6px;font-weight:600;cursor:pointer;white-space:nowrap}
    .ir button:hover{background:#7dd3fc}
    .fc{display:flex;gap:.25rem;flex-wrap:wrap;margin-bottom:.75rem}
    .ch{padding:.3rem .6rem;border-radius:20px;font-size:.75rem;background:#334155;color:#94a3b8;border:none;cursor:pointer}
    .ch:hover{background:#475569;color:#e2e8f0}
    .toast{position:fixed;bottom:1.5rem;right:1.5rem;background:#334155;color:#e2e8f0;padding:.75rem 1rem;border-radius:8px;font-size:.85rem;opacity:0;transition:opacity .3s;pointer-events:none;z-index:99}
    .toast.show{opacity:1}
  </style>
</head>
<body>
  <nav class="nv">
    <div class="nb">Rhapsod</div>
    <div class="nl">
      <a class="nk a" href="/" id="nd">Dashboard</a>
      <a class="nk" href="/settings" id="ns">Config</a>
      <a class="nk" href="/commands" id="nc">Comandos</a>
    </div>
    <div class="nr">
      <div class="dot ${connected ? "on" : "off"}" id="dot"></div>
      <span class="st" id="stxt">${connected ? "Conectado" : "Desconectado"}</span>
    </div>
  </nav>
  <div class="mn">
    <div class="g">
      <div class="cd np">
        <div class="ct">Reproduciendo</div>
        <div class="nt" id="nt">${title}</div>
        <div class="nc" id="nc2">Canal ${channel}</div>
        <div class="ct2">
          <button class="cb" onclick="cmd('previous')" title="Anterior">&#9198;</button>
          <button class="cb" onclick="cmd('pause')" title="Pausar">&#9208;</button>
          <button class="cb p" onclick="cmd('resume')" title="Reanudar">&#9654;</button>
          <button class="cb" onclick="cmd('skip')" title="Saltar">&#9197;</button>
          <button class="cb" onclick="cmd('stop')" title="Detener">&#9724;</button>
          <div class="vg">
            <span style="font-size:.8rem;color:#94a3b8">Vol</span>
            <input type="range" min="0" max="100" value="100" id="vol" onchange="cmd('volume '+this.value)">
          </div>
        </div>
      </div>
      <div class="cd" style="grid-column:1/-1">
        <div class="ct">Agregar cancion</div>
        <div class="ir">
          <input id="pi" placeholder="URL o busqueda (YouTube, Spotify, SoundCloud...)" onkeydown="if(event.key==='Enter')play()">
          <button onclick="play()">Reproducir</button>
        </div>
      </div>
      <div class="cd">
        <div class="ct">Cola <span id="qc" style="float:right;color:#64748b">${queueLen} pistas</span></div>
        <ul class="ql" id="ql"></ul>
        <div class="em" id="qe" style="display:${queueLen === 0 ? "block" : "none"}">La cola esta vacia</div>
      </div>
      <div class="cd">
        <div class="ct">Filtros</div>
        <div class="fc">
          <button class="ch" onclick="cmd('bassboost')">Bass</button>
          <button class="ch" onclick="cmd('nightcore')">Nightcore</button>
          <button class="ch" onclick="cmd('vaporwave')">Vaporwave</button>
          <button class="ch" onclick="cmd('8d')">8D</button>
          <button class="ch" onclick="cmd('filter off')">Quitar</button>
        </div>
        <div class="ct" style="margin-top:1rem">Loop</div>
        <div class="fc">
          <button class="ch" onclick="cmd('loop off')">Off</button>
          <button class="ch" onclick="cmd('loop track')">Track</button>
          <button class="ch" onclick="cmd('loop queue')">Queue</button>
        </div>
        <div class="ct" style="margin-top:1rem">Acciones</div>
        <div class="fc">
          <button class="ch" onclick="cmd('shuffle')">Shuffle</button>
          <button class="ch" onclick="cmd('clear')">Clear</button>
          <button class="ch" onclick="cmd('test-tone')">Test Tone</button>
          <button class="ch" onclick="cmd('stats')">Stats</button>
        </div>
      </div>
      <div class="cd" style="grid-column:1/-1">
        <div class="ct">Errores <span id="ec" style="float:right;color:#64748b">0 total</span></div>
        <div class="fc" id="ek"></div>
        <ul class="ql" id="el"></ul>
        <div class="em" id="ee">Sin errores registrados</div>
      </div>
    </div>
  </div>
  <div class="toast" id="toast"></div>
  <script>
    var A='Basic '+btoa('${cred}');
    var H={authorization:A};

    function cmd(c){
      fetch('/api/command',{method:'POST',headers:Object.assign({},H,{'content-type':'application/json'}),body:JSON.stringify({command:c})})
        .then(function(r){return r.json();})
        .then(function(d){toast(d.ok?(d.response||'OK'):'Error: '+(d.error||'desconocido'));if(d.ok)setTimeout(refresh,500);})
        .catch(function(){toast('Error de conexion');});
    }

    function play(){
      var el=document.getElementById('pi');
      var q=el.value.trim();
      if(!q)return;
      el.value='';
      cmd('play '+q);
    }

    function toast(m){
      var el=document.getElementById('toast');
      el.textContent=m;el.classList.add('show');
      setTimeout(function(){el.classList.remove('show');},3000);
    }

    function esc(s){
      return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function refresh(){
      fetch('/api/state',{headers:H}).then(function(r){return r.json();}).then(function(d){
        document.getElementById('nt').textContent=d.currentTitle||'Sin reproducir';
        document.getElementById('nc2').textContent='Canal '+(d.currentChannelId||'-');
        document.getElementById('qc').textContent=d.queueLength+' pistas';
        var dot=document.getElementById('dot');
        var txt=document.getElementById('stxt');
        dot.className='dot '+(d.connected?'on':'off');
        txt.textContent=d.connected?'Conectado':'Desconectado';
        var list=document.getElementById('ql');
        var empty=document.getElementById('qe');
        if(!d.queue||d.queue.length===0){list.innerHTML='';empty.style.display='block';}
        else{
          empty.style.display='none';
          var h='';
          for(var i=0;i<d.queue.length;i++){
            var t=d.queue[i];
            var title=t.title||'Sin titulo';
            h+='<li class="qi"><span class="qn">'+(i+1)+'</span><span class="qt" title="'+title.replace(/"/g,'&quot;')+'">'+title.replace(/</g,'&lt;')+'</span></li>';
          }
          list.innerHTML=h;
        }
      }).catch(function(){});
      fetch('/api/errors',{headers:H}).then(function(r){return r.json();}).then(function(e){
        document.getElementById('ec').textContent=(e.totalErrors||0)+' total';
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
      }).catch(function(){});
    }

    refresh();
    setInterval(refresh,5000);
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
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f172a;color:#e2e8f0}
    .nv{background:#1e293b;border-bottom:1px solid #334155;padding:0 1.5rem;display:flex;align-items:center;height:48px;gap:1.5rem}
    .nb{font-weight:700;font-size:1rem;color:#38bdf8}
    .nl{display:flex;gap:.25rem}
    .nk{padding:.4rem .75rem;border-radius:6px;color:#94a3b8;text-decoration:none;font-size:.85rem}
    .nk:hover,.nk.a{background:#334155;color:#e2e8f0}
    .mn{max-width:600px;margin:0 auto;padding:1.5rem}
    .cd{background:#1e293b;border-radius:10px;padding:1.25rem;margin-bottom:1rem}
    .ct{font-size:.8rem;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:1rem}
    .f{margin-bottom:.75rem}
    .f label{display:block;font-size:.85rem;color:#94a3b8;margin-bottom:.2rem}
    .f input{width:100%;padding:.5rem .7rem;background:#0f172a;border:1px solid #334155;border-radius:6px;color:#e2e8f0;font-size:.9rem}
    .f input:focus{outline:none;border-color:#38bdf8}
    .f .h{font-size:.75rem;color:#64748b;margin-top:.15rem}
    .btn{padding:.6rem 1.5rem;background:#38bdf8;color:#0f172a;border:none;border-radius:6px;font-weight:600;cursor:pointer;font-size:.9rem}
    .btn:hover{background:#7dd3fc}
    .toast{position:fixed;bottom:1.5rem;right:1.5rem;background:#334155;color:#e2e8f0;padding:.75rem 1rem;border-radius:8px;font-size:.85rem;opacity:0;transition:opacity .3s;pointer-events:none;z-index:99}
    .toast.show{opacity:1}
  </style>
</head>
<body>
  <nav class="nv">
    <div class="nb">Rhapsod</div>
    <div class="nl">
      <a class="nk" href="/">Dashboard</a>
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
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f172a;color:#e2e8f0}
    .nv{background:#1e293b;border-bottom:1px solid #334155;padding:0 1.5rem;display:flex;align-items:center;height:48px;gap:1.5rem}
    .nb{font-weight:700;font-size:1rem;color:#38bdf8}
    .nl{display:flex;gap:.25rem}
    .nk{padding:.4rem .75rem;border-radius:6px;color:#94a3b8;text-decoration:none;font-size:.85rem}
    .nk:hover,.nk.a{background:#334155;color:#e2e8f0}
    .mn{max-width:600px;margin:0 auto;padding:1.5rem}
    .cd{background:#1e293b;border-radius:10px;padding:1.25rem;margin-bottom:1rem}
    .ct{font-size:.8rem;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:1rem}
    .sr{width:100%;padding:.6rem .8rem;background:#0f172a;border:1px solid #334155;border-radius:6px;color:#e2e8f0;font-size:.9rem;margin-bottom:1rem}
    .sr:focus{outline:none;border-color:#38bdf8}
    .ci{padding:.5rem 0;border-bottom:1px solid #334155}
    .ci:last-child{border-bottom:none}
    .cn{color:#38bdf8;font-family:monospace;font-size:.9rem;font-weight:600}
    .ca{color:#64748b;font-size:.8rem;font-family:monospace}
    .cd2{color:#94a3b8;font-size:.85rem;margin-top:.15rem}
    .cg{font-size:.7rem;background:#334155;color:#94a3b8;padding:.1rem .4rem;border-radius:4px;margin-left:.5rem}
    .em{color:#64748b;font-size:.85rem;text-align:center;padding:1rem}
  </style>
</head>
<body>
  <nav class="nv">
    <div class="nb">Rhapsod</div>
    <div class="nl">
      <a class="nk" href="/">Dashboard</a>
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
