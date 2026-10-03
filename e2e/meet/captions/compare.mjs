/** Compare direct endpoint and rendered Meet predictions against one frozen corpus. */
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile, chmod } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { scoreRun, validateManifest } from './report.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function controlMetrics(rows) {
  const controls = rows.filter(row => !row.expectSpeech);
  const count = field => controls.filter(row => row[field]).length;
  const interimSamples = count('interimMeasured');
  const finalEvidenceComplete = count('finalMeasured') === controls.length;
  const interimEvidenceComplete = finalEvidenceComplete && interimSamples === controls.length;
  return {
    clips: controls.length,
    failed: count('failed'),
    missing: count('missing'),
    interimSamples,
    finalEvidenceComplete,
    interimEvidenceComplete,
    falseFinalCaptionClips: finalEvidenceComplete ? count('falseFinalCaption') : null,
    falseInterimCaptionClips: interimEvidenceComplete ? count('falseInterimCaption') : null,
    falseCaptionClips: interimEvidenceComplete ? count('falseCaption') : null,
  };
}

export function comparePair(manifest, directPredictions, meetRaw, directInputs, actualHashes) {
  validateManifest(manifest);
  const ids = manifest.clips.map(clip => clip.id);
  if (!directPredictions || Array.isArray(directPredictions) || typeof directPredictions !== 'object') throw Error('Direct predictions must be keyed by clip ID');
  if (Object.keys(directPredictions).length !== ids.length || ids.some(id => !Object.hasOwn(directPredictions, id))) throw Error('Direct predictions must contain every clip exactly once');
  if (!Array.isArray(meetRaw?.predictions) || meetRaw.predictions.length !== ids.length) throw Error('Meet predictions must contain every clip exactly once');
  const sourceRows = value => {
    if (!Array.isArray(value)) throw Error('Missing audio input evidence');
    const rows = new Map();
    for (const row of value) {
      if (!ids.includes(row.id) || rows.has(row.id) || !/^[a-f0-9]{64}$/.test(row.sourceAudioSha256)) throw Error('Invalid audio input evidence');
      rows.set(row.id, row);
    }
    return rows;
  };
  const directSources = sourceRows(directInputs?.audioInputs);
  const meetSources = sourceRows(meetRaw?.run?.audioInputs);
  const unavailableInputEvidence = [];
  for (const id of ids) {
    if (!/^[a-f0-9]{64}$/.test(actualHashes[id] ?? '') || directSources.get(id)?.sourceAudioSha256 !== actualHashes[id]) throw Error('Direct source audio mismatch');
    const meet = meetSources.get(id);
    if (!meet) unavailableInputEvidence.push(id);
    else if (meet.sourceAudioSha256 !== actualHashes[id]) throw Error('Meet source audio mismatch');
  }
  const directRows = ids.map(id => {
    const prediction = directPredictions[id];
    if (prediction?.id !== undefined && prediction.id !== id) throw Error('Direct prediction ID conflicts with its keyed identity');
    return { ...prediction, id, speaker: undefined };
  });
  const direct = scoreRun(manifest, directRows);
  const meet = scoreRun(manifest, meetRaw.predictions);
  const byId = new Map(meet.clips.map(clip => [clip.id, clip]));
  const clips = direct.clips.map(clip => {
    const counterpart = byId.get(clip.id);
    return {
      id: clip.id,
      expectSpeech: clip.expectSpeech,
      referenceWords: clip.referenceWords,
      directWordErrors: clip.wordErrors,
      meetWordErrors: counterpart.wordErrors,
      addedWordErrors: counterpart.wordErrors - clip.wordErrors,
      directFailed: clip.failed, meetFailed: counterpart.failed,
      inputEvidenceAvailable: !unavailableInputEvidence.includes(clip.id),
    };
  });
  const groups = [...new Set(manifest.clips.map(clip => clip.scenario ?? 'unspecified'))].map(scenario => {
    const members = new Set(manifest.clips.filter(clip => (clip.scenario ?? 'unspecified') === scenario).map(clip => clip.id));
    const rows = clips.filter(clip => members.has(clip.id));
    const sum = field => rows.reduce((total, row) => total + Number(row[field]), 0);
    const referenceWords = sum('referenceWords');
    return {
      scenario,
      clips: rows.length,
      referenceWords,
      directWer: referenceWords ? sum('directWordErrors') / referenceWords : null,
      meetWer: referenceWords ? sum('meetWordErrors') / referenceWords : null,
      directControls: controlMetrics(direct.clips.filter(clip => members.has(clip.id))),
      meetControls: controlMetrics(meet.clips.filter(clip => members.has(clip.id))),
      addedWordErrors: sum('addedWordErrors'),
      directFailed: sum('directFailed'),
      meetFailed: sum('meetFailed'),
    };
  });
  const declaredSettings = directInputs.operatorSettings ?? null;
  const meetSettings = meetRaw.run.operatorSettings ?? null;
  const settingsMatch = declaredSettings !== null && meetSettings !== null &&
    ['modelImageDigest', 'modelRevision', 'language', 'sampleRate', 'nameHints'].every(key =>
      Object.hasOwn(declaredSettings, key) && Object.hasOwn(meetSettings, key) &&
      JSON.stringify(declaredSettings[key]) === JSON.stringify(meetSettings[key]));
  return {
    version: 1,
    summary: {
      clips: ids.length,
      referenceWords: direct.summary.referenceWords,
      directWer: direct.summary.wer,
      meetWer: meet.summary.wer,
      addedWordErrors: meet.summary.wordErrors - direct.summary.wordErrors,
      directFailed: direct.summary.failed,
      meetFailed: meet.summary.failed,
      directControls: controlMetrics(direct.clips),
      meetControls: controlMetrics(meet.clips),
    },
    groups,
    clips,
    meetAttributionAccuracy: meet.summary.attributionAccuracy,
    evidence: {
      sourceAudioMatches: unavailableInputEvidence.length === 0,
      unavailableInputEvidence,
      operatorDeclaredSettingsMatch: settingsMatch,
      backendIdentityVerified: false,
      limitation: 'Matching operator declarations do not independently verify the deployed checkpoint or session settings. Inspect SFU boundary captures before attributing differences.',
    },
  };
}

async function main() {
  const args = new Map();
  const allowed = new Set(['--manifest', '--direct-predictions', '--direct-inputs', '--meet-raw', '--output']);
  for (let i = 2; i < process.argv.length; i += 2) {
    if (!allowed.has(process.argv[i]) || !process.argv[i + 1] || args.has(process.argv[i])) throw Error('Use --manifest --direct-predictions --direct-inputs --meet-raw --output');
    args.set(process.argv[i], resolve(process.argv[i + 1]));
  }
  if (args.size !== allowed.size) throw Error('All five arguments are required');
  const manifestBytes = await readFile(args.get('--manifest'));
  const manifest = validateManifest(JSON.parse(manifestBytes));
  const [direct, inputs, meet] = await Promise.all(['--direct-predictions', '--direct-inputs', '--meet-raw'].map(async key => JSON.parse(await readFile(args.get(key), 'utf8'))));
  if (meet.run?.manifestSha256 !== sha256(manifestBytes)) throw Error('Meet manifest mismatch');
  const hashes = Object.fromEntries(await Promise.all(manifest.clips.map(async clip => [clip.id, sha256(await readFile(resolve(dirname(args.get('--manifest')), clip.audio)))])));
  const result = comparePair(manifest, direct, meet, inputs, hashes);
  result.inputs = { manifestSha256: sha256(manifestBytes), createdAt: new Date().toISOString() };
  const output = args.get('--output');
  if ([...args.values()].filter(path => path === output).length !== 1) throw Error('Output must differ from input paths');
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  await writeFile(output, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
  await chmod(output, 0o600);
  console.log(JSON.stringify({ summary: result.summary, evidence: result.evidence }, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error('Paired comparison failed: invalid arguments, inputs, or audio provenance'); process.exitCode = 1; });
}
