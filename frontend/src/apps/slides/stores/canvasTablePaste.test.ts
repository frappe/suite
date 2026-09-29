import { describe, it, expect, beforeEach, vi } from 'vitest'
import tinycolor from 'tinycolor2'

vi.mock('@/apps/slides/utils/mediaUploads', () => ({
	getAttachmentUrl: () => '',
	handleUploadedMedia: vi.fn(),
}))
vi.mock('@/apps/slides/router', () => ({ router: { replace: () => Promise.resolve() } }))

const { focusElementId } = await import('./element')
await import('@/apps/slides/composables/useTextEditor')
const { handlePaste } = await import('./copyPaste')
const { slides, slideIndex, slideBounds } = await import('./slide')
const { useCommandHistory } = await import('@/apps/slides/composables/useCommandHistory')
const { actionOrder, actions, setCommandHistory } = await import('./historyMeta')
const { getTableSize, getTableWidth } = await import('@/apps/slides/utils/tableWidths')

// the wrapper Sheets puts around every copied range
const inSheetsWrapper = (rows: string, colgroup = '') =>
	`<meta charset='utf-8'><google-sheets-html-origin>` +
	`<style type="text/css"><!--td {border: 1px solid #cccccc;}--></style>` +
	`<table style="font-size:10pt;font-family:Arial">${colgroup}<tbody>${rows}</tbody></table>`

const row = (...cells: string[]) => `<tr>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`

// A1:C2 exactly as Sheets put it on the clipboard: a filled A1, a bigger right-aligned
// B1, a coloured C1, A2:B2 merged, a two-line C2
const sheetsRange =
	`<meta charset='utf-8'><google-sheets-html-origin>` +
	`<style type="text/css"><!--td {border: 1px solid #cccccc;}br {mso-data-placement:same-cell;}--></style>` +
	`<table xmlns="http://www.w3.org/1999/xhtml" cellspacing="0" cellpadding="0" dir="ltr" border="1" ` +
	`style="table-layout:fixed;font-size:10pt;font-family:Arial;width:0px;border-collapse:collapse;border:none" ` +
	`data-sheets-root="1" data-sheets-baot="1">` +
	`<colgroup><col width="100"/><col width="100"/><col width="100"/></colgroup>` +
	`<tbody><tr style="height:21px;">` +
	`<td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;background-color:#fff2cc;">Apple</td>` +
	`<td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;font-size:14pt;text-align:right;">12</td>` +
	`<td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;color:#990000;">red</td>` +
	`</tr><tr style="height:21px;">` +
	`<td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;" rowspan="1" colspan="2">wide</td>` +
	`<td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;">line one <br/>line two</td>` +
	`</tr></tbody></table>`

const elements = () => slides.value[0].elements
let history: ReturnType<typeof useCommandHistory>

const paste = async (html: string) => {
	handlePaste({
		preventDefault: () => {},
		clipboardData: {
			getData: (type: string) =>
				type === 'text/html' ? html : type === 'text/plain' ? 'before\ta' : '',
		},
	})
	await vi.waitFor(() => expect(elements()).toHaveLength(1))
	return elements()[0]
}

// header cells are th, so they never read back
const readCells = (content: string) =>
	Array.from(new DOMParser().parseFromString(content, 'text/html').querySelectorAll('tr')).map(
		(tr) =>
			Array.from(tr.querySelectorAll('td')).map((cell) =>
				Array.from(cell.querySelectorAll('p')).map((p) => p.textContent!.replace(/\u200b/g, '')),
			),
	)

const readSpans = (content: string) =>
	Array.from(new DOMParser().parseFromString(content, 'text/html').querySelectorAll('td')).map(
		(cell) => `${cell.getAttribute('colspan')}x${cell.getAttribute('rowspan')}`,
	)

const readTds = (content: string) =>
	Array.from(new DOMParser().parseFromString(content, 'text/html').querySelectorAll('td'))

// the editor writes colours as rgb()
const hexOf = (color: string) => tinycolor(color).toHexString()
const textColorOf = (cell: HTMLTableCellElement) => hexOf(cell.querySelector('span')!.style.color)

beforeEach(() => {
	history = useCommandHistory(slides, { actionOrder, actions })
	setCommandHistory(history)
	slides.value = [{ clientId: 'c1', background: '#ffffff', elements: [] }] as any
	slideIndex.value = 0
	// a pasted text box opens for editing, and a paste then goes into it
	focusElementId.value = null
	Object.assign(slideBounds, { width: 960, height: 540, scale: 1 })
})

describe('pasting a spreadsheet range onto the canvas', () => {
	it('adds a table of the copied cells', async () => {
		const table = await paste(sheetsRange)

		expect(readCells(table.content)).toEqual([
			[['Apple'], ['12'], ['red']],
			[['wide'], ['line one', 'line two']],
		])
		expect(readSpans(table.content)).toEqual(['1x1', '1x1', '1x1', '2x1', '1x1'])
		expect(getTableSize(table.content)).toEqual({ rows: 2, columns: 3 })
		expect(getTableWidth(table.content)).toBe(table.width)

		await history.undo()
		expect(elements()).toHaveLength(0)
	})

	it('keeps the cell formatting', async () => {
		slides.value[0].background = '#000000'
		const table = await paste(sheetsRange)
		const [apple, qty, red, wide] = readTds(table.content)

		expect(hexOf(apple.style.backgroundColor)).toBe('#fff2cc')
		expect(textColorOf(apple)).toBe('#000000')
		expect(qty.querySelector('span')!.style.fontSize).toBe('25px')
		expect(qty.querySelector('p')!.style.textAlign).toBe('right')
		expect(textColorOf(red)).toBe('#990000')
		expect(textColorOf(wide)).toBe('#ffffff')
		// a merged cell holds the widths of both its columns
		expect(wide.getAttribute('colwidth')).toBe('150,150')
	})

	it('keeps the marks, a cell merged downwards and the column ratios', async () => {
		const table = await paste(
			inSheetsWrapper(
				`<tr><td rowspan="2" style="font-weight:bold">tall</td>` +
					`<td style="font-style:italic;text-decoration:underline line-through">marks</td></tr>` +
					`<tr><td>two  spaces</td></tr>`,
				`<colgroup><col width="100"/><col width="200"/></colgroup>`,
			),
		)
		const [tall, marks] = readTds(table.content)

		expect(readSpans(table.content)).toEqual(['1x2', '1x1', '1x1'])
		expect(readCells(table.content)[1]).toEqual([['two  spaces']])
		expect(tall.querySelector('strong')).not.toBeNull()
		expect(['em', 'u', 's'].map((tag) => marks.querySelector(tag))).not.toContain(null)
		// 300 total shared 1:2
		expect(tall.getAttribute('colwidth')).toBe('100')
		expect(marks.getAttribute('colwidth')).toBe('200')
	})

	it('keeps the text of a hostile cell and nothing else', async () => {
		const table = await paste(
			inSheetsWrapper(
				`<tr><td rowspan="3"><img src=x onerror="alert(1)">a<script>alert(1)</script></td>` +
					`<td>b</td></tr>`,
			),
		)

		expect(readCells(table.content)).toEqual([[['a'], ['b']]])
		expect(readSpans(table.content)).toEqual(['1x1', '1x1'])
		expect(table.content).not.toMatch(/onerror|<img|<script/)
	})

	it('trims the empty rows a whole-column copy brings along', async () => {
		const emptyTail = `<tr><td rowspan="500"></td><td></td></tr>` + row('').repeat(499)
		const table = await paste(inSheetsWrapper(row('a', 'b') + emptyTail))

		expect(readCells(table.content)).toEqual([[['a'], ['b']]])
		expect(readSpans(table.content)).toEqual(['1x1', '1x1'])
	})

	it.each([
		['a single cell', inSheetsWrapper(row('only'))],
		['a table with text around it', `<p>before</p>${inSheetsWrapper(row('a', 'b'))}`],
		[
			'a cell merged far past the limit',
			inSheetsWrapper(`<tr><td colspan="1000000">a</td><td>b</td></tr>`),
		],
		['more rows than the limit', inSheetsWrapper(row('a', 'b').repeat(51))],
	])('pastes %s as text', async (_, html) => {
		const element = await paste(html)

		expect(element.type).toBe('text')
		expect(element.content).toContain('before')
	})
})
