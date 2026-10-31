// Counters belong to Consumer instances. Recovery can replace one mid-window.
export function measureStream(samples, producerId) {
  let bytesDelta = 0,
    framesDelta = 0;
  for (let i = 1; i < samples.length; i++) {
    const current = samples[i].rows.find(
      (row) => row.producerId === producerId,
    );
    if (!current) continue;
    const previous = samples[i - 1].rows.find((row) => row.id === current.id);
    bytesDelta +=
      previous && current.bytes >= previous.bytes
        ? current.bytes - previous.bytes
        : current.bytes;
    framesDelta +=
      previous && current.frames >= previous.frames
        ? current.frames - previous.frames
        : current.frames;
  }
  return { bytesDelta, framesDelta };
}
