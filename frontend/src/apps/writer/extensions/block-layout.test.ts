import { generateJSON } from '@tiptap/core'
import { describe, expect, it } from 'vitest'

import { writerSchema } from '@/apps/writer/schema'

// The indent the editor reads from a pasted paragraph and heading with this left margin
function indentsOf(margin: string) {
  const style = `style="margin-left: ${margin}"`
  const json = generateJSON(`<p ${style}>one</p><h2 ${style}>Two</h2>`, writerSchema())
  return json.content?.map((block: { attrs?: { indent?: unknown } }) => block.attrs?.indent)
}

describe('BlockLayout', () => {
  it("reads an indent from a px margin with Drive's priority", () => {
    expect(indentsOf('24px !important')).toEqual([24, 24])
  })

  it.each(['24px', '2em', '18pt'])('reads no indent from a %s margin', (margin) => {
    expect(indentsOf(margin)).toEqual([null, null])
  })
})
