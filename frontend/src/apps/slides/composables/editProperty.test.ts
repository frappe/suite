import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: () => '' }))
vi.mock('@/apps/slides/router', () => ({ router: { replace: () => Promise.resolve() } }))

const { slides, slideIndex } = await import('@/apps/slides/stores/slide')
const { activeElementIds } = await import('@/apps/slides/stores/element')
const { dirty } = await import('@/apps/slides/stores/saving')
const { setCommandHistory } = await import('@/apps/slides/stores/historyMeta')
const { useCommandHistory } = await import('./useCommandHistory')
const { setElementProperty, useElementProperty } = await import('./editProperty')
const { setStrokeWidthInPlace } = await import('@/apps/slides/utils/shapeGeometry')

const actionOrder = {
	execute: { editElement: ['execute'], batch: ['execute'] },
	undo: { editElement: ['undo'], batch: ['undo'] },
}

let history: ReturnType<typeof useCommandHistory>
let executed: ReturnType<typeof vi.spyOn>

const element = (id: string) => slides.value[0].elements.find((el: any) => el.id === id)

const select = (elements: any[]) => {
	slides.value = [{ clientId: 'c1', elements }]
	slideIndex.value = 0
	activeElementIds.value = elements.map((el) => el.id)
}

const shapes = (overrides: any[] = [{}, {}]) =>
	overrides.map((o, i) => ({
		id: 'abc'[i],
		type: 'shape',
		fillColor: ['red', 'blue', 'green'][i],
		strokeStyle: 'solid',
		...o,
	}))

const pickFill = (color: string) => {
	const fill = useElementProperty('fillColor')
	fill.begin()
	fill.set(color)
	fill.commit()
}

beforeEach(() => {
	history = useCommandHistory(slides, { actionOrder, actions: {} })
	setCommandHistory(history)
	executed = vi.spyOn(history, 'execute')
	dirty.value = false
})

describe('editing a property over a selection', () => {
	it('writes every selected element and undoes each to its own value', () => {
		select(shapes())

		pickFill('white')

		expect(element('a').fillColor).toBe('white')
		expect(element('b').fillColor).toBe('white')
		expect(executed).toHaveBeenCalledTimes(1)
		expect(executed.mock.calls[0][0].jumpToElementIds).toEqual(['a', 'b'])

		history.undo()

		expect(element('a').fillColor).toBe('red')
		expect(element('b').fillColor).toBe('blue')
		expect(history.canUndo.value).toBe(false)
	})

	it('leaves a locked element alone and still records the rest', () => {
		select(shapes([{ locked: true }, {}]))

		pickFill('white')

		expect(element('a').fillColor).toBe('red')
		expect(element('b').fillColor).toBe('white')
		expect(history.canUndo.value).toBe(true)

		history.undo()

		expect(element('a').fillColor).toBe('red')
		expect(element('b').fillColor).toBe('blue')
	})

	it('records nothing when every element already has the value', () => {
		select(shapes([{ fillColor: 'white' }, { fillColor: 'white' }]))

		pickFill('white')

		expect(executed).not.toHaveBeenCalled()
		expect(history.canUndo.value).toBe(false)
		expect(dirty.value).toBe(false)
	})

	it('records a single selection as a bare edit', () => {
		select(shapes([{}]))

		pickFill('white')

		const command = executed.mock.calls[0][0]
		expect(command.key).toBe('editElement')
		expect(command.elementIds).toEqual(['a'])
	})

	it('commits coupled writes decided per element as one step', () => {
		select(shapes([{ shadowBlur: 10 }, {}]))

		const shadowColor = useElementProperty('shadowColor')
		shadowColor.begin(['shadowColor', 'shadowBlur'])
		shadowColor.setEach((el: any) => {
			el.shadowColor = 'black'
			if (!el.shadowBlur) el.shadowBlur = 4
		})
		shadowColor.commit()

		expect(element('a')).toMatchObject({ shadowColor: 'black', shadowBlur: 10 })
		expect(element('b')).toMatchObject({ shadowColor: 'black', shadowBlur: 4 })

		history.undo()

		expect(element('a')).toMatchObject({ shadowColor: undefined, shadowBlur: 10 })
		expect(element('b')).toMatchObject({ shadowColor: undefined, shadowBlur: undefined })
		expect(history.canUndo.value).toBe(false)
	})

	it('shifts a line but not a rectangle when the stroke width is dragged', () => {
		select([
			{ id: 'a', type: 'shape', shapeType: 'line', strokeWidth: 2, top: 100, height: 2 },
			{ id: 'b', type: 'shape', shapeType: 'rectangle', strokeWidth: 2, top: 100, height: 50 },
		])

		const strokeWidth = useElementProperty('strokeWidth')
		strokeWidth.begin(['strokeWidth', 'top', 'height'])
		strokeWidth.setEach((el: any) => setStrokeWidthInPlace(el, 4))
		strokeWidth.setEach((el: any) => setStrokeWidthInPlace(el, 6))
		strokeWidth.commit()

		expect(element('a')).toMatchObject({ strokeWidth: 6, top: 98, height: 6 })
		expect(element('b')).toMatchObject({ strokeWidth: 6, top: 100, height: 50 })
		expect(executed).toHaveBeenCalledTimes(1)

		history.undo()

		expect(element('a')).toMatchObject({ strokeWidth: 2, top: 100, height: 2 })
		expect(element('b')).toMatchObject({ strokeWidth: 2, top: 100, height: 50 })
	})

	it('sets a property directly on every element that differs', () => {
		select(shapes([{}, { strokeStyle: 'dashed' }]))

		setElementProperty('strokeStyle', 'dashed')

		expect(element('a').strokeStyle).toBe('dashed')
		expect(executed.mock.calls[0][0].commands).toHaveLength(1)

		history.undo()

		expect(element('a').strokeStyle).toBe('solid')
		expect(element('b').strokeStyle).toBe('dashed')
	})
})
