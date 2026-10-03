// Fixture times are stored as they are sorted — '09:41' — but read as they are
// spoken. Any clock time inside the string is rewritten, which covers both a
// bare time and the full stamp a message header carries ('14 Aug 2026, 09:41').
// Strings that hold no time at all — 'Yesterday', 'Wed', '9 Aug' — come back
// untouched.
export function formatTime(value: string): string {
  return value.replace(/\b(\d{1,2}):(\d{2})\b/g, (_, rawHours: string, minutes: string) => {
    const hours = Number(rawHours)
    if (hours > 23) return `${rawHours}:${minutes}`
    const suffix = hours < 12 ? 'AM' : 'PM'
    return `${hours % 12 === 0 ? 12 : hours % 12}:${minutes} ${suffix}`
  })
}
