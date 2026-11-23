import { describe, expect, it } from 'vitest'

import { formatTimeLeft, TimeLeft } from './eta'

const MB = 1_000_000

/** Feeds one sample a second at `rate` bytes a second, each second jittered by `jitter`. */
function feed(
  estimate: TimeLeft,
  seconds: number,
  rate: number,
  jitter: (second: number) => number,
) {
  const texts: Array<string | null> = []
  let sent = 0
  for (let second = 0; second <= seconds; second++) {
    texts.push(estimate.update({ sent, total: 200 * MB, at: second * 1000 }))
    sent += rate * jitter(second)
  }
  return texts
}

describe('time left', () => {
  it('says nothing for the first 5 seconds', () => {
    const texts = feed(new TimeLeft('en'), 4, MB, () => 1)
    expect(texts.every((text) => text === null)).toBe(true)
  })

  it('a steady rate with ±30% jitter reads as a stable "About 3 minutes left"', () => {
    // 200 MB at 1 MB/s is 200 seconds: about 3 minutes once a few seconds have gone.
    const texts = feed(new TimeLeft('en'), 30, MB, (second) => 1 + 0.3 * Math.sin(second * 2))
    expect(texts.slice(6)).toEqual(Array(25).fill('About 3 minutes left'))
  })

  it('counts bytes that arrive one chunk at a time over the time the chunk took', () => {
    // 2 MB every 7 seconds, sampled each second: 53 MB left at about 0.29 MB/s.
    const estimate = new TimeLeft('en')
    let text: string | null = null
    for (let second = 0; second <= 14; second++)
      text = estimate.update({
        sent: Math.floor(second / 7) * 2 * MB,
        total: 57 * MB,
        at: second * 1000,
      })
    expect(text).toBe('About 3 minutes left')
  })

  it('hides the estimate after 30 seconds without progress', () => {
    const estimate = new TimeLeft('en')
    feed(estimate, 10, MB, () => 1)
    expect(estimate.update({ sent: 10 * MB, total: 200 * MB, at: 39_000 })).not.toBeNull()
    expect(estimate.update({ sent: 10 * MB, total: 200 * MB, at: 41_000 })).toBeNull()
  })

  it('files joining the run do not count as speed', () => {
    const estimate = new TimeLeft('en')
    feed(estimate, 10, MB, () => 1)
    // A resumed 100 MB file joins with 90 MB already sent.
    expect(estimate.update({ sent: 101 * MB, total: 300 * MB, at: 11_000 })).toBe(
      'About 3 minutes left',
    )
  })

  it('words minutes and hours in the given language', () => {
    expect(formatTimeLeft(30, 'en')).toBe('Less than a minute left')
    expect(formatTimeLeft(150, 'en')).toBe('About 3 minutes left')
    expect(formatTimeLeft(150, 'de')).toBe('About 3 Minuten left')
    expect(formatTimeLeft(2 * 3600 + 100, 'en')).toBe('About 2 hours left')
  })
})
