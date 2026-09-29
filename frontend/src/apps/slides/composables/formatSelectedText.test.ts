import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: () => '' }))
vi.mock('@/apps/slides/router', () => ({ router: { replace: () => Promise.resolve() } }))

const { DOMParser } = await import('@tiptap/pm/model')
const { Editor: HeadlessEditor } = await import('@tiptap/core')
const { slides, slideIndex } = await import('@/apps/slides/stores/slide')
const { activeElementIds, focusElementId } = await import('@/apps/slides/stores/element')
const historyMeta = await import('@/apps/slides/stores/historyMeta')
const { setCommandHistory } = historyMeta
const { useCommandHistory } = await import('./useCommandHistory')
const { useTextEditor } = await import('./useTextEditor')

const { activeEditor, editorStyles, formatSelectedText, toggleMark, updateProperty } =
	useTextEditor()

const actionOrder = {
	execute: { editElement: ['execute'], batch: ['execute'] },
	undo: { editElement: ['undo'], batch: ['undo'] },
}

let history: ReturnType<typeof useCommandHistory>

const frames: Array<() => void> = []
const nextFrame = () => frames.splice(0).forEach((frame) => frame())

// jsdom lays nothing out, so a measuring div is as wide as its font size times its text
const measuredWidth = function (this: HTMLElement) {
	const fontSize = Number(this.innerHTML.match(/font-size: (\d+)px/)?.[1] ?? 10)
	return { width: fontSize * (this.textContent?.length ?? 0), height: 0 } as DOMRect
}

const element = (id: string) => slides.value[0].elements.find((el: any) => el.id === id)

// the serialiser's own form, so a same-value click compares like for like
const line = (text: string, align = '') =>
	`<p style="${align && `text-align: ${align}; `}line-height: 1.5;">${text}</p>`

const sized = (px: number, text: string, align = '') =>
	line(`<span style="font-size: ${px}px;">${text}</span>`, align)

const table = (cell: string) =>
	`<table><tbody><tr><td><p>${cell}</p></td><td><p>${cell}</p></td></tr></tbody></table>`

const select = (...elements: Record<string, any>[]) => {
	const withDefaults = elements.map((el) => ({ type: 'text', left: 0, ...el }))
	slides.value = [{ clientId: 'c1', elements: withDefaults }]
	slideIndex.value = 0
	activeElementIds.value = elements.map((el) => el.id)
}

beforeEach(() => {
	vi.stubGlobal('requestAnimationFrame', (frame: () => void) => frames.push(frame))
	vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(measuredWidth)
	history = useCommandHistory(slides, { actionOrder, actions: {} })
	setCommandHistory(history)
})

afterEach(() => {
	nextFrame()
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
	activeEditor.value?.destroy()
	activeEditor.value = null
	focusElementId.value = null
	activeElementIds.value = []
	slides.value = []
})

describe('a style written to every selected box', () => {
	it('lands on both and shows in the panel', async () => {
		select({ id: 'a', content: sized(20, 'one') }, { id: 'b', content: sized(30, 'two') })

		formatSelectedText('fontSize', 40)
		await nextTick()

		expect(element('a').content).toContain('font-size: 40px')
		expect(element('b').content).toContain('font-size: 40px')
		expect(editorStyles.fontSize).toBe(40)
	})

	it('folds a scrub into one history entry', () => {
		select({ id: 'a', content: sized(20, 'one') }, { id: 'b', content: sized(30, 'two') })

		formatSelectedText('fontSize', 40)
		nextFrame()
		formatSelectedText('fontSize', 50)
		history.undo()

		expect(element('a').content).toBe(sized(20, 'one'))
		expect(element('b').content).toBe(sized(30, 'two'))
		expect(history.canUndo.value).toBe(false)
	})

	it('records nothing when every box already has the value', () => {
		select({ id: 'a', content: line('one', 'center') }, { id: 'b', content: line('two', 'center') })

		formatSelectedText('textAlign', 'center')

		expect(history.canUndo.value).toBe(false)
	})

	it('leaves a locked box alone', () => {
		select(
			{ id: 'a', content: sized(20, 'one') },
			{ id: 'b', content: sized(30, 'two'), locked: true },
		)

		formatSelectedText('fontSize', 40)

		expect(element('a').content).toContain('font-size: 40px')
		expect(element('b').content).toBe(sized(30, 'two'))
	})

	it('keeps a locked box selected, so a scrub past it is still one entry', async () => {
		history = useCommandHistory(slides, historyMeta)
		setCommandHistory(history)
		select(
			{ id: 'a', content: sized(20, 'one') },
			{ id: 'b', content: sized(30, 'two'), locked: true },
		)

		formatSelectedText('fontSize', 40)
		await nextTick()
		nextFrame()
		formatSelectedText('fontSize', 50)
		history.undo()

		expect(activeElementIds.value).toEqual(['a', 'b'])
		expect(element('a').content).toBe(sized(20, 'one'))
		expect(history.canUndo.value).toBe(false)
	})

	it('reaches every cell of a table without touching its width', () => {
		select(
			{ id: 'a', content: '<p>one</p>' },
			{ id: 't', type: 'table', content: table('x'), width: 300 },
		)

		formatSelectedText('color', 'rgb(1, 2, 3)')

		expect(element('a').content).toContain('color: rgb(1, 2, 3)')
		expect(element('t').content.match(/color: rgb\(1, 2, 3\)/g)).toHaveLength(2)
		expect(element('t').width).toBe(300)
	})
})

describe('the second step of a burst', () => {
	it('parses nothing and measures only the new text', () => {
		const centred = sized(20, 'one', 'center')
		select({ id: 'a', content: centred, left: 400 }, { id: 'b', content: centred, left: 400 })
		formatSelectedText('fontSize', 40)
		nextFrame()

		const parse = vi.spyOn(DOMParser.prototype, 'parse')
		const parseHTML = vi.spyOn(globalThis.DOMParser.prototype, 'parseFromString')
		const append = vi.spyOn(document.body, 'appendChild')
		formatSelectedText('fontSize', 50)

		expect(parse).not.toHaveBeenCalled()
		expect(parseHTML).not.toHaveBeenCalled()
		expect(append).toHaveBeenCalledTimes(2)
		expect(element('a').left).toBe(355)
	})

	it('neither serialises nor measures a box the step leaves as it is', () => {
		select(
			{ id: 'a', content: sized(20, 'one', 'center'), left: 400 },
			{ id: 'b', content: sized(50, 'two', 'center'), left: 400 },
		)
		formatSelectedText('fontSize', 50)
		nextFrame()

		const serialise = vi.spyOn(HeadlessEditor.prototype, 'getHTML')
		const append = vi.spyOn(document.body, 'appendChild')
		formatSelectedText('fontSize', 50)

		expect(serialise).not.toHaveBeenCalled()
		expect(append).not.toHaveBeenCalled()
		expect(element('a').content).toBe(sized(50, 'one', 'center'))
		expect(element('a').left).toBe(355)
	})
})

describe('a burst inside one frame', () => {
	it('writes the first value now and only the last at the frame', () => {
		select({ id: 'a', content: sized(20, 'one') }, { id: 'b', content: sized(20, 'two') })
		const execute = vi.spyOn(history, 'execute')

		formatSelectedText('fontSize', 40)
		formatSelectedText('fontSize', 50)
		formatSelectedText('fontSize', 60)
		expect(element('a').content).toContain('font-size: 40px')

		nextFrame()
		expect(element('a').content).toContain('font-size: 60px')
		expect(element('b').content).toContain('font-size: 60px')
		expect(execute).toHaveBeenCalledTimes(2)
	})
})

describe('what the panel shows for two boxes', () => {
	it('reads the first box once they are selected', async () => {
		select({ id: 'a', content: sized(25, 'one') }, { id: 'b', content: sized(30, 'two') })

		await nextTick()

		expect(editorStyles.fontSize).toBe(25)
	})

	it('skips a locked first box', async () => {
		select(
			{ id: 'a', content: sized(20, 'one'), locked: true },
			{ id: 'b', content: sized(30, 'two') },
		)

		await nextTick()

		expect(editorStyles.fontSize).toBe(30)
	})

	it('follows an undo', async () => {
		select({ id: 'a', content: sized(20, 'one') }, { id: 'b', content: sized(30, 'two') })

		formatSelectedText('fontSize', 40)
		history.undo()
		await nextTick()

		expect(editorStyles.fontSize).toBe(20)
	})
})

describe('a mark toggled across boxes', () => {
	const bold = line('<strong>one</strong>')
	const plain = line('two')

	it.each([
		['the plain box first', plain, bold],
		['the bold box first', bold, plain],
	])('marks every box before it unmarks any, with %s', async (_, first, second) => {
		select({ id: 'a', content: first }, { id: 'b', content: second })

		toggleMark('bold')
		await nextTick()
		expect(element('a').content).toContain('<strong>')
		expect(element('b').content).toContain('<strong>')
		expect(editorStyles.bold).toBe(true)

		toggleMark('bold')
		await nextTick()
		expect(element('a').content).not.toContain('<strong>')
		expect(element('b').content).not.toContain('<strong>')
		expect(editorStyles.bold).toBe(false)
	})

	it('undoes a quick double press back to the mixed start', () => {
		select({ id: 'a', content: plain }, { id: 'b', content: bold })

		toggleMark('bold')
		toggleMark('bold')
		history.undo()

		expect(element('a').content).toBe(plain)
		expect(element('b').content).toBe(bold)
		expect(history.canUndo.value).toBe(false)
	})
})

describe('opacity over a mixed selection', () => {
	it('marks the text box, sets the others as elements, and undoes all in one step', () => {
		select(
			{ id: 'a', content: line('one') },
			{ id: 'r', type: 'shape', opacity: 100 },
			{ id: 't', type: 'table', content: table('x') },
		)

		updateProperty('opacity', 50)
		expect(element('a').content).toContain('opacity: 0.5')
		expect(element('r').opacity).toBe(50)
		expect(element('t').opacity).toBe(50)
		expect(element('t').content).toBe(table('x'))

		history.undo()
		expect(element('a').content).toBe(line('one'))
		expect(element('r').opacity).toBe(100)
		expect(element('t').opacity).toBeUndefined()
		expect(history.canUndo.value).toBe(false)
	})
})

describe('the anchor of an auto-width box', () => {
	it('keeps a centred box centred when its text grows', () => {
		const content = '<p style="text-align: center"><span style="font-size: 20px">one</span></p>'
		select({ id: 'a', content, left: 400 }, { id: 'b', content, left: 100, width: 200 })

		formatSelectedText('fontSize', 40)

		expect(element('a').left).toBe(370)
		expect(element('b').left).toBe(100)
	})
})

describe('a box that still carries a legacy line height', () => {
	const legacy = { id: 'a', content: '<p>one</p>', editorMetadata: { lineHeight: 2 } }

	it('writes the legacy value and drops the marker in one step', () => {
		select(legacy, { id: 'b', content: '<p>two</p>' })

		formatSelectedText('fontSize', 40)

		expect(element('a').content).toContain('line-height: 2')
		expect(element('a').editorMetadata).toBeUndefined()
	})

	it('folds a second step and undoes back to the marker', () => {
		select(legacy, { id: 'b', content: '<p>two</p>' })

		formatSelectedText('fontSize', 40)
		nextFrame()
		formatSelectedText('fontSize', 50)
		history.undo()

		expect(element('a').content).toBe('<p>one</p>')
		expect(element('a').editorMetadata).toEqual({ lineHeight: 2 })
	})
})

// the scratch editor runs without ProseMirror plugins, so the cases a plugin could
// have carried on the live editor are proven here
describe('content the live editor leans on plugins for', () => {
	it('keeps an empty line between two styled lines styled, step after step', () => {
		const content = `${sized(20, 'one')}<p></p>${sized(20, 'two')}`
		select({ id: 'a', content }, { id: 'b', content })

		formatSelectedText('fontSize', 40)
		nextFrame()
		formatSelectedText('fontSize', 50)

		const lines = element('a').content.match(/<p[^>]*>.*?<\/p>/g)
		expect(lines).toHaveLength(3)
		expect(lines[1]).toContain('font-size: 50px')
	})

	it('gives a font family to cells holding only the placeholder', () => {
		select({ id: 't', type: 'table', content: table('​') }, { id: 'a', content: '<p>one</p>' })

		formatSelectedText('fontFamily', 'Lora')

		expect(element('t').content.match(/font-family: Lora/g)).toHaveLength(2)
	})

	it('wraps two boxes into a list and lifts them back', () => {
		select({ id: 'a', content: line('one') }, { id: 'b', content: line('two') })

		formatSelectedText('list', 'bullet')
		expect(element('a').content).toMatch(/^<ul>/)
		expect(element('b').content).toMatch(/^<ul>/)

		nextFrame()
		formatSelectedText('list', 'none')
		expect(element('a').content).toBe(line('one'))
		expect(element('b').content).toBe(line('two'))
	})
})
