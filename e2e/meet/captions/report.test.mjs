import test from 'node:test';
import assert from 'node:assert/strict';
import {validateManifest, validateAudioTiming, scoreRun, words} from './report.mjs';
const clip = (id = 'a', overrides = {}) => ({id, audio: 'speech.wav', reference: 'Please send the report', speaker: 'Aarav', speechStartSeconds: .2, speechEndSeconds: 3, consented: true, ...overrides});
const manifest = (...clips) => ({version: 1, clips});
test('fixed transcript examples count substitution deletion and insertion independently', () => {
  const result = scoreRun(manifest(clip()), [{id:'a', transcript:'Please share report now', speaker:'Aarav'}]);
  assert.equal(result.summary.wordErrors, 3);
  assert.equal(result.summary.wer, .75);
  assert.equal(result.summary.attributionAccuracy, 1);
});
test('missing clips remain in WER failure and attribution denominators', () => {
  const result = scoreRun(manifest(clip('a'), clip('b')), [{id:'a',transcript:'Please send the report',speaker:'Aarav'}]);
  assert.equal(result.summary.missing, 1);
  assert.equal(result.summary.failed, 1);
  assert.equal(result.summary.wer, .5);
  assert.equal(result.summary.attributionAccuracy, .5);
});
test('Unicode normalization preserves Hindi vowel marks and internal apostrophes', () => {
  assert.deepEqual(words('रिपोर्ट भेजो, AARAV! Don’t.'), ['रिपोर्ट', 'भेजो', 'aarav', "don't"]);
  const result = scoreRun(manifest(clip('a',{reference:'रिपोर्ट भेजो'})), [{id:'a', transcript:'रिपोर्ट भेजो',speaker:'Aarav'}]);
  assert.equal(result.summary.wer, 0);
});
test('exact names report missed and hallucinated roster mentions', () => {
  const result = scoreRun(manifest(clip('a',{reference:'Aarav please ask Siobhan',names:['Aarav','Siobhan','Zubair']})), [{id:'a',transcript:'Aarav please ask Zubair',speaker:'Other'}]);
  assert.equal(result.summary.nameRecall,.5);
  assert.equal(result.summary.falseNames,1);
  assert.equal(result.summary.attributionAccuracy,0);
});
test('latency gates require observations for every expected clip', () => {
  const result = scoreRun(manifest(clip('a'),clip('b')), [{id:'a',transcript:'Please send the report',speaker:'Aarav',firstTextSeconds:1,finalAfterSpeechSeconds:.5},{id:'b',transcript:'Please send the report',speaker:'Aarav'}], {thresholds:{maxWer:0,maxFailed:0,maxFirstTextP95Seconds:5,maxFinalAfterSpeechP95Seconds:5}});
  assert.deepEqual(result.thresholds,{passed:false,failures:['maxFirstTextP95Seconds','maxFinalAfterSpeechP95Seconds']});
  assert.equal(result.summary.firstTextSeconds.p95,1);
});
test('privacy report contains neither reference nor prediction transcript', () => {
  const result = scoreRun(manifest(clip()), [{id:'a',transcript:'Please send the report',speaker:'Aarav'}]);
  assert.equal(JSON.stringify(result).includes('Please send'),false);
});
test('manifest rejects unverified audio invalid annotations and duplicate identities', () => {
  assert.throws(() => validateManifest(manifest(clip('a',{consented:false}))));
  assert.throws(() => validateManifest(manifest(clip('a',{speechEndSeconds:0}))));
  assert.throws(() => validateManifest(manifest(clip(),clip())));
  assert.throws(() => validateManifest(manifest(clip('a',{names:['Aarav','AARAV']}))));
  assert.doesNotThrow(() => validateManifest(manifest(clip('a',{consented:false,datasetLicense:'CC0',sourceUrl:'https://example.org/source'}))));
});
test('prediction contract rejects unknown duplicates and invalid observations', () => {
  assert.throws(() => scoreRun(manifest(clip()),[{id:'other',transcript:'text'}]));
  assert.throws(() => scoreRun(manifest(clip()),[{id:'a',transcript:'text'},{id:'a',transcript:'text'}]));
  assert.throws(() => scoreRun(manifest(clip()),[{id:'a',transcript:'text',firstTextSeconds:NaN}]));
});
test('nearest rank latency percentiles and explicit gates use independent examples', () => {
  const result = scoreRun(manifest(clip('a'),clip('b'),clip('c')), ['a','b','c'].map((id,index)=>({id,transcript:'Please send the report',speaker:'Aarav',firstTextSeconds:[3,1,2][index],finalAfterSpeechSeconds:.5})), {thresholds:{maxWer:0,maxFailed:0,minAttributionAccuracy:1,maxFirstTextP95Seconds:2}});
  assert.deepEqual(result.summary.firstTextSeconds,{samples:3,p50:2,p95:3});
  assert.deepEqual(result.thresholds.failures,['maxFirstTextP95Seconds']);
});
test('valid early final timing stays signed and onset delay uses speech annotations', () => {
  const result = scoreRun(manifest(clip()), [{id:'a',transcript:'Please send the report',speaker:'Aarav',firstTextSeconds:1,finalAfterSpeechSeconds:-.25}]);
  assert.equal(result.summary.finalAfterSpeechSeconds.p95,-.25);
  assert.equal(result.summary.firstTextAfterSpeechStartSeconds.p95,.8);
});
test('failed partial transcripts count errors but never successful latency samples', () => {
  const result = scoreRun(manifest(clip()), [{id:'a',transcript:'Please',speaker:'Aarav',failed:true,firstTextSeconds:1,finalAfterSpeechSeconds:.5}]);
  assert.equal(result.summary.failed,1);
  assert.equal(result.summary.wordErrors,3);
  assert.equal(result.summary.firstTextSeconds.samples,0);
});
test('ambiguous overlapping roster names fail validation', () => {
  assert.throws(()=>validateManifest(manifest(clip('a',{names:['Aarav','Aarav Shah']}))),/Overlapping/);
});
test('complete measurements pass limits while missing readings fail even generous limits', () => {
  const complete = {id:'a',transcript:'Please send the report',speaker:'Aarav',firstTextSeconds:1,finalAfterSpeechSeconds:.5};
  const thresholds = {maxFailed:0,maxWer:0,minAttributionAccuracy:1,maxFirstTextP95Seconds:1,maxFinalAfterSpeechP95Seconds:.5};
  assert.equal(scoreRun(manifest(clip()),[complete],{thresholds}).thresholds.passed,true);
  assert.equal(scoreRun(manifest(clip()),[{...complete,finalAfterSpeechSeconds:null}],{thresholds}).thresholds.passed,false);
});
test('onset-adjusted first-text gate subtracts leading silence and requires every sample', () => {
  const fixture = manifest(clip('a',{speechStartSeconds:2,speechEndSeconds:4}));
  const prediction = {id:'a',transcript:'Please send the report',speaker:'Aarav',firstTextSeconds:2.5};
  assert.equal(scoreRun(fixture,[prediction],{thresholds:{maxFirstTextAfterSpeechStartP95Seconds:.5}}).thresholds.passed,true);
  assert.equal(scoreRun(fixture,[prediction],{thresholds:{maxFirstTextAfterSpeechStartP95Seconds:.4}}).thresholds.passed,false);
  assert.equal(scoreRun(fixture,[{...prediction,firstTextSeconds:null}],{thresholds:{maxFirstTextAfterSpeechStartP95Seconds:10}}).thresholds.passed,false);
});
test('unannotated speech keeps speech-relative latency missing and fails its gates', () => {
  const fixture = manifest(clip('a',{speechStartSeconds:null,speechEndSeconds:undefined}));
  const prediction = {id:'a',transcript:'Please send the report',speaker:'Aarav',firstTextSeconds:1,finalAfterSpeechSeconds:.5,finalAfterAudioSeconds:-.2};
  const report = scoreRun(fixture,[prediction],{thresholds:{maxFirstTextAfterSpeechStartP95Seconds:10,maxFinalAfterSpeechP95Seconds:10}});
  assert.equal(report.summary.firstTextAfterSpeechStartSeconds.samples,0);
  assert.equal(report.summary.finalAfterSpeechSeconds.samples,0);
  assert.equal(report.summary.finalAfterAudioSeconds.p95,-.2);
  assert.deepEqual(report.thresholds.failures,['maxFirstTextAfterSpeechStartP95Seconds','maxFinalAfterSpeechP95Seconds']);
});
test('precreated rooms must map every manifest clip to a distinct nonempty room', async () => {
  const {validateRooms} = await import('./report.mjs');
  const fixture = manifest(clip('a'),clip('b'));
  assert.deepEqual([...validateRooms(fixture,{a:'room-a',b:'room-b'})],[['a','room-a'],['b','room-b']]);
  for (const value of [null,[],{a:'room-a'},{a:'room-a',c:'room-c'},{a:'room',b:' room '},{a:'room-a',b:' '},{a:'room-a',b:42}]) assert.throws(()=>validateRooms(fixture,value));
});
const control = (id='control') => clip(id,{reference:'',expectSpeech:false,speechStartSeconds:null,speechEndSeconds:null});
test('only explicit non-speech controls accept empty references', () => {
  assert.doesNotThrow(()=>validateManifest(manifest(control())));
  assert.throws(()=>validateManifest(manifest(clip('a',{reference:''}))));
  assert.throws(()=>validateManifest(manifest(control('a'),clip('b',{expectSpeech:'false'}))));
  assert.throws(()=>validateManifest(manifest({...control(),reference:'spoken word'})));
  assert.throws(()=>validateManifest(manifest({...control(),speechEndSeconds:2})));
});
test('successful silence controls do not dilute speech WER attribution or latency', () => {
  const report = scoreRun(manifest(clip(),control()),[
    {id:'a',transcript:'Please send report',speaker:'Aarav',firstTextSeconds:1,finalAfterSpeechSeconds:.5},
    {id:'control',transcript:'',failed:false,interimCaptionObservations:0,finalCaptionObservations:0},
  ],{thresholds:{maxFailed:0,maxFalseCaptionClips:0,maxFirstTextP95Seconds:1,maxFinalAfterSpeechP95Seconds:.5}});
  assert.equal(report.summary.clips,2);
  assert.equal(report.summary.speechClips,1);
  assert.equal(report.summary.nonSpeechClips,1);
  assert.equal(report.summary.wer,.25);
  assert.equal(report.summary.attributionAccuracy,1);
  assert.equal(report.summary.failed,0);
  assert.equal(report.summary.missing,0);
  assert.equal(report.summary.firstTextSeconds.samples,1);
  assert.equal(report.thresholds.passed,true);
});
test('cleared interim and final hallucinations count separately without inflating speech WER', () => {
  const report = scoreRun(manifest(clip(),control('interim'),control('final')),[
    {id:'a',transcript:'Please send the report',speaker:'Aarav'},
    {id:'interim',transcript:'',interimCaptionObservations:2,finalCaptionObservations:0},
    {id:'final',transcript:'Thank you',interimCaptionObservations:0,finalCaptionObservations:1},
  ],{thresholds:{maxFalseCaptionClips:0,maxFalseInterimCaptionClips:0,maxFalseFinalCaptionClips:0}});
  assert.equal(report.summary.falseCaptionClips,2);
  assert.equal(report.summary.falseInterimCaptionClips,1);
  assert.equal(report.summary.falseFinalCaptionClips,1);
  assert.equal(report.summary.falseCaptionWords,2);
  assert.equal(report.summary.wer,0);
  assert.equal(report.summary.failed,2);
  assert.deepEqual(report.thresholds.failures,['maxFalseCaptionClips','maxFalseInterimCaptionClips','maxFalseFinalCaptionClips']);
});
test('absent controls count as failed captures rather than missing speech', () => {
  const report = scoreRun(manifest(control()),[],{thresholds:{maxFailed:0,maxFalseCaptionClips:0}});
  assert.equal(report.summary.missing,0);
  assert.equal(report.summary.missingControls,1);
  assert.equal(report.summary.failed,1);
  assert.equal(report.summary.wer,null);
  assert.equal(report.summary.attributionAccuracy,null);
  assert.equal(report.summary.firstTextSeconds.samples,0);
  assert.equal(report.thresholds.passed,false);
});
test('interim hallucination gates require observed interim coverage', () => {
  const report = scoreRun(manifest(control()),[{id:'control',transcript:'',failed:false}],{thresholds:{maxFalseCaptionClips:0,maxFalseInterimCaptionClips:0}});
  assert.equal(report.summary.failed,0);
  assert.deepEqual(report.thresholds.failures,['maxFalseCaptionClips','maxFalseInterimCaptionClips']);
  assert.throws(()=>scoreRun(manifest(control()),[{id:'control',transcript:'',interimCaptionObservations:-1}]));
});

test('final-only silence gate rejects failed publication and browser captures', () => {
  for (const prediction of [{id:'control',transcript:'',failed:true}, {id:'control',transcript:'',failed:true,interimCaptionObservations:0}]) {
    const result=scoreRun(manifest(control()),[prediction],{thresholds:{maxFalseFinalCaptionClips:0}});
    assert.deepEqual(result.thresholds,{passed:false,failures:['maxFalseFinalCaptionClips']});
  }
  const quiet=scoreRun(manifest(control()),[{id:'control',transcript:'',failed:false,interimCaptionObservations:0,finalCaptionObservations:0}],{thresholds:{maxFalseFinalCaptionClips:0}});
  assert.equal(quiet.thresholds.passed,true);
});
test('start-only annotation cannot exceed decoded audio duration', () => {
  assert.throws(()=>validateAudioTiming(1,{speechStartSeconds:2}),/Audio is shorter/);
  assert.throws(()=>validateAudioTiming(1,{speechEndSeconds:2}),/Audio is shorter/);
  assert.doesNotThrow(()=>validateAudioTiming(1,{speechStartSeconds:.2,speechEndSeconds:null}));
  assert.doesNotThrow(()=>validateAudioTiming(1,{speechStartSeconds:null,speechEndSeconds:null}));
  assert.doesNotThrow(()=>validateAudioTiming(1,{speechStartSeconds:0,speechEndSeconds:1}));
  assert.throws(()=>validateAudioTiming(1,{speechStartSeconds:NaN}));
});

test('final-only gate remains final-specific after an observed interim hallucination', () => {
  const report=scoreRun(manifest(control()),[{id:'control',transcript:'',failed:true,interimCaptionObservations:1,finalCaptionObservations:0}],{thresholds:{maxFalseFinalCaptionClips:0}});
  assert.equal(report.summary.failedControls,1);
  assert.equal(report.summary.finalCaptionSamples,1);
  assert.equal(report.thresholds.passed,true);
});
