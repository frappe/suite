import assert from 'node:assert/strict';
import test from 'node:test';
import { comparePair } from './compare.mjs';

const hash = 'a'.repeat(64);
const settings = { modelImageDigest: 'sha256:base', modelRevision: 'base', language: 'auto', sampleRate: 24000, nameHints: [] };
function example() {
  return { manifest: { version: 1, clips: [
    { id: 'english', audio: 'one.wav', reference: 'please send the report', speaker: 'Speaker', consented: true, scenario: 'english' },
    { id: 'mixed', audio: 'two.wav', reference: 'आज meeting है', speaker: 'Speaker', consented: true, scenario: 'mixed' },
  ] }, direct: { english: { transcript: 'please send a report' }, mixed: { transcript: 'आज meeting है' } },
  meet: { predictions: [{ id: 'english', transcript: 'please send report', speaker: 'Speaker' }, { id: 'mixed', transcript: '', failed: true }], run: { audioInputs: [{ id: 'english', sourceAudioSha256: hash }, { id: 'mixed', sourceAudioSha256: hash }], operatorSettings: settings } },
  inputs: { audioInputs: [{ id: 'english', sourceAudioSha256: hash }, { id: 'mixed', sourceAudioSha256: hash }], operatorSettings: settings }, hashes: { english: hash, mixed: hash } };
}
const run = fixture => comparePair(fixture.manifest, fixture.direct, fixture.meet, fixture.inputs, fixture.hashes);
test('paired errors use common independent references and preserve failed clips', () => {
  const result = run(example());
  assert.equal(result.summary.directWer, 1 / 7);
  assert.equal(result.summary.meetWer, 4 / 7);
  assert.equal(result.summary.addedWordErrors, 3);
  assert.equal(result.summary.meetFailed, 1);
  assert.equal(result.groups.find(row => row.scenario === 'mixed').meetWer, 1);
  assert.equal(result.meetAttributionAccuracy, .5);
});
test('matching declarations do not claim independently verified model identity', () => {
  const result = run(example());
  assert.equal(result.evidence.operatorDeclaredSettingsMatch, true);
  assert.equal(result.evidence.backendIdentityVerified, false);
  assert.equal(JSON.stringify(result).includes('please send'), false);
});
test('changed source bytes reject comparisons even when predictions match', () => {
  const fixture = example(); fixture.meet.run.audioInputs[0].sourceAudioSha256 = 'b'.repeat(64);
  assert.throws(() => run(fixture), /Meet source audio mismatch/);
});
test('input failures stay scored but incomplete audio evidence prevents parity claim', () => {
  const fixture = example(); fixture.meet.run.audioInputs.pop();
  const result = run(fixture);
  assert.equal(result.summary.meetFailed, 1);
  assert.equal(result.evidence.sourceAudioMatches, false);
  assert.deepEqual(result.evidence.unavailableInputEvidence, ['mixed']);
});
test('prompt or hint differences invalidate declared settings parity', () => {
  const fixture = example(); fixture.meet.run.operatorSettings = { ...settings, language: 'en-US' };
  assert.equal(run(fixture).evidence.operatorDeclaredSettingsMatch, false);
});
test('missing, extra and duplicate clip identities are rejected', () => {
  const missing = example(); delete missing.direct.mixed;
  assert.throws(() => run(missing), /every clip exactly once/);
  const duplicate = example(); duplicate.meet.predictions[1].id = 'english';
  assert.throws(() => run(duplicate), /duplicate prediction/);
});
test('nested prediction IDs cannot swap transcripts across source-bound clips', () => {
  const fixture = example();
  fixture.direct.english = { id: 'mixed', transcript: 'आज meeting है' };
  fixture.direct.mixed = { id: 'english', transcript: 'please send the report' };
  assert.throws(() => run(fixture), /conflicts with its keyed identity/);
});

test('control-only groups use explicit null WER and distinguish unavailable direct interims', () => {
  const fixture = example();
  fixture.manifest.clips.push({id:'quiet',audio:'quiet.wav',reference:'',speaker:'Speaker',expectSpeech:false,consented:true,scenario:'control'});
  fixture.direct.quiet={transcript:''};
  fixture.meet.predictions.push({id:'quiet',transcript:'',interimCaptionObservations:2,finalCaptionObservations:0});
  fixture.inputs.audioInputs.push({id:'quiet',sourceAudioSha256:hash});
  fixture.meet.run.audioInputs.push({id:'quiet',sourceAudioSha256:hash});
  fixture.hashes.quiet=hash;
  const result=run(fixture);
  const group=result.groups.find(group=>group.scenario==='control');
  assert.equal(group.directWer,null);
  assert.equal(group.meetWer,null);
  assert.equal(result.summary.directWer,1/7);
  assert.deepEqual(group.directControls,{clips:1,failed:0,missing:0,interimSamples:0,finalEvidenceComplete:true,interimEvidenceComplete:false,falseFinalCaptionClips:0,falseInterimCaptionClips:null,falseCaptionClips:null});
  assert.equal(group.meetControls.falseInterimCaptionClips,1);
  assert.equal(group.meetControls.falseFinalCaptionClips,0);
  assert.equal(group.meetControls.falseCaptionClips,1);
  assert.equal(result.summary.meetControls.falseCaptionClips,1);
  fixture.direct.quiet={transcript:'Thank you'};
  assert.equal(run(fixture).summary.directControls.falseFinalCaptionClips,1);
  fixture.direct.quiet={transcript:'',failed:true};
  assert.equal(run(fixture).summary.directControls.falseFinalCaptionClips,null);
});
