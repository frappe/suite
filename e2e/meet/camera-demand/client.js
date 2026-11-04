import {Device} from 'mediasoup-client';
import {io} from 'socket.io-client';
import {createApp, h, provide, shallowRef, reactive, ref, computed, nextTick} from 'vue';
import MeetingLayout from '../../../frontend/src/apps/meet/components/MeetingLayout.vue';
import {provideMeetingContext} from '../../../frontend/src/apps/meet/composables/useMeetingContext';
import {SFUMeetingManager} from '../../../frontend/src/apps/meet/utils/SFUMeetingManager';
import {SFUClient} from '../../../frontend/src/apps/meet/utils/SFUClient';
import {SocketIOSignalChannel} from '../../../frontend/src/apps/meet/utils/media/SignalChannel';
const endpoints=[]; const timers=[]; const tracks=[];
async function endpoint(config) { console.log('CAMERA endpoint',config.id);
 const socket=io('http://127.0.0.1:4317',{auth:{token:config.token},transports:['websocket'],reconnection:false});
 await new Promise((r,j)=>{socket.once('connect',r);socket.once('connect_error',j)});
 const request=(event,data={})=>new Promise((r,j)=>socket.timeout(10000).emit(event,data,(err,res)=>err||!res?.success?j(new Error(event+': '+(res?.error||err))):r(res)));
 await request('join_room',{roomId:config.room,connectionId:crypto.randomUUID(),userData:{userId:config.id,name:config.id},mediaState:{video_enabled:true,audio_enabled:true},e2ee:{enabled:false,capability:{supported:false,mode:'none'}}});
 const device=new Device(); await device.load({routerRtpCapabilities:(await request('get_router_rtp_capabilities')).rtpCapabilities});
 const wire=t=>t.on('connect',({dtlsParameters},done,fail)=>request('connect_webrtc_transport',{transportId:t.id,dtlsParameters}).then(done,fail));
 const send=device.createSendTransport(await request('create_webrtc_transport',{direction:'send',encryptionEnabled:false}));wire(send);
 send.on('produce',({kind,rtpParameters,appData},done,fail)=>request('create_producer',{transportId:send.id,kind,rtpParameters,appData}).then(r=>done({id:r.producerId||r.id}),fail));
 const receive=device.createRecvTransport(await request('create_webrtc_transport',{direction:'recv',encryptionEnabled:false}));wire(receive);
 const entry={id:config.id,socket,request,send,receive,device};endpoints.push(entry);return entry;
}
async function publish(e,type='camera') {
 const canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;const ctx=canvas.getContext('2d');let frame=0;
 timers.push(setInterval(()=>{ctx.fillStyle=`hsl(${frame++%360} 80% 40%)`;ctx.fillRect(0,0,320,240);ctx.fillStyle='white';ctx.fillText(`${e.id} ${frame}`,30,90)},40));
 const track=canvas.captureStream(25).getVideoTracks()[0];tracks.push(track);
 console.log('CAMERA publish',e.id,type);const p=await e.send.produce({track,appData:{type}});return {producerId:p.id,participantId:e.id,isScreen:type==='screen'};
}
let manager,inventory,app,audio,stopped=false;
const participants=reactive({});
const pinnedTiles=ref([]), shares=ref([]);
const gridLayout={pinnedTiles,displayScreenShares:computed(()=>shares.value),
 pinTile(type,id){if(!pinnedTiles.value.some(x=>x.type===type&&x.id===id))pinnedTiles.value.push({type,id})},
 unpinTile(type,id){pinnedTiles.value=pinnedTiles.value.filter(x=>x.type!==type||x.id!==id)}};
window.cameraCheck={
 async start(configs){
  const publishers=[];for(const config of configs.slice(0,4))publishers.push(await endpoint(config));
  inventory=[];for(const p of publishers)inventory.push(await publish(p));
  inventory.push(await publish(publishers[0],'screen'));
  audio=new AudioContext();await audio.resume();const oscillator=audio.createOscillator(),dest=audio.createMediaStreamDestination();oscillator.connect(dest);oscillator.start();tracks.push(...dest.stream.getTracks());
  const ap=await publishers[0].send.produce({track:dest.stream.getAudioTracks()[0],appData:{type:'camera'}});inventory.push({producerId:ap.id,participantId:publishers[0].id,isScreen:false,kind:'audio'});
  const config=configs[4];
  const client=new SFUClient(new SocketIOSignalChannel());
  manager=new SFUMeetingManager(client);
  manager.initialize({meetingId:config.room,currentUser:{user_id:config.id,name:config.id},eventHandlers:{
   onParticipantJoined(p){participants[p.user_id]=p},
   onParticipantUpdated(id,p){Object.assign(participants[id]||{},p)},
   onParticipantLeft({participantId}){delete participants[participantId]},
   onScreenShareStarted(data){shares.value=[{participantId:data.participantId,consumerId:data.consumerId,source:'remote'}]}
  }});
  app=createApp({setup(){
   provideMeetingContext({participantStore:{participants,activeSpeakerIds:[],stableSpeakerIds:[]},currentUser:{currentUser:ref({user_id:config.id})},mediaState:{isCameraOn:false,isMicOn:false},gridLayout,raiseHandStore:{raisedHands:{}},reactionStore:{reactions:{}}});
   // Negative control drops only layout demand calls; the manager still connects.
   const injected=new URLSearchParams(location.search).has('disableDemand')
    ? new Proxy(manager,{get(target,key){return key==='setVisibleRemoteVideoParticipants'?async()=>{}:Reflect.get(target,key)}}):manager;
   provide('sfuManager',shallowRef(injected));
   provide('setRemoteVideoRef',(id,el)=>manager.registerRemoteVideoElement(id,el));
   provide('setScreenShareVideoRef',(id,el)=>manager.registerScreenSharePreview(id,el));
   return ()=>h(MeetingLayout);
  }});
  app.mount(document.getElementById('app'));
  await manager.startParticipantConnection({prefetchedDetails:{authToken:config.token,meetingId:config.room,userId:config.id,sfuUrl:'http://127.0.0.1:4317',sfuPort:'4317',tokenExpiresAt:Date.now()+600000,codecStrategy:'simulcast',e2eeRequired:false,isHost:false,isCohost:false},prepareJoin:async()=>({userData:{userId:config.id,name:config.id},mediaState:{video_enabled:false,audio_enabled:false}}),waitForE2EEReady:async()=>{},publishLocalMedia:async()=>{}});
  return inventory;
 },
 async pin(id){pinnedTiles.value=id?[{type:'participant',id}]:[];await nextTick()},
 async stats(){
  const raw=await manager.sampleRTCStats();
  return {timestamp:performance.timeOrigin+performance.now(),raw,rows:raw.streams.filter(x=>x.direction==='receive').map(x=>({id:x.id,producerId:manager.consumerManager.getConsumer(x.id)?.consumer.producerId,participantId:x.participantId,kind:x.kind,isScreen:x.source==='remote screen',bytes:x.reports.filter(r=>r.type==='inbound-rtp').reduce((n,r)=>n+(r.bytesReceived||0),0),frames:x.reports.filter(r=>r.type==='inbound-rtp').reduce((n,r)=>n+(r.framesDecoded||0),0)})),tiles:[...document.querySelectorAll('[data-participant]')].map(el=>({id:el.dataset.participant,hidden:el.classList.contains('hidden-tile'),pinned:el.classList.contains('pinned-tile'),decodedFrames:el.querySelector('video')?.getVideoPlaybackQuality().totalVideoFrames||0}))};
 },
 async stop(){if(stopped)return;stopped=true;app?.unmount();await manager?.cleanup();for(const e of endpoints){e.send.close();e.receive.close();e.socket.disconnect()}for(const t of timers)clearInterval(t);for(const t of tracks)t.stop();await audio?.close()}
};
