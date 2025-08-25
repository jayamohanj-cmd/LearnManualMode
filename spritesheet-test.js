(function(){
  'use strict';
  const $ = s=>document.querySelector(s);
  const urlIn = $('#url'), fileIn = $('#file'), fwIn = $('#fw'), fhIn = $('#fh');
  const framesIn = $('#frames'), fpsIn = $('#fps'), pixIn = $('#pix'), btn = $('#load');
  const cv = $('#cv'), ctx = cv.getContext('2d');

  let img = null, fw=64, fh=64, frames=6, fps=12, frame=0, t=0;

  function fitCanvas(){
    const size = Math.min(window.innerWidth-40, window.innerHeight-120);
    const s = Math.max(300, Math.min(720, size));
    cv.width = cv.height = s|0;
  }
  fitCanvas();
  window.addEventListener('resize', fitCanvas);

  function setImage(src){
    return new Promise((resolve,reject)=>{
      const im = new Image();
      im.onload = ()=> resolve(im);
      im.onerror = reject;
      im.src = src;
    });
  }

  function draw(dt){
    t += dt;
    const adv = t*fps;
    frame = Math.floor(adv % Math.max(1, frames));

    // clear
    ctx.clearRect(0,0,cv.width,cv.height);
    // checker bg
    const s=16; for(let y=0;y<cv.height;y+=s){for(let x=0;x<cv.width;x+=s){
      ctx.fillStyle = ((x+y)/s)%2? '#0e141c':'#0b0f14'; ctx.fillRect(x,y,s,s);
    }}

    if(img){
      ctx.imageSmoothingEnabled = !pixIn.checked ? true : false;
      const cols = Math.max(1, Math.floor(img.width/fw|0));
      const col = frame % cols, row = Math.floor(frame/cols);
      const sx = col*fw, sy = row*fh;

      // fit inside canvas (centered)
      const scale = Math.min(cv.width/(fw*1.2), cv.height/(fh*1.2));
      const dw = Math.floor(fw*scale), dh = Math.floor(fh*scale);
      const dx = (cv.width - dw)/2, dy = (cv.height - dh)/2;
      ctx.drawImage(img, sx, sy, fw, fh, dx, dy, dw, dh);

      // frame rect
      ctx.strokeStyle = '#7cd1ff'; ctx.lineWidth = 2;
      ctx.strokeRect(dx, dy, dw, dh);
    }

    requestAnimationFrame((now)=> draw( (now - (draw._last||now))/1000, draw._last=now ));
  }
  requestAnimationFrame((now)=> draw(0, draw._last=now));

  async function doLoad(fromDrop){
    fw = Math.max(1, parseInt(fwIn.value,10)||64);
    fh = Math.max(1, parseInt(fhIn.value,10)||64);
    frames = Math.max(1, parseInt(framesIn.value,10)||6);
    fps = Math.max(1, parseInt(fpsIn.value,10)||12);

    if(fromDrop && fromDrop.dataTransfer && fromDrop.dataTransfer.files[0]){
      const f = fromDrop.dataTransfer.files[0];
      img = await setImage(URL.createObjectURL(f));
    } else if (fileIn.files && fileIn.files[0]) {
      img = await setImage(URL.createObjectURL(fileIn.files[0]));
    } else if (urlIn.value) {
      img = await setImage(urlIn.value);
    } else {
      alert('Provide an image via URL or File input, or drop a PNG onto the page.');
      return;
    }

    // Guess frame count if not provided (exact grid)
    if ((img.width % fw === 0) && (img.height % fh === 0)){
      const cols = img.width / fw;
      const rows = img.height / fh;
      const guess = cols * rows;
      if(!framesIn.value || parseInt(framesIn.value,10) <= 1){
        frames = guess|0;
        framesIn.value = frames;
      }
    }
  }

  btn.addEventListener('click', ()=> doLoad().catch(()=> alert('Failed to load image. If using an external URL, host it in your repo to avoid CORS.')), {passive:true});
  window.addEventListener('dragover', e=>{ e.preventDefault(); }, {passive:false});
  window.addEventListener('drop', e=>{
    e.preventDefault();
    doLoad(e).catch(()=> alert('Failed to load dropped file.'));
  }, {passive:false});

})();
