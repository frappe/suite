import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

vi.mock('@/apps/slides/stores/saving', () => ({ markDirty: () => {} }))
vi.mock('@/apps/slides/stores/presentation', () => ({ slidesLength: ref(0) }))
vi.mock('@/apps/slides/utils/helpers', () => ({
	cloneObj: (obj: any) => JSON.parse(JSON.stringify(obj)),
}))

const { useCommandHistory } = await import('./useCommandHistory')
const { batchCommand, editElementCommand } = await import('@/apps/slides/stores/commands')

const COALESCE_WINDOW = 500

const actionOrder = {
	execute: { editElement: ['execute'], batch: ['execute'] },
	undo: { editElement: ['undo'], batch: ['undo'] },
}

const makeState = (overrides = {}) => [
	{
		clientId: 'c1',
		elements: [{ id: 1, type: 'text', content: 'a', locked: false, ...overrides }],
	},
]

const contentEdit = (oldValue: string, newValue: string, coalesceKey = 'content:c1:1') =>
	editElementCommand({
		slideId: 'c1',
		elementIds: [1],
		property: 'content',
		oldValue,
		newValue,
		coalesceKey,
	})

const keylessEdit = (oldValue: string, newValue: string) =>
	editElementCommand({
		slideId: 'c1',
		elementIds: [1],
		property: 'content',
		oldValue,
		newValue,
	})

const batchEdit = (edits: [string, string][]) =>
	batchCommand({
		slideId: 'c1',
		elementIds: [1, 2],
		coalesceKey: 'content:c1:1,2',
		commands: edits.map(([oldValue, newValue], i) =>
			editElementCommand({
				slideId: 'c1',
				elementIds: [i + 1],
				property: 'content',
				oldValue,
				newValue,
			}),
		),
	})

let state: any
let history: ReturnType<typeof useCommandHistory>

beforeEach(() => {
	vi.useFakeTimers()
	state = ref(makeState())
	history = useCommandHistory(state, { actionOrder, actions: {} })
})

afterEach(() => {
	vi.useRealTimers()
})

describe('record coalescing', () => {
	it('folds edits sharing a key inside the window into one undo step', async () => {
		history.record(contentEdit('a', 'ab'))
		vi.advanceTimersByTime(COALESCE_WINDOW - 1)
		history.record(contentEdit('ab', 'abc'))

		state.value[0].elements[0].content = 'abc'
		await history.undo()

		expect(state.value[0].elements[0].content).toBe('a')
		expect(history.canUndo.value).toBe(false)
	})

	it('starts a new step once the window has passed', async () => {
		history.record(contentEdit('a', 'ab'))
		vi.advanceTimersByTime(COALESCE_WINDOW + 1)
		history.record(contentEdit('ab', 'abc'))

		state.value[0].elements[0].content = 'abc'
		await history.undo()

		expect(state.value[0].elements[0].content).toBe('ab')
		expect(history.canUndo.value).toBe(true)
	})

	it('never folds key-less commands, which would match on undefined', async () => {
		history.record(keylessEdit('a', 'ab'))
		history.record(keylessEdit('ab', 'abc'))

		state.value[0].elements[0].content = 'abc'
		await history.undo()

		expect(state.value[0].elements[0].content).toBe('ab')
		expect(history.canUndo.value).toBe(true)
	})

	it('never folds across two different elements', async () => {
		history.record(contentEdit('a', 'ab', 'content:c1:1'))
		history.record(contentEdit('x', 'xy', 'content:c1:2'))

		expect(history.canUndo.value).toBe(true)
		await history.undo()
		expect(history.canUndo.value).toBe(true)
	})

	it('folds an IME run even when a candidate pause outlasts the window', async () => {
		history.record(contentEdit('a', 'ab'))
		vi.advanceTimersByTime(COALESCE_WINDOW * 4)
		history.record(contentEdit('ab', 'abc'), { forceCoalesce: true })

		state.value[0].elements[0].content = 'abc'
		await history.undo()

		expect(state.value[0].elements[0].content).toBe('a')
		expect(history.canUndo.value).toBe(false)
	})

	it('drops the step when typing lands back on the original value', () => {
		history.record(contentEdit('a', 'ab'))
		history.record(contentEdit('ab', 'a'))

		expect(history.canUndo.value).toBe(false)
	})

	it('keeps a batch whose lead lands back while another element changed', async () => {
		state.value[0].elements.push({ id: 2, type: 'text', content: 'x', locked: false })
		history.record(batchEdit([['a', 'ab'], ['x', 'xy']]))
		history.record(batchEdit([['ab', 'a'], ['xy', 'xyz']]))

		expect(history.canUndo.value).toBe(true)

		await history.undo()

		expect(state.value[0].elements[1].content).toBe('x')
	})

	it('drops a batch once every element lands back on its original value', () => {
		history.record(batchEdit([['a', 'ab'], ['x', 'xy']]))
		history.record(batchEdit([['ab', 'a'], ['xy', 'x']]))

		expect(history.canUndo.value).toBe(false)
	})

	it('starts a new entry when the next batch has fewer boxes', async () => {
		state.value[0].elements.push({ id: 2, type: 'text', content: 'x', locked: false })
		history.record(batchEdit([['a', 'ab'], ['x', 'xy']]))
		history.record(batchEdit([['ab', 'abc']]))

		await history.undo()

		expect(state.value[0].elements[0].content).toBe('ab')
		expect(history.canUndo.value).toBe(true)
	})

	it('does not fold the next edit into the burst before a dropped step', async () => {
		history.record(contentEdit('a', 'ab'))
		vi.advanceTimersByTime(COALESCE_WINDOW + 1)
		history.record(contentEdit('ab', 'abc'))
		history.record(contentEdit('abc', 'ab'))
		history.record(contentEdit('ab', 'abx'))

		state.value[0].elements[0].content = 'abx'
		await history.undo()

		expect(state.value[0].elements[0].content).toBe('ab')
		expect(history.canUndo.value).toBe(true)
	})

	it('never force-folds into the entry a dropped step exposed', async () => {
		history.record(contentEdit('a', 'ab'))
		await history.undo()
		await history.redo()

		history.record(contentEdit('ab', 'abc'), { forceCoalesce: true })
		history.record(contentEdit('abc', 'ab'), { forceCoalesce: true })
		history.record(contentEdit('ab', 'abx'), { forceCoalesce: true })

		state.value[0].elements[0].content = 'abx'
		await history.undo()

		expect(state.value[0].elements[0].content).toBe('ab')
		expect(history.canUndo.value).toBe(true)
	})

	it('does not fold the next edit into the step undo just restored', async () => {
		history.record(contentEdit('a', 'ab'))
		vi.advanceTimersByTime(COALESCE_WINDOW + 1)
		history.record(contentEdit('ab', 'abc'))

		state.value[0].elements[0].content = 'abc'
		await history.undo()

		history.record(contentEdit('ab', 'abx'))
		state.value[0].elements[0].content = 'abx'
		await history.undo()

		expect(state.value[0].elements[0].content).toBe('ab')
	})
})

describe('overlapping operations', () => {
	// deliberately awaits nothing: an action that suspends the sequence would let a
	// second undo interleave between this one's pop and its push
	it('applies a run of undos in press order without waiting on a navigating action', () => {
		const navigating = useCommandHistory(state, {
			actionOrder: {
				execute: { editElement: ['execute'] },
				undo: { editElement: ['jump', 'undo'] },
			},
			actions: { jump: () => new Promise<void>(() => {}) },
		})

		navigating.record(contentEdit('a', 'ab'))
		vi.advanceTimersByTime(COALESCE_WINDOW + 1)
		navigating.record(contentEdit('ab', 'abc'))
		state.value[0].elements[0].content = 'abc'

		navigating.undo()
		navigating.undo()

		expect(state.value[0].elements[0].content).toBe('a')

		navigating.redo()
		expect(state.value[0].elements[0].content).toBe('ab')
		navigating.redo()
		expect(state.value[0].elements[0].content).toBe('abc')
	})
})

describe('record bookkeeping', () => {
	it('discards the redo stack', async () => {
		history.record(contentEdit('a', 'ab'))
		await history.undo()
		expect(history.canRedo.value).toBe(true)

		history.record(contentEdit('a', 'ax'))

		expect(history.canRedo.value).toBe(false)
	})

	it('drops the oldest step once the stack is full', async () => {
		for (let i = 0; i < 205; i++) {
			history.record(contentEdit(`v${i}`, `v${i + 1}`, `content:c1:${i}`))
		}

		for (let i = 0; i < 200; i++) await history.undo()

		expect(history.canUndo.value).toBe(false)
		expect(state.value[0].elements[0].content).toBe('v5')
	})
})
