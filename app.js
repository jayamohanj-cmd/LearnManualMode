/* Master Manual Mode - vanilla JS
   - Smooth dial controls (pointer capture + rAF easing)
   - Sprite class (grid-based sheet; multi-row OK)
   - Scenes: Runner (uses ./assets/runner.png), Waterfall (motion blur demo)
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
    g.gain.exponentialRampToValueAtTime(0.0001, au
