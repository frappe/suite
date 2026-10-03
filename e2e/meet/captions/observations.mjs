/** Aggregate rendered finals, retaining their first appearance for latency. */
export function predictionFromObservations(clip, result) {
  const finals = new Map();
  for (const line of result.observations) {
    if (!line.isFinal || !line.text.trim() || line.text === '...') continue;
    const prior = finals.get(line.captionId);
    finals.set(line.captionId, {...line, observedAt: prior?.observedAt ?? line.observedAt});
  }
  const ordered = [...finals.values()].sort((a, b) => a.observedAt - b.observedAt);
  const first = result.observations.find(line => line.text.trim() && line.text !== '...');
  const last = ordered.at(-1);
  const interimCaptionObservations = result.observations.filter(line => !line.isFinal && line.text.trim() && line.text !== '...').length;
  const expectSpeech = clip.expectSpeech !== false;
  return {
    id: clip.id,
    transcript: ordered.map(line => line.text).join(' '),
    speaker: ordered.length && ordered.every(line => line.participantName === clip.speaker)
      ? clip.speaker : ordered.find(line => line.participantName !== clip.speaker)?.participantName,
    firstTextSeconds: first ? Math.max(0, (first.observedAt - result.playbackStartedAt) / 1000) : undefined,
    finalAfterSpeechSeconds: last && clip.speechEndSeconds != null ? (last.observedAt - result.playbackStartedAt) / 1000 - clip.speechEndSeconds : undefined,
    finalAfterAudioSeconds: last && result.durationSeconds != null ? (last.observedAt - result.playbackStartedAt) / 1000 - result.durationSeconds : undefined,
    interimCaptionObservations, finalCaptionObservations: ordered.length,
    failed: expectSpeech ? ordered.length === 0 || result.unfinishedCaptionIds.length > 0 : interimCaptionObservations > 0 || ordered.length > 0,
  };
}
