import { panelScript } from "./panel-scripts.js";

// Shared animated-background system: the fixed aurora layer, its scene
// variants, the motion-pause rule and the scene controls. Every panel page
// includes this so the whole panel moves as one instrument.
export const AMBIENT_CSS = `
@property --song-h{syntax:'<number>';inherits:true;initial-value:142}
:root{--song-h:142;--song:hsl(var(--song-h) 62% 66%);--song-deep:hsl(var(--song-h) 48% 20%);--song-glow:hsl(var(--song-h) 80% 60% / .35);transition:--song-h 1.6s ease}
.ambient .orb{position:absolute;left:50%;top:38%;width:70vmax;height:70vmax;margin:-35vmax 0 0 -35vmax;animation:orb-float 26s ease-in-out infinite alternate;opacity:.5;transition:opacity 1.4s ease}
.ambient .orb::before{content:'';position:absolute;inset:0;border-radius:50%;background:radial-gradient(closest-side,hsl(var(--song-h) 72% 46% / .26),transparent 72%);animation:orb-breathe 5.2s ease-in-out infinite;animation-play-state:paused}
html[data-live=true] .ambient .orb{opacity:1}html[data-live=true] .ambient .orb::before{animation-play-state:running}
.ambient[data-scene=off] .orb{display:none}
@keyframes orb-float{0%{transform:translate(-14vw,-6vh)}50%{transform:translate(10vw,8vh)}100%{transform:translate(16vw,-10vh)}}
@keyframes orb-breathe{50%{transform:scale(1.14);opacity:.75}}
.cd{position:relative;isolation:isolate;transition:border-color .35s ease,box-shadow .35s ease,transform .35s ease}
.cd::before{content:'';position:absolute;inset:0;z-index:-1;border-radius:inherit;pointer-events:none;background:radial-gradient(460px circle at var(--mx,50%) var(--my,-30%),hsl(var(--song-h) 70% 62% / .09),transparent 62%);opacity:0;transition:opacity .4s ease}
.cd:hover::before{opacity:1}.cd:hover{border-color:#ffffff1f;box-shadow:0 22px 60px #00000040}
.tb,.go,.ch,.sg button,.qx,.btn,.scene-tools button{position:relative;overflow:hidden}
.toast{display:flex;align-items:center;gap:10px;border-radius:14px;padding:12px 16px;box-shadow:0 18px 50px #0009;transform:translateY(18px) scale(.95);transition:opacity .3s ease,transform .5s cubic-bezier(.2,1.4,.4,1)}
.toast::before{content:'';width:8px;height:8px;flex-shrink:0;border-radius:50%;background:var(--song);box-shadow:0 0 10px var(--song)}
.toast.show{transform:none}html .toast{border-left:3px solid var(--song)}html .toast.err{border-left-color:var(--rd)}.toast.err::before{background:var(--rd);box-shadow:0 0 10px var(--rd)}
.toast.copy::before{background:var(--ac)}
@view-transition{navigation:auto}
::view-transition-old(root),::view-transition-new(root){animation-duration:.32s;animation-timing-function:cubic-bezier(.2,.8,.2,1)}
.nv{view-transition-name:site-nav}
.nb b{display:inline-block;color:var(--song);transition:color .8s ease}
.nk{position:relative;transition:background .25s ease,color .25s ease}
.nk::after{content:'';position:absolute;left:50%;bottom:3px;width:4px;height:4px;margin-left:-2px;border-radius:50%;background:var(--song);box-shadow:0 0 8px var(--song);transform:scale(0);transition:transform .4s cubic-bezier(.2,1.4,.4,1)}
.nk.a::after{transform:scale(1)}.nk:hover::after{transform:scale(.7)}
.rv-wait{opacity:0;animation:rv-show 0s 2.5s forwards}@keyframes rv-show{to{opacity:1}}@media print{.rv-wait{opacity:1}}

.rp{position:absolute;border-radius:50%;pointer-events:none;background:currentColor;opacity:0;transform:scale(0)}
.ambient{position:fixed;inset:0;z-index:-1;overflow:hidden;pointer-events:none;background:radial-gradient(ellipse at 80% 0%,#17342855,transparent 65%),#090d0c}
.ambient::before,.ambient::after{content:'';position:absolute;width:85vw;height:75vh;left:-20%;top:-30%;border-radius:45%;background:radial-gradient(ellipse,#33734f77,transparent 65%);animation:aurora-drift 28s ease-in-out infinite alternate;will-change:transform}
.ambient::after{left:45%;top:35%;background:radial-gradient(ellipse,#41608033,transparent 65%);animation-delay:-14s;animation-duration:35s}
.ambient[data-scene=ember]::before{background:radial-gradient(ellipse,#b8653544,transparent 65%)}.ambient[data-scene=ember]::after{background:radial-gradient(ellipse,#79505444,transparent 65%)}
.ambient[data-scene=ocean]::before{background:radial-gradient(ellipse,#258c9255,transparent 65%)}.ambient[data-scene=ocean]::after{background:radial-gradient(ellipse,#4157a544,transparent 65%)}
.ambient[data-scene=off]{background:#090d0c}.ambient[data-scene=off]::before,.ambient[data-scene=off]::after{display:none}
@keyframes aurora-drift{to{transform:translate(18vw,16vh) rotate(35deg) scale(1.2)}}
html[data-motion=paused] *,html[data-motion=paused] *::before,html[data-motion=paused] *::after{animation-play-state:paused!important}
.scene-tools{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px;color:var(--dm)}
.scene-tools select{background:#121b16;border:1px solid #ffffff16;color:#d2ded5;padding:9px 26px 9px 10px;border-radius:8px;max-width:150px}
.scene-tools button{background:#121b16;border:1px solid #ffffff16;color:#d2ded5;padding:9px 12px;border-radius:8px;cursor:pointer}
@media(max-width:640px){.scene-tools{gap:6px}.scene-tools label{display:none}.scene-tools select,.scene-tools button{min-height:36px}}
`;

// Served at /favicon.ico so browsers stop logging a 404 on every page load.
// The "r." mark: the wordmark's first letter and its dot. tools/desktop
// draws the same shapes for the tray icon; keep the two in step.
export const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0d1411"/><path d="M21 50V30a14 14 0 0 1 14-14h6" fill="none" stroke="#eef2ec" stroke-width="9"/><circle cx="45" cy="45" r="6" fill="#e88aae"/></svg>`;

export const BRAND_HTML = `rhapsod<b aria-hidden="true"></b>`;

export function statusPillHtml(connected?: boolean): string {
  const on = connected === true;
  const text =
    connected === undefined ? "Conectando…" : on ? "Conectado" : "Desconectado";
  return `<div class="status${on ? " on" : ""}" id="lamp" role="status"><span class="dot ${on ? "on" : "off"}" id="dot"></span><span class="st" id="stxt">${text}</span></div>`;
}

// Last layer on every page: type roles, the wordmark, and scroll areas
// without visible bars. Lists that scroll fade at the clipped edge instead,
// so hidden bars never hide that there is more to see.
export const BRAND_CSS = `
.nb{font-family:var(--dp);font-weight:800;font-size:24px;letter-spacing:-.035em;line-height:1;text-transform:none;display:inline-flex;align-items:baseline;color:#f4f1e8}
.nb b{display:inline-block;width:.25em;height:.25em;margin-left:.07em;border-radius:50%;background:var(--song);transition:background .8s ease}
.page-intro h1,.page-heading h1,.nt,.setup-story h1,.setup-shell h1{font-family:var(--dp);font-weight:600;letter-spacing:-.025em}
.ct,.mini-label,.eyebrow,.sl,.volume-label{font-weight:600}.mini-label,.volume-label{font-family:var(--sn);letter-spacing:.14em}
.record-label{font-family:var(--dp);letter-spacing:0;font-weight:600}
*{scrollbar-width:none}*::-webkit-scrollbar{display:none}
#srvTree,#tree,.ql{overflow-x:hidden}
@property --sf-top{syntax:'<length>';inherits:false;initial-value:0px}
@property --sf-bot{syntax:'<length>';inherits:false;initial-value:0px}
@keyframes scroll-fade{0%{--sf-top:0px;--sf-bot:56px}6%{--sf-top:40px}94%{--sf-bot:56px}100%{--sf-top:40px;--sf-bot:0px}}
@supports (animation-timeline:scroll()){html #srvTree,html .ql,html .dw{-webkit-mask-image:linear-gradient(to bottom,transparent,#000 var(--sf-top),#000 calc(100% - var(--sf-bot)),transparent);mask-image:linear-gradient(to bottom,transparent,#000 var(--sf-top),#000 calc(100% - var(--sf-bot)),transparent);animation:scroll-fade linear both!important;animation-timeline:scroll(self)!important;animation-play-state:running!important}}
@supports not (animation-timeline:scroll()){html #srvTree,html .ql,html .dw{-webkit-mask-image:linear-gradient(to bottom,transparent,#000 var(--sf-top),#000 calc(100% - var(--sf-bot)),transparent);mask-image:linear-gradient(to bottom,transparent,#000 var(--sf-top),#000 calc(100% - var(--sf-bot)),transparent)}}
.status{display:inline-flex;align-items:center;gap:8px;padding:6px 12px 6px 10px;border-radius:999px;border:1px solid #ffffff14;background:#ffffff06;color:#b8c7bc;font-size:12px;font-weight:500;white-space:nowrap;transition:border-color .4s ease,color .4s ease}
.status .st{font-size:12px;color:inherit}
.status.on{color:#eef2ec}
:focus-visible{outline-color:hsl(var(--song-h) 60% 72%)}.tree-hint{font-size:12px;line-height:1.7;color:#91a497;margin:-10px 0 12px}.sg button{letter-spacing:.02em!important}.system-card .sg3{flex:none}.system-card{justify-content:space-between}.command-count{margin-left:8px;color:#7d9284}
.channel-move{min-height:28px;cursor:pointer}.chrow:hover{border-color:#ffffff10}.chrow:has(>.chhead:hover){border-color:hsl(var(--song-h) 55% 62% / .55)}.queue-card .ql{padding:0 10px;margin:0 -10px}
.more{align-self:center;flex:none;margin-top:10px;font:500 12px var(--sn);color:#d6e2da;background:#ffffff0a;border:1px solid #ffffff18;border-radius:999px;padding:5px 14px;cursor:pointer}.more:hover{background:#ffffff14}.more[hidden]{display:none}
.status .dot{width:7px;height:7px;border-radius:50%;background:#7f8c84;flex:none}.status .dot.on{background:var(--ac)}.status .dot.off{background:var(--rd)}
@media(max-width:640px){.nb{font-size:20px}}
.intro{position:fixed;inset:0;z-index:100;display:grid;place-items:center;background:#090d0c;transition:background-color .5s ease;animation:intro-gone 0s 4s forwards}
@keyframes intro-gone{to{visibility:hidden}}
html.intro-on .nv .nb{visibility:hidden;animation:intro-show 0s 4s forwards}
@keyframes intro-show{to{visibility:visible}}
.intro-mark{font-family:var(--dp);font-weight:800;font-size:clamp(56px,11vw,96px);letter-spacing:-.035em;line-height:1;color:#f4f1e8;display:inline-flex;align-items:baseline;transform-origin:0 0;transition:transform .65s cubic-bezier(.7,0,.2,1);animation:intro-in .35s ease-out backwards}
.intro-rest{display:inline-block;overflow:hidden;max-width:0;transition:max-width .6s cubic-bezier(.6,0,.2,1)}
.intro.open .intro-rest{max-width:4.2em}
.intro-mark b{display:inline-block;width:.25em;height:.25em;margin-left:.07em;border-radius:50%;background:var(--song)}
.intro.land{background-color:transparent}
@keyframes intro-in{from{opacity:0;transform:scale(.92)}}
`;

// The intro overlay rides with the ambient layer so every page gets it; its
// script decides before first paint whether it plays at all.
export const AMBIENT_LAYER_HTML = `<div class="ambient" id="ambient" data-scene="aurora" aria-hidden="true"><i class="orb"></i></div><div class="intro" id="intro" aria-hidden="true"><div class="intro-mark">r<span class="intro-rest">hapsod</span><b></b></div></div><script>${panelScript("intro")}</script>`;

export const SCENE_TOOLS_HTML = `<div class="scene-tools"><label for="scene">Ambiente</label><select id="scene" aria-label="Ambiente" onchange="setScene(this.value)"><option value="aurora">Aurora</option><option value="ember">Atardecer</option><option value="ocean">Océano</option><option value="off">Sin fondo</option></select><button id="motionToggle" type="button" onclick="toggleMotion()" aria-pressed="false">Pausar movimiento</button></div>`;

// Every track gets its own hue: the player, progress bar, buttons and the
// ambient orb follow it, so a track change is visible across the room. The
// browser script repeats this exact FNV-1a hash (see AMBIENCE_JS) so the
// server-rendered first paint and later client updates agree.
export const IDLE_SONG_HUE = 142;

export function songHue(title: string | undefined): number {
  if (title === undefined || title.length === 0) return IDLE_SONG_HUE;
  let hash = 2166136261;
  for (let i = 0; i < title.length; i++) {
    hash ^= title.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 360;
}

const LIVE_DECK_CSS = `
.player-card{background:radial-gradient(120% 110% at 0% 0%,hsl(var(--song-h) 40% 19% / .96),transparent 58%),radial-gradient(90% 90% at 100% 100%,hsl(calc(var(--song-h) + 40) 38% 15% / .6),transparent 62%),linear-gradient(125deg,#16211b,#101712 70%)}
.player-card::after{content:'';position:absolute;left:50%;top:50%;width:200%;aspect-ratio:1;border-radius:50%;transform:translate(-50%,-50%);z-index:-1;pointer-events:none;background:conic-gradient(from 0deg,transparent,hsl(var(--song-h) 70% 55% / .12) 40deg,transparent 110deg,transparent 200deg,hsl(calc(var(--song-h) + 60) 70% 55% / .09) 250deg,transparent 320deg);opacity:0;transition:opacity 1.2s ease;animation:aura-spin 26s linear infinite;animation-play-state:paused}
.player-card[data-playing=true]::after{opacity:1;animation-play-state:running}
@keyframes aura-spin{from{transform:translate(-50%,-50%) rotate(0)}to{transform:translate(-50%,-50%) rotate(360deg)}}
.record-stage>.record,.record-stage>.shine{grid-area:1/1}
.record-stage::after{content:none}
.record-stage::before{content:'';position:absolute;inset:-8px;border-radius:50%;background:radial-gradient(closest-side,var(--song-glow),transparent 76%);opacity:0;transform:scale(.9);transition:opacity .9s ease,transform .9s ease}
.player-card[data-playing=true] .record-stage::before{opacity:1;transform:scale(1.08);animation:halo 2.6s ease-in-out infinite}
@keyframes halo{50%{transform:scale(1.18);opacity:.65}}
.record{animation-duration:4.2s}.record::before{content:none}
.record-label{background:radial-gradient(circle at 38% 32%,hsl(var(--song-h) 60% 82%),hsl(var(--song-h) 46% 60%));color:hsl(var(--song-h) 45% 15%);transition:background .8s ease}
.shine{width:174px;height:174px;border-radius:50%;pointer-events:none;background:conic-gradient(from 20deg,transparent,#ffffff17 24deg,transparent 60deg,transparent 180deg,#ffffff12 204deg,transparent 244deg)}
.tonearm{position:absolute;right:-6px;top:0;width:14px;height:134px;z-index:2;transform-origin:7px 7px;transform:rotate(-6deg);transition:transform 1.2s cubic-bezier(.45,.05,.2,1);filter:drop-shadow(3px 6px 4px #0008)}
.player-card[data-playing=true] .tonearm{transform:rotate(19deg)}
.tonearm .pivot{position:absolute;left:0;top:0;width:14px;height:14px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#e8efe6,#76867a 58%,#39443c);box-shadow:0 0 0 3px #0b100c}
.tonearm .arm{position:absolute;left:5px;top:7px;width:4px;height:112px;border-radius:4px;background:linear-gradient(90deg,#56665a,#cfd9cd,#526257)}
.tonearm .head{position:absolute;left:1px;top:112px;width:12px;height:21px;border-radius:4px 4px 8px 8px;background:linear-gradient(#c3cec1,#667669);transform:rotate(12deg)}
.ns-row{display:flex;align-items:center;gap:12px;margin-bottom:12px}.ns-row .ns{margin-bottom:0}
.player-card[data-playing=true] .ns{color:var(--song)}
.eq{display:inline-flex;align-items:flex-end;gap:3px;height:14px}
.eq i{width:3px;height:100%;border-radius:4px;background:var(--song);transform-origin:bottom;transform:scaleY(.18);transition:transform .5s ease}
.player-card[data-playing=true] .eq i{animation:eq 1s ease-in-out infinite}
.player-card[data-playing=true] .eq i:nth-child(2){animation-duration:.72s;animation-delay:-.25s}
.player-card[data-playing=true] .eq i:nth-child(3){animation-duration:1.18s;animation-delay:-.5s}
.player-card[data-playing=true] .eq i:nth-child(4){animation-duration:.86s;animation-delay:-.1s}
.player-card[data-playing=true] .eq i:nth-child(5){animation-duration:1.32s;animation-delay:-.7s}
@keyframes eq{0%,100%{transform:scaleY(.2)}50%{transform:scaleY(1)}}
.nt{background:linear-gradient(95deg,#f7f3ea 30%,hsl(var(--song-h) 62% 80%));-webkit-background-clip:text;background-clip:text;color:transparent}
.sk{transition:height .2s ease}.sk:hover,.sk:focus-visible{height:8px}
.skf{background:linear-gradient(90deg,hsl(var(--song-h) 50% 48%),var(--song));box-shadow:0 0 14px var(--song-glow);transition:none}
.skf::after{background:#fff;box-shadow:0 0 0 4px hsl(var(--song-h) 70% 60% / .25),0 0 16px var(--song-glow)}
.player-card[data-playing=true] .skf::after{animation:knob 1.8s ease-in-out infinite}
@keyframes knob{50%{box-shadow:0 0 0 8px hsl(var(--song-h) 70% 60% / .1),0 0 24px var(--song-glow)}}
.sk.live .skf{background:repeating-linear-gradient(115deg,var(--song) 0 8px,hsl(var(--song-h) 45% 38%) 8px 16px)}
.tb:hover{transform:translateY(-2px);color:#eef5ec}
.tb.main{background:var(--song);color:hsl(var(--song-h) 50% 12%);box-shadow:0 8px 26px var(--song-glow);transition:background .8s ease,box-shadow .3s ease,transform .2s ease}
.player-card[data-playing=true] .tb.main{animation:pp-pulse 2.4s ease-in-out infinite}
@keyframes pp-pulse{50%{box-shadow:0 8px 38px hsl(var(--song-h) 80% 60% / .6),0 0 0 6px hsl(var(--song-h) 70% 60% / .08)}}
.go{background:linear-gradient(135deg,hsl(var(--song-h) 55% 76%),hsl(var(--song-h) 48% 62%));color:hsl(var(--song-h) 50% 12%);transition:transform .2s ease,box-shadow .3s ease,background .8s ease}
.go:hover{transform:translateY(-1px);box-shadow:0 10px 28px var(--song-glow)}
.ch:hover{border-color:hsl(var(--song-h) 50% 60% / .45);color:#e7efe5}
.ir input{transition:border-color .25s ease,box-shadow .25s ease}.ir input:focus{border-color:hsl(var(--song-h) 55% 60% / .7);box-shadow:0 0 0 4px hsl(var(--song-h) 60% 55% / .12)}
.sg button{transition:background .3s ease,color .3s ease}.sg button.on{background:var(--song);color:hsl(var(--song-h) 50% 12%)}
.dot{position:relative}.dot.on::after{content:'';position:absolute;inset:0;border-radius:50%;background:var(--ac);animation:ping 2.4s cubic-bezier(0,0,.2,1) infinite}
@keyframes ping{75%,100%{transform:scale(2.8);opacity:0}}
html[data-live=true] .nb b{animation:beat 1.2s ease-in-out infinite}
@keyframes beat{0%,40%,100%{transform:scale(1)}14%{transform:scale(1.6)}}
.page-intro h1 span{background:linear-gradient(100deg,#8b9b90 20%,hsl(var(--song-h) 62% 76%) 48%,#8b9b90 76%);background-size:240% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:shimmer 7s ease-in-out infinite alternate}
@keyframes shimmer{from{background-position:100% 0}to{background-position:0 0}}
.queue-card .qi{margin:0 -10px;padding-left:10px;padding-right:10px;border-radius:8px;transition:background .25s ease,transform .25s ease}
.queue-card .qi:hover{background:#ffffff08}
.queue-card .qi:first-child{background:linear-gradient(90deg,hsl(var(--song-h) 40% 30% / .3),transparent 85%);box-shadow:inset 3px 0 0 var(--song)}
.queue-card .qi:first-child .qn{color:var(--song)}
.qx{transition:background .2s ease,color .2s ease}.qx:hover{background:#f8717122;color:var(--rd)}
.av{display:inline-grid;place-items:center;width:18px;height:18px;margin-right:7px;border-radius:50%;vertical-align:middle;font:700 11px var(--mn);background:hsl(var(--h,142) 42% 30%);color:hsl(var(--h,142) 75% 86%)}
.chat-card .qi{transition:background .25s ease}.chat-card .qi:hover{background:#ffffff05}
.stt{transition:transform .25s ease,background .25s ease}.stt:hover{transform:translateY(-2px);background:#0c1610}
.sv.am{color:var(--song)}
.vg input[type=range]{accent-color:var(--song)}
.vg input[type=range]::-webkit-slider-thumb{background:var(--song);box-shadow:0 0 0 1px var(--song),0 0 12px var(--song-glow)}
.vg input[type=range]::-moz-range-thumb{background:var(--song);box-shadow:0 0 0 1px var(--song),0 0 12px var(--song-glow)}
.vg .vv{color:var(--song)}
.chrow.here{background:hsl(var(--song-h) 32% 17% / .6);border-color:hsl(var(--song-h) 45% 55% / .45)}
.botpill{background:var(--song);color:hsl(var(--song-h) 50% 12%)}
.chrow{transition:border-color .25s ease,background .25s ease}
.sk-tip{position:absolute;bottom:16px;left:0;transform:translateX(-50%);padding:3px 7px;border-radius:8px;background:#0b120ee8;border:1px solid hsl(var(--song-h) 45% 55% / .4);font:12px var(--mn);color:#eef5ec;white-space:nowrap;pointer-events:none;opacity:0;transition:opacity .15s ease}
.sk:hover .sk-tip:not(:empty){opacity:1}
.vg input[type=range]{background:linear-gradient(90deg,var(--song) calc(var(--v,50) * 1%),#2b2b30 0)}
.empty-mark{animation:float-mark 3.4s ease-in-out infinite}
@keyframes float-mark{50%{transform:translateY(-5px);color:var(--song)}}
.cd{transition:border-color .35s ease,box-shadow .35s ease,transform .35s ease,filter .6s ease}
html[data-offline=true] .player-card,html[data-offline=true] .queue-card,html[data-offline=true] .server-card{filter:grayscale(.75) brightness(.8)}
html[data-offline=true] .status{opacity:.6}
@media(max-width:640px){.tonearm{scale:.5}.shine{width:88px;height:88px}.ns-row{margin-bottom:8px}}

`;

export const DASHBOARD_CSS = `${AMBIENT_CSS}
html{color-scheme:dark;scroll-behavior:smooth}
body{background:#090d0c;font-size:13px;isolation:isolate}
button,input,select{font:inherit}button,a,input,select{-webkit-tap-highlight-color:transparent}button{transition:background .18s,border-color .18s,transform .18s}button:disabled{opacity:.45;cursor:wait}
.nv{height:76px;padding:0 max(28px,calc((100vw - 1320px)/2 + 28px));background:#090d0ce8;border-bottom:1px solid #ffffff0d;gap:44px;backdrop-filter:blur(18px)}
.nb{font-size:20px;letter-spacing:.12em}.nl{gap:6px}.nk{font-size:12px;padding:10px 14px;border-radius:8px}.nk.a{background:#ffffff08;color:#d9f8df}.nr{gap:10px}.st{font-size:12px}.dot{width:6px;height:6px}
.mn{max-width:1320px;padding:38px 28px 48px}.page-intro{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-bottom:28px}.eyebrow{font:12px var(--mn);letter-spacing:.2em;text-transform:uppercase;color:#92aa9a;margin-bottom:9px}.page-intro h1{font-size:clamp(28px,4vw,40px);line-height:1.15;font-weight:500;letter-spacing:-1.4px;color:#f4f1e8}.page-intro h1 span{color:#8b9b90}.intro-note{margin-top:12px;font-size:12px;line-height:1.8;color:#95a299}.page-tools{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.g{grid-template-columns:repeat(12,minmax(0,1fr));grid-auto-flow:row dense;gap:18px;align-items:stretch}.g>.cd{min-width:0}.cd{background:#111914ed;border:1px solid #ffffff10;border-radius:14px;padding:22px;box-shadow:0 8px 32px #00000012}.ct{font-size:12px;letter-spacing:.14em;color:#c0cec4;margin-bottom:20px}.ct .rv{font-size:12px;color:#91a497}.section-no{color:#8a9e90;margin-right:9px;font:12px var(--mn)}
.player-card{grid-column:span 8;display:flex;flex-direction:column;position:relative;overflow:hidden;background:linear-gradient(125deg,#1c2c21f2,#111914f5 65%)}.player-card .deck{flex:1}.queue-card{grid-column:span 4;display:flex;flex-direction:column;contain:size;min-height:390px;overflow:hidden}.queue-card .ql{flex:1 1 0;min-height:0;max-height:none;overflow:auto}.request-card,.errors-card,.notices-card,.g>.fw{grid-column:1/-1}.notices-card[hidden]{display:none}.notices-card{border-color:#ffffff1a}.notices-card[data-worst=critical]{border-color:#d0715f73;box-shadow:inset 3px 0 0 #e0806b}.notices-card[data-worst=error]{border-color:#d9a0646b;box-shadow:inset 3px 0 0 #e3a86a}.notices-card[data-worst=warning]{box-shadow:inset 3px 0 0 #d8c47a}.notices-card .ct{margin-bottom:6px}.notice-list{list-style:none;margin:0;padding:0}.notice{display:grid;grid-template-columns:78px minmax(0,1fr) auto;column-gap:16px;align-items:start;padding:14px 0;border-top:1px solid #ffffff0b}.notice:first-child{border-top:0}.notice.ignored{opacity:.55}.sev{justify-self:start;font:12px var(--mn);letter-spacing:.12em;text-transform:uppercase;padding:4px 8px;border-radius:8px;border:1px solid #ffffff1f;color:#b8c7bc}.sev-critical{color:#ffc2b6;background:#5a1d1640;border-color:#c25b4a80}.sev-error{color:#f6c893;background:#5a3a1640;border-color:#c2874a66}.sev-warning{color:#eadb98;background:#4f471a33;border-color:#b8a4506b}.sev-info{color:#b3d0e0;background:#1a3a4f33;border-color:#4f86a866}.notice-title{font-size:13px;line-height:1.5;color:#eef4eb;overflow-wrap:anywhere}.notice-detail{font-size:12px;line-height:1.7;color:#a9bbae;margin-top:3px;overflow-wrap:anywhere}.notice-meta{font:12px var(--mn);color:#7f9486;margin-top:6px}.notice .ch{white-space:nowrap}@media(max-width:640px){.notice{grid-template-columns:minmax(0,1fr) auto;row-gap:8px}.notice .sev{grid-column:1/-1}}.sound-card,.server-card{grid-column:span 6}.system-card{grid-column:span 4;display:flex;flex-direction:column}.system-card .sg3{flex:1}.system-card .stt{display:flex;flex-direction:column;justify-content:center}.chat-card{grid-column:span 8}
.deck{display:grid;grid-template-columns:190px minmax(0,1fr);column-gap:28px;align-items:center;align-content:center;background:none;border:0;box-shadow:none;padding:0;margin:12px 0 26px}.record-stage{grid-row:1/5;width:190px;height:190px;position:relative;display:grid;place-items:center}.record{width:174px;height:174px;border-radius:50%;background:repeating-radial-gradient(circle at center,#151918 0 1px,#232b24 2px,#101411 3px,#171d18 4px);border:1px solid #354238;box-shadow:0 12px 35px #0009,inset 0 0 0 5px #0c100d;position:relative;animation:record-spin 18s linear infinite;animation-play-state:paused}.record::before{content:'';position:absolute;inset:0;border-radius:50%;background:conic-gradient(from 25deg,transparent,#cedbd61c 30deg,transparent 70deg,transparent 180deg,#cedbd620 210deg,transparent 255deg)}.record-label{position:absolute;inset:54px;border-radius:50%;background:#bad4a8;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#1d3828;font:12px var(--mn);letter-spacing:1px;box-shadow:0 0 0 4px #080c0999}.record-label b{font-size:20px;margin-bottom:1px}.record-label::after{content:'';width:6px;height:6px;border-radius:50%;background:#101811;margin-top:6px}.record-stage::after{content:'';position:absolute;right:1px;top:10px;width:5px;height:100px;background:linear-gradient(90deg,#55695b,#b0b9ae,#4b5f50);transform:rotate(-22deg);transform-origin:top;border-radius:4px;box-shadow:3px 4px 5px #0005}.player-card[data-playing=true] .record{animation-play-state:running}@keyframes record-spin{to{transform:rotate(360deg)}}
.ns{font-size:12px;letter-spacing:.2em;margin-bottom:12px;display:flex;align-items:center;gap:8px}.ns::before{content:'';width:5px;height:5px;border-radius:50%;background:currentColor}.nt{font-size:clamp(24px,2.8vw,38px);line-height:1.15;letter-spacing:-1.2px;font-weight:500;color:#f6f2e8;white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}.track-detail{font-size:12px;color:#9bae9e;line-height:1.6;margin:10px 0 14px;min-height:19px}.track-detail:empty{display:none}.track-detail b{color:#e3ece5;font-weight:600}.nt+.progress-block,.nt+.track-detail:empty+.progress-block{margin-top:22px}.progress-block{grid-column:2}.tm{font-size:12px;margin:10px 0 0;color:#b5c9bc}.sk{height:5px;border:0;background:#ffffff15;border-radius:4px;overflow:visible}.skf{border-radius:4px;background:#bdd6a9}.skf::after{content:'';position:absolute;right:-3px;top:-2px;width:9px;height:9px;border-radius:50%;background:#d6edc4}.tp{gap:10px;border-top:1px solid #ffffff0b;padding-top:20px}.tb{height:38px;width:38px;border:0;border-radius:50%;box-shadow:none;background:transparent;font-size:16px;color:#b0c3b5}.tb:hover{background:#ffffff0b}.tb.main{height:48px;width:48px;background:#d0e6b9;color:#18251a;font-size:16px}.tb.dng{color:#b0c3b5}.vg{gap:10px}.vg .vv{color:#b0c3b5;font-size:12px}.vg input[type=range]{width:90px}.volume-label{font:12px var(--mn);letter-spacing:.1em;color:#91a497}.player-links{margin-left:14px;display:flex;gap:8px}.player-links .ch{background:none;border-color:#ffffff14}
.request-card{padding:18px 22px}.request-card .ct{margin-bottom:12px}.ir{gap:8px}.ir input{background:#080f0b80;border-color:#ffffff12;padding:12px 14px;border-radius:8px;font-size:12px}.go{background:#c9e3b2;color:#19271c;font-size:12px;padding:12px 20px;border-radius:8px}.nx{font-size:12px;margin-top:10px}.nx input{width:13px;height:13px}.queue-card .ql{min-height:120px}.queue-card .qi{padding:9px 0;gap:6px 10px;flex-wrap:wrap;border-color:#ffffff09}.queue-card .qn{font-size:12px;min-width:18px}.queue-card .qt{font-size:12px;line-height:1.5;flex-basis:calc(100% - 90px);white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}.queue-card .qr{font-size:12px;margin-left:28px;max-width:90%;order:2;color:#8d9f93}.qx{border:0;background:#ffffff05;color:#93a499;width:30px;height:30px;border-radius:8px}.queue-footer{border-top:1px solid #ffffff0c;margin-top:16px;padding-top:16px;display:flex;justify-content:space-between;gap:8px}.queue-footer .ch{font-size:12px}.em{font-size:12px;color:#91a497;line-height:1.7;padding:22px 10px}.empty-mark{font-size:30px;color:#64836e;display:block;margin-bottom:10px}
.sg{border-color:#ffffff12;background:#080f0b70;border-radius:8px}.sg button{font-size:12px;padding:10px 4px;letter-spacing:.07em}.sg button.on{background:#bdd6a9;color:#1b2d21}.ch{font-size:12px;padding:7px 10px;background:#0a120d66;border-color:#ffffff10;border-radius:8px}.fc{gap:7px}.sound-card .ir{margin-top:12px}.sound-card .ir input{width:100%;padding:10px}.sound-card .go{padding:10px}.mini-label{font:12px var(--mn);text-transform:uppercase;letter-spacing:.13em;color:#91a497;margin:20px 0 10px}.helper{font-size:12px;line-height:1.7;color:#91a497}.tree-hint{margin:-10px 0 12px}.sound-card .sg{margin:12px 0}.server-card{display:flex;flex-direction:column;contain:size;min-height:320px}.server-card #srvTree{flex:1 1 0;min-height:0;overflow:auto}.chat-card .ql{max-height:260px;overflow:auto}.chrow{background:#0a120d66;border-color:#ffffff0c;padding:11px;border-radius:8px}.chrow.here{background:#1c332288;border-color:#62856a55}.chnm{font-size:12px}.users li{font-size:12px;line-height:1.7}.botpill{font-size:12px;letter-spacing:.08em;background:#bdd6a9}.chct{font-size:12px}.chat-card .ql{min-height:100px}.chat-card .qi{font-size:12px;line-height:1.6;border-color:#ffffff09;padding:9px 0;flex-wrap:wrap}.chat-card .qn{font-size:12px}.chat-card .cmt{flex-basis:55%}.cnm{color:#c1d8b2}.cmB{color:#91bda2}.sg3{gap:8px}.stt{border:0;background:#080f0b70;border-radius:8px;padding:12px 4px}.sv{font-size:20px}.sv.am{color:#bdd6a9}.sl{font-size:12px;letter-spacing:.1em}.system-card .ct .rv{font-size:12px}.errors-card .ct{margin-bottom:8px}.errors-card .qt,.errors-card .qn{font-size:12px}.errors-card .em{text-align:left;padding:8px 0}.dw{background:#080f0b;color:#c4d4c9;border-color:#ffffff0e}.page-footer{display:flex;justify-content:space-between;gap:16px;color:#718679;font:12px var(--mn);letter-spacing:.1em;padding-top:12px}.page-footer a{color:#a6bcad;text-decoration:none}.toast{background:#17251d;border-color:#375b42;color:#eff4eb;font-size:12px}
@media(min-width:1500px){.mn{padding-top:44px}.deck{column-gap:38px}.player-card{padding:26px}}@media(max-width:1050px){.g>.cd{grid-column:1/-1}.server-card{contain:none;min-height:0}.server-card #srvTree{flex:none;max-height:420px}.queue-card{contain:none;min-height:0}.queue-card .ql{flex:none;max-height:500px}.nv{gap:24px;padding:0 24px}}
@media(max-width:640px){.nv{height:auto;min-height:64px;flex-wrap:wrap;gap:12px;padding:16px 18px 0}.nb{font-size:16px}.nr{order:1}.nl{order:2;width:100%;justify-content:space-between;padding:0 0 10px;gap:0}.nk{font-size:12px;padding:8px 10px}.mn{padding:25px 16px}.page-intro{align-items:flex-start;flex-direction:column;gap:18px;margin-bottom:22px}.page-intro h1{font-size:30px}.scene-tools{width:100%;justify-content:flex-end}.scene-tools label{margin-right:auto}.g{grid-template-columns:minmax(0,1fr);gap:14px}.g>.cd{grid-column:1;grid-row:auto}.cd{padding:18px}.deck{grid-template-columns:90px minmax(0,1fr);column-gap:16px;margin:20px 0}.record-stage{width:90px;height:100px}.record{width:88px;height:88px}.record-label{inset:28px;font-size:4px;letter-spacing:0}.record-label b{font-size:12px}.record-label::after{width:3px;height:3px;margin-top:2px}.record-stage::after{height:50px;width:3px;top:4px;right:0}.nt{font-size:24px;letter-spacing:-.7px;display:block;overflow:visible}.ns{font-size:12px;margin-bottom:8px}.track-detail{font-size:12px;margin:8px 0}.progress-block{grid-column:1/-1;margin-top:22px}.player-card{min-height:0}.tp{gap:6px;padding-top:16px}.tb{width:32px;height:36px}.tb.main{width:43px;height:43px}.player-links{margin-left:auto}.vg{width:100%;justify-content:flex-end;margin-top:12px;padding-top:12px;border-top:1px solid #ffffff0b}.vg input[type=range]{width:130px}.volume-label{margin-right:auto}.queue-card .ql{min-height:0;max-height:320px}.ir input{font-size:12px}.go{padding:12px}.page-footer{font-size:12px;line-height:1.8}.scene-tools select,.scene-tools button{min-height:36px}.qx{width:36px;height:36px}.ch{min-height:32px}}

${LIVE_DECK_CSS}
${BRAND_CSS}
`;

export const AMBIENCE_JS = panelScript("ambience");
