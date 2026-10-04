import test from 'node:test';
import assert from 'node:assert/strict';
import {predictionFromObservations} from './observations.mjs';
const clip = {id:'a',speaker:'Ada',speechEndSeconds:2};
const line = (captionId,text,isFinal,observedAt,participantName='Ada') => ({captionId,text,isFinal,observedAt,participantName});
const result = observations => ({observations,playbackStartedAt:1000,unfinishedCaptionIds:[]});
test('ordered finals deduplicate rerenders but preserve repeated spoken utterances', () => {
  const prediction = predictionFromObservations(clip,result([
    line('draft','Hello',false,1200), line('first','Hello there',true,3000),
    line('first','Hello there',true,4000), line('second','Hello there',true,5000),
  ]));
  assert.equal(prediction.transcript,'Hello there Hello there');
  assert.equal(prediction.firstTextSeconds,.2);
  assert.equal(prediction.finalAfterSpeechSeconds,2);
  assert.equal(prediction.failed,false);
});
test('first final appearance determines timing even after label changes', () => {
  const prediction = predictionFromObservations(clip,result([
    line('first','Hello',true,3500,'Wrong'),line('first','Hello',true,8000),
  ]));
  assert.equal(prediction.finalAfterSpeechSeconds,.5);
  assert.equal(prediction.speaker,'Ada');
});
test('a final followed by an unfinished draft counts as a failed clip', () => {
  const input = result([line('first','Hello',true,3000),line('draft','another',false,4000)]);
  input.unfinishedCaptionIds=['draft'];
  const prediction = predictionFromObservations(clip,input);
  assert.equal(prediction.transcript,'Hello');
  assert.equal(prediction.failed,true);
});
test('attribution errors do not hide the first displayed text from latency', () => {
  const prediction = predictionFromObservations(clip,result([
    line('draft','Hello',false,1200,'Wrong'),line('final','Hello',true,3000,'Wrong'),
  ]));
  assert.equal(prediction.firstTextSeconds,.2);
  assert.equal(prediction.speaker,'Wrong');
});
test('placeholder captions cannot masquerade as finalized speech', () => {
  const prediction = predictionFromObservations(clip,result([line('placeholder','...',true,3000)]));
  assert.equal(prediction.failed,true);
  assert.equal(prediction.transcript,'');
  assert.equal(prediction.firstTextSeconds,undefined);
});
test('audio end is never substituted for unknown speech end', () => {
  const prediction = predictionFromObservations({...clip,speechEndSeconds:null},{...result([line('final','Hello',true,4500)]),durationSeconds:4});
  assert.equal(prediction.finalAfterSpeechSeconds,undefined);
  assert.equal(prediction.finalAfterAudioSeconds,-.5);
});
test('non-speech full collection with no text succeeds without synthetic finals', () => {
  const prediction = predictionFromObservations({...clip,expectSpeech:false},result([]));
  assert.equal(prediction.transcript,'');
  assert.equal(prediction.failed,false);
  assert.equal(prediction.interimCaptionObservations,0);
  assert.equal(prediction.finalCaptionObservations,0);
  assert.equal(prediction.firstTextSeconds,undefined);
});
test('non-speech interim later cleared still fails even without final transcript', () => {
  const prediction = predictionFromObservations({...clip,expectSpeech:false},result([line('draft','Hello',false,1500)]));
  assert.equal(prediction.transcript,'');
  assert.equal(prediction.failed,true);
  assert.equal(prediction.interimCaptionObservations,1);
  assert.equal(prediction.finalCaptionObservations,0);
});
test('non-speech final text fails and rerenders count once', () => {
  const prediction = predictionFromObservations({...clip,expectSpeech:false},result([line('final','Hello',true,1500),line('final','Hello',true,1600)]));
  assert.equal(prediction.failed,true);
  assert.equal(prediction.finalCaptionObservations,1);
});
