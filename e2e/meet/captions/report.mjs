/** Independent reference-based scoring for browser microphone caption evaluations. */
export function words(text) {
  return text.normalize('NFKC').toLocaleLowerCase('und').replaceAll('’', "'")
    .replace(/[^\p{L}\p{N}\p{M}']/gu, ' ').split(/\s+/u)
    .map(word => word.replace(/^'+|'+$/g, '')).filter(Boolean);
}
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
export function validateManifest(value) {
  if (value?.version !== 1 || !Array.isArray(value.clips) || !value.clips.length) throw Error('Manifest needs version 1 and nonempty clips');
  const ids = new Set();
  for (const clip of value.clips) {
    for (const field of ['id', 'audio', 'speaker']) {
      if (typeof clip?.[field] !== 'string' || !clip[field].trim()) throw Error(`Clip needs ${field}`);
    }
    if (ids.has(clip.id)) throw Error('Duplicate clip id');
    ids.add(clip.id);
    if (clip.expectSpeech !== undefined && typeof clip.expectSpeech !== 'boolean') throw Error('expectSpeech must be boolean');
    if (typeof clip.reference !== 'string') throw Error('Clip needs reference');
    if (clip.expectSpeech === false ? clip.reference.trim() !== '' : !words(clip.reference).length) throw Error('Speech needs reference words; non-speech controls need empty reference');
    if (clip.expectSpeech === false && (clip.speechStartSeconds != null || clip.speechEndSeconds != null)) throw Error('Non-speech controls cannot have speech annotations');
    for (const field of ['speechStartSeconds', 'speechEndSeconds']) if (clip[field] != null && !finite(clip[field])) throw Error('Invalid speech annotations');
    if (clip.speechStartSeconds != null && clip.speechEndSeconds != null && clip.speechEndSeconds <= clip.speechStartSeconds) throw Error('Invalid speech annotations');
    if (clip.consented !== true && !(typeof clip.datasetLicense === 'string' && clip.datasetLicense.trim() && typeof clip.sourceUrl === 'string' && clip.sourceUrl.startsWith('https://'))) throw Error('Clip needs consent or dataset license and source');
    if (clip.names !== undefined && (!Array.isArray(clip.names) || clip.names.some(name => typeof name !== 'string' || !words(name).length))) throw Error('Invalid names');
    const nameTokens = (clip.names ?? []).map(words);
    if (nameTokens.some((phrase, index) => nameTokens.some((other, otherIndex) => index !== otherIndex && phrase.length < other.length && other.some((_, offset) => phrase.every((token, i) => other[offset + i] === token))))) throw Error('Overlapping roster names are ambiguous');
    if (new Set((clip.names ?? []).map(name => words(name).join(' '))).size !== (clip.names ?? []).length) throw Error('Duplicate normalized names');
  }
  return value;
}
/** Check supplied annotations against the decoded recording, without inventing missing bounds. */
export function validateAudioTiming(durationSeconds, clip) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw Error('Invalid decoded audio duration');
  for (const field of ['speechStartSeconds', 'speechEndSeconds']) {
    const value = clip[field];
    if (value != null && (!finite(value) || value > durationSeconds)) throw Error(`Audio is shorter than annotated ${field}`);
  }
  if (clip.speechStartSeconds != null && clip.speechEndSeconds != null && clip.speechEndSeconds <= clip.speechStartSeconds) throw Error('Invalid speech annotations');
}
function distance(reference, actual) {
  let prior = Array.from({length: actual.length + 1}, (_, i) => i);
  for (let i = 1; i <= reference.length; i++) {
    const next = [i];
    for (let j = 1; j <= actual.length; j++) next[j] = Math.min(prior[j] + 1, next[j - 1] + 1, prior[j - 1] + Number(reference[i - 1] !== actual[j - 1]));
    prior = next;
  }
  return prior[actual.length];
}
function mentions(tokens, name) {
  const phrase = words(name);
  let count = 0;
  for (let i = 0; i <= tokens.length - phrase.length; i++) {
    if (phrase.every((token, offset) => token === tokens[i + offset])) { count++; i += phrase.length - 1; }
  }
  return count;
}
function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}
export function scoreRun(manifest, predictions, {thresholds} = {}) {
  validateManifest(manifest);
  if (!Array.isArray(predictions)) throw Error('Predictions must be an array');
  const byId = new Map();
  const expectedIds = new Set(manifest.clips.map(clip => clip.id));
  for (const prediction of predictions) {
    if (!expectedIds.has(prediction?.id) || byId.has(prediction.id)) throw Error('Unknown or duplicate prediction id');
    if (typeof prediction.transcript !== 'string' || (prediction.failed !== undefined && typeof prediction.failed !== 'boolean')) throw Error('Invalid prediction');
    if (prediction.speaker !== undefined && typeof prediction.speaker !== 'string') throw Error('Invalid prediction speaker');
    for (const field of ['firstTextSeconds', 'finalAfterSpeechSeconds', 'finalAfterAudioSeconds']) if (prediction[field] != null && !(typeof prediction[field] === 'number' && Number.isFinite(prediction[field]) && (field !== 'firstTextSeconds' || prediction[field] >= 0))) throw Error(`Invalid ${field}`);
    for (const field of ['interimCaptionObservations', 'finalCaptionObservations']) if (prediction[field] !== undefined && (!Number.isInteger(prediction[field]) || prediction[field] < 0)) throw Error(`Invalid ${field}`);
    byId.set(prediction.id, prediction);
  }
  const clips = manifest.clips.map(clip => {
    const prediction = byId.get(clip.id);
    const expectSpeech = clip.expectSpeech !== false;
    const reference = words(clip.reference), actual = words(prediction?.transcript ?? '');
    const falseInterimCaption = !expectSpeech && (prediction?.interimCaptionObservations ?? 0) > 0;
    const falseFinalCaption = !expectSpeech && ((prediction?.finalCaptionObservations ?? 0) > 0 || !!prediction?.transcript.trim());
    const falseCaption = falseInterimCaption || falseFinalCaption;
    let expectedNames = 0, correctNames = 0, falseNames = 0;
    for (const name of clip.names ?? []) {
      const expected = mentions(reference, name), observed = mentions(actual, name);
      expectedNames += expected; correctNames += Math.min(expected, observed); falseNames += Math.max(0, observed - expected);
    }
    return {id: clip.id, expectSpeech, missing: !prediction, failed: !prediction || prediction.failed === true || (expectSpeech ? !actual.length : falseCaption), falseCaption, falseInterimCaption, falseFinalCaption, interimMeasured: !expectSpeech && prediction?.interimCaptionObservations !== undefined, finalMeasured: !expectSpeech && !!prediction && (prediction.finalCaptionObservations !== undefined || prediction.failed !== true || falseFinalCaption), falseCaptionWords: expectSpeech ? 0 : actual.length,
      referenceWords: reference.length, wordErrors: expectSpeech ? distance(reference, actual) : 0, expectedNames, correctNames, falseNames,
      attributionCorrect: expectSpeech && !!actual.length && prediction?.speaker === clip.speaker,
      firstTextSeconds: prediction?.firstTextSeconds ?? null, firstTextAfterSpeechStartSeconds: prediction?.firstTextSeconds == null || clip.speechStartSeconds == null ? null : prediction.firstTextSeconds - clip.speechStartSeconds, finalAfterSpeechSeconds: clip.speechEndSeconds == null ? null : prediction?.finalAfterSpeechSeconds ?? null, finalAfterAudioSeconds: prediction?.finalAfterAudioSeconds ?? null};
  });
  const sum = field => clips.reduce((total, clip) => total + Number(clip[field]), 0);
  const latency = field => { const values = clips.filter(clip => clip.expectSpeech && !clip.failed && clip[field] !== null).map(clip => clip[field]); return {samples: values.length, p50: percentile(values, .5), p95: percentile(values, .95)}; };
  const speechClips = clips.filter(clip => clip.expectSpeech).length;
  const report = {version: 1, clips, summary: {clips: clips.length, speechClips, nonSpeechClips: clips.length - speechClips, failed: sum('failed'), failedSpeech: clips.filter(clip => clip.expectSpeech && clip.failed).length, failedControls: clips.filter(clip => !clip.expectSpeech && clip.failed).length, missing: clips.filter(clip => clip.expectSpeech && clip.missing).length, missingControls: clips.filter(clip => !clip.expectSpeech && clip.missing).length, falseCaptionClips: sum('falseCaption'), falseInterimCaptionClips: sum('falseInterimCaption'), falseFinalCaptionClips: sum('falseFinalCaption'), interimCaptionSamples: sum('interimMeasured'), finalCaptionSamples: sum('finalMeasured'), falseCaptionWords: sum('falseCaptionWords'), referenceWords: sum('referenceWords'), wordErrors: sum('wordErrors'), wer: sum('referenceWords') ? sum('wordErrors') / sum('referenceWords') : null, attributionAccuracy: speechClips ? sum('attributionCorrect') / speechClips : null, expectedNames: sum('expectedNames'), correctNames: sum('correctNames'), falseNames: sum('falseNames'), nameRecall: sum('expectedNames') ? sum('correctNames') / sum('expectedNames') : null, firstTextSeconds: latency('firstTextSeconds'), firstTextAfterSpeechStartSeconds: latency('firstTextAfterSpeechStartSeconds'), finalAfterSpeechSeconds: latency('finalAfterSpeechSeconds'), finalAfterAudioSeconds: latency('finalAfterAudioSeconds')}};
  if (thresholds) report.thresholds = assertThresholds(report, thresholds);
  return report;
}
export function assertThresholds(report, thresholds) {
  const failures = [];
  const summary = report.summary;
  const checks = {maxWer: ['wer', '<='], maxFailed: ['failed', '<='], minAttributionAccuracy: ['attributionAccuracy', '>='], minNameRecall: ['nameRecall', '>='], maxFalseNames: ['falseNames', '<='], maxFalseCaptionClips: ['falseCaptionClips', '<='], maxFalseInterimCaptionClips: ['falseInterimCaptionClips', '<='], maxFalseFinalCaptionClips: ['falseFinalCaptionClips', '<=']};
  for (const [key, limit] of Object.entries(thresholds)) {
    if (!finite(limit)) throw Error(`Invalid threshold ${key}`);
    if (key === 'maxFirstTextP95Seconds' || key === 'maxFirstTextAfterSpeechStartP95Seconds' || key === 'maxFinalAfterSpeechP95Seconds') {
      const field = key === 'maxFirstTextP95Seconds' ? 'firstTextSeconds' : key === 'maxFirstTextAfterSpeechStartP95Seconds' ? 'firstTextAfterSpeechStartSeconds' : 'finalAfterSpeechSeconds';
      if (summary[field].samples !== summary.speechClips || summary[field].p95 === null || summary[field].p95 > limit) failures.push(key);
    } else {
      const check = checks[key];
      if (!check) throw Error(`Unknown threshold ${key}`);
      const [field, operator] = check, value = summary[field];
      if (key === 'maxFalseFinalCaptionClips' && summary.finalCaptionSamples !== summary.nonSpeechClips) { failures.push(key); continue; }
      if ((key === 'maxFalseCaptionClips' || key === 'maxFalseInterimCaptionClips') && summary.interimCaptionSamples !== summary.nonSpeechClips) { failures.push(key); continue; }
      if (value === null || (operator === '<=' ? value > limit : value < limit)) failures.push(key);
    }
  }
  return {passed: !failures.length, failures};
}

/** Validate exact one-room-per-clip mapping before any browser capture. */
export function validateRooms(manifest, value) {
  validateManifest(manifest);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Room map must be an object');
  const expected = new Set(manifest.clips.map(clip => clip.id));
  const entries = Object.entries(value);
  if (entries.length !== expected.size || entries.some(([id]) => !expected.has(id))) throw Error('Room map must match all manifest IDs exactly');
  if (entries.some(([, room]) => typeof room !== 'string' || !room.trim())) throw Error('Room map needs nonempty room IDs');
  const normalized = entries.map(([id, room]) => [id, room.trim()]);
  if (new Set(normalized.map(([, room]) => room)).size !== entries.length) throw Error('Room IDs must be unique');
  return new Map(normalized);
}
