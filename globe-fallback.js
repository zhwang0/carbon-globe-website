const $ = selector => document.querySelector(selector);
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// Orthographic globe: every colored point comes from the supplied ED simulation grid.
export function createPointGlobe(canvas) {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    $('#globe-status').textContent = 'Your browser cannot display the globe. Explore the data below.';
    return {setPoints() {}};
  }
  let width = 600, height = 600, points = [];
  let longitude = -28 * Math.PI / 180, tilt = 0.16;
  let paused = reducedMotion.matches, visible = true, dragging = false, lastPointer = null;
  let lastFrame = 0, needsRender = true;
  const toggle = $('#globe-toggle');
  function updateButton() {
    toggle.setAttribute('aria-pressed', String(paused));
    toggle.setAttribute('aria-label', paused ? 'Resume globe rotation' : 'Pause globe rotation');
    $('#globe-play-icon').textContent = paused ? '▶' : 'Ⅱ';
  }
  updateButton();
  toggle.addEventListener('click', () => { paused = !paused; updateButton(); needsRender = true; });
  reducedMotion.addEventListener('change', () => { paused = reducedMotion.matches; updateButton(); });
  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    width = rect.width || 600; height = rect.height || width;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0); needsRender = true;
  };
  new ResizeObserver(resize).observe(canvas);
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; needsRender = true; }).observe(canvas);
  canvas.addEventListener('pointerdown', (event) => {
    dragging = true; lastPointer = {x:event.clientX, y:event.clientY};
    canvas.setPointerCapture(event.pointerId); canvas.classList.add('dragging');
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    longitude -= (event.clientX - lastPointer.x) * 0.006;
    tilt = Math.max(-0.65, Math.min(0.65, tilt + (event.clientY - lastPointer.y) * 0.004));
    lastPointer = {x:event.clientX, y:event.clientY}; needsRender = true;
  });
  const release = () => { dragging = false; canvas.classList.remove('dragging'); };
  canvas.addEventListener('pointerup', release); canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('keydown', (event) => {
    if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
    event.preventDefault(); paused = true; updateButton();
    if (event.key === 'ArrowLeft') longitude -= 0.13;
    if (event.key === 'ArrowRight') longitude += 0.13;
    if (event.key === 'ArrowUp') tilt = Math.min(0.65, tilt + 0.08);
    if (event.key === 'ArrowDown') tilt = Math.max(-0.65, tilt - 0.08);
    needsRender = true;
  });
  function render() {
    const x0 = width * 0.5, y0 = height * 0.48, radius = Math.min(width, height) * 0.407;
    const ct = Math.cos(tilt), st = Math.sin(tilt), cl = Math.cos(longitude), sl = Math.sin(longitude);
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = '#bdc8b942'; ctx.lineWidth = 0.8;
    [1.11, 1.20].forEach((scale) => {
      ctx.beginPath(); ctx.ellipse(x0, y0, radius * scale, radius * scale, 0, 0, Math.PI*2); ctx.stroke();
    });
    for (let i = 0; i < 72; i++) {
      const a = i * Math.PI / 36, r = radius * 1.16;
      ctx.beginPath(); ctx.moveTo(x0+Math.cos(a)*r, y0+Math.sin(a)*r);
      ctx.lineTo(x0+Math.cos(a)*(r+(i%6===0?6:2)), y0+Math.sin(a)*(r+(i%6===0?6:2))); ctx.stroke();
    }
    const shadow = ctx.createRadialGradient(x0, y0+radius*.85, 0, x0, y0+radius*.85, radius*.8);
    shadow.addColorStop(0, '#143e3220'); shadow.addColorStop(1, '#143e3200');
    ctx.save(); ctx.translate(0, height*.18); ctx.scale(1, .80); ctx.fillStyle=shadow; ctx.fillRect(0,0,width,height); ctx.restore();
    const sphere = ctx.createRadialGradient(x0-radius*.35,y0-radius*.45,radius*.05,x0+radius*.17,y0+radius*.15,radius*1.12);
    sphere.addColorStop(0,'#295e76'); sphere.addColorStop(.5,'#19465e'); sphere.addColorStop(.85,'#0c2c41'); sphere.addColorStop(1,'#071d2f');
    ctx.beginPath(); ctx.arc(x0,y0,radius,0,Math.PI*2); ctx.fillStyle=sphere; ctx.fill();
    ctx.save(); ctx.clip();
    function project(lat, lon) {
      const cos = Math.cos(lat), x = cos*Math.sin(lon-longitude), z = cos*Math.cos(lon-longitude), y = Math.sin(lat);
      return [x0+x*radius, y0-(y*ct-z*st)*radius, y*st+z*ct];
    }
    function gridLine(coords) {
      ctx.beginPath(); let drawing=false;
      for (const [lat,lon] of coords) {
        const p = project(lat,lon);
        if (p[2] <= 0) { drawing=false; continue; }
        if (!drawing) ctx.moveTo(p[0],p[1]); else ctx.lineTo(p[0],p[1]);
        drawing=true;
      }
      ctx.stroke();
    }
    ctx.strokeStyle = '#c8e5ba17'; ctx.lineWidth=.65;
    for (let lat=-60;lat<=60;lat+=30) gridLine(Array.from({length:181},(_,i)=>[lat*Math.PI/180,i*Math.PI/90]));
    for (let lon=0;lon<360;lon+=30) gridLine(Array.from({length:91},(_,i)=>[(-90+i*2)*Math.PI/180,lon*Math.PI/180]));
    const dot = Math.max(.65, radius / 230);
    for (const point of points) {
      const x=point.x*cl-point.z*sl, z=point.x*sl+point.z*cl;
      const depth=point.y*st+z*ct;
      if (depth < .015) continue;
      const px=x0+x*radius, py=y0-(point.y*ct-z*st)*radius;
      ctx.globalAlpha = .38 + depth*.62; ctx.fillStyle=point.color;
      const size=dot*(.65+depth*.35);
      ctx.fillRect(px-size,py-size,size*1.75,size*1.75);
    }
    ctx.globalAlpha=1;
    const shade=ctx.createLinearGradient(x0-radius,y0-radius,x0+radius,y0+radius);
    shade.addColorStop(0,'#d9f2b50a'); shade.addColorStop(.5,'#001e3000'); shade.addColorStop(1,'#0018247a');
    ctx.fillStyle=shade; ctx.fillRect(x0-radius,y0-radius,radius*2,radius*2); ctx.restore();
    ctx.strokeStyle='#9bb99566';ctx.lineWidth=1;ctx.beginPath();ctx.arc(x0,y0,radius,0,Math.PI*2);ctx.stroke();
  }
  function frame(time) {
    requestAnimationFrame(frame);
    if (document.hidden || !visible || time-lastFrame<32) return;
    const elapsed = Math.min(time-lastFrame,64); lastFrame=time;
    if (!paused && !dragging) { longitude += elapsed*.000035; needsRender=true; }
    if (needsRender) { render(); needsRender=false; }
  }
  resize(); requestAnimationFrame(frame);
  return {
    setPoints(rawPoints) {
      points = rawPoints.map(([lat,lon,agb]) => {
        const p=lat*Math.PI/180,l=lon*Math.PI/180,t=Math.max(0,Math.min(1,agb/12));
        const lo=[68,132,102], mid=[164,194,104], hi=[224,237,139];
        const a=t<.5?lo:mid,b=t<.5?mid:hi,f=t<.5?t*2:(t-.5)*2;
        const color=`rgb(${a.map((v,i)=>Math.round(v+(b[i]-v)*f)).join(',')})`;
        return {x:Math.cos(p)*Math.sin(l),y:Math.sin(p),z:Math.cos(p)*Math.cos(l),color};
      });
      needsRender=true; $('#globe-status').hidden=true;
    }
  };
}
