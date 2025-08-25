/* Master Manual Mode - vanilla JS
   - Smooth dial controls (pointer capture + rAF easing)
   - Sprite class (grid-based sheet; multi-row OK)
   - Scenes: Runner (default), Waterfall (motion blur demo)
   - Exposure model: exposure = baseLight * shutter * (ISO/100) / (aperture^2)
   - ISO grain, DoF blur hint, shutter flash + sound (WebAudio fallback)
   - Export PNG
   Guardrails: DOM safe, defer script, no undefined refs, clamped inputs
*/

(function(){
  'use strict';

  // ---------- DOM ----------
  const $ = sel => document.querySelector(sel);
  const vf = $('#vf');
  const hud = $('#hud');
  const flashEl = $('#flash');
  const tabRunner = $('#tab-runner');
  const tabWater = $('#tab-waterfall');
  const dialShutter = $('#dial-shutter');
  const dialAperture = $('#dial-aperture');
  const readShutter = $('#readout-shutter');
  const readAperture = $('#readout-aperture');
  const isoInput = $('#iso');
  const isoOut = $('#iso-out');
  const btnPlay = $('#btn-play');
  const btnShutter = $('#btn-shutter');
  const btnExport = $('#btn-export');

  if(!vf || !hud || !dialShutter || !dialAperture || !isoInput || !btnPlay || !btnShutter || !btnExport){
    console.warn('DOM not ready'); return;
  }

  // ---------- Canvas ----------
  const ctx = vf.getContext('2d');
  const DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  function fitCanvas(){
    // Keep internal resolution sharp
    const cssW = vf.clientWidth, cssH = vf.clientHeight;
    vf.width = Math.floor(cssW * DPR);
    vf.height = Math.floor(cssH * DPR);
  }
  fitCanvas();
  new ResizeObserver(fitCanvas).observe(vf);

  // ---------- Utilities ----------
  const clamp = (v, lo, hi)=> Math.max(lo, Math.min(hi, v));
  const lerp = (a, b, t)=> a + (b - a) * t;
  const ease = (cur, target, rate)=> cur + (target - cur) * rate;
  const TAU = Math.PI * 2;

  function formatShutter(s){
    if (s >= 1) return s.toFixed(1) + 's';
    const d = Math.round(1 / s);
    return '1/' + d;
  }
  function formatAperture(f){ return 'f/' + (Math.round(f*10)/10).toString(); }
  function logMap01To(min, max, t){ return min * Math.pow(max/min, clamp(t,0,1)); }
  function invLogMap(min, max, v){
    v = clamp(v, min, max);
    return Math.log(v/min) / Math.log(max/min);
  }

  // ---------- Audio (shutter) ----------
  let shutterAudio = null;
  try {
    shutterAudio = new Audio('./assets/shutter.ogg');
    shutterAudio.volume = 0.35;
  } catch(e) {
    shutterAudio = null;
  }
  const audioCtx = (window.AudioContext || window.webkitAudioContext) ? new (window.AudioContext || window.webkitAudioContext)() : null;
  function playShutterClick(){
    // If file exists and can play: prefer it
    if (shutterAudio && shutterAudio.play) {
      const p = shutterAudio.cloneNode();
      p.volume = 0.35;
      p.play().catch(()=> synthClick());
      return;
    }
    synthClick();
  }
  function synthClick(){
    if(!audioCtx) return;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(600, audioCtx.currentTime);
    g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.4, audioCtx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.09);
    o.connect(g).connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + 0.1);
  }

  // ---------- Grain (ISO) ----------
  const grainCanvas = document.createElement('canvas');
  const grainSize = 128;
  grainCanvas.width = grainCanvas.height = grainSize;
  const gctx = grainCanvas.getContext('2d');
  const gimg = gctx.createImageData(grainSize, grainSize);
  for(let i=0; i<gimg.data.length; i+=4){
    const n = Math.random()*255|0;
    gimg.data[i]=gimg.data[i+1]=gimg.data[i+2]=n;
    gimg.data[i+3]=255;
  }
  gctx.putImageData(gimg,0,0);
  function drawGrain(intensity){
    if(intensity<=0) return;
    const repsX = Math.ceil(vf.width/grainSize);
    const repsY = Math.ceil(vf.height/grainSize);
    ctx.globalAlpha = intensity;
    for(let y=0;y<repsY;y++){
      for(let x=0;x<repsX;x++){
        ctx.drawImage(grainCanvas, x*grainSize, y*grainSize);
      }
    }
    ctx.globalAlpha = 1;
  }

  // ---------- Sprite class ----------
  class Sprite {
    constructor(img, fw, fh, frames, fps, scale=1){
      this.img = img; this.fw = fw|0; this.fh = fh|0; this.frames = Math.max(1, frames|0);
      this.fps = fps || 12; this.scale = scale || 1;
      this.t = 0; this.playing = true; this.frame = 0;
      this.cols = Math.max(1, Math.floor(img.width / this.fw));
      this.rows = Math.max(1, Math.floor(img.height / this.fh));
    }
    play(){ this.playing=true; }
    pause(){ this.playing=false; }
    update(dt){
      if(!this.playing) return;
      this.t += dt;
      const adv = this.t * this.fps;
      this.frame = Math.floor(adv % this.frames);
    }
    draw(ctx, x, y){
      const col = this.frame % this.cols;
      const row = Math.floor(this.frame / this.cols);
      const sx = col * this.fw;
      const sy = row * this.fh;
      const dw = Math.floor(this.fw * this.scale);
      const dh = Math.floor(this.fh * this.scale);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.img, sx, sy, this.fw, this.fh, x|0, y|0, dw, dh);
    }
  }

  // ---------- Procedural placeholder spritesheets ----------
  function makeRunnerSheet(){
    // 6 frames, 64x64 each, very blocky runner silhouette with moving legs/arms
    const fw=64, fh=64, frames=6, cols=6, rows=1;
    const w = fw*cols, h = fh*rows;
    const c = document.createElement('canvas'); c.width=w; c.height=h;
    const x = c.getContext('2d');
    x.fillStyle='#000'; x.fillRect(0,0,w,h);
    for(let f=0; f<frames; f++){
      const ox = f*fw;
      // background stripe for variety
      x.fillStyle = f%2? '#081019' : '#0a0f14';
      x.fillRect(ox,0,fw,fh);
      // runner: torso
      x.fillStyle = '#d6e6ff';
      x.fillRect(ox+28,18,8,22);
      // head
      x.beginPath(); x.arc(ox+32,12,6,0,TAU); x.fill();
      // legs (swing)
      const leg = (f/frames)*TAU;
      const l1 = Math.sin(leg)*10, l2 = Math.sin(leg+Math.PI)*10;
      x.fillRect(ox+28,40,6,14);
      x.save(); x.translate(ox+30,48); x.rotate(l1*0.08); x.fillRect(-2,0,4,12); x.restore();
      x.save(); x.translate(ox+34,48); x.rotate(l2*0.08); x.fillRect(-2,0,4,12); x.restore();
      // arms (counter-swing)
      const a1 = Math.sin(leg+Math.PI)*8, a2 = Math.sin(leg)*8;
      x.save(); x.translate(ox+26,24); x.rotate(a1*0.09); x.fillRect(-2,0,4,12); x.restore();
      x.save(); x.translate(ox+38,24); x.rotate(a2*0.09); x.fillRect(-2,0,4,12); x.restore();
      // ground
      x.fillStyle = '#152433'; x.fillRect(ox,56,fw,4);
    }
    const img = new Image();
    img.src = c.toDataURL('image/png');
    return {img, fw, fh, frames};
  }

  function makeWaterfallLayer(width, height, speedSeed){
    const c = document.createElement('canvas');
    c.width = width; c.height = height;
    const x = c.getContext('2d');
    const cols = 48;
    for(let i=0;i<cols;i++){
      const w = Math.random()*6+2;
      const xPos = Math.random()*width;
      const grad = x.createLinearGradient(xPos,0,xPos, height);
      const a = 0.7 + Math.random()*0.3;
      grad.addColorStop(0, `rgba(180,220,255,${a})`);
      grad.addColorStop(1, `rgba(140,180,220,${a*0.8})`);
      x.fillStyle = grad;
      x.fillRect(xPos, 0, w, height);
    }
    // subtle foam dots
    x.fillStyle = 'rgba(255,255,255,0.4)';
    for(let i=0;i<200;i++){
      x.fillRect(Math.random()*width, Math.random()*height, 1, 1);
    }
    return c;
  }

  // ---------- Scenes ----------
  const scenes = {};
  let currentScene = 'runner';

  // Shared exposure params (animated via easing)
  const expo = {
    shutter: 1/250, targetShutter: 1/250,  // seconds
    aperture: 4, targetAperture: 4,        // f-number
    iso: 200, targetISO: 200,              // ISO
    baseLight: 1.0
  };

  // Runner scene
  (function initRunner(){
    const runnerSheet = makeRunnerSheet();
    const sprite = new Sprite(runnerSheet.img, runnerSheet.fw, runnerSheet.fh, runnerSheet.frames, 12, 2.4);
    let posX = 0, posY = 0;
    let speed = 140; // px/s @ DPR space

    scenes.runner = {
      name: 'Runner',
      play(){ sprite.play(); },
      pause(){ sprite.pause(); },
      update(dt){
        sprite.update(dt);
        const vw = vf.width, vh = vf.height;
        posY = vh*0.6 - sprite.fh*sprite.scale;
        posX += speed * dt * DPR; // move across
        if(posX > vw + 20) posX = -sprite.fw*sprite.scale - 20;
      },
      render(){
        const vw = vf.width, vh = vf.height;

        // background w/ DoF blur hint
        const dof = clamp((2.2 - Math.log(expo.aperture))/2.2, 0, 1); // more blur at low f
        ctx.save();
        ctx.fillStyle = '#0c121a'; ctx.fillRect(0,0,vw,vh);
        ctx.filter = `blur(${Math.round(dof*6)}px)`;
        // distant skyline blocks
        ctx.fillStyle = '#0f1a24'; for(let i=0;i<12;i++){ ctx.fillRect(i*vw/12, vh*0.35 + (i%3)*6, vw/18, vh*0.4); }
        ctx.fillStyle = '#0e1620'; for(let i=0;i<10;i++){ ctx.fillRect(i*vw/10+15, vh*0.42 + (i%2)*4, vw/20, vh*0.35); }
        ctx.restore();

        // exposure brightness lift
        const exposure = computeExposure();
        if(exposure > 1){
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = clamp((exposure-1)*0.4, 0, 0.8);
          ctx.fillStyle = '#b8d9ff';
          ctx.fillRect(0,0,vw,vh);
          ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
        }

        // ground
        ctx.fillStyle = '#0a1016'; ctx.fillRect(0,vh*0.7, vw, vh*0.3);
        ctx.fillStyle = '#101a24'; ctx.fillRect(0,vh*0.68, vw, 3);

        // motion blur based on shutter (longer = more streaks)
        const shutter = expo.shutter;
        const samples = clamp(Math.round(lerp(1, 18, clamp(shutter/0.5,0,1))), 1, 18);
        const trail = speed * shutter;
        for(let i=samples-1; i>=0; i--){
          const t = i / samples;
          const x = posX - trail * t * DPR;
          ctx.globalAlpha = 0.08 + (1 - t) * 0.22;
          sprite.draw(ctx, x, posY);
        }
        ctx.globalAlpha = 1;

        // grid + corners
        drawGridAndCorners();
        // UI overlays are HTML; export path will re-draw overlays via canvas (see exportPNG)
      }
    };
  })();

  // Waterfall scene (layered strips with vertical motion; blur from shutter)
  (function initWaterfall(){
    const vw = 1280, vh = 720; // base; scaled by canvas anyway
    const layer1 = makeWaterfallLayer(320, vh, 0.7);
    const layer2 = makeWaterfallLayer(400, vh, 0.4);
    const layer3 = makeWaterfallLayer(260, vh, 0.9);
    const layers = [
      {img: layer1, x: 300, w: 320, speed: 140},
      {img: layer2, x: 620, w: 400, speed: 220},
      {img: layer3, x: 980, w: 260, speed: 180},
    ];
    let yOff = 0;

    scenes.waterfall = {
      name: 'Waterfall',
      play(){},
      pause(){},
      update(dt){
        yOff += dt;
      },
      render(){
        const w = vf.width, h = vf.height;

        // rocky background
        ctx.fillStyle = '#0b0f14'; ctx.fillRect(0,0,w,h);
        ctx.fillStyle = '#0e141c'; ctx.fillRect(0,h*0.55, w, h*0.45);
        ctx.fillStyle = '#121a24'; ctx.fillRect(0,h*0.6, w, 6);

        // DoF hint from aperture (lower f-number => blur more background rock)
        const dof = clamp((2.2 - Math.log(expo.aperture))/2.2, 0, 1);
        // draw a dark cliff silhouette behind water
        ctx.save();
        ctx.filter = `blur(${Math.round(dof*7)}px)`;
        ctx.fillStyle = '#0c131b';
        ctx.beginPath();
        ctx.moveTo(200,0); ctx.lineTo(260,h); ctx.lineTo(200,h); ctx.closePath(); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(w-200,0); ctx.lineTo(w-240,h); ctx.lineTo(w-200,h); ctx.closePath(); ctx.fill();
        ctx.restore();

        // Water layers with motion; integrate over shutter time => more streaks when shutter is long
        const shutter = expo.shutter;
        const samples = clamp(Math.round(lerp(1, 24, clamp(shutter/0.5,0,1))), 1, 24);
        for (const L of layers){
          for(let i=0;i<samples;i++){
            const t = i/samples;
            const y = ((yOff + t) * L.speed * DPR) % h;
            ctx.globalAlpha = 0.05 + (1 - t) * 0.12;
            // tile vertically
            for(let k=-1; k<=1; k++){
              ctx.drawImage(L.img, Math.floor(L.x*DPR), Math.floor((y + k*h)), Math.floor(L.w*DPR), h);
            }
          }
        }
        ctx.globalAlpha = 1;

        // exposure lift
        const exposure = computeExposure();
        if(exposure > 1){
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = clamp((exposure-1)*0.5, 0, 0.9);
          ctx.fillStyle = '#b8d9ff';
          ctx.fillRect(0,0,w,h);
          ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
        }

        drawGridAndCorners();
      }
    };
  })();

  function computeExposure(){
    // exposure ~ baseLight * shutter * (ISO/100) / (aperture^2)
    const e = expo.baseLight * expo.shutter * (expo.iso/100) / (expo.aperture*expo.aperture);
    // scale to pleasant viewing range (tuned)
    return clamp(e * 2.4, 0, 3.5);
  }

  function drawGridAndCorners(){
    const w = vf.width, h = vf.height;
    const lw = Math.max(1, Math.floor(1 * DPR));
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = lw;

    // rule of thirds
    ctx.beginPath();
    ctx.moveTo(w/3,0); ctx.lineTo(w/3,h);
    ctx.moveTo(2*w/3,0); ctx.lineTo(2*w/3,h);
    ctx.moveTo(0,h/3); ctx.lineTo(w,h/3);
    ctx.moveTo(0,2*h/3); ctx.lineTo(w,2*h/3);
    ctx.stroke();

    // thin corners
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    const L = Math.floor(24*DPR);
    ctx.beginPath();
    // TL
    ctx.moveTo(2, L); ctx.lineTo(2,2); ctx.lineTo(L,2);
    // TR
    ctx.moveTo(w-2, L); ctx.lineTo(w-2,2); ctx.lineTo(w-L,2);
    // BL
    ctx.moveTo(2, h-L); ctx.lineTo(2,h-2); ctx.lineTo(L,h-2);
    // BR
    ctx.moveTo(w-2, h-L); ctx.lineTo(w-2,h-2); ctx.lineTo(w-L,h-2);
    ctx.stroke();

    // ISO grain overlay
    const isoNorm = clamp((expo.iso - 100) / (6400 - 100), 0, 1);
    drawGrain(isoNorm * 0.25);
  }

  // ---------- Render loop ----------
  let raf = 0, last = performance.now(), playing = true, flashAlpha = 0;
  function tick(t){
    const dt = Math.min(0.05, (t - last)/1000);
    last = t;

    // ease params
    expo.shutter = ease(expo.shutter, expo.targetShutter, 0.15);
    expo.aperture = ease(expo.aperture, expo.targetAperture, 0.15);
    expo.iso = ease(expo.iso, expo.targetISO, 0.25);

    // scene update
    scenes[currentScene].update(dt);

    // render
    ctx.clearRect(0,0,vf.width,vf.height);
    scenes[currentScene].render();

    // shutter flash overlay (canvas-based for export path)
    if(flashAlpha > 0){
      ctx.globalAlpha = flashAlpha;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0,0,vf.width,vf.height);
      ctx.globalAlpha = 1;
      flashAlpha = Math.max(0, flashAlpha - dt*3.8);
      flashEl.style.opacity = Math.max(0, flashAlpha).toFixed(2); // HTML overlay to show in UI too
    } else if (flashEl.style.opacity !== '0') {
      flashEl.style.opacity = '0';
    }

    if(playing) raf = requestAnimationFrame(tick);
  }
  function start(){ if(!playing){ playing=true; last=performance.now(); raf=requestAnimationFrame(tick);} }
  function stop(){ playing=false; cancelAnimationFrame(raf); }

  // start
  scenes[currentScene].play();
  raf = requestAnimationFrame(tick);

  // ---------- Dials (pointer capture + rAF-friendly easing) ----------
  function makeDial(el, options){
    const knob = el.querySelector('.dial-knob');
    const {get, set, format} = options;
    let dragging = false, startAngle=0, startVal=0;

    function angleFromEvent(ev){
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width/2;
      const cy = rect.top + rect.height/2;
      const dx = ev.clientX - cx, dy = ev.clientY - cy;
      let a = Math.atan2(dy, dx); // [-PI, PI]
      a = a + Math.PI/2; // rotate so top is min
      // map angle to [0,1] across ~300 degrees (avoid a dead zone at bottom)
      let t = (a + Math.PI) / (2*Math.PI); // [0,1] around circle
      // compress bottom 60deg
      const dead = 60/360;
      t = (t + (dead/2)) % 1; // shift
      t = clamp(t / (1 - dead), 0, 1);
      return t;
    }

    function onDown(ev){
      dragging = true; document.body.classList.add('dragging');
      el.setPointerCapture(ev.pointerId);
      startAngle = angleFromEvent(ev);
      startVal = getT();
      ev.preventDefault();
    }
    function onMove(ev){
      if(!dragging) return;
      const a = angleFromEvent(ev);
      const delta = a - startAngle;
      const t = clamp(startVal + delta, 0, 1);
      setT(t);
    }
    function onUp(){
      dragging=false; document.body.classList.remove('dragging');
    }
    function getT(){ return clamp(options.toT(get()), 0, 1); }
    function setT(t){
      const v = options.fromT(clamp(t,0,1));
      set(v);
      knob.style.transform = `rotate(${(t*300-150).toFixed(1)}deg)`; // map to -150..+150 deg
      el.setAttribute('aria-valuenow', String(t.toFixed(3)));
      options.onChange && options.onChange(v);
    }
    // init
    setT(getT());

    el.addEventListener('pointerdown', onDown, {passive:false});
    el.addEventListener('pointermove', onMove, {passive:true});
    el.addEventListener('pointerup', onUp, {passive:true});
    el.addEventListener('pointercancel', onUp, {passive:true});
    el.addEventListener('keydown', (e)=>{
      // keyboard adjust
      const step = (e.shiftKey? 0.05 : 0.015);
      if(e.key==='ArrowLeft' || e.key==='ArrowDown'){ setT(getT()-step); e.preventDefault(); }
      if(e.key==='ArrowRight'|| e.key==='ArrowUp'){ setT(getT()+step); e.preventDefault(); }
    });
    // click to focus
    el.addEventListener('click', ()=> el.focus(), {passive:true});

    // Update readout continuously
    function sync(){
      options.onChange && options.onChange(get());
      requestAnimationFrame(sync);
    }
    requestAnimationFrame(sync);

    return {setT, getT};
  }

  // Shutter dial: 1/1000 .. 0.5s (logarithmic)
  const shutterMin = 1/1000, shutterMax = 0.5;
  const shutterDial = makeDial(dialShutter, {
    get: ()=> expo.targetShutter,
    set: (v)=> { expo.targetShutter = clamp(v, shutterMin, shutterMax); },
    toT: (v)=> invLogMap(shutterMin, shutterMax, v),
    fromT: (t)=> logMap01To(shutterMin, shutterMax, t),
    onChange: (v)=> { readShutter.textContent = formatShutter(v); }
  });

  // Aperture dial: f/1.8 .. f/16 (logarithmic)
  const apMin = 1.8, apMax = 16;
  const apertureDial = makeDial(dialAperture, {
    get: ()=> expo.targetAperture,
    set: (v)=> { expo.targetAperture = clamp(v, apMin, apMax); },
    toT: (v)=> invLogMap(apMin, apMax, v),
    fromT: (t)=> logMap01To(apMin, apMax, t),
    onChange: (v)=> { readAperture.textContent = formatAperture(v); }
  });

  // ISO slider (100..6400)
  isoInput.addEventListener('input', ()=>{
    const v = clamp(parseInt(isoInput.value,10)||200, 100, 6400);
    expo.targetISO = v; isoOut.textContent = `ISO ${v}`;
  }, {passive:true});
  isoOut.textContent = `ISO ${isoInput.value}`;

  // ---------- Buttons ----------
  btnPlay.addEventListener('click', ()=>{
    if(playing){ stop(); btnPlay.textContent='▶︎'; scenes[currentScene].pause(); }
    else { start(); btnPlay.textContent='⏸︎'; scenes[currentScene].play(); }
  }, {passive:true});

  function fireShutter(){
    playShutterClick();
    flashAlpha = 0.6;
    flashEl.style.opacity = '0.6';
  }
  btnShutter.addEventListener('click', fireShutter, {passive:true});
  // keyboard: Enter triggers shutter
  window.addEventListener('keydown', (e)=>{
    if(e.key === 'Enter'){ fireShutter(); }
  }, {passive:true});

  // Scene tabs
  function selectScene(name){
    if(name === currentScene) return;
    scenes[currentScene].pause();
    currentScene = name;
    scenes[currentScene].play();
    tabRunner.classList.toggle('is-active', currentScene==='runner');
    tabRunner.setAttribute('aria-selected', currentScene==='runner' ? 'true' : 'false');
    tabWater.classList.toggle('is-active', currentScene==='waterfall');
    tabWater.setAttribute('aria-selected', currentScene==='waterfall' ? 'true' : 'false');
  }
  tabRunner.addEventListener('click', ()=> selectScene('runner'), {passive:true});
  tabWater.addEventListener('click', ()=> selectScene('waterfall'), {passive:true});

  // ---------- Export PNG ----------
  function exportPNG(){
    try{
      // We already draw overlays (grid/corners/flash) in canvas.
      const a = document.createElement('a');
      a.download = 'shot.png';
      a.href = vf.toDataURL('image/png');
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch(e){
      alert('Export failed. Make sure this is served via http(s) (GitHub Pages is fine).');
    }
  }
  btnExport.addEventListener('click', exportPNG, {passive:true});

})();
