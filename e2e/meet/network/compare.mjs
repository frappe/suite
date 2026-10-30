import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=dirname(fileURLToPath(import.meta.url));
const beforeDir=resolve(process.env.MEET_NETWORK_BEFORE_OUTPUT||root+'/artifacts-before');
const afterDir=resolve(process.env.MEET_NETWORK_AFTER_OUTPUT||root+'/artifacts-after');
const before=JSON.parse(await readFile(beforeDir+'/result.json','utf8'));
const after=JSON.parse(await readFile(afterDir+'/result.json','utf8'));
assert(after.passed,'The after run must pass every media and indicator assertion');
const impaired=['slow-512k-300ms-5pct','severe-128k-800ms-20pct','media-blackout'];
const premature=run=>run.events.filter(event=>event.state==='healthy'&&run.windows.some(window=>impaired.includes(window.name)&&event.at>=window.samples[0].timestamp&&event.at<=window.samples.at(-1).timestamp));
assert.equal(premature(after).length,0,'Recovery must not report healthy during impairment');
const labels=['Healthy connection','Slow connection','Severe connection','Connection restored','10-second media blackout','Restored after blackout'];
const details=[
 'Unlimited link · all streams flowing',
 '512 kbps down / 256 kbps up · 300 ms round trip · 5% random loss',
 '128 kbps down / 64 kbps up · 800 ms round trip · 20% random loss',
 'Normal networking restored · each capture is at the end of its recovery window',
 '100% of receiver media packets dropped · signaling remains connected',
 'Normal networking restored after the blackout',
];
const phaseData=before.windows.map((old,index)=>{
 const current=after.windows.find(window=>window.name===old.name);
 assert(current,'Both recordings must contain each profile');
 const message=indicator=>indicator.text.split('\n').slice(1,-1).join(' ');
 return {name:old.name,label:labels[index],detail:details[index],
  before:message(old.indicator),after:message(current.indicator),status:current.indicator.domStatus,
  beforeImage:beforeDir+'/'+old.name+'.png',afterImage:afterDir+'/'+old.name+'-indicator.png',
  secondsBefore:Math.round(old.elapsedMs/1000),secondsAfter:Math.round(current.elapsedMs/1000)};
});
const summary={checks:after.checks,prematureHealthyBefore:premature(before).length,prematureHealthyAfter:premature(after).length,phases:phaseData};
await writeFile(afterDir+'/comparison.json',JSON.stringify(summary,null,2));
const escape=text=>text.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Meet network indicator before and after</title><style>
body{font:14px var(--font-sans,system-ui);color:var(--foreground);margin:0}p{line-height:1.5}.muted{color:var(--muted-foreground);font-size:12px}.controls{display:flex;gap:6px;flex-wrap:wrap;margin:12px 0}button{font:inherit;border:1px solid var(--border);color:var(--foreground);background:var(--secondary);border-radius:var(--radius,8px);padding:7px 10px;cursor:pointer}button[aria-pressed=true]{border-color:var(--primary);background:var(--accent)}.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}.card{padding:16px;border-radius:var(--radius,10px);background:var(--card);border:1px solid var(--border)}.label{font-size:12px;font-weight:600;color:var(--muted-foreground);margin-bottom:10px}.message{min-height:54px;display:flex;align-items:center;gap:8px;font-weight:500}.warning{color:var(--warning);background:var(--warning-surface);border-radius:8px;padding:8px}.dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--muted-foreground);flex-shrink:0}.warning .dot{background:var(--warning)}.good .dot{background:var(--success)}figure{margin:12px 0 0}img{width:100%;height:160px;object-fit:contain;object-position:top;border-radius:8px}.recorded{font-size:11px;color:var(--muted-foreground)}.fact{padding-top:12px;font-size:13px} @media(max-width:520px){.pair{grid-template-columns:1fr}img{height:120px}.message{min-height:28px}}
</style></head><body>
<p class="muted">Recorded real WebRTC runs · existing warning icon · isolated call fixture</p>
<p class="muted">App UI is unchanged: only the existing tile warning icon appears. The larger text here is its hover tooltip, shown for readability.</p>
<div class="controls">${phaseData.map((phase,index)=>`<button data-index="${index}" aria-pressed="${index===1}">${escape(phase.label)}</button>`).join('')}<button id="play">Play comparison</button></div>
<p id="detail"></p>
<div class="pair"><section class="card"><div class="label">BEFORE</div><div class="message" id="before"><span class="dot"></span><span></span></div><p class="recorded">Original local indicator logic</p><figure>${phaseData.map((phase,index)=>`<img data-before="${index}" src="${escape(phase.beforeImage)}" alt="Original call capture during ${escape(phase.label)}" ${index!==1?'hidden':''}>`).join('')}</figure></section>
<section class="card"><div class="label">AFTER</div><div class="message" id="after"><span class="dot"></span><span></span></div><p class="recorded">Existing warning icon and tooltip</p><figure>${phaseData.map((phase,index)=>`<img data-after="${index}" src="${escape(phase.afterImage)}" alt="New indicator during ${escape(phase.label)}" ${index!==1?'hidden':''}>`).join('')}</figure></section></div>
<p class="fact">Premature “healthy” recovery events during impairment: <strong>${premature(before).length} before → ${premature(after).length} after</strong>.</p>
<p class="muted">Choose a condition or play through the recorded endpoints. The call layout and legacy display are fixture presentations; the warning icon is the production Vue component. Packet loss and media quality vary between runs. This demonstrates warning and recovery behavior.</p>
<script>const phases=${JSON.stringify(phaseData).replaceAll('<','\\u003c')};let index=1,timer;function show(i){index=i;const p=phases[i];document.getElementById('detail').textContent=p.detail;document.querySelector('#before span:last-child').textContent=p.before;document.querySelector('#after span:last-child').textContent=p.after;document.getElementById('before').className='message'+(p.before==='No network warning'?'':' warning');document.getElementById('after').className='message '+(p.status==='poor'||p.status==='critical'?'warning':'');document.querySelectorAll('[data-index]').forEach(b=>b.setAttribute('aria-pressed',Number(b.dataset.index)===i));document.querySelectorAll('[data-before]').forEach(img=>img.hidden=Number(img.dataset.before)!==i);document.querySelectorAll('[data-after]').forEach(img=>img.hidden=Number(img.dataset.after)!==i)}document.querySelectorAll('[data-index]').forEach(b=>b.onclick=()=>show(Number(b.dataset.index)));document.getElementById('play').onclick=function(){if(timer){clearInterval(timer);timer=null;this.textContent='Play comparison'}else{show(0);timer=setInterval(()=>show((index+1)%phases.length),2500);this.textContent='Pause'}};show(index)</script></body></html>`;
await writeFile(afterDir+'/comparison.html',html);
console.log(JSON.stringify({output:afterDir+'/comparison.html',checks:Object.keys(after.checks).length,prematureHealthyBefore:premature(before).length,prematureHealthyAfter:premature(after).length}));
