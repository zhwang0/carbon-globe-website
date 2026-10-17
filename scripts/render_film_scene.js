/* Original cinematic illustration. ED values are references, not AI predictions. */
import * as THREE from '../assets/vendor/three.module.js';
const W=1280,H=720,DURATION=48,STARTS=[0,7,14,23,32,41];
const canvas=document.querySelector('#frame'),ctx=canvas.getContext('2d');
await Promise.all([document.fonts.load('500 60px Manrope'),document.fonts.load('400 12px Mono')]);
const growth=await fetch('../assets/data/film-growth.json').then(r=>{if(!r.ok)throw Error('Missing film data');return r.json();});
const congo=growth.profiles.find(s=>s.id==='congo'),profiles=['congo','eastern-us','boreal'].map(id=>growth.profiles.find(s=>s.id===id));
const colors=['#dcf680','#7adbd0','#daa9ee'];
const clamp=(v,a=0,b=1)=>Math.min(b,Math.max(a,v)),mix=(a,b,t)=>a+(b-a)*t;
const ease=v=>{v=clamp(v);return v*v*(3-2*v);};
function value(site,age,key,year){const s=site.trajectories[String(age)][key],i=Math.floor(clamp(year,0,40));return mix(s[i],s[Math.min(40,i+1)],year-i);}
function text(str,x,y,size=18,color='#bdcfc3',font='Manrope',weight=400){ctx.fillStyle=color;ctx.font=`${weight} ${size}px ${font}`;ctx.fillText(str,x,y);}
function line(x1,y1,x2,y2,color='#345448',width=1){ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();}
function circle(x,y,r,color){ctx.fillStyle=color;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();}
function arrow(x1,y1,x2,y2,color='#a6c987',width=1.5){line(x1,y1,x2,y2,color,width);const a=Math.atan2(y2-y1,x2-x1);line(x2,y2,x2-8*Math.cos(a-.5),y2-8*Math.sin(a-.5),color,width);line(x2,y2,x2-8*Math.cos(a+.5),y2-8*Math.sin(a+.5),color,width);}
function tag(label,x,y,color='#b9d58d'){text(label,x,y,11,color,'Mono');}
const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:true});
renderer.setSize(W,H);renderer.setPixelRatio(1);renderer.setClearColor('#091c19');
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(39,W/H,.1,400);
camera.position.set(0,25,90);camera.lookAt(0,14,0);
let seed=317;
function random(){seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;}
function treeGeometry(){
 const p=[],c=[],leaf=[];
 function add(x,y,z,l){p.push(x,y,z);leaf.push(l?1:0);const col=new THREE.Color(l?'#b5e39a':'#debd8d');col.multiplyScalar(.60+.4*random());if(l)col.lerp(new THREE.Color('#58b8a8'),random()*.65);c.push(col.r,col.g,col.b);}
 function branch(a,b,r,n){for(let j=0;j<n;j++){const t=random(),a1=random()*Math.PI*2,rr=r*(.3+.7*random());add(mix(a[0],b[0],t)+Math.cos(a1)*rr,mix(a[1],b[1],t),mix(a[2],b[2],t)+Math.sin(a1)*rr,false);}}
 branch([0,0,0],[.2,22,0],.36,1800);
 for(let i=0;i<22;i++){
  const a=i*2.39996+random()*.3,y=8+random()*13,r=3+random()*3.6,end=[Math.cos(a)*r,y+3+random()*4,Math.sin(a)*r];branch([0,y,0],end,.13,160);
  for(let k=0;k<4;k++){
   const a2=a+(random()-.5)*2.7,tip=[end[0]+Math.cos(a2)*2.1,end[1]+1+random()*2.6,end[2]+Math.sin(a2)*2.1];branch(end,tip,.05,40);
   for(let j=0;j<90;j++){const u=random()*2-1,theta=random()*Math.PI*2,rr=Math.cbrt(random()),rad=Math.sqrt(1-u*u)*rr;add(tip[0]+Math.cos(theta)*rad*2.2,tip[1]+u*rr*2.6,tip[2]+Math.sin(theta)*rad*2.2,true);}
  }
 }
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('color',new THREE.Float32BufferAttribute(c,3));g.setAttribute('leaf',new THREE.Float32BufferAttribute(leaf,1));return g;
}
const treeGeo=treeGeometry(),forest=new THREE.Group();scene.add(forest);
const stands=[1,10,50].map((age,i)=>{
 const uniforms={opacity:{value:1},foliage:{value:1}};
 const mat=new THREE.ShaderMaterial({uniforms,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
 vertexShader:`attribute vec3 color;attribute float leaf;uniform float opacity;uniform float foliage;varying vec3 vColor;varying float vAlpha;
 void main(){vec4 p=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*p;gl_PointSize=clamp(1.7*85./-p.z,1.,3.);vColor=color;vAlpha=opacity*mix(.9,foliage,leaf);}`,
 fragmentShader:`varying vec3 vColor;varying float vAlpha;void main(){float d=length(gl_PointCoord-.5);if(d>.5)discard;gl_FragColor=vec4(vColor,vAlpha*smoothstep(.5,.12,d));}`});
 const group=new THREE.Group();forest.add(group);group.add(new THREE.Points(treeGeo,mat));
 for(const [x,z,s] of [[-4,-5,.77],[4,-4,.86]]){const tree=new THREE.Points(treeGeo,mat);tree.position.set(x,0,z);tree.scale.set(s,s,s);tree.rotation.y=x*.3;group.add(tree);}
 group.position.x=[-1,18,37][i];return{age,group,uniforms};
});
const grid=new THREE.GridHelper(90,30,0x32534b,0x19372f);grid.material.transparent=true;grid.material.opacity=.3;grid.position.x=20;scene.add(grid);
// The film retains the same terrain imagery and blue oceans as the live Earth.
const loader=new THREE.TextureLoader();
const [terrain,mask]=await Promise.all([loader.loadAsync('../assets/textures/earth-terrain.webp'),loader.loadAsync('../assets/textures/earth-land-mask.png')]);
for(const t of [terrain,mask]){t.flipY=false;t.wrapS=THREE.RepeatWrapping;t.needsUpdate=true;}
terrain.colorSpace=THREE.SRGBColorSpace;mask.colorSpace=THREE.NoColorSpace;
const earth=new THREE.Group();scene.add(earth);
const globeUniforms={terrain:{value:terrain},mask:{value:mask},opacity:{value:1}};
const globeMat=new THREE.ShaderMaterial({uniforms:globeUniforms,transparent:true,
 vertexShader:`varying vec3 p;varying vec3 n;void main(){p=position;n=normalize(normalMatrix*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
 fragmentShader:`varying vec3 p;varying vec3 n;uniform sampler2D terrain;uniform sampler2D mask;uniform float opacity;
 void main(){vec3 u=normalize(p);vec2 uv=vec2(atan(u.x,u.z)/6.283185307+.5,.5-asin(u.y)/3.141592654);vec3 land=texture2D(terrain,uv).rgb;float m=texture2D(mask,uv).r;
 vec3 c=mix(vec3(.075,.22,.30),land,m);float light=.65+.4*max(0.,dot(normalize(n),normalize(vec3(-.6,.7,1.))));gl_FragColor=vec4(c*light,opacity);}`});
earth.add(new THREE.Mesh(new THREE.SphereGeometry(20,128,64),globeMat));
const atmosphere=new THREE.Mesh(new THREE.SphereGeometry(20.4,64,32),new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.BackSide,uniforms:{opacity:{value:1}},vertexShader:`varying vec3 n;varying vec3 v;void main(){vec4 p=modelViewMatrix*vec4(position,1.);n=normalize(normalMatrix*normal);v=normalize(-p.xyz);gl_Position=projectionMatrix*p;}`,fragmentShader:`varying vec3 n;varying vec3 v;uniform float opacity;void main(){float a=pow(1.-abs(dot(n,v)),4.);gl_FragColor=vec4(.35,.65,.8,a*.26*opacity);}`}));earth.add(atmosphere);
function decodeU16(s){const b=Uint8Array.from(atob(s),c=>c.charCodeAt(0)),d=new DataView(b.buffer);return Uint16Array.from({length:b.length/2},(_,i)=>d.getUint16(i*2,true));}
const heights=decodeU16(growth.global.height),coords=growth.global.sites,scale=growth.meta.scale;
const directions=[],pointColors=new Float32Array(coords.length*3),pointPositions=new Float32Array(coords.length*3);
coords.forEach(([lat,lon])=>{const a=lat*Math.PI/180,b=lon*Math.PI/180;directions.push(new THREE.Vector3(Math.sin(b)*Math.cos(a),Math.sin(a),Math.cos(b)*Math.cos(a)));});
const pointsGeo=new THREE.BufferGeometry();pointsGeo.setAttribute('position',new THREE.BufferAttribute(pointPositions,3));pointsGeo.setAttribute('color',new THREE.BufferAttribute(pointColors,3));
const pointsMat=new THREE.PointsMaterial({size:.18,vertexColors:true,transparent:true,opacity:1,depthWrite:false});
const mapPoints=new THREE.Points(pointsGeo,pointsMat);mapPoints.frustumCulled=false;earth.add(mapPoints);
const low=new THREE.Color('#3b9e85'),high=new THREE.Color('#e5fa9a');
function updateEarth(year){const j=Math.floor(year),f=year-j;for(let i=0;i<coords.length;i++){const h=mix(heights[i*41+j],heights[i*41+Math.min(40,j+1)],f)*scale;const d=directions[i],r=20.12+h*.075;pointPositions.set([d.x*r,d.y*r,d.z*r],i*3);const c=low.clone().lerp(high,clamp(h/35));pointColors.set([c.r,c.g,c.b],i*3);}pointsGeo.attributes.position.needsUpdate=true;pointsGeo.attributes.color.needsUpdate=true;}
// A conceptual deep architecture, deliberately not a trained baseline prediction.
const network=new THREE.Group();scene.add(network);
const nodes=[],links=[],layerSizes=[5,8,8,8,5];
layerSizes.forEach((count,l)=>{for(let j=0;j<count;j++)nodes.push({layer:l,p:new THREE.Vector3(-18+l*9,-11+j*22/(count-1),Math.sin(j*1.6+l)*1.5)});});
nodes.forEach((a,i)=>nodes.forEach((b,j)=>{if(b.layer===a.layer+1)links.push([i,j]);}));
const nodeMat=new THREE.MeshBasicMaterial({color:0xdcf680,transparent:true}),linkMat=new THREE.LineBasicMaterial({color:0x72b7a9,transparent:true});
nodes.forEach(n=>{const mesh=new THREE.Mesh(new THREE.SphereGeometry(.27,10,10),nodeMat);mesh.position.copy(n.p);network.add(mesh);});
const linkGeo=new THREE.BufferGeometry();linkGeo.setAttribute('position',new THREE.Float32BufferAttribute(links.flatMap(([i,j])=>[...nodes[i].p.toArray(),...nodes[j].p.toArray()]),3));network.add(new THREE.LineSegments(linkGeo,linkMat));
const pulseMat=new THREE.MeshBasicMaterial({color:0xf1ffd5,transparent:true});
const pulses=Array.from({length:40},()=>{const p=new THREE.Mesh(new THREE.SphereGeometry(.14,6,6),pulseMat);network.add(p);return p;});
function profileChart(year){
 const x=720,y=269,w=480,h=202;
 for(const v of [0,10,20,30]){line(x,y+h-v/35*h,x+w,y+h-v/35*h,'#29483d');text(String(v),x-27,y+h-v/35*h+4,10,'#8aa99b','Mono');}
 text('CANOPY HEIGHT / m · ED REFERENCES',x,y-23,11,'#bcd49b','Mono');
 profiles.forEach((s,k)=>{ctx.strokeStyle=colors[k];ctx.lineWidth=2.8;ctx.beginPath();for(let i=0;i<=Math.ceil(year*4);i++){const yr=Math.min(year,i/4),xx=x+yr/40*w,yy=y+h-value(s,1,'height',yr)/35*h;i?ctx.lineTo(xx,yy):ctx.moveTo(xx,yy);}ctx.stroke();circle(x+year/40*w,y+h-value(s,1,'height',year)/35*h,4,colors[k]);});
 text('Year 0',x,y+h+25,11,'#8aa99b','Mono');text('Year 40',x+w-50,y+h+25,11,'#8aa99b','Mono');
 ['Tropical','Temperate','Boreal'].forEach((s,i)=>{circle(x+i*160,y+h+53,3,colors[i]);text(s,x+11+i*160,y+h+57,11,colors[i]);});
}
function heading(k,title,subtitle,x=60,y=145,size=45){tag(['01 / ONE FOREST','02 / AGE GROUPS','03 / A GLOBAL DATASET','04 / DEEP LEARNING','05 / CONDITIONAL FORECASTS','06 / BUILT FOR DISCOVERY'][k],x,112);title.forEach((s,i)=>text(s,x-3,y+i*(size+10),size,i?'#dcf0b8':'#f1f3e7','Manrope',500));if(subtitle)text(subtitle,x,y+title.length*(size+10)+12,16);}
function footer(t,label){line(60,653,1220,653,'#29453b');line(60,653,60+1160*t/DURATION,653,'#c8e79f',2);text(label,60,682,10,'#94afa1','Mono');text('CARBONGLOBE / DATA → ECOSYSTEM EMULATORS',890,682,9,'#94afa1','Mono');}
window.renderFrame=time=>{
 const t=clamp(time,0,DURATION),k=STARTS.filter(s=>s<=t).length-1,local=t-STARTS[k];
 const cohort=ease((t-7)/1.4),zoom=ease((t-14)/2.5),split=ease((t-23)/2),forecast=ease((t-32)/1.8),end=ease((t-41)/1);
 const year=k===0?20*ease((t-.4)/5.8):k===1?20+20*ease((local-.8)/5.8):k===2?40*ease((local-2)/6.3):k===4?40*ease((local-.6)/6.3):40;
 forest.visible=t<17;grid.visible=t<17;
 stands.forEach((s,i)=>{
  s.group.position.x=mix(18,[-1,18,37][i],cohort);s.group.rotation.y=.35+i*.6+Math.sin(t*.15+i)*.16;
  const fy=k===0?year:k===1?year:40,h=value(congo,k===0?1:s.age,'height',fy);
  s.group.scale.setScalar(mix(1.6,1,cohort)*mix(1,.02,zoom));s.group.scale.y*=h/27;
  s.uniforms.opacity.value=(i===0?1:cohort)*(1-zoom);s.uniforms.foliage.value=.25+.5*clamp(value(congo,k===0?1:s.age,'lai',fy)/6.1);
  s.group.children.forEach((p,j)=>{p.visible=j===0||cohort>.02;});
 });grid.material.opacity=.25*(1-zoom);
 earth.visible=t>=14;earth.position.set(mix(18,-24,split),mix(15,11,split),0);earth.rotation.y=-.35+(t-14)*.065;earth.rotation.x=.08;
 let earthScale=t<23?mix(2.5,1,zoom):mix(1,.65,split);
 if(k>=4){earthScale*=mix(1,.75,forecast);earth.position.x=mix(-24,-37,forecast);earth.position.y=mix(11,4,forecast);}
 if(k===5){earth.position.set(28,15,0);earthScale=1.05;}
 earth.scale.setScalar(earthScale);
 const earthAlpha=k===2?ease((t-14)/1.6):k===3?1:k===4?.18:.27;
 globeUniforms.opacity.value=earthAlpha;atmosphere.material.uniforms.opacity.value=earthAlpha;pointsMat.opacity=earthAlpha*.95;
 updateEarth(k===2?year:40);
 network.visible=t>=23&&t<42;network.position.set(mix(25,-18,forecast),15,0);network.scale.setScalar(mix(1,.64,forecast));network.rotation.y=Math.sin(t*.24)*.12;
 const na=ease((t-23)/1.6)*(1-end);nodeMat.opacity=na;linkMat.opacity=na*.21;pulseMat.opacity=na;
 pulses.forEach((p,i)=>{const [a,b]=links[(i*7)%links.length];p.position.lerpVectors(nodes[a].p,nodes[b].p,(t*.45+i*.071)%1);});
 renderer.render(scene,camera);ctx.drawImage(renderer.domElement,0,0);
 if(k<3){const shade=ctx.createLinearGradient(340,0,570,0);shade.addColorStop(0,'#091c19');shade.addColorStop(1,'#091c1900');ctx.fillStyle=shade;ctx.fillRect(0,80,570,570);}
 text('CarbonGlobe',60,51,23,'#edf2e2','Manrope',650);tag('THE LIVING LAYER OF EARTH',1032,47,'#91b1a2');line(60,74,1220,74,'#29453b');
 ctx.save();const enter=ease(local/.65);ctx.globalAlpha=enter;ctx.translate(0,8*(1-enter));
 if(k===0){
  heading(k,['Watch a','forest grow.'],'A 40-year reference from the Congo Basin.',60,196,49);
  tag('SIMULATION YEAR',60,400);text(String(Math.round(year)).padStart(2,'0'),57,465,58,'#f1f2e7');
  tag('CANOPY HEIGHT',60,526);text(`${value(congo,1,'height',year).toFixed(1)} m`,60,568,31,'#dcf0b8');
  tag('BIOMASS',263,526);text(`${value(congo,1,'agb',year).toFixed(2)}`,263,568,31,'#dcf0b8');text('kg C / m²',263,594,11,'#91b1a2','Mono');
 }else if(k===1){
  heading(k,['Age shapes','the response.'],'Different starting points. Parallel growth.',60,196,46);
  tag('INITIAL FOREST AGES',60,393);text('1 · 10 · 50 years',60,435,28,'#dcf0b8');
  text('Three examples from 15 initial ages.',60,481,14,'#91b1a2');text('Illustrative stands · Congo Basin',60,512,13,'#91b1a2');
  tag(`SIMULATION YEAR ${String(Math.round(year)).padStart(2,'0')} / 40`,60,587);
  [1,10,50].forEach((a,i)=>{tag(`AGE ${a}`,582+i*212,606);text(`${value(congo,a,'height',year).toFixed(1)} m`,582+i*212,631,17,'#dcf0b8');});
 }else if(k===2){
  heading(k,['Many climates.','Many trajectories.'],null,60,196,39);
  ['TROPICAL / CONGO','TEMPERATE / APPALACHIANS','BOREAL / FINLAND'].forEach((s,i)=>{tag(s,60,355+i*72,colors[i]);text(`${value(profiles[i],1,'height',year).toFixed(1)} m canopy height`,60,384+i*72,19,'#e4eddb');});
  tag(`ED GLOBAL SAMPLE · YEAR ${String(Math.round(year)).padStart(2,'0')}`,60,608);
  text('TEMPERATURE  ·  WATER  ·  CO₂',702,112,12,'#cde4c3','Mono');text(`${coords.length.toLocaleString('en-US')} sites shown · height exaggerated`,733,624,10,'#91b1a2','Mono');
 }else if(k===3){
  heading(k,['A planet of data. A learnable model.'],'Environmental drivers + initial ecosystem state → next state',60,170,42);
  tag('GLOBAL SIMULATION SEQUENCES',145,594);tag('DEEP LEARNING EMULATOR',845,594);
  arrow(555,375,680,375);for(let j=0;j<5;j++)circle(555+((t*.35+j*.2)%1)*118,375,3,'#dcf680');
  text('136 inputs',564,348,12,'#dcf0b8','Mono');text('+ forest state',552,405,11,'#91b1a2','Mono');
  text('Conceptual architecture · train on ED references',785,624,11,'#91b1a2');
 }else if(k===4){
  heading(k,['Condition the inputs. Forecast the response.'],'Learned rollout workflow · the curves show ED reference trajectories',60,167,39);
  tag('ENVIRONMENT + INITIAL STATE',90,274);tag('ECOSYSTEM EMULATOR',275,511);
  arrow(548,366,664,366);for(let j=0;j<5;j++)circle(550+((t*.35+j*.2)%1)*105,366,2.5,'#dcf680');
  profileChart(year);line(60,557,1220,557,'#29483d');
  tag('FUTURE SCENARIO RESEARCH / ILLUSTRATIVE WORKFLOW',60,582);
  text('Warmer / drier',60,611,15,'#dfc594');text('Warmer / wetter',60,634,15,'#89cfc7');
  arrow(235,618,365,618);text('New climate forcings',385,623,17,'#e1ecda');arrow(590,618,695,618);
  text('AI emulator',718,623,17,'#dcf0b8');arrow(837,618,927,618);text('Scenario forecasts',952,623,17,'#e1ecda');
 }else{
  heading(k,['A foundation for','planetary AI.'],null,60,187,49);
  const nums=[['54,152','GLOBAL SIMULATION SITES'],['812,280','SITE–AGE SEQUENCES'],['40','YEARS PER ROLLOUT']];
  nums.forEach(([n,label],i)=>{const x=60+i*410;text(n,x,423,i===1?62:69,'#e7f1d6','Manrope',550);tag(label,x,461,'#b3c6a9');});
  line(60,499,1220,499,'#355244');text('15 initial ages   /   136 inputs   /   7 targets   /   8 baselines',60,543,20,'#dcf0b8');
  text('ML-ready data. Reproducible benchmarks. Ecosystem emulators.',60,598,19,'#d5e1ca');
 }
 ctx.restore();
 const notes=['ED reference · initial forest age 1 · illustrated tree geometry','Initial-age groups are illustrative; not individual-tree cohort measurements','Actual sampled site trajectories; regional differences are not causal attribution','Conceptual network; no trained-model outputs shown','ED reference curves · future scenario forecasts are a research direction','CarbonGlobe · NeurIPS 2025 Datasets & Benchmarks'];
 footer(t,notes[k]);return{time:t,chapter:k,year,globalSampleCount:coords.length};
};
window.renderFrame(20.5);window.filmReady=true;
window.filmMetadata={duration:DURATION,width:W,height:H,chapters:STARTS,stills:{forest:5.8,cohorts:13.1,global:21.5,network:29.5,rollout:39.5,scale:46.5,poster:29.5},site:congo.id,sourceIndex:congo.sourceIndex,ages:[1,10,50],globalSampleCount:coords.length,profiles:profiles.map(s=>s.id),initialAges:15,siteAgeSequences:812280,totalSites:54152,inputs:136,targets:7,baselines:8,geometry:'Original illustrated stand groups, not measured tree cohorts',network:'Conceptual deep network; no trained-model predictions',scenario:'Prospective workflow only; no SSP data or numerical future forecasts'};
