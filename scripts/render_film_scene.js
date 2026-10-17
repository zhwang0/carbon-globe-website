/* Original procedural illustration. Geometry is not a measurement or model output. */
import * as THREE from '../assets/vendor/three.module.js';

const W = 1280, H = 720, DURATION = 20;
const canvas = document.querySelector('#frame'), ctx = canvas.getContext('2d');
await Promise.all([document.fonts.load('500 60px Manrope'), document.fonts.load('400 12px Mono')]);
const data = await fetch('../assets/data/carbon-globe.json').then(r => r.json());
const site = data.sites.find(s => s.id === 'congo'), series = site.trajectories['1'];
const renderer = new THREE.WebGLRenderer({antialias:true, alpha:false, preserveDrawingBuffer:true});
renderer.setSize(850, 630); renderer.setPixelRatio(1);
renderer.setClearColor('#091c19');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 850 / 630, .1, 300);
camera.position.set(0, 23, 78); camera.lookAt(0, 15, 0);
const world = new THREE.Group(); scene.add(world);
const grid = new THREE.GridHelper(58, 22, 0x32534b, 0x19372f);
grid.material.transparent = true; grid.material.opacity = .45; world.add(grid);

let seed = 317;
function random() { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; }
const positions = [], colors = [], types = [];
function add(x,y,z,leaf) {
  positions.push(x,y,z); types.push(leaf ? 1 : 0);
  const c = new THREE.Color(leaf ? '#c9ed95' : '#d8b789');
  c.multiplyScalar(.58 + .42 * random());
  if (leaf) c.lerp(new THREE.Color('#64b8a3'), .25 + .45 * random());
  colors.push(c.r,c.g,c.b);
}
function segment(a,b,radius,n) {
  for(let i=0;i<n;i++) {
    const t=random(), theta=random()*Math.PI*2, r=radius*(.25+.75*random());
    add(a[0]+(b[0]-a[0])*t+Math.cos(theta)*r,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t+Math.sin(theta)*r,false);
  }
}
function tree(x,z,height,width) {
  segment([x,0,z],[x+.3,height*.82,z],width*.065,1800);
  for(let b=0;b<19;b++) {
    const angle=b*2.39996+random()*.6;
    const y=height*(.30+random()*.46), spread=width*(.4+.6*random());
    const start=[x,y,z], end=[x+Math.cos(angle)*spread,y+height*(.1+.18*random()),z+Math.sin(angle)*spread];
    segment(start,end,.13,180);
    for(let k=0;k<4;k++) {
      const a=angle+(random()-.5)*2.4;
      const twig=[end[0]+Math.cos(a)*width*.35,end[1]+height*(.04+.09*random()),end[2]+Math.sin(a)*width*.35];
      segment(end,twig,.055,45);
      for(let j=0;j<105;j++) {
        const u=random()*2-1, theta=random()*Math.PI*2, rr=Math.cbrt(random());
        const radial=Math.sqrt(1-u*u)*rr;
        add(twig[0]+Math.cos(theta)*radial*width*.34,twig[1]+u*rr*height*.1,twig[2]+Math.sin(theta)*radial*width*.34,true);
      }
    }
  }
}
tree(0,0,27,6.3); tree(-10,-8,22,4.7); tree(10,-7,24,5.4);
tree(-9,8,18,4.2); tree(9,9,16,4.0);

const nodes=[], layers=[4,7,7,4], connections=[];
layers.forEach((count,layer)=>{
  for(let j=0;j<count;j++) nodes.push({layer, p:new THREE.Vector3(-20+layer*13.3,3+j*25/(count-1),Math.sin(j*1.7+layer)*2)});
});
nodes.forEach((a,i)=>nodes.forEach((b,j)=>{if(b.layer===a.layer+1)connections.push([i,j]);}));
const networkPositions=[];
for(let i=0;i<types.length;i++) {
  const edge=connections[Math.floor(random()*connections.length)];
  const a=nodes[edge[0]].p,b=nodes[edge[1]].p,t=random();
  networkPositions.push(a.x+(b.x-a.x)*t+(random()-.5)*.25,a.y+(b.y-a.y)*t+(random()-.5)*.25,a.z+(b.z-a.z)*t+(random()-.5)*.25);
}
const geometry=new THREE.BufferGeometry();
geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
geometry.setAttribute('networkPosition',new THREE.Float32BufferAttribute(networkPositions,3));
geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
geometry.setAttribute('leaf',new THREE.Float32BufferAttribute(types,1));
const uniforms={morph:{value:0},growth:{value:1},foliage:{value:1},time:{value:0}};
const material=new THREE.ShaderMaterial({
  uniforms,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
  vertexShader:`attribute vec3 networkPosition; attribute vec3 color; attribute float leaf;
    uniform float morph; uniform float growth; uniform float foliage; uniform float time;
    varying vec3 vColor; varying float vAlpha;
    void main(){
      vec3 forest=position; forest.y*=growth;
      vec3 p=mix(forest,networkPosition,morph);
      vec4 mv=modelViewMatrix*vec4(p,1.);
      gl_Position=projectionMatrix*mv;
      gl_PointSize=clamp(1.6*70./-mv.z,1.,3.);
      float pulse=.45+.55*pow(.5+.5*sin(networkPosition.x*.36-time*3.),4.);
      vColor=mix(color,vec3(.55,.92,.84),morph);
      vAlpha=mix(mix(.85,foliage,leaf),pulse*.24,morph);
    }`,
  fragmentShader:`varying vec3 vColor; varying float vAlpha;
    void main(){float d=length(gl_PointCoord-.5);if(d>.5)discard;
    gl_FragColor=vec4(vColor,vAlpha*smoothstep(.5,.1,d));}`
});
const particles=new THREE.Points(geometry,material); particles.frustumCulled=false; world.add(particles);
const network=new THREE.Group();world.add(network);
const nodeMaterial=new THREE.MeshBasicMaterial({color:0xdcf680,transparent:true,opacity:0});
nodes.forEach(n=>{const s=new THREE.Mesh(new THREE.SphereGeometry(.4,12,12),nodeMaterial);s.position.copy(n.p);network.add(s);});
const linePositions=[];
connections.forEach(([i,j])=>linePositions.push(...nodes[i].p.toArray(),...nodes[j].p.toArray()));
const lineGeo=new THREE.BufferGeometry();lineGeo.setAttribute('position',new THREE.Float32BufferAttribute(linePositions,3));
const lineMaterial=new THREE.LineBasicMaterial({color:0x6daca3,transparent:true,opacity:0});
network.add(new THREE.LineSegments(lineGeo,lineMaterial));
const signalMaterial=new THREE.MeshBasicMaterial({color:0xf0ffc3,transparent:true,opacity:0});
const signals=Array.from({length:28},(_,i)=>{
  const s=new THREE.Mesh(new THREE.SphereGeometry(.16,6,6),signalMaterial);network.add(s);return s;
});

function clamp(v,a=0,b=1){return Math.min(b,Math.max(a,v));}
function ease(v){v=clamp(v);return v*v*(3-2*v);}
function value(key,year){const i=Math.floor(year),t=year-i;return series[key][i]+((series[key][Math.min(i+1,40)]-series[key][i])*t);}
function text(str,x,y,size=18,color='#becdbd',font='Manrope',weight=400){ctx.fillStyle=color;ctx.font=`${weight} ${size}px ${font}`;ctx.fillText(str,x,y);}
function line(x1,y1,x2,y2,color='#365049',width=1){ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();}
function chart(key,x,y,w,h,year,max,color){
  line(x,y+h,x+w,y+h);line(x,y,x,y+h);
  text('0',x-15,y+h+4,10,'#8baba1','Mono');text(String(max),x-23,y+5,10,'#8baba1','Mono');
  text('0',x,y+h+22,10,'#8baba1','Mono');text('40 years',x+w-53,y+h+22,10,'#8baba1','Mono');
  ctx.strokeStyle=color;ctx.lineWidth=2.5;ctx.beginPath();
  for(let i=0;i<=Math.ceil(year*4);i++){const yr=Math.min(i/4,year);const xx=x+yr/40*w,yy=y+h-value(key,yr)/max*h;i?ctx.lineTo(xx,yy):ctx.moveTo(xx,yy);}
  ctx.stroke();const xx=x+year/40*w,yy=y+h-value(key,year)/max*h;ctx.fillStyle=color;ctx.beginPath();ctx.arc(xx,yy,4,0,Math.PI*2);ctx.fill();
}

window.renderFrame = (time) => {
  const t=clamp(time,0,DURATION), chapter=t<6?0:t<12.5?1:2;
  const morph=ease((t-5.6)/1.4)*(1-ease((t-12.5)/1.4));
  const year=chapter===0?40*ease((t-.35)/5.0):chapter===1?40:40*ease((t-13.3)/5.8);
  const forestYear=chapter===2?40:year;
  uniforms.morph.value=morph;uniforms.growth.value=value('height',forestYear)/series.height[40];
  uniforms.foliage.value=.18+.65*clamp(value('lai',forestYear)/6.1);uniforms.time.value=t;
  world.rotation.y=(.32+Math.sin(t*.22)*.15)*(1-morph)+Math.sin(t*.4)*.1*morph;
  world.position.y=0;
  nodeMaterial.opacity=morph*.95;lineMaterial.opacity=morph*.2;signalMaterial.opacity=morph;
  grid.material.opacity=.35*(1-morph);
  signals.forEach((s,i)=>{const edge=connections[(i*7)%connections.length];s.position.lerpVectors(nodes[edge[0]].p,nodes[edge[1]].p,(t*.42+i*.073)%1);});
  renderer.render(scene,camera);
  ctx.fillStyle='#091c19';ctx.fillRect(0,0,W,H);ctx.drawImage(renderer.domElement,420,55);
  // A soft edge joins the rendered scene to the editorial text column.
  const shade=ctx.createLinearGradient(400,0,590,0);shade.addColorStop(0,'#091c19');shade.addColorStop(1,'#091c1900');ctx.fillStyle=shade;ctx.fillRect(400,55,190,630);
  text('CarbonGlobe',60,54,23,'#eef2df','Manrope',650);text('ECOSYSTEMS → AI',1030,51,11,'#91b1a2','Mono');
  line(60,79,1220,79,'#29453b');
  const titles=[['A forest,','in motion.'],['Learn the','dynamics.'],['Then test','forty years.']];
  const tags=['01 / SIMULATE','02 / EMULATE','03 / BENCHMARK'];
  const entry=ease((t-(chapter===0?0:chapter===1?6:12.5))/.55);
  ctx.save();ctx.globalAlpha=entry;ctx.translate(0,12*(1-entry));
  text(tags[chapter],60,142,12,'#b9d58d','Mono');
  text(titles[chapter][0],56,225,55,'#f1f2e7','Manrope',500);
  text(titles[chapter][1],56,291,55,'#d6efb0','Manrope',500);
  if(chapter===0){
    text('A real 40-year ED trajectory.',60,342,18);text('Congo Basin · initial forest age 1',60,373,15,'#90ada0');
    text('SIMULATION YEAR',60,434,11,'#91b1a2','Mono');text(String(Math.round(year)).padStart(2,'0'),57,496,52,'#f1f2e7','Manrope',500);
    text('CANOPY HEIGHT',60,552,10,'#91b1a2','Mono');text(`${value('height',year).toFixed(1)} m`,60,588,27,'#d6efb0');
    text('BIOMASS',258,552,10,'#91b1a2','Mono');text(`${value('agb',year).toFixed(2)}`,258,588,27,'#d6efb0');text('kg C / m²',258,610,11,'#91b1a2','Mono');
  }else if(chapter===1){
    text('Learn ecosystem responses',60,342,18);text('from simulation sequences.',60,372,18);
    text('INPUT',60,436,10,'#91b1a2','Mono');text('Forest state + environment',60,466,18,'#eef2df');
    line(60,491,386,491);text('OUTPUT',60,523,10,'#91b1a2','Mono');text('The next forest state',60,554,18,'#d6efb0');
    text('CONCEPTUAL NEURAL NETWORK',685,612,11,'#91b1a2','Mono');
  }else{
    text('Compare long rollouts with ED.',60,338,17);text('Across climates. Across forest ages.',60,368,15,'#90ada0');
    text('ED REFERENCE · CANOPY HEIGHT (m)',60,421,10,'#b9d58d','Mono');
    chart('height',84,449,298,105,year,30,'#dcf680');
    text('40 years · 7 ecosystem targets',60,612,12,'#b9d58d','Mono');
    text('ILLUSTRATED FOREST · FINAL ED STATE',668,612,11,'#91b1a2','Mono');
  }
  ctx.restore();
  line(60,647,1220,647,'#29453b');line(60,647,60+1160*t/DURATION,647,'#c8e79f',2);
  text('ED reference data · Congo Basin · 0.75°S, 22.75°E',60,678,11,'#91b1a2','Mono');
  text('Illustrated geometry / conceptual AI',880,678,11,'#91b1a2','Mono');
  return {time:t,chapter,year,height:value('height',year),agb:value('agb',year)};
};
window.renderFrame(4.7);
window.filmReady=true;
window.filmMetadata={duration:DURATION,width:W,height:H,site:site.id,sourceIndex:site.sourceIndex,age:1,points:types.length,year0:{height:series.height[0],agb:series.agb[0]},year40:{height:series.height[40],agb:series.agb[40]}};
