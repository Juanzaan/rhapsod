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
.toast{display:flex;align-items:center;gap:10px;border-radius:12px;padding:12px 16px;box-shadow:0 18px 50px #0009;transform:translateY(18px) scale(.95);transition:opacity .3s ease,transform .5s cubic-bezier(.2,1.4,.4,1)}
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
.rv-wait{opacity:0}
@media(prefers-reduced-motion:reduce){::view-transition-group(*),::view-transition-old(*),::view-transition-new(*){animation:none!important}.rv-wait{opacity:1}}
.rp{position:absolute;border-radius:50%;pointer-events:none;background:currentColor;opacity:0;transform:scale(0)}
.ambient{position:fixed;inset:0;z-index:-1;overflow:hidden;pointer-events:none;background:radial-gradient(ellipse at 80% 0%,#17342855,transparent 65%),#090d0c}
.ambient::before,.ambient::after{content:'';position:absolute;width:85vw;height:75vh;left:-20%;top:-30%;border-radius:45%;background:radial-gradient(ellipse,#33734f77,transparent 65%);animation:aurora-drift 28s ease-in-out infinite alternate;will-change:transform}
.ambient::after{left:45%;top:35%;background:radial-gradient(ellipse,#41608033,transparent 65%);animation-delay:-14s;animation-duration:35s}
.ambient[data-scene=ember]::before{background:radial-gradient(ellipse,#b8653544,transparent 65%)}.ambient[data-scene=ember]::after{background:radial-gradient(ellipse,#79505444,transparent 65%)}
.ambient[data-scene=ocean]::before{background:radial-gradient(ellipse,#258c9255,transparent 65%)}.ambient[data-scene=ocean]::after{background:radial-gradient(ellipse,#4157a544,transparent 65%)}
.ambient[data-scene=off]{background:#090d0c}.ambient[data-scene=off]::before,.ambient[data-scene=off]::after{display:none}
@keyframes aurora-drift{to{transform:translate(18vw,16vh) rotate(35deg) scale(1.2)}}
html[data-motion=paused] *,html[data-motion=paused] *::before,html[data-motion=paused] *::after{animation-play-state:paused!important}
.scene-tools{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:11px;color:var(--dm)}
.scene-tools select{background:#121b16;border:1px solid #ffffff16;color:#d2ded5;padding:9px 26px 9px 10px;border-radius:8px;max-width:150px}
.scene-tools button{background:#121b16;border:1px solid #ffffff16;color:#d2ded5;padding:9px 12px;border-radius:8px;cursor:pointer}
@media(max-width:640px){.scene-tools{gap:6px}.scene-tools label{display:none}.scene-tools select,.scene-tools button{min-height:36px}}
`;

// Served at /favicon.ico so browsers stop logging a 404 on every page load.
export const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="#101412"/><circle cx="32" cy="32" r="24" fill="none" stroke="#232b24" stroke-width="2"/><circle cx="32" cy="32" r="17" fill="none" stroke="#232b24" stroke-width="2"/><circle cx="32" cy="32" r="10" fill="#1ED760"/><circle cx="32" cy="32" r="2.5" fill="#101412"/></svg>`;

export const AMBIENT_LAYER_HTML = `<div class="ambient" id="ambient" data-scene="aurora" aria-hidden="true"><i class="orb"></i></div>`;

export const SCENE_TOOLS_HTML = `<div class="scene-tools"><label for="scene">Ambiente</label><select id="scene" onchange="setScene(this.value)"><option value="aurora">Aurora</option><option value="ember">Atardecer</option><option value="ocean">Océano</option><option value="off">Sin fondo</option></select><button id="motionToggle" type="button" onclick="toggleMotion()" aria-pressed="false">Pausar movimiento</button></div>`;

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
.tonearm .arm{position:absolute;left:5px;top:7px;width:4px;height:112px;border-radius:3px;background:linear-gradient(90deg,#56665a,#cfd9cd,#526257)}
.tonearm .head{position:absolute;left:1px;top:112px;width:12px;height:21px;border-radius:3px 3px 6px 6px;background:linear-gradient(#c3cec1,#667669);transform:rotate(12deg)}
.ns-row{display:flex;align-items:center;gap:12px;margin-bottom:12px}.ns-row .ns{margin-bottom:0}
.player-card[data-playing=true] .ns{color:var(--song)}
.eq{display:inline-flex;align-items:flex-end;gap:3px;height:14px}
.eq i{width:3px;height:100%;border-radius:2px;background:var(--song);transform-origin:bottom;transform:scaleY(.18);transition:transform .5s ease}
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
.lamp.on{animation:onair 2.8s ease-in-out infinite}
@keyframes onair{50%{box-shadow:0 0 20px #1ed76055;background:#1ed76028}}
.dot{position:relative}.dot.on::after{content:'';position:absolute;inset:0;border-radius:50%;background:var(--ac);animation:ping 2.4s cubic-bezier(0,0,.2,1) infinite}
@keyframes ping{75%,100%{transform:scale(2.8);opacity:0}}
html[data-live=true] .nb b{animation:beat 1.2s ease-in-out infinite}
@keyframes beat{0%,40%,100%{transform:scale(1)}14%{transform:scale(1.6)}}
.page-intro h1 span{background:linear-gradient(100deg,#8b9b90 20%,hsl(var(--song-h) 62% 76%) 48%,#8b9b90 76%);background-size:240% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:shimmer 7s ease-in-out infinite alternate}
@keyframes shimmer{from{background-position:100% 0}to{background-position:0 0}}
.queue-card .qi{margin:0 -10px;padding-left:10px;padding-right:10px;border-radius:10px;transition:background .25s ease,transform .25s ease}
.queue-card .qi:hover{background:#ffffff08;transform:translateX(3px)}
.queue-card .qi:first-child{background:linear-gradient(90deg,hsl(var(--song-h) 40% 30% / .3),transparent 85%);box-shadow:inset 3px 0 0 var(--song)}
.queue-card .qi:first-child .qn{color:var(--song)}
.qx{transition:background .2s ease,color .2s ease}.qx:hover{background:#f8717122;color:var(--rd)}
.av{display:inline-grid;place-items:center;width:18px;height:18px;margin-right:7px;border-radius:50%;vertical-align:middle;font:700 9px var(--mn);background:hsl(var(--h,142) 42% 30%);color:hsl(var(--h,142) 75% 86%)}
.chat-card .qi{transition:background .25s ease}.chat-card .qi:hover{background:#ffffff05}
.stt{transition:transform .25s ease,background .25s ease}.stt:hover{transform:translateY(-2px);background:#0c1610}
.sv.am{color:var(--song)}
.vg input[type=range]{accent-color:var(--song)}
.vg input[type=range]::-webkit-slider-thumb{background:var(--song);box-shadow:0 0 0 1px var(--song),0 0 12px var(--song-glow)}
.vg input[type=range]::-moz-range-thumb{background:var(--song);box-shadow:0 0 0 1px var(--song),0 0 12px var(--song-glow)}
.vg .vv{color:var(--song)}
.chrow.here{background:hsl(var(--song-h) 32% 17% / .6);border-color:hsl(var(--song-h) 45% 55% / .45)}
.botpill{background:var(--song);color:hsl(var(--song-h) 50% 12%)}
.chrow{transition:border-color .25s ease,background .25s ease,transform .25s ease}.chrow:hover{transform:translateX(2px)}
.sk-tip{position:absolute;bottom:16px;left:0;transform:translateX(-50%);padding:3px 7px;border-radius:6px;background:#0b120ee8;border:1px solid hsl(var(--song-h) 45% 55% / .4);font:10px var(--mn);color:#eef5ec;white-space:nowrap;pointer-events:none;opacity:0;transition:opacity .15s ease}
.sk:hover .sk-tip:not(:empty){opacity:1}
.vg input[type=range]{background:linear-gradient(90deg,var(--song) calc(var(--v,50) * 1%),#2b2b30 0)}
.empty-mark{animation:float-mark 3.4s ease-in-out infinite}
@keyframes float-mark{50%{transform:translateY(-5px);color:var(--song)}}
.cd{transition:border-color .35s ease,box-shadow .35s ease,transform .35s ease,filter .6s ease}
html[data-offline=true] .player-card,html[data-offline=true] .queue-card,html[data-offline=true] .server-card{filter:grayscale(.75) brightness(.8)}
html[data-offline=true] .lamp{opacity:.4}
@media(max-width:640px){.tonearm{scale:.5}.shine{width:88px;height:88px}.ns-row{margin-bottom:8px}}
@media(prefers-reduced-motion:reduce){.player-card::after,.record-stage::before,.eq i,.skf::after,.tb.main,.lamp.on,.dot.on::after,.nb b,.page-intro h1 span,.ambient .orb,.ambient .orb::before,.empty-mark{animation:none!important}.tonearm,.cd,.toast{transition:none}}
`;

export const DASHBOARD_CSS = `${AMBIENT_CSS}
html{color-scheme:dark;scroll-behavior:smooth}
body{background:#090d0c;font-size:14px;isolation:isolate}
button,input,select{font:inherit}button,a,input,select{-webkit-tap-highlight-color:transparent}button{transition:background .18s,border-color .18s,transform .18s}button:disabled{opacity:.45;cursor:wait}
.nv{height:76px;padding:0 max(28px,calc((100vw - 1380px)/2));background:#090d0ce8;border-bottom:1px solid #ffffff0d;gap:44px;backdrop-filter:blur(18px)}
.nb{font-size:19px;letter-spacing:.12em}.nl{gap:6px}.nk{font-size:12px;padding:10px 14px;border-radius:8px}.nk.a{background:#ffffff08;color:#d9f8df}.nr{gap:10px}.lamp{font-size:9px;letter-spacing:.12em;border-radius:20px;padding:5px 9px}.lamp.on{box-shadow:none;background:#1ed76015;color:var(--ac);border-color:#1ed76035}.st{font-size:11px}.dot{width:6px;height:6px}
.mn{max-width:1380px;padding:34px 28px 48px}.page-intro{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-bottom:28px}.eyebrow{font:10px var(--mn);letter-spacing:.2em;text-transform:uppercase;color:#92aa9a;margin-bottom:9px}.page-intro h1{font-size:clamp(25px,3vw,36px);font-weight:500;letter-spacing:-1.4px;color:#f4f1e8}.page-intro h1 span{color:#8b9b90}.intro-note{margin-top:8px;font-size:12px;color:#95a299}.page-tools{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.g{grid-template-columns:minmax(0,1.2fr) minmax(0,1fr) minmax(280px,.85fr);gap:18px;align-items:start}.g>.cd{min-width:0}.cd{background:#111914ed;border:1px solid #ffffff10;border-radius:16px;padding:22px;box-shadow:0 8px 32px #00000012}.ct{font-size:10px;letter-spacing:.14em;color:#c0cec4;margin-bottom:20px}.ct .rv{font-size:10px;color:#91a497}.section-no{color:#8a9e90;margin-right:9px;font:10px var(--mn)}
.player-card{grid-column:1/3;grid-row:1;position:relative;overflow:hidden;min-height:368px;background:linear-gradient(125deg,#1c2c21f2,#111914f5 65%)}.queue-card{grid-column:3;grid-row:1/3;align-self:stretch}.request-card{grid-column:1/3;grid-row:2}.sound-card{grid-column:1;grid-row:3}.discovery-card{grid-column:2;grid-row:3}.server-card{grid-column:3;grid-row:3}.chat-card{grid-column:1/3}.system-card{grid-column:3}.errors-card{grid-column:1/-1}
.deck{display:grid;grid-template-columns:190px minmax(0,1fr);column-gap:28px;align-items:center;background:none;border:0;box-shadow:none;padding:0;margin:12px 0 26px}.record-stage{grid-row:1/5;width:190px;height:190px;position:relative;display:grid;place-items:center}.record{width:174px;height:174px;border-radius:50%;background:repeating-radial-gradient(circle at center,#151918 0 1px,#232b24 2px,#101411 3px,#171d18 4px);border:1px solid #354238;box-shadow:0 12px 35px #0009,inset 0 0 0 5px #0c100d;position:relative;animation:record-spin 18s linear infinite;animation-play-state:paused}.record::before{content:'';position:absolute;inset:0;border-radius:50%;background:conic-gradient(from 25deg,transparent,#cedbd61c 30deg,transparent 70deg,transparent 180deg,#cedbd620 210deg,transparent 255deg)}.record-label{position:absolute;inset:54px;border-radius:50%;background:#bad4a8;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#1d3828;font:8px var(--mn);letter-spacing:1px;box-shadow:0 0 0 4px #080c0999}.record-label b{font-size:22px;margin-bottom:1px}.record-label::after{content:'';width:6px;height:6px;border-radius:50%;background:#101811;margin-top:6px}.record-stage::after{content:'';position:absolute;right:1px;top:10px;width:5px;height:100px;background:linear-gradient(90deg,#55695b,#b0b9ae,#4b5f50);transform:rotate(-22deg);transform-origin:top;border-radius:5px;box-shadow:3px 4px 5px #0005}.player-card[data-playing=true] .record{animation-play-state:running}@keyframes record-spin{to{transform:rotate(360deg)}}
.ns{font-size:9px;letter-spacing:.2em;margin-bottom:12px;display:flex;align-items:center;gap:8px}.ns::before{content:'';width:5px;height:5px;border-radius:50%;background:currentColor}.nt{font-size:clamp(24px,2.8vw,38px);line-height:1.15;letter-spacing:-1.2px;font-weight:500;color:#f6f2e8;white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}.track-detail{font-size:12px;color:#9bae9e;line-height:1.6;margin:10px 0 14px;min-height:19px}.progress-block{grid-column:2}.tm{font-size:10px;margin:10px 0 0;color:#b5c9bc}.sk{height:5px;border:0;background:#ffffff15;border-radius:4px;overflow:visible}.skf{border-radius:4px;background:#bdd6a9}.skf::after{content:'';position:absolute;right:-3px;top:-2px;width:9px;height:9px;border-radius:50%;background:#d6edc4}.tp{gap:10px;border-top:1px solid #ffffff0b;padding-top:20px}.tb{height:38px;width:38px;border:0;border-radius:50%;box-shadow:none;background:transparent;font-size:16px;color:#b0c3b5}.tb:hover{background:#ffffff0b}.tb.main{height:48px;width:48px;background:#d0e6b9;color:#18251a;font-size:18px}.tb.dng{color:#b0c3b5}.vg{gap:10px}.vg .vv{color:#b0c3b5;font-size:10px}.vg input[type=range]{width:90px}.volume-label{font:9px var(--mn);letter-spacing:.1em;color:#91a497}.player-links{margin-left:14px;display:flex;gap:8px}.player-links .ch{background:none;border-color:#ffffff14}
.request-card{padding:18px 22px}.request-card .ct{margin-bottom:12px}.ir{gap:8px}.ir input{background:#080f0b80;border-color:#ffffff12;padding:12px 14px;border-radius:9px;font-size:12px}.go{background:#c9e3b2;color:#19271c;font-size:11px;padding:12px 20px;border-radius:9px}.nx{font-size:10px;margin-top:10px}.nx input{width:13px;height:13px}.queue-card .ql{max-height:345px;min-height:270px}.queue-card .qi{padding:15px 0;gap:10px;flex-wrap:wrap;border-color:#ffffff09}.queue-card .qn{font-size:10px;min-width:18px}.queue-card .qt{font-size:12px;line-height:1.5;flex-basis:calc(100% - 90px);white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}.queue-card .qr{font-size:10px;margin-left:28px;max-width:90%;order:2;color:#8d9f93}.qx{border:0;background:#ffffff05;color:#93a499;width:30px;height:30px;border-radius:7px}.queue-footer{border-top:1px solid #ffffff0c;margin-top:16px;padding-top:16px;display:flex;justify-content:space-between;gap:8px}.queue-footer .ch{font-size:10px}.em{font-size:12px;color:#91a497;line-height:1.7;padding:22px 10px}.empty-mark{font-size:30px;color:#64836e;display:block;margin-bottom:10px}
.sg{border-color:#ffffff12;background:#080f0b70;border-radius:8px}.sg button{font-size:9px;padding:10px 4px;letter-spacing:.07em}.sg button.on{background:#bdd6a9;color:#1b2d21}.ch{font-size:10px;padding:7px 10px;background:#0a120d66;border-color:#ffffff10;border-radius:7px}.fc{gap:7px}.discovery-card .ir{margin-top:12px}.discovery-card .ir input{width:100%;padding:10px}.discovery-card .go{padding:10px}.mini-label{font:9px var(--mn);text-transform:uppercase;letter-spacing:.13em;color:#91a497;margin:20px 0 10px}.helper{font-size:11px;line-height:1.7;color:#91a497}.discovery-card .sg{margin:12px 0}.server-card #srvTree{max-height:290px;overflow:auto}.chrow{background:#0a120d66;border-color:#ffffff0c;padding:11px;border-radius:8px}.chrow.here{background:#1c332288;border-color:#62856a55}.chnm{font-size:11px}.users li{font-size:10px;line-height:1.7}.botpill{font-size:8px;letter-spacing:.08em;background:#bdd6a9}.chct{font-size:9px}.chat-card .ql{min-height:100px}.chat-card .qi{font-size:11px;line-height:1.6;border-color:#ffffff09;padding:9px 0;flex-wrap:wrap}.chat-card .qn{font-size:9px}.chat-card .cmt{flex-basis:55%}.cnm{color:#c1d8b2}.cmB{color:#91bda2}.sg3{gap:8px}.stt{border:0;background:#080f0b70;border-radius:9px;padding:16px 4px}.sv{font-size:19px}.sv.am{color:#bdd6a9}.sl{font-size:8px;letter-spacing:.1em}.system-card .ct .rv{font-size:9px}.errors-card .ct{margin-bottom:8px}.errors-card .em{text-align:left;padding:8px 0}.dw{background:#080f0b;color:#c4d4c9;border-color:#ffffff0e}.page-footer{display:flex;justify-content:space-between;gap:16px;color:#718679;font:9px var(--mn);letter-spacing:.1em;padding-top:12px}.page-footer a{color:#a6bcad;text-decoration:none}.toast{background:#17251d;border-color:#375b42;color:#eff4eb;font-size:12px}
@media(min-width:1500px){.mn{padding-top:44px}.deck{column-gap:38px}.player-card{padding:26px}}@media(max-width:1050px){.g{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.player-card,.request-card{grid-column:1/-1;grid-row:auto}.queue-card,.sound-card,.discovery-card,.server-card,.chat-card,.system-card{grid-column:auto;grid-row:auto}.queue-card{grid-row:3/5}.chat-card{grid-column:1/-1}.system-card{grid-column:1/-1}.queue-card .ql{max-height:500px}.nv{gap:24px;padding:0 24px}.nr .st{display:none}}
@media(max-width:640px){.nv{height:auto;min-height:64px;flex-wrap:wrap;gap:12px;padding:16px 18px 0}.nb{font-size:16px}.nr{order:1}.nl{order:2;width:100%;justify-content:space-between;padding:0 0 10px;gap:0}.nk{font-size:11px;padding:8px 10px}.mn{padding:25px 16px}.page-intro{align-items:flex-start;flex-direction:column;gap:18px;margin-bottom:22px}.page-intro h1{font-size:30px}.scene-tools{width:100%;justify-content:flex-end}.scene-tools label{margin-right:auto}.g{grid-template-columns:minmax(0,1fr);gap:14px}.g>.cd{grid-column:1;grid-row:auto}.cd{padding:18px}.deck{grid-template-columns:90px minmax(0,1fr);column-gap:16px;margin:20px 0}.record-stage{width:90px;height:100px}.record{width:88px;height:88px}.record-label{inset:28px;font-size:4px;letter-spacing:0}.record-label b{font-size:11px}.record-label::after{width:3px;height:3px;margin-top:2px}.record-stage::after{height:50px;width:3px;top:4px;right:0}.nt{font-size:25px;letter-spacing:-.7px}.ns{font-size:8px;margin-bottom:8px}.track-detail{font-size:10px;margin:8px 0}.progress-block{grid-column:1/-1;margin-top:22px}.player-card{min-height:0}.tp{gap:6px;padding-top:16px}.tb{width:32px;height:36px}.tb.main{width:43px;height:43px}.player-links{margin-left:auto}.vg{width:100%;justify-content:flex-end;margin-top:12px;padding-top:12px;border-top:1px solid #ffffff0b}.vg input[type=range]{width:130px}.volume-label{margin-right:auto}.queue-card .ql{min-height:0;max-height:320px}.ir input{font-size:12px}.go{padding:12px}.page-footer{font-size:8px;line-height:1.8}.scene-tools select,.scene-tools button{min-height:36px}.qx{width:36px;height:36px}.ch{min-height:32px}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}.ambient::before,.ambient::after,.record{animation:none!important}}
${LIVE_DECK_CSS}
`;

export const AMBIENCE_JS = panelScript("ambience");
