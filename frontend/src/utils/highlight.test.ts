import { describe, expect, it } from 'vitest'

import { highlightDocument, highlightSegments } from './highlight'

describe('highlightSegments', () => {
  it('marks each word of the term, ignoring case', () => {
    expect(highlightSegments('Board Meeting: the board', 'board meeting')).toEqual([
      { text: 'Board', hit: true },
      { text: ' ', hit: false },
      { text: 'Meeting', hit: true },
      { text: ': the ', hit: false },
      { text: 'board', hit: true },
    ])
  })

  it('leaves the text whole when the term has no words', () => {
    expect(highlightSegments('Holi party', '  ')).toEqual([{ text: 'Holi party', hit: false }])
    expect(highlightSegments('', 'holi')).toEqual([])
  })

  it('takes the longer word where a shorter one is inside it', () => {
    expect(highlightSegments('meeting', 'meet meeting')).toEqual([{ text: 'meeting', hit: true }])
  })

  it('reads regex characters in the term as characters', () => {
    expect(highlightSegments('Q3 (draft)', '(draft)')).toEqual([
      { text: 'Q3 ', hit: false },
      { text: '(draft)', hit: true },
    ])
  })
})

describe('highlightDocument', () => {
  it("marks the term's words in a body's text, not in its styles", () => {
    const doc = new DOMParser().parseFromString(
      '<style>.board{}</style><p>The <b>board</b> meets: board meeting</p>',
      'text/html',
    )
    highlightDocument(doc.body, 'board')
    expect([...doc.querySelectorAll('mark')].map((mark) => mark.textContent)).toEqual([
      'board',
      'board',
    ])
    expect(doc.querySelector('style')?.textContent).toBe('.board{}')
    expect(doc.querySelector('p')?.textContent).toBe('The board meets: board meeting')
  })
})
