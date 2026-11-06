import { generateJSON } from '@tiptap/core'
import { Editor } from '@tiptap/vue-3'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: () => '' }))

const { extensions, oldBodyHTML } = await import('./tiptapSetup')

// What HTML coming in, pasted or converted, saves as
function marksOf(html: string) {
  const [paragraph] = generateJSON(html, extensions).content
  return paragraph.content[0].marks ?? []
}

describe('a weight coming in', () => {
  it.each(['700', 'bold'])('takes %s as bold and nothing else', (weight) => {
    const marks = marksOf(`<p><span style="font-weight: ${weight}">a</span></p>`)
    expect(marks).toContainEqual({ type: 'bold' })
    expect(
      marks.find(({ type }: { type: string }) => type === 'textStyle')?.attrs.fontWeight,
    ).toBeFalsy()
  })

  it.each(['500', '600', '900'])('keeps %s as that weight, not bold', (weight) => {
    const marks = marksOf(`<p><span style="font-weight: ${weight}">a</span></p>`)
    expect(marks).not.toContainEqual({ type: 'bold' })
    expect(marks).toContainEqual(
      expect.objectContaining({
        type: 'textStyle',
        attrs: expect.objectContaining({ fontWeight: weight }),
      }),
    )
  })

  it('keeps a weight when the text is copied back out', () => {
    const json = generateJSON('<p><span style="font-weight: 600">a</span></p>', extensions)
    const editor = new Editor({ extensions, content: json })
    expect(editor.getHTML()).toContain('font-weight: 600')
    editor.destroy()
  })

  it('takes 400 inside bold as plain text', () => {
    const marks = marksOf('<p><strong><span style="font-weight: 400">a</span></strong></p>')
    expect(marks).not.toContainEqual({ type: 'bold' })
    expect(
      marks.find(({ type }: { type: string }) => type === 'textStyle')?.attrs.fontWeight,
    ).toBeFalsy()
  })
})

describe('an old saved document', () => {
  it('draws without the weight the editor never read from it', () => {
    const marks = [{ type: 'textStyle', attrs: { fontWeight: '600', color: 'red' } }]
    const paragraph = { type: 'paragraph', content: [{ type: 'text', text: 'A', marks }] }
    const html = oldBodyHTML({ type: 'doc', content: [paragraph] })
    expect(html).not.toContain('font-weight')
    expect(html).toContain('color: red')
  })
})
