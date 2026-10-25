/* shared helpers for the per-project identity scripts (no dependencies) */
(function(){'use strict';
var d=document,R=d.documentElement;
var FX=window.FX={
 reduce:!!(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches),
 $:function(s,c){return(c||d).querySelector(s)},
 $$:function(s,c){return Array.prototype.slice.call((c||d).querySelectorAll(s))},
 mouse:{x:-1e3,y:-1e3,px:.5,py:.5},
 /* add .rv and reveal on scroll */
 reveal:function(sel,cls){cls=cls||'in';var els=FX.$$(sel);els.forEach(function(e){e.classList.add('rv')});
  if(FX.reduce||!('IntersectionObserver' in window)){els.forEach(function(e){e.classList.add(cls)});return}
  var io=new IntersectionObserver(function(es){es.forEach(function(x){if(x.isIntersecting){x.target.classList.add(cls);io.unobserve(x.target)}})},{rootMargin:'0px 0px -6% 0px'});els.forEach(function(e,i){e.style.setProperty('--i',i%6);io.observe(e)})},
 /* canvas loop: sizes to its box, pauses offscreen / hidden tab; draw(ctx,w,h,t,dt,m) with m = mouse in canvas px */
 loop:function(cv,draw,o){o=o||{};var ctx=cv.getContext('2d'),w=0,h=0,dpr=1,raf=0,on=false,vis=true,last=0,t0=performance.now(),m={x:-1e3,y:-1e3,in:false};
  function size(){var r=cv.getBoundingClientRect();w=r.width;h=r.height;dpr=Math.min(o.dpr||2,window.devicePixelRatio||1);cv.width=Math.max(1,Math.round(w*dpr));cv.height=Math.max(1,Math.round(h*dpr));ctx.setTransform(dpr,0,0,dpr,0,0);if(o.resize)o.resize(w,h)}
  function fr(now){if(!on)return;var t=(now-t0)/1000,dt=Math.min(.05,(now-last)/1000||.016);last=now;ctx.setTransform(dpr,0,0,dpr,0,0);draw(ctx,w,h,t,dt,m);raf=requestAnimationFrame(fr)}
  function go(){if(on||FX.reduce||d.hidden||!vis)return;on=true;last=performance.now();raf=requestAnimationFrame(fr)}
  function stop(){on=false;cancelAnimationFrame(raf)}
  size();addEventListener('resize',function(){size();if(!on){ctx.setTransform(dpr,0,0,dpr,0,0);draw(ctx,w,h,0,0,m)}});
  var host=o.host||cv.parentElement;host.addEventListener('pointermove',function(e){var r=cv.getBoundingClientRect();m.x=e.clientX-r.left;m.y=e.clientY-r.top;m.in=true},{passive:true});host.addEventListener('pointerleave',function(){m.in=false;m.x=m.y=-1e3});
  if(FX.reduce){draw(ctx,w,h,o.still||2,0,m)}else{
   if('IntersectionObserver' in window)new IntersectionObserver(function(es){vis=es[0].isIntersecting;vis?go():stop()},{threshold:0}).observe(cv);else go();
   d.addEventListener('visibilitychange',function(){d.hidden?stop():go()});draw(ctx,w,h,0,0,m)}
  return{size:size,draw:function(){draw(ctx,w,h,(performance.now()-t0)/1000,0,m)},ctx:ctx};},
 /* create an absolutely positioned canvas as the first child of host */
 layer:function(host,cls){var cv=d.createElement('canvas');cv.className='fx '+(cls||'');cv.setAttribute('aria-hidden','true');cv.setAttribute('role','presentation');if(getComputedStyle(host).position==='static')host.style.position='relative';host.insertBefore(cv,host.firstChild);return cv},
 css:function(n){return getComputedStyle(R).getPropertyValue(n).trim()},
 rnd:function(a,b){return a+Math.random()*(b-a)},
 theme:function(){return R.getAttribute('data-theme')==='dark'?'dark':'light'}
};
addEventListener('pointermove',function(e){FX.mouse.x=e.clientX;FX.mouse.y=e.clientY;FX.mouse.px=e.clientX/innerWidth;FX.mouse.py=e.clientY/innerHeight},{passive:true});
R.classList.add('fxjs');
})();

(function(){var hero=FX.$('.hero');if(!hero)return;var cv=document.createElement('canvas');cv.className='city';cv.setAttribute('aria-hidden','true');hero.insertBefore(cv,hero.firstChild);
var lab=document.createElement('div');lab.className='city-lab';lab.style.display='none';hero.appendChild(lab);
var SV=[['Zarinpal','#ffb547'],['Zibal','#e65f2e'],['Kavenegar','#6aa7ff'],['SMS.ir','#ff6b8b']],B=[],fail={},hov=-1,rnd=(function(s){return function(){s=(s*16807)%2147483647;return s/2147483647}})(7);
function build(w){B=[];var tw=w<600?20:30,x=tw*2,i=0,sv=0;while(x<w+tw){var isS=(i%4===1)&&sv<4&&x>w*.18&&x<w*.9;var b={x:x,tw:tw,h:(isS?150:40)+rnd()*(isS?80:90),s:isS?sv++:-1,ph:rnd()*9,seed:rnd()};B.push(b);x+=tw*(isS?2.2:1.7);i++}
 /* guarantee four towers spread across */ if(sv<4){var idx=[.2,.4,.6,.8].map(function(f){return Math.floor(B.length*f)});B.forEach(function(b){if(b.s>=0)b.s=-1;b.h=Math.min(b.h,110)});idx.forEach(function(k,j){B[k].s=j;B[k].h=170+rnd()*60})}}
function shade(hex,k){var n=parseInt(hex.slice(1),16),r=(n>>16)&255,g=(n>>8)&255,b=n&255;return'rgb('+Math.round(r*k)+','+Math.round(g*k)+','+Math.round(b*k)+')'}
var W=0;
FX.loop(cv,function(c,w,h,t,dt,m){if(W!==w){W=w;build(w)}var D=FX.theme()==='dark';c.clearRect(0,0,w,h);hov=-1;var by=h-12;
 B.forEach(function(b,i){if(b.s>=0&&m.in&&Math.abs(m.x-b.x)<b.tw*1.1&&m.y>by-b.h-b.tw&&m.y<by+b.tw)hov=i});
 B.forEach(function(b,i){var isS=b.s>=0,col=isS?SV[b.s][1]:(D?'#3a4a86':'#8aa1c4'),f=fail[b.s],lift=(i===hov?10:0),H=b.h+lift,ty=by-H,x=b.x,tw=b.tw,base=D?1:1.0;
  var kf=f?'#ff3b3b':col;
  /* faces */
  c.fillStyle=shade(isS?kf:col,D?.55:.95);c.beginPath();c.moveTo(x-tw,ty+tw/2);c.lineTo(x,ty+tw);c.lineTo(x,by+tw);c.lineTo(x-tw,by+tw/2);c.closePath();c.fill();
  c.fillStyle=shade(isS?kf:col,D?.34:.78);c.beginPath();c.moveTo(x+tw,ty+tw/2);c.lineTo(x,ty+tw);c.lineTo(x,by+tw);c.lineTo(x+tw,by+tw/2);c.closePath();c.fill();
  c.fillStyle=shade(isS?kf:col,D?.85:1.12);c.beginPath();c.moveTo(x,ty);c.lineTo(x+tw,ty+tw/2);c.lineTo(x,ty+tw);c.lineTo(x-tw,ty+tw/2);c.closePath();c.fill();
  /* windows */
  var rows=Math.floor(H/12),cols=Math.max(2,Math.floor(tw/9));
  for(var side=0;side<2;side++){c.save();if(side===0)c.transform(1,.5,0,1,x-tw,ty+tw/2);else c.transform(1,-.5,0,1,x,ty+tw);
   for(var r=1;r<rows;r++)for(var k=0;k<cols;k++){var on=((Math.sin(b.ph*13+r*7.3+k*3.1+Math.floor(t*(f?9:.6)+r))>(f?.2:-.15)));if(!on)continue;c.fillStyle=f?'rgba(255,90,90,.9)':(isS?'rgba(255,245,210,.9)':(D?'rgba(255,225,150,.55)':'rgba(255,255,255,.7)'));c.fillRect(3+k*(tw-4)/cols,r*12,Math.max(3,(tw-4)/cols-3),5)}
   c.restore()}
  if(isS){c.fillStyle=f?'#ff3b3b':col;var bl=(Math.sin(t*3+i)>0)?1:.3;c.globalAlpha=bl;c.beginPath();c.arc(x,ty-5,3,0,6.3);c.fill();c.globalAlpha=1;c.fillRect(x-.5,ty-5,1,5)}
 });
 if(hov>=0){var b=B[hov],s=SV[b.s];lab.style.display='block';lab.style.left=b.x+'px';lab.style.top=(cv.offsetTop+(h-12)-b.h-b.tw-14)+'px';lab.textContent=s[0]+(fail[b.s]?' · declined':' · ok');lab.style.borderColor=fail[b.s]?'#ff3b3b':s[1];cv.style.cursor='pointer'}else{lab.style.display='none';cv.style.cursor='default'}
},{still:2,dpr:1.5,host:hero});
cv.style.pointerEvents='auto';cv.style.touchAction='pan-y';
cv.addEventListener('pointerdown',function(e){var r=cv.getBoundingClientRect(),x=e.clientX-r.left;B.forEach(function(b){if(b.s>=0&&Math.abs(x-b.x)<b.tw*1.1){fail[b.s]=!fail[b.s];if(fail[b.s])setTimeout(function(){fail[b.s]=false},3500)}})});
})();
