import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyAudioPublication} from './publication.mjs';
const snapshot = (packets,bytes,overrides={}) => ({audioContextState:'running',peakSourceAmplitude:0,connections:[{
  connectionState:'connected',senders:[{enabled:true,readyState:'live'}],reports:[{type:'outbound-rtp',packetsSent:packets,bytesSent:bytes},{type:'media-source',totalAudioEnergy:0}],...overrides,
}]});
test('connected silence publication passes on packet and byte progress without energy', () => {
  assert.equal(verifyAudioPublication(snapshot(10,100),snapshot(20,150)),true);
});
test('broken publication cannot pass a no-caption control', () => {
  const before=snapshot(10,100);
  for (const after of [snapshot(10,100),snapshot(20,100),snapshot(10,150),snapshot(20,150,{connectionState:'failed'}),snapshot(20,150,{senders:[{enabled:false,readyState:'live'}]}),snapshot(20,150,{senders:[{enabled:true,readyState:'ended'}]})]) assert.equal(verifyAudioPublication(before,after),false);
  assert.equal(verifyAudioPublication(undefined,undefined),false);
});
test('inbound media or source energy cannot substitute for outbound publication', () => {
  const after=snapshot(0,0,{reports:[{type:'inbound-rtp',packetsSent:100,bytesSent:1000},{type:'media-source',totalAudioEnergy:5}]});
  assert.equal(verifyAudioPublication(snapshot(0,0),after),false);
});
