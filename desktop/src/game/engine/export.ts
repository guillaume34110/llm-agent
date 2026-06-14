// Standalone single-file HTML export. Takes a Cart and bakes the whole engine
// (gfx + math + 3x5 font + palette + main-thread loop), the cart program, and a
// responsive handheld-console overlay (D-pad + O/X, keyboard, multi-touch) into
// one self-contained .html — no network, no modules, double-click to play on
// desktop / phone / tablet. The exported game runs on the main thread (no
// worker sandbox needed: it's the player's own cart, shipped standalone).

import type { Cart } from './types';
import { PALETTE } from './palette';

// Uint8Array -> base64 (chunked to dodge call-stack limits on 16k arrays).
function b64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(s);
}

const ICON =
  "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%20100%20100'%3E%3Ctext%20y='.9em'%20font-size='90'%3E%F0%9F%90%B5%3C/text%3E%3C/svg%3E";

export function cartName(cart: Cart): string {
  return (cart.name || 'game').trim() || 'game';
}

/** Build the complete standalone HTML document for a cart. */
export function cartToHtml(cart: Cart): string {
  const title = cartName(cart).replace(/[<>&"]/g, '').slice(0, 80) || 'game';
  const palette = JSON.stringify(PALETTE.map((c) => [c[0], c[1], c[2]]));
  const sheetB64 = b64(cart.sheet);
  const flagsB64 = b64(cart.flags);
  const mapB64 = b64(cart.map);
  // JSON string literal, with </script> neutralised so a cart can't break out
  // of the <script> tag ('\/' === '/' in JS, so the string value is unchanged).
  const codeJson = JSON.stringify(cart.code).replace(/<\/(script)/gi, '<\\/$1');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="theme-color" content="#0e0f13">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<title>${title}</title>
<link rel="icon" href="${ICON}">
<style>
  * { margin:0; padding:0; box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
  html,body { height:100%; width:100%; overflow:hidden; background:#0e0f13;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color:#c2c3c7;
    -webkit-user-select:none; user-select:none; touch-action:none; overscroll-behavior:none; }
  #app { position:fixed; inset:0; display:flex; flex-direction:column; }
  #screen-area { flex:1 1 auto; min-height:0; display:flex; align-items:center; justify-content:center; padding:12px; position:relative; }
  canvas { image-rendering:pixelated; image-rendering:crisp-edges; display:block;
    width:128px; height:128px; background:#000;
    border-radius:8px; box-shadow:0 0 0 3px #1d2b53, 0 10px 34px rgba(0,0,0,.55); }
  #err { position:absolute; inset:12px; display:none; align-items:center; justify-content:center;
    text-align:center; padding:16px; color:#ff77a8; font-size:13px; line-height:1.5;
    background:rgba(14,15,19,.92); border-radius:8px; white-space:pre-wrap; overflow:auto; }
  #controls { flex:0 0 auto; display:flex; align-items:center; justify-content:space-between;
    gap:14px; padding:14px 24px calc(16px + env(safe-area-inset-bottom)); }
  #dpad { display:grid; grid-template-columns:repeat(3, var(--k)); grid-template-rows:repeat(3, var(--k));
    gap:6px; --k:clamp(42px, 13vmin, 66px); }
  .pad { -webkit-user-select:none; user-select:none; border:none; cursor:pointer; color:#fff1e8;
    background:#3a3f4b; border-radius:12px; box-shadow:0 4px 0 #23262e; display:flex;
    align-items:center; justify-content:center; font-size:18px; font-weight:800; touch-action:none; }
  .pad:active, .pad.on { transform:translateY(2px); box-shadow:0 2px 0 #23262e; background:#4a505e; }
  .pu { grid-area:1/2; } .pl { grid-area:2/1; } .pr { grid-area:2/3; } .pd { grid-area:3/2; }
  .pc { grid-area:2/2; background:transparent; box-shadow:none; pointer-events:none; }
  #actions { display:flex; align-items:center; gap:14px; }
  .act { --b:clamp(54px, 17vmin, 84px); width:var(--b); height:var(--b); border-radius:50%;
    border:none; cursor:pointer; color:#fff1e8; font-size:22px; font-weight:900; touch-action:none;
    display:flex; align-items:center; justify-content:center; }
  .act:active, .act.on { transform:translateY(2px); filter:brightness(1.15); }
  #btO { background:#ff004d; box-shadow:0 5px 0 #7e2553; }
  #btX { background:#29adff; box-shadow:0 5px 0 #1d2b53; }
  #btO:active, #btO.on { box-shadow:0 3px 0 #7e2553; }
  #btX:active, #btX.on { box-shadow:0 3px 0 #1d2b53; }
  #fs { position:fixed; top:calc(8px + env(safe-area-inset-top)); right:10px; width:34px; height:34px;
    border:none; border-radius:9px; background:rgba(58,63,75,.7); color:#c2c3c7; cursor:pointer;
    font-size:16px; display:flex; align-items:center; justify-content:center; z-index:5; }
</style>
</head>
<body>
<div id="app">
  <button id="fs" title="fullscreen" aria-label="fullscreen">&#x26F6;</button>
  <div id="screen-area">
    <canvas id="cv" width="128" height="128"></canvas>
    <div id="err"></div>
  </div>
  <div id="controls">
    <div id="dpad">
      <button class="pad pu" data-b="2" aria-label="up">&#x25B2;</button>
      <button class="pad pl" data-b="0" aria-label="left">&#x25C0;</button>
      <div class="pad pc"></div>
      <button class="pad pr" data-b="1" aria-label="right">&#x25B6;</button>
      <button class="pad pd" data-b="3" aria-label="down">&#x25BC;</button>
    </div>
    <div id="actions">
      <button class="act" id="btX" data-b="5" aria-label="X">X</button>
      <button class="act" id="btO" data-b="4" aria-label="O">O</button>
    </div>
  </div>
</div>
<script>
"use strict";
(function () {
  // ---- baked cart data -----------------------------------------------------
  var SCREEN=128, SHEET=128, SPR_PX=8, SPR_PER_ROW=16, MAP_W=128, MAP_H=32, FB_LEN=SCREEN*SCREEN;
  var PALETTE=${palette};
  var CODE=${codeJson};
  function unb64(s){ var bin=atob(s), a=new Uint8Array(bin.length); for(var i=0;i<bin.length;i++) a[i]=bin.charCodeAt(i); return a; }
  var SHEETB=unb64("${sheetB64}"), FLAGSB=unb64("${flagsB64}"), MAPB=unb64("${mapB64}");

  // ---- 3x5 bitmap font (uppercase only; lowercase folds up) ----------------
  var GLYPH_W=3, CHAR_ADVANCE=4, LINE_ADVANCE=6;
  var G={' ':'...,...,...,...,...','A':'###,#.#,###,#.#,#.#','B':'##.,#.#,##.,#.#,##.','C':'###,#..,#..,#..,###','D':'##.,#.#,#.#,#.#,##.','E':'###,#..,##.,#..,###','F':'###,#..,##.,#..,#..','G':'###,#..,#.#,#.#,###','H':'#.#,#.#,###,#.#,#.#','I':'###,.#.,.#.,.#.,###','J':'..#,..#,..#,#.#,###','K':'#.#,#.#,##.,#.#,#.#','L':'#..,#..,#..,#..,###','M':'#.#,###,###,#.#,#.#','N':'#.#,###,###,###,#.#','O':'###,#.#,#.#,#.#,###','P':'###,#.#,###,#..,#..','Q':'###,#.#,#.#,###,..#','R':'###,#.#,##.,#.#,#.#','S':'###,#..,###,..#,###','T':'###,.#.,.#.,.#.,.#.','U':'#.#,#.#,#.#,#.#,###','V':'#.#,#.#,#.#,#.#,.#.','W':'#.#,#.#,###,###,#.#','X':'#.#,#.#,.#.,#.#,#.#','Y':'#.#,#.#,###,.#.,.#.','Z':'###,..#,.#.,#..,###','0':'###,#.#,#.#,#.#,###','1':'.#.,##.,.#.,.#.,###','2':'###,..#,###,#..,###','3':'###,..#,###,..#,###','4':'#.#,#.#,###,..#,..#','5':'###,#..,###,..#,###','6':'###,#..,###,#.#,###','7':'###,..#,.#.,.#.,.#.','8':'###,#.#,###,#.#,###','9':'###,#.#,###,..#,###','.':'...,...,...,...,.#.',',':'...,...,...,.#.,#..','!':'.#.,.#.,.#.,...,.#.','?':'###,..#,.##,...,.#.',':':'...,.#.,...,.#.,...',';':'...,.#.,...,.#.,#..','-':'...,...,###,...,...','+':'...,.#.,###,.#.,...','=':'...,###,...,###,...','/':'..#,..#,.#.,#..,#..','(':'.#.,#..,#..,#..,.#.',')':'.#.,..#,..#,..#,.#.','<':'..#,.#.,#..,.#.,..#','>':'#..,.#.,..#,.#.,#..','*':'...,#.#,.#.,#.#,...','%':'#.#,..#,.#.,#..,#.#','#':'#.#,###,#.#,###,#.#',"'":'.#.,.#.,...,...,...','"':'#.#,#.#,...,...,...','_':'...,...,...,...,###'};
  var TABLE={}; for (var gk in G){ var rs=G[gk].split(','), m=[]; for (var ri=0; ri<rs.length; ri++){ var r=rs[ri]; m.push((r[0]==='#'?4:0)|(r[1]==='#'?2:0)|(r[2]==='#'?1:0)); } TABLE[gk]=m; }
  var BLANK=[0,0,0,0,0];
  function glyphRows(ch){ return TABLE[ch]||TABLE[ch.toUpperCase()]||BLANK; }

  // ---- gfx (faithful port of engine/gfx.ts) --------------------------------
  function c16(c,d){ if(c==null) return d===undefined?0:d; return ((Math.floor(c)%16)+16)%16; }
  function makeGfx(st){
    var W=SCREEN;
    function plot(sx,sy,col){ if(sx<0||sy<0||sx>=W||sy>=W) return; st.px[sy*W+sx]=st.pal[col]; }
    function put(x,y,col){ plot((x-st.camx)|0,(y-st.camy)|0,col); }
    function cls(col){ st.px.fill(st.pal[c16(col,0)]); }
    function pset(x,y,col){ put(x|0,y|0,c16(col,6)); }
    function pget(x,y){ var sx=(x-st.camx)|0, sy=(y-st.camy)|0; if(sx<0||sy<0||sx>=W||sy>=W) return 0; return st.px[sy*W+sx]; }
    function line(x0,y0,x1,y1,col){ var c=c16(col,6); var ax=x0|0,ay=y0|0,bx=x1|0,by=y1|0;
      var dx=Math.abs(bx-ax), dy=-Math.abs(by-ay), sx=ax<bx?1:-1, sy=ay<by?1:-1, err=dx+dy;
      for(;;){ put(ax,ay,c); if(ax===bx&&ay===by) break; var e2=2*err; if(e2>=dy){err+=dy;ax+=sx;} if(e2<=dx){err+=dx;ay+=sy;} } }
    function rectfill(x0,y0,x1,y1,col){ var c=c16(col,6); var lo=Math.min(x0,x1)|0,hi=Math.max(x0,x1)|0,loy=Math.min(y0,y1)|0,hiy=Math.max(y0,y1)|0;
      for(var y=loy;y<=hiy;y++) for(var x=lo;x<=hi;x++) put(x,y,c); }
    function rect(x0,y0,x1,y1,col){ var c=c16(col,6); var lo=Math.min(x0,x1)|0,hi=Math.max(x0,x1)|0,loy=Math.min(y0,y1)|0,hiy=Math.max(y0,y1)|0;
      for(var x=lo;x<=hi;x++){ put(x,loy,c); put(x,hiy,c); } for(var y=loy;y<=hiy;y++){ put(lo,y,c); put(hi,y,c); } }
    function circ(xc,yc,r,col){ var c=c16(col,6); xc|=0; yc|=0; r=Math.max(0,r|0); var x=r,y=0,err=1-r;
      while(x>=y){ var pts=[[x,y],[y,x],[-y,x],[-x,y],[-x,-y],[-y,-x],[y,-x],[x,-y]];
        for(var i=0;i<8;i++) put(xc+pts[i][0],yc+pts[i][1],c); y++; if(err<0) err+=2*y+1; else { x--; err+=2*(y-x)+1; } } }
    function circfill(xc,yc,r,col){ var c=c16(col,6); xc|=0; yc|=0; r=Math.max(0,r|0);
      for(var dy=-r;dy<=r;dy++){ var dx=Math.floor(Math.sqrt(r*r-dy*dy)); for(var x=xc-dx;x<=xc+dx;x++) put(x,yc+dy,c); } }
    function spr(n,x,y,flipx,flipy){ n=n|0; if(n<0||n>255) return; var ssx=(n%SPR_PER_ROW)*SPR_PX, ssy=((n/SPR_PER_ROW)|0)*SPR_PX;
      for(var r=0;r<SPR_PX;r++) for(var cc=0;cc<SPR_PX;cc++){ var col=st.sheet[(ssy+r)*SHEET+(ssx+cc)]; if(st.transparent[col]) continue;
        var ox=flipx?SPR_PX-1-cc:cc, oy=flipy?SPR_PX-1-r:r; put((x|0)+ox,(y|0)+oy,col); } }
    function sspr(sx,sy,sw,sh,dx,dy,dw,dh){ if(dw==null) dw=sw; if(dh==null) dh=sh; if(sw<=0||sh<=0||dw<=0||dh<=0) return;
      for(var j=0;j<dh;j++){ var syy=sy+Math.floor((j*sh)/dh); for(var i=0;i<dw;i++){ var sxx=sx+Math.floor((i*sw)/dw);
        if(sxx<0||syy<0||sxx>=SHEET||syy>=SHEET) continue; var col=st.sheet[syy*SHEET+sxx]; if(st.transparent[col]) continue; put((dx|0)+i,(dy|0)+j,col); } } }
    function map(cx,cy,sx,sy,cw,ch){ cx|=0; cy|=0; sx|=0; sy|=0; cw|=0; ch|=0;
      for(var j=0;j<ch;j++) for(var i=0;i<cw;i++){ var mx=cx+i,my=cy+j; if(mx<0||my<0||mx>=MAP_W||my>=MAP_H) continue;
        var n=st.map[my*MAP_W+mx]; if(n===0) continue; spr(n,sx+i*SPR_PX,sy+j*SPR_PX); } }
    function mget(cx,cy){ cx|=0; cy|=0; if(cx<0||cy<0||cx>=MAP_W||cy>=MAP_H) return 0; return st.map[cy*MAP_W+cx]; }
    function mset(cx,cy,n){ cx|=0; cy|=0; if(cx<0||cy<0||cx>=MAP_W||cy>=MAP_H) return; st.map[cy*MAP_W+cx]=(((n|0)%256)+256)%256; }
    function print(s,x,y,col){ var c=c16(col,6); var str=String(s==null?'':s); var cx=x|0, cy=y|0;
      for (var si=0; si<str.length; si++){ var ch=str[si]; if(ch==='\\n'){ cx=x|0; cy+=LINE_ADVANCE; continue; }
        var rows=glyphRows(ch); for(var r=0;r<rows.length;r++){ var bits=rows[r]; for(var b=0;b<GLYPH_W;b++){ if(bits&(1<<(GLYPH_W-1-b))) put(cx+b,cy+r,c); } } cx+=CHAR_ADVANCE; } }
    function palt(col,t){ if(col==null){ for(var i=0;i<16;i++) st.transparent[i]=false; st.transparent[0]=true; return; } st.transparent[c16(col)]=t==null?true:!!t; }
    function pal(from,to){ if(from==null){ for(var i=0;i<16;i++) st.pal[i]=i; return; } st.pal[c16(from)]=c16(to); }
    function camera(x,y){ st.camx=(x==null?0:x)|0; st.camy=(y==null?0:y)|0; }
    function fget(n,f){ var v=st.flags[(n|0)&255]||0; return f==null?v:((v&(1<<(f|0)))!==0); }
    function fset(n,f,v){ n=(n|0)&255; if(v==null){ st.flags[n]=f|0; return; } if(v) st.flags[n]|=1<<(f|0); else st.flags[n]&=~(1<<(f|0)); }
    return { cls:cls,pset:pset,pget:pget,line:line,rect:rect,rectfill:rectfill,circ:circ,circfill:circfill,
      spr:spr,sspr:sspr,map:map,mget:mget,mset:mset,print:print,palt:palt,pal:pal,camera:camera,fget:fget,fset:fset };
  }

  // ---- math (port of engine/mathlib.ts) ------------------------------------
  function makeMath(){ var TAU=Math.PI*2; var s=(Date.now()^0x9e3779b9)>>>0;
    function next(){ s|=0; s=(s+0x6d2b79f5)|0; var t=Math.imul(s^(s>>>15),1|s); t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; }
    return { flr:function(x){return Math.floor(x);}, ceil:function(x){return Math.ceil(x);}, abs:function(x){return Math.abs(x);},
      min:function(a,b){return a<b?a:b;}, max:function(a,b){return a>b?a:b;},
      mid:function(a,b,c){return Math.max(Math.min(a,b),Math.min(Math.max(a,b),c));},
      sqrt:function(x){return x<0?0:Math.sqrt(x);}, sin:function(t){return -Math.sin(t*TAU);}, cos:function(t){return Math.cos(t*TAU);},
      atan2:function(dx,dy){ var a=Math.atan2(-dy,dx)/TAU; return a<0?a+1:a; }, sgn:function(x){return x<0?-1:1;},
      rnd:function(x){ if(x==null) x=1; return next()*x; }, srand:function(seed){ s=(Math.floor(seed)^0x9e3779b9)>>>0; } };
  }

  // ---- input ---------------------------------------------------------------
  var held=0, prev=0;
  function setBtn(i,d){ if(d) held|=(1<<i); else held&=~(1<<i); }
  var KEYMAP={ ArrowLeft:0, ArrowRight:1, ArrowUp:2, ArrowDown:3, a:0, d:1, w:2, s:3, z:4, c:4, n:4, x:5, v:5, m:5, ' ':4, Enter:5 };
  window.addEventListener('keydown', function(e){ var i=KEYMAP[e.key]; if(i==null) return; e.preventDefault(); setBtn(i,true); }, { passive:false });
  window.addEventListener('keyup', function(e){ var i=KEYMAP[e.key]; if(i==null) return; e.preventDefault(); setBtn(i,false); }, { passive:false });
  // on-screen pads: pointer events => multi-touch + mouse both work
  var pads=document.querySelectorAll('[data-b]');
  for (var pi=0; pi<pads.length; pi++){ (function(el){ var b=parseInt(el.getAttribute('data-b'),10);
    function down(e){ e.preventDefault(); el.classList.add('on'); setBtn(b,true); try{ el.setPointerCapture(e.pointerId); }catch(_){} }
    function up(e){ e.preventDefault(); el.classList.remove('on'); setBtn(b,false); }
    el.addEventListener('pointerdown', down); el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up); el.addEventListener('pointerleave', up);
    el.addEventListener('contextmenu', function(e){ e.preventDefault(); });
  })(pads[pi]); }
  var fsBtn=document.getElementById('fs');
  fsBtn.addEventListener('click', function(){ try{ if(document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen(); }catch(_){} });

  // ---- build + run ---------------------------------------------------------
  var cv=document.getElementById('cv'), errBox=document.getElementById('err');
  var ctx=cv.getContext('2d'); ctx.imageSmoothingEnabled=false;

  // Scale the 128x128 canvas up to the biggest square that fits the screen area.
  // The backing store stays 128x128 (crisp pixels); only the CSS box grows.
  var area=document.getElementById('screen-area');
  function fit(){
    var pad=12, w=area.clientWidth-pad*2, h=area.clientHeight-pad*2;
    var side=Math.max(64, Math.min(w, h)); // biggest square that fits; pixelated keeps it crisp
    cv.style.width=side+'px'; cv.style.height=side+'px';
  }
  fit();
  window.addEventListener('resize', fit);
  window.addEventListener('orientationchange', fit);
  document.addEventListener('fullscreenchange', fit);
  if (window.ResizeObserver){ try{ new ResizeObserver(fit).observe(area); }catch(_){} }
  var img=ctx.createImageData(SCREEN,SCREEN), buf32=new Uint32Array(img.data.buffer);
  var lut=new Uint32Array(16), big=(new Uint8Array(new Uint32Array([1]).buffer)[0]===0);
  for (var li=0; li<16; li++){ var rgb=PALETTE[li], r=rgb[0],g=rgb[1],b=rgb[2];
    lut[li]= big ? (((r<<24)|(g<<16)|(b<<8)|0xff)>>>0) : (((0xff<<24)|(b<<16)|(g<<8)|r)>>>0); }

  function fail(msg){ errBox.textContent=String(msg); errBox.style.display='flex'; }
  var st={ px:new Uint8Array(FB_LEN), sheet:SHEETB, flags:FLAGSB, map:MAPB, camx:0, camy:0,
    pal:Uint8Array.from({length:16},function(_,i){return i;}), transparent:(function(){var a=new Array(16).fill(false); a[0]=true; return a;})() };
  var gfx=makeGfx(st), m=makeMath();
  var api={};
  for (var k in gfx) api[k]=gfx[k];
  api.btn=function(i){ return (held&(1<<(i|0)))!==0; };
  api.btnp=function(i){ return (pressed&(1<<(i|0)))!==0; };
  api.sfx=function(){}; api.music=function(){};
  api.flr=m.flr; api.ceil=m.ceil; api.abs=m.abs; api.min=m.min; api.max=m.max; api.mid=m.mid;
  api.sqrt=m.sqrt; api.sin=m.sin; api.cos=m.cos; api.atan2=m.atan2; api.sgn=m.sgn; api.rnd=m.rnd; api.srand=m.srand;

  var pressed=0;
  var names=Object.keys(api);
  var body='"use strict";\\n'+CODE+'\\nreturn {'+
    '_init: typeof _init!=="undefined"?_init:null,'+
    '_update: typeof _update!=="undefined"?_update:null,'+
    '_update60: typeof _update60!=="undefined"?_update60:null,'+
    '_draw: typeof _draw!=="undefined"?_draw:null};';
  var game=null;
  try {
    var factory=Function.apply(null, names.concat([body]));
    game=factory.apply(null, names.map(function(n){ return api[n]; }));
  } catch(e){ fail('cart error: '+(e&&e.message||e)); }
  if (game && game._init){ try{ game._init(); }catch(e){ fail('_init error: '+(e&&e.message||e)); game=null; } }

  function blit(){ var px=st.px; for(var i=0;i<px.length;i++) buf32[i]=lut[px[i]&15]; ctx.putImageData(img,0,0); }
  blit();

  var STEP=1000/30, acc=0, last=performance.now(), broken=!game;
  function loop(now){ requestAnimationFrame(loop); if(broken||!game) return;
    var dt=now-last; if(dt>250) dt=250; last=now; acc+=dt; var n=0;
    while(acc>=STEP && n<4){ acc-=STEP; n++;
      pressed = held & ~prev; prev = held;
      try { var upd=game._update60||game._update; if(upd) upd(); }
      catch(e){ fail('runtime error: '+(e&&e.message||e)); broken=true; return; }
    }
    if(game._draw){ try{ game._draw(); }catch(e){ fail('draw error: '+(e&&e.message||e)); broken=true; return; } }
    blit();
  }
  requestAnimationFrame(loop);
})();
</script>
</body>
</html>`;
}
