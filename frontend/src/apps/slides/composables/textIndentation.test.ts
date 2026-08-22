import { describe, it, expect, afterEach, vi } from 'vitest'
import { nextTick } from 'vue'

vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: () => '' }))
vi.mock('@/apps/slides/router', () => ({ router: { replace: () => Promise.resolve() } }))

const { slides, slideIndex } = await import('@/apps/slides/stores/slide')
const { focusElementId } = await import('@/apps/slides/stores/element')
const { useTextEditor } = await import('./useTextEditor')

const { activeEditor } = useTextEditor()

const indented = '<p>def foo():</p><p>    return 1</p>'
const indentedLine = '<p><span style="font-size: 20px">    b</span></p>'

const editText = async (content: string) => {
	slides.value = [{ clientId: 'c1', elements: [{ id: 't1', type: 'text', content }] }]
	slideIndex.value = 0
	focusElementId.value = 't1'
	await nextTick()
	await nextTick()
}

const lines = () => {
	const texts: string[] = []
	activeEditor.value.state.doc.descendants((node) => {
		if (node.type.name === 'paragraph') texts.push(node.textContent)
	})
	return texts
}

afterEach(() => {
	activeEditor.value?.destroy()
	activeEditor.value = null
	focusElementId.value = null
	slides.value = []
})

// prosemirror's default parse drops a line's leading spaces, so indentation only
// lasted until the element was read back into an editor
describe('indentation through a parse', () => {
	it('keeps the leading spaces of a line the editor opens on', async () => {
		await editText(indented)

		expect(lines()).toEqual(['def foo():', '    return 1'])
	})

	it('keeps them when history rewrites the content underneath the editor', async () => {
		await editText(indented)

		slides.value[0].elements[0].content = '<p>def foo():</p><p>    return 2</p>'
		await nextTick()

		expect(lines()).toEqual(['def foo():', '    return 2'])
	})

	it('writes them back out to the stored content', async () => {
		await editText(indented)

		expect(activeEditor.value.getHTML()).toContain('    return 1')
	})

	// a line left holding only its indent reads as empty to patchEmptyParagraphs, and
	// the placeholder it writes must not read back as a change and reset the editor
	it('holds the caret where it was when a line is erased down to its indent', async () => {
		await editText('<p><span style="font-size: 20px">a</span></p>' + indentedLine)

		activeEditor.value.commands.setTextSelection({ from: 8, to: 9 })
		activeEditor.value.commands.deleteSelection()
		await nextTick()

		expect(activeEditor.value.state.selection.from).toBe(8)
		expect(slides.value[0].elements[0].content).toContain('<span style="font-size: 20px;">')
	})

	// a cell's static render collapses whitespace the way the browser lays out any
	// table, so keeping it in the editor would draw the two differently
	it('leaves the whitespace in a table cell collapsed', async () => {
		slides.value = [
			{
				clientId: 'c1',
				elements: [
					{
						id: 't1',
						type: 'table',
						content: '<table><tbody><tr><td><p>    a  b</p></td></tr></tbody></table>',
					},
				],
			},
		] as any
		slideIndex.value = 0
		focusElementId.value = 't1'
		await nextTick()
		await nextTick()

		expect(lines()).toEqual(['a b'])
	})

	it('reads no line out of the gaps in indented html', async () => {
		await editText('<p>one</p>\n\t<p>two</p>\n')

		expect(lines()).toEqual(['one', 'two'])
	})
})
