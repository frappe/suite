/** Verify publication, including silence, from actual outbound audio counters. */
export function verifyAudioPublication(before, after) {
  const counts = connection => (connection?.reports ?? [])
    .filter(report => report.type === 'outbound-rtp')
    .reduce((sum, report) => ({packets: sum.packets + (report.packetsSent ?? 0), bytes: sum.bytes + (report.bytesSent ?? 0)}), {packets:0,bytes:0});
  return (after?.connections ?? []).some((connection, index) => {
    if (connection.connectionState !== 'connected' || !connection.senders.some(track => track.enabled && track.readyState === 'live')) return false;
    const initial = counts(before?.connections?.[index]), final = counts(connection);
    return final.packets > initial.packets && final.bytes > initial.bytes;
  });
}
