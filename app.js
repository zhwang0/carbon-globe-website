import {createGlobe} from './globe.js';

const $ = (selector) => document.querySelector(selector);
const formatNumber = (value, digits = 2) => Number(value).toLocaleString('en-US', {maximumFractionDigits: digits, minimumFractionDigits: digits});

async function loadJSON(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Unable to load ${path} (${response.status})`);
  return response.json();
}

const menuToggle = $('.menu-toggle');
const navigation = $('#main-nav');
function closeMenu() {
  menuToggle.setAttribute('aria-expanded', 'false');
  menuToggle.setAttribute('aria-label', 'Open navigation');
  navigation.classList.remove('is-open');
}
menuToggle.addEventListener('click', () => {
  const open = menuToggle.getAttribute('aria-expanded') !== 'true';
  menuToggle.setAttribute('aria-expanded', String(open));
  menuToggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  navigation.classList.toggle('is-open', open);
});
navigation.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeMenu));
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeMenu(); });

const globe = createGlobe($('#globe'));
loadJSON('assets/data/globe-surface.json').then(data => globe.setSurface(data)).catch(error => {
  console.warn(error.message); globe.surfaceError();
});

function initializeExplorer(data) {
  const sites=data.sites, variables=data.meta.variables;
  let site=sites[0], age='10', variable='agb', year=40, timer=null;
  const siteSelect=$('#site-select'), ageSelect=$('#age-select'), variableSelect=$('#variable-select');
  siteSelect.replaceChildren(...sites.map((item,index)=>new Option(item.label,String(index))));
  for (const control of [siteSelect,ageSelect,variableSelect,$('#year-slider'),$('#timeline-play'),$('#download-series')]) control.disabled=false;
  $('#explorer').setAttribute('aria-busy','false'); $('#explorer-status').hidden=true;
  const svg=$('#trajectory-chart');
  let scale={x:(v)=>v,y:(v)=>v}, values=[];
  const currentVariable=()=>variables.find((v)=>v.id===variable);
  const currentValues=()=>site.trajectories[age][variable];
  function drawLocator() {
    const canvas=$('#locator'), ctx=canvas.getContext('2d'); if (!ctx) return;
    const w=canvas.clientWidth||260,h=canvas.clientHeight||130,dpr=Math.min(window.devicePixelRatio||1,2);
    canvas.width=w*dpr;canvas.height=h*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);
    const x=(lon)=>(lon+180)/360*(w-12)+6,y=(lat)=>(90-lat)/180*(h-12)+6;
    ctx.fillStyle='#a2b6a55c';
    for(const p of data.map.points) ctx.fillRect(x(p[1]),y(p[0]),1.1,1.1);
    ctx.beginPath();ctx.arc(x(site.lon),y(site.lat),9,0,Math.PI*2);ctx.fillStyle='#b6d26844';ctx.fill();
    ctx.beginPath();ctx.arc(x(site.lon),y(site.lat),3.5,0,Math.PI*2);ctx.fillStyle='#1b5840';ctx.fill();
    ctx.strokeStyle='#f6f7ee';ctx.lineWidth=1.5;ctx.stroke();
  }
  const coordinate=(number,pos,neg)=>`${Math.abs(number).toFixed(2)}°${number>=0?pos:neg}`;
  function renderChart() {
    values=currentValues(); const info=currentVariable();
    $('#site-name').textContent=site.label;
    $('#site-region').textContent=site.region;
    $('#site-coordinates').textContent=`${coordinate(site.lat,'N','S')} / ${coordinate(site.lon,'E','W')}`;
    $('#selected-variable-label').textContent=info.label;
    $('#selected-unit').textContent=info.unit;
    $('#chart-title').textContent=`${info.label} over time`;
    const low=Math.min(0,...values), high=Math.max(...values), span=high-low||1;
    const yMin=low<0?low-span*.07:0,yMax=high+span*.15;
    const left=58,right=698,top=25,bottom=265;
    scale={x:(v)=>left+v/40*(right-left),y:(v)=>bottom-(v-yMin)/(yMax-yMin)*(bottom-top)};
    const area=values.map((value,i)=>`${i===0?'M':'L'}${scale.x(i).toFixed(2)},${scale.y(value).toFixed(2)}`).join(' ');
    let markup='<defs><linearGradient id="chart-gradient" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#70965e" stop-opacity=".24"/><stop offset="100%" stop-color="#70965e" stop-opacity=".015"/></linearGradient></defs>';
    for(let i=0;i<=4;i++) {
      const value=yMin+(yMax-yMin)*i/4,y=scale.y(value);
      markup+=`<line x1="${left}" y1="${y}" x2="${right}" y2="${y}" stroke="#dce2d7" stroke-dasharray="3 5"/><text x="${left-13}" y="${y+4}" text-anchor="end" fill="#728172" font-size="11" font-family="monospace">${Number(value.toFixed(value>=10?1:2))}</text>`;
    }
    for(let i=0;i<=40;i+=10) markup+=`<text x="${scale.x(i)}" y="${bottom+26}" text-anchor="middle" fill="#728172" font-size="11" font-family="monospace">${i===0?'Year 0':i}</text>`;
    markup+=`<path d="${area} L${right},${bottom} L${left},${bottom} Z" fill="url(#chart-gradient)"/><path d="${area}" fill="none" stroke="#2e6345" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><line id="chart-cursor-line" y1="${top}" y2="${bottom}" stroke="#789172" stroke-dasharray="4 4"/><circle id="chart-cursor-halo" r="9" fill="#99b66a" opacity=".2"/><circle id="chart-cursor" r="4.5" fill="#244d35" stroke="#f9faf3" stroke-width="2"/>`;
    svg.innerHTML=markup;
    svg.setAttribute('aria-label',`${info.label} at ${site.label}, initial forest age ${age} years. ${formatNumber(values[0])} at year 0 and ${formatNumber(values[40])} ${info.unit} at year 40. Use the simulation year slider for individual values.`);
    drawLocator(); updateYear();
  }
  function updateYear() {
    $('#selected-value').textContent=formatNumber(values[year]);
    $('#year-readout').textContent=String(year).padStart(2,'0');
    $('#year-slider').value=year;
    $('#year-slider').setAttribute('aria-valuetext',`Year ${year}: ${formatNumber(values[year])} ${currentVariable().unit}`);
    $('#year-slider').style.setProperty('--progress',`${year/40*100}%`);
    const x=scale.x(year),y=scale.y(values[year]);
    $('#chart-cursor-line').setAttribute('x1',x);$('#chart-cursor-line').setAttribute('x2',x);
    for (const id of ['#chart-cursor','#chart-cursor-halo']) { $(id).setAttribute('cx',x);$(id).setAttribute('cy',y); }
  }
  function stopPlayback() {
    clearInterval(timer);timer=null;$('#timeline-play').textContent='▶';
    $('#timeline-play').setAttribute('aria-label','Play simulation timeline');
  }
  siteSelect.addEventListener('change',()=>{stopPlayback();site=sites[Number(siteSelect.value)];renderChart();});
  ageSelect.addEventListener('change',()=>{stopPlayback();age=ageSelect.value;renderChart();});
  variableSelect.addEventListener('change',()=>{stopPlayback();variable=variableSelect.value;renderChart();});
  $('#year-slider').addEventListener('input',(event)=>{stopPlayback();year=Number(event.target.value);updateYear();});
  $('#timeline-play').addEventListener('click',()=>{
    if(timer) {stopPlayback();return;}
    if(year===40) year=0;
    $('#timeline-play').textContent='Ⅱ';$('#timeline-play').setAttribute('aria-label','Pause simulation timeline');
    updateYear();timer=setInterval(()=>{year++;updateYear();if(year>=40)stopPlayback();},220);
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stopPlayback();});
  svg.addEventListener('pointermove',(event)=>{
    if(event.pointerType==='touch'||timer) return;
    const rect=svg.getBoundingClientRect(),x=(event.clientX-rect.left)/rect.width*720;
    if(x<58||x>698)return;
    year=Math.max(0,Math.min(40,Math.round((x-58)/640*40)));updateYear();
  });
  $('#download-series').addEventListener('click',()=>{
    const names=variables.map(v=>v.id);
    const header=['site_id','latitude','longitude','initial_forest_age','simulation_year',...names.map(id=>`${id} (${variables.find(v=>v.id===id).unit})`)];
    const rows=[header.join(',')];
    for(let i=0;i<=40;i++) rows.push([site.id,site.lat,site.lon,age,i,...names.map(id=>site.trajectories[age][id][i])].join(','));
    downloadBlob(new Blob([rows.join('\n')+'\n'],{type:'text/csv;charset=utf-8'}),`carbonglobe-site-${site.id}-age-${age}.csv`);
  });
  new ResizeObserver(drawLocator).observe($('#locator'));
  renderChart();
}

function downloadBlob(blob,name) {
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;
  document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

loadJSON('assets/data/carbon-globe.json').then((data)=>{
  globe.setPoints(data.map.points);initializeExplorer(data);
}).catch((error)=>{
  console.error(error);
  $('#globe-status').textContent='Globe data could not be loaded.';
  $('#explorer-status').textContent='The explorer could not load. Please reload the page or use the dataset download links below.';
  $('#explorer').setAttribute('aria-busy','false');
});

loadJSON('assets/benchmarks.json').then((data)=>{
  let metric='rmse';
  function renderBenchmarks() {
    const variable=$('#benchmark-variable').value;
    const info=data.variables.find(v=>v.id===variable);
    const ranked=[...data.models].sort((a,b)=>a.values[variable][metric]-b.values[variable][metric]);
    const max=Math.max(...ranked.map(m=>m.values[variable][metric]));
    $('#benchmark-unit').textContent=`${metric.toUpperCase()} · ${info.unit}`;
    $('#benchmark-bars').replaceChildren(...ranked.map((model,index)=>{
      const value=model.values[variable][metric],row=document.createElement('div');
      row.className=`bar-row${index===0?' best':''}`;
      row.setAttribute('aria-label',`${index+1}. ${model.name}: ${value.toFixed(3)} ${info.unit}${index===0?', lowest error':''}`);
      const label=document.createElement('div');label.className='bar-label';
      const rank=document.createElement('span');rank.className='bar-rank';rank.textContent=String(index+1).padStart(2,'0');
      const name=document.createElement('span');name.textContent=model.name;label.append(rank,name);
      const track=document.createElement('div');track.className='bar-track';
      const fill=document.createElement('div');fill.className='bar-fill';fill.style.width=`${value/max*100}%`;track.append(fill);
      const number=document.createElement('span');number.className='bar-value';number.textContent=value.toFixed(3);
      row.append(label,track,number);return row;
    }));
  }
  $('#benchmark-variable').addEventListener('change',renderBenchmarks);
  document.querySelectorAll('[data-metric]').forEach(button=>button.addEventListener('click',()=>{
    metric=button.dataset.metric;
    document.querySelectorAll('[data-metric]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));});
    renderBenchmarks();
  }));
  renderBenchmarks();
}).catch((error)=>{
  console.error(error);$('#benchmark-bars').textContent='Results could not be loaded. Read Table 1 in the paper linked alongside.';
});

$('#copy-citation').addEventListener('click',async()=>{
  const status=$('#copy-status');
  try {
    const response=await fetch('assets/citation.bib');if(!response.ok)throw new Error('Citation unavailable');
    const citation=await response.text();
    if(navigator.clipboard&&window.isSecureContext)await navigator.clipboard.writeText(citation);
    else {
      const field=document.createElement('textarea');field.value=citation;field.style.position='fixed';field.style.opacity='0';
      document.body.append(field);field.select();const success=document.execCommand('copy');field.remove();
      if(!success)throw new Error('Copy unavailable');
    }
    status.textContent='Copied!';setTimeout(()=>{status.textContent='';},4000);
  } catch {
    status.textContent='Use the .bib download below.';
  }
});

// Progressively enhance section navigation without hiding content from failed scripts.
const sections=[...document.querySelectorAll('main section[id]')];
const sectionObserver = new IntersectionObserver((entries)=>{
  for(const entry of entries)if(entry.isIntersecting){
    document.querySelectorAll('#main-nav a').forEach(link=>{
      const current=link.getAttribute('href')===`#${entry.target.id}`;
      if(current)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current');
    });
  }
},{rootMargin:'-20% 0px -60% 0px'});
sections.forEach((section)=>sectionObserver.observe(section));
