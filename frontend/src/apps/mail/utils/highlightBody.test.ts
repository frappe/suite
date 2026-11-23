import { expect, it } from 'vitest'

import { highlightBody } from './highlightBody'

it("marks each word of the search in a body's text, not in its styles", () => {
  const doc = new DOMParser().parseFromString(
    '<p>The <b>Board</b> meets: board meeting<style>.board{}</style></p>',
    'text/html',
  )
  highlightBody(doc.body, 'board meeting')
  expect([...doc.querySelectorAll('mark')].map((mark) => mark.textContent)).toEqual([
    'Board',
    'board',
    'meeting',
  ])
  expect(doc.querySelector('style')?.textContent).toBe('.board{}')
  expect(doc.querySelector('p')?.textContent).toBe('The Board meets: board meeting.board{}')
})
