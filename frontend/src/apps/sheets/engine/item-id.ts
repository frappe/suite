// Ids for items that several tabs can add to one sheet at the same moment
// (charts, pivots, conditional format rules, slicers). The collab doc keeps
// one key per item, so two items must never share an id. A counter can't
// promise that: every tab's counter starts from the same number.

const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** 10 random characters from [a-z0-9] (36^10 ≈ 3.7e15 values). */
export function newItemId(): string {
  let id = ''
  while (id.length < 10) {
    for (const b of crypto.getRandomValues(new Uint8Array(10))) {
      // 252 = 7 × 36: dropping bytes above it keeps every character equally likely.
      if (b < 252 && id.length < 10) id += ID_CHARS[b % ID_CHARS.length]
    }
  }
  return id
}

/** A random integer in [1, 2^48), for stores whose ids are numbers. */
export function newItemNumber(): number {
  const [hi = 0, lo = 0] = crypto.getRandomValues(new Uint32Array(2))
  return (hi & 0xffff) * 2 ** 32 + lo || 1
}
