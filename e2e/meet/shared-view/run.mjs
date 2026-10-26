import {createServer} from 'vite';
import {chromium} from '@playwright/test';
import {spawn} from 'node:child_process';
import {randomBytes,createHmac,randomUUID} from 'node:crypto';
import {writeFile,readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=dirname(fileURLToPath(import.meta.url));
const repo=resolve(root,'../../..');
const {default:vue}=await import(resolve(repo,'node_modules/@vitejs/plugin-vue/dist/index.mjs'));
const output=resolve(process.env.SHARED_VIEW_EVIDENCE_DIR||'/tmp/meet-shared-view-proof');
await mkdir(output,{recursive:true});
import assert from 'node:assert/strict';
const secret=randomBytes(32).toString('hex'),metrics=randomBytes(32).toString('hex');
const room='load-'+randomUUID();
const server=spawn(process.execPath,['-r','ts-node/register','src/server.ts'],{cwd:repo+'/suite/meet/sfu-server',env:{...process.env,TS_NODE_TRANSPILE_ONLY:'1',NODE_ENV:'test',JWT_SECRET:secret,METRICS_TOKEN:metrics,HOST:'127.0.0.1',PORT:'4317',WEBRTC_LISTEN_IP:'127.0.0.1',WEBRTC_ANNOUNCED_IP:'127.0.0.1',WEBRTC_SERVER_PORT:'44170',MEDIASOUP_NUM_WORKERS:'1',SFU_LOG_LEVEL:'error'},stdio:['ignore','pipe','pipe']});
let logs='';server.stdout.on('data',x=>logs+=x);server.stderr.on('data',x=>logs+=x);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let vite,browser,page,result,frames=[];
const token=id=>{const enc=o=>Buffer.from(JSON.stringify(o)).toString('base64url');const x=enc({alg:'HS256',typ:'JWT'})+'.'+enc({user_id:id,user_name:id,meeting_id:room,site:'load.test',scope:'full',is_host:false,is_cohost:false,is_guest:false,e2ee_required:false,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+600});return x+'.'+createHmac('sha256',secret).update(x).digest('base64url')};
async function resources(){const r=await fetch('http://127.0.0.1:4317/metrics',{headers:{Authorization:'Bearer '+metrics}});assert(r.ok);const raw=await r.text();return raw.split('\n').filter(l=>!l.startsWith('#')&&/consumers|producers/.test(l));}
try{
 for(let i=0;i<50;i++){try{if((await fetch('http://127.0.0.1:4317/health')).ok)break}catch{}if(server.exitCode!==null)throw new Error(logs);await sleep(200)}
 vite=await createServer({root,configFile:false,plugins:[{
 name:'camera-presentation-stubs',enforce:'pre',resolveId(id,importer){
  if(importer?.includes('MeetingLayout.vue')&&/\/(ParticipantTile|GroupTile|FloatingReactions)\.vue$/.test(id))return root+'/tiles.js';
  if(id==='@/boot/session')return '\0session';
 },load(id){if(id==='\0session')return 'export const session={user:{sessionUser:"receiver"}}'}
 },vue()],resolve:{alias:{'@':resolve(repo,'frontend/src'),vue:resolve(repo,'node_modules/vue/dist/vue.runtime.esm-bundler.js'),'frappe-ui':resolve(repo,'frontend/recorder/frappeUi.ts')}},optimizeDeps:{include:['mediasoup-client','socket.io-client','vue']},server:{host:'127.0.0.1',port:4318,strictPort:true,fs:{allow:[root,repo,'/home/t3code/projects/suite']}},logLevel:'error'});await vite.listen();
 browser=await chromium.launch({headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});const context=await browser.newContext({viewport:{width:1280,height:1080},recordVideo:{dir:output+'/recording',size:{width:1280,height:1080}}});page=await context.newPage();page.on('console',m=>{if(m.text().startsWith('CAMERA'))console.log(m.text())});page.on('pageerror',e=>console.error(e.message));
 await page.goto('http://127.0.0.1:4318/dashboard.html');
 const handles=await page.locator('iframe').elementHandles();frames=await Promise.all(handles.map(x=>x.contentFrame()));
 if(process.env.SHARED_VIEW_NEGATIVE_CONTROL)await frames[1].goto('http://127.0.0.1:4318/index.html?dropSharedStage=1');
 for(const f of frames)await f.waitForFunction(()=>!!window.cameraCheck);
 const configs=['a','b','c','d','receiver-r1'].map(id=>({id,room,token:token(id)}));
 const inventory=await frames[0].evaluate(c=>window.cameraCheck.start(c),configs);
 await frames[0].evaluate(()=>window.cameraCheck.speak('d'));await sleep(3000);
 await frames[0].evaluate(()=>window.cameraCheck.speak('c'));await sleep(3000);
 await frames[0].evaluate(()=>window.cameraCheck.speak(null));await sleep(2500);
 await frames[1].evaluate(({c,i})=>window.cameraCheck.start(c,i),{c:[...configs.slice(0,4),{id:'receiver-r2',room,token:token('receiver-r2')}],i:inventory});
 const files=['e2e/meet/shared-view/run.mjs','e2e/meet/shared-view/client.js','e2e/meet/shared-view/tiles.js','e2e/meet/shared-view/index.html','frontend/src/apps/meet/components/MeetingLayout.vue','frontend/src/apps/meet/utils/SFUMeetingManager.ts','frontend/src/apps/meet/utils/sfu/ParticipantConnection.ts','frontend/src/apps/meet/utils/sfu/SFUMediaManager.ts','frontend/src/apps/meet/utils/media/TransportManager.ts','frontend/src/apps/meet/utils/media/VideoElementManager.ts','suite/meet/sfu-server/src/server/SharedStage.ts','suite/meet/sfu-server/src/server/RoomRegistry.ts','frontend/src/apps/meet/composables/useLayout.ts','frontend/src/apps/meet/composables/useParticipantStore.ts','frontend/src/apps/meet/composables/useSFUConnection.ts','frontend/src/apps/meet/utils/sharedStage.ts','suite/meet/sfu-server/src/server/handlers/RoomJoinHandlers.ts','suite/meet/sfu-server/src/mediasoup/RoomManager.ts','suite/meet/types/index.ts','frontend/recorder/RecorderStageProjection.ts','frontend/recorder/RecorderSocketController.ts','frontend/recorder/protocol.ts'];
 result={scope:'real-layout-and-meeting-manager-isolated-SFU',revision:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),sourceHashes:Object.fromEntries(await Promise.all(files.map(async f=>[f,createHash('sha256').update(await readFile(resolve(repo,f))).digest('hex')]))),browser:browser.version(),node:process.version,worker:process.env.MEDIASOUP_WORKER_BIN||'packaged',workerSha256:process.env.MEDIASOUP_WORKER_BIN?createHash('sha256').update(await readFile(process.env.MEDIASOUP_WORKER_BIN)).digest('hex'):null,negativeControl:!!process.env.SHARED_VIEW_NEGATIVE_CONTROL,inventory,windows:[]};
 const scenarios=[
 {name:'Late R2 joins after D then C spoke: silence retains shared C',expected:[['c'],['c']]},
 {name:'Sustained B becomes the shared default',speaker:'b',expected:[['b'],['b']]},
 {name:'Personal pin D on R1; R2 keeps B',pin:'d',expected:[['d'],['b']]},
 {name:'Unpin returns R1 to current shared B',pin:null,expected:[['b'],['b']]},
 {name:'R2 reconnects after missed history; canonical snapshot restores B',reconnect:true,expected:[['b'],['b']]},
 {name:'Silence keeps recent B; no browser-local fallback',speaker:null,expected:[['b'],['b']]},
 ];
 for(const scenario of scenarios){
 await page.locator('#phase').evaluate((el,t)=>el.textContent=t,scenario.name+' — transitioning / sampling');
 for(const id of ['#r1','#r2','#total'])await page.locator(id).evaluate(el=>el.textContent='Collecting the next settled sample…');

 if('speaker' in scenario){await frames[0].evaluate(id=>window.cameraCheck.speak(id),scenario.speaker);await sleep(3000);}
 if(scenario.reconnect){await frames[1].evaluate(()=>window.cameraCheck.stop());await frames[1].goto('http://127.0.0.1:4318/index.html');await frames[1].waitForFunction(()=>!!window.cameraCheck);await frames[1].evaluate(({c,i})=>window.cameraCheck.start(c,i),{c:[...configs.slice(0,4),{id:'receiver-r2',room,token:token('receiver-r2')}],i:inventory});}
 if('pin' in scenario)await frames[0].evaluate(id=>window.cameraCheck.pin(id),scenario.pin);
 await page.locator('#phase').evaluate((el,t)=>el.textContent=t,scenario.name);
 await sleep(2000);
 const before=await Promise.all(frames.map(f=>f.evaluate(()=>window.cameraCheck.stats())));await sleep(2500);
 const after=await Promise.all(frames.map(f=>f.evaluate(()=>window.cameraCheck.stats())));const counts=await resources();
 result.pendingWindow={scenario,before,after,resources:counts};
 for(let i=0;i<2;i++){
 const cams=after[i].rows.filter(x=>x.kind==='video'&&!x.isScreen);
 assert.deepEqual(cams.map(x=>x.participantId).sort(),scenario.expected[i],'independent expected camera participant IDs');
 assert.deepEqual(cams.map(x=>x.producerId).sort(),inventory.filter(x=>!x.isScreen&&x.kind!=='audio'&&scenario.expected[i].includes(x.participantId)).map(x=>x.producerId).sort());
 assert(cams.every(x=>x.participantId!=='receiver-r'+(i+1)));
 for(const row of after[i].rows){const prior=before[i].rows.find(x=>x.id===row.id);assert(prior&&row.bytes>prior.bytes);if(row.kind==='video')assert(row.frames>prior.frames)}
 for(const id of scenario.expected[i])assert(after[i].tiles.some(t=>t.id===id&&!t.hidden&&t.decodedFrames>0));
 await page.locator('#r'+(i+1)).evaluate((el,data)=>el.textContent=data,`Shared order v${after[i].sharedStage?.version}: ${after[i].sharedStage?.participantIds.join(", ")}\nCamera participants: ${cams.map(x=>x.participantId).join(', ')}
Camera Consumers: ${cams.length}; all Consumers: ${after[i].rows.length}
Producer IDs:
${cams.map(x=>x.producerId).join('\n')}
Decoded camera frames: ${cams.map(x=>x.frames).join(', ')}`);
 }
 assert.deepEqual(after[0].sharedStage,after[1].sharedStage,'same canonical snapshot across independent clients');
 assert(counts.includes(`meet_sfu_resources{resource="consumers"} ${scenario.expected.flat().length+2*(inventory.filter(x=>x.kind==='audio'||x.isScreen).length)}`));
 await page.locator('#total').evaluate((el,t)=>el.textContent=t,'Actual SFU gauges: '+counts.filter(x=>x.startsWith('meet_sfu_resources')).join(' | '));
 delete result.pendingWindow;
 result.windows.push({scenario,before,after,resources:counts,equalCameraSets:JSON.stringify(scenario.expected[0])===JSON.stringify(scenario.expected[1])});
 await page.screenshot({path:output+'/'+result.windows.length+'.png'});await sleep(1500);console.log('PASS',scenario.name);
 }
 await frames[1].evaluate(()=>window.cameraCheck.stop());await frames[0].evaluate(()=>window.cameraCheck.stop());await sleep(1200);
 result.cleanup=await resources();assert(result.cleanup.includes('meet_sfu_resources{resource="consumers"} 0'));assert(result.cleanup.includes('meet_sfu_resources{resource="producers"} 0'));
 await page.locator('#phase').evaluate(el=>el.textContent='Cleanup complete: zero Producers and zero Consumers');
 await page.locator('#total').evaluate((el,t)=>el.textContent=t,result.cleanup.join(' | '));await sleep(2500);
 await writeFile(output+'/result.json',JSON.stringify(result,null,2));console.log('PASS cleanup',result.cleanup);
 await context.close();await page.video().saveAs(output+'/shared-view.webm');

}catch(e){await page?.screenshot({path:output+'/failure.png'}).catch(()=>{});if(result){result.failure={message:e.message,code:e.code};await writeFile(output+'/result.json',JSON.stringify(result,null,2))}console.error(e);console.error(logs.slice(-3000));process.exitCode=1}
finally{for(const f of frames)await f.evaluate(()=>window.cameraCheck?.stop()).catch(()=>{});if(page&&!page.isClosed())await page.evaluate(()=>window.cameraCheck?.stop()).catch(()=>{});if(result){await sleep(1000);result.finalResources=await resources().catch(()=>null);await writeFile(output+'/result.json',JSON.stringify(result,null,2))}await browser?.close();await vite?.close();server.kill('SIGTERM');await writeFile(output+'/server.log',logs);await Promise.race([new Promise(r=>server.once('exit',r)),sleep(3000)]);if(server.exitCode===null)server.kill('SIGKILL')}
