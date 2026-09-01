// Command schema (v1) for the sheets core adapter.
//
// Commands are plain JSON objects: { id, actor, ts, type, payload }.
// Rows and columns are 1-based to match IronCalc. Ranges are inclusive
// { r1, c1, r2, c2 }. This module is dependency-free so the same
// validation can run on the client and on the server.

export const CommandTypes = Object.freeze({
	setInput:          'setInput',
	setArrayFormula:   'setArrayFormula',
	clearContents:     'clearContents',
	setRangeStyle:     'setRangeStyle',
	setColumnsWidth:   'setColumnsWidth',
	setRowsHeight:     'setRowsHeight',
	insertRows:        'insertRows',
	deleteRows:        'deleteRows',
	insertColumns:     'insertColumns',
	deleteColumns:     'deleteColumns',
	moveRows:          'moveRows',
	moveColumns:       'moveColumns',
	setFrozen:         'setFrozen',
	addSheet:          'addSheet',
	deleteSheet:       'deleteSheet',
	renameSheet:       'renameSheet',
	duplicateSheet:    'duplicateSheet',
	setDefinedName:    'setDefinedName',
	deleteDefinedName: 'deleteDefinedName',
	batch:             'batch',
} as const)

export type CommandType = (typeof CommandTypes)[keyof typeof CommandTypes]

/** Inclusive, 1-based cell range. */
export interface CellRange {
	r1: number
	c1: number
	r2: number
	c2: number
}

/** Scalar accepted by IronCalc's `updateRangeStyle(area, path, value)`. */
export type StyleValue = string | number | boolean

/**
 * Map of IronCalc style paths to scalar values, e.g.
 * `{ "font.b": true, "fill.color": "#FFEE00", "num_fmt": "0.00" }`.
 */
export interface StylePatch {
	[path: string]: StyleValue
}

export interface SetInputPayload      { sheet: string; row: number; col: number; input: string }
// width/height are the fixed dimensions of the (CSE-style) array result;
// both default to 1. Dynamic-array spills use setInput instead.
export interface SetArrayFormulaPayload extends SetInputPayload { width?: number; height?: number }
export interface ClearContentsPayload  { sheet: string; range: CellRange }
export interface SetRangeStylePayload  { sheet: string; range: CellRange; style: StylePatch }
export interface SetColumnsWidthPayload { sheet: string; c1: number; c2: number; width: number }
export interface SetRowsHeightPayload  { sheet: string; r1: number; r2: number; height: number }
export interface RowSpanPayload        { sheet: string; row: number; count: number }
export interface ColumnSpanPayload     { sheet: string; col: number; count: number }
export interface MoveRowsPayload    extends RowSpanPayload    { delta: number }
export interface MoveColumnsPayload extends ColumnSpanPayload { delta: number }
export interface SetFrozenPayload      { sheet: string; rows: number; cols: number }
export interface AddSheetPayload       { name?: string }
export interface SheetRefPayload       { sheet: string }
export interface RenameSheetPayload    { sheet: string; name: string }
// scope is a sheet name for sheet-scoped names, or null/absent for
// workbook-global names.
export interface SetDefinedNamePayload    { name: string; formula: string; scope?: string | null }
export interface DeleteDefinedNamePayload { name: string; scope?: string | null }
export interface BatchPayload          { commands: NonBatchCommand[] }

interface Envelope<T extends CommandType, P> {
	id: string
	actor: string
	ts: number
	type: T
	payload: P
}

export type NonBatchCommand =
	| Envelope<'setInput',          SetInputPayload>
	| Envelope<'setArrayFormula',   SetArrayFormulaPayload>
	| Envelope<'clearContents',     ClearContentsPayload>
	| Envelope<'setRangeStyle',     SetRangeStylePayload>
	| Envelope<'setColumnsWidth',   SetColumnsWidthPayload>
	| Envelope<'setRowsHeight',     SetRowsHeightPayload>
	| Envelope<'insertRows',        RowSpanPayload>
	| Envelope<'deleteRows',        RowSpanPayload>
	| Envelope<'insertColumns',     ColumnSpanPayload>
	| Envelope<'deleteColumns',     ColumnSpanPayload>
	| Envelope<'moveRows',          MoveRowsPayload>
	| Envelope<'moveColumns',       MoveColumnsPayload>
	| Envelope<'setFrozen',         SetFrozenPayload>
	| Envelope<'addSheet',          AddSheetPayload>
	| Envelope<'deleteSheet',       SheetRefPayload>
	| Envelope<'renameSheet',       RenameSheetPayload>
	| Envelope<'duplicateSheet',    SheetRefPayload>
	| Envelope<'setDefinedName',    SetDefinedNamePayload>
	| Envelope<'deleteDefinedName', DeleteDefinedNamePayload>

export type BatchCommand = Envelope<'batch', BatchPayload>
export type Command = NonBatchCommand | BatchCommand

function fail(type: string, msg: string): never {
	throw new Error(`invalid ${type} command: ${msg}`)
}

const isPosInt    = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 1
const isNonNegInt = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0

// Single read boundary for unvalidated JSON. Reflect.get keeps the rest of
// this module free of open-record types; every caller narrows before use.
function prop(o: object, key: string): unknown {
	return Reflect.get(o, key)
}

function isPlainObject(v: unknown): v is object {
	return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function reqSheet(t: string, p: object): void {
	const v = prop(p, 'sheet')
	if (typeof v !== 'string' || v === '') fail(t, '"sheet" must be a non-empty sheet name')
}
function reqPosInt(t: string, p: object, key: string): void {
	if (!isPosInt(prop(p, key))) fail(t, `"${key}" must be an integer >= 1`)
}
function reqNonNegInt(t: string, p: object, key: string): void {
	if (!isNonNegInt(prop(p, key))) fail(t, `"${key}" must be an integer >= 0`)
}
function reqName(t: string, p: object, key = 'name'): void {
	const v = prop(p, key)
	if (typeof v !== 'string' || v === '') fail(t, `"${key}" must be a non-empty string`)
}
function reqSize(t: string, p: object, key: string): void {
	const v = prop(p, key)
	if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
		fail(t, `"${key}" must be a positive number`)
	}
}
function reqString(t: string, p: object, key: string): void {
	if (typeof prop(p, key) !== 'string') fail(t, `"${key}" must be a string`)
}
function optPosInt(t: string, p: object, key: string): void {
	const v = prop(p, key)
	if (v !== undefined && !isPosInt(v)) fail(t, `"${key}" must be an integer >= 1`)
}
function reqNonZeroInt(t: string, p: object, key: string): void {
	const v = prop(p, key)
	if (!Number.isInteger(v) || v === 0) fail(t, `"${key}" must be a non-zero integer`)
}
function reqOrder(t: string, p: object, lo: string, hi: string, msg: string): void {
	if ((prop(p, hi) as number) < (prop(p, lo) as number)) fail(t, msg)
}
function reqRange(t: string, p: object): void {
	const r = prop(p, 'range')
	if (!isPlainObject(r)) fail(t, '"range" must be an object { r1, c1, r2, c2 }')
	for (const k of ['r1', 'c1', 'r2', 'c2']) {
		if (!isPosInt(prop(r, k))) fail(t, `range "${k}" must be an integer >= 1`)
	}
	const r1 = prop(r, 'r1') as number, r2 = prop(r, 'r2') as number
	const c1 = prop(r, 'c1') as number, c2 = prop(r, 'c2') as number
	if (r2 < r1 || c2 < c1) fail(t, 'range end must not precede range start')
}
function reqScope(t: string, p: object): void {
	const v = prop(p, 'scope')
	if (v != null && (typeof v !== 'string' || v === '')) {
		fail(t, '"scope" must be a sheet name or null')
	}
}

type Validator = (t: string, p: object) => void

const validators: Readonly<Record<Exclude<CommandType, 'batch'>, Validator>> = {
	setInput(t, p) {
		reqSheet(t, p); reqPosInt(t, p, 'row'); reqPosInt(t, p, 'col'); reqString(t, p, 'input')
	},
	setArrayFormula(t, p) {
		reqSheet(t, p); reqPosInt(t, p, 'row'); reqPosInt(t, p, 'col'); reqString(t, p, 'input')
		optPosInt(t, p, 'width'); optPosInt(t, p, 'height')
	},
	clearContents(t, p) {
		reqSheet(t, p); reqRange(t, p)
	},
	setRangeStyle(t, p) {
		reqSheet(t, p); reqRange(t, p)
		const s = prop(p, 'style')
		if (!isPlainObject(s)) fail(t, '"style" must be an object of style-path → value')
		const entries = Object.entries(s)
		if (entries.length === 0) fail(t, '"style" must not be empty')
		for (const [path, value] of entries) {
			if (path === '') fail(t, 'style paths must be non-empty strings')
			if (!['string', 'number', 'boolean'].includes(typeof value)) {
				fail(t, `style value for "${path}" must be a string, number, or boolean`)
			}
		}
	},
	setColumnsWidth(t, p) {
		reqSheet(t, p); reqPosInt(t, p, 'c1'); reqPosInt(t, p, 'c2'); reqSize(t, p, 'width')
		reqOrder(t, p, 'c1', 'c2', '"c2" must not precede "c1"')
	},
	setRowsHeight(t, p) {
		reqSheet(t, p); reqPosInt(t, p, 'r1'); reqPosInt(t, p, 'r2'); reqSize(t, p, 'height')
		reqOrder(t, p, 'r1', 'r2', '"r2" must not precede "r1"')
	},
	insertRows(t, p)    { reqSheet(t, p); reqPosInt(t, p, 'row'); reqPosInt(t, p, 'count') },
	deleteRows(t, p)    { reqSheet(t, p); reqPosInt(t, p, 'row'); reqPosInt(t, p, 'count') },
	insertColumns(t, p) { reqSheet(t, p); reqPosInt(t, p, 'col'); reqPosInt(t, p, 'count') },
	deleteColumns(t, p) { reqSheet(t, p); reqPosInt(t, p, 'col'); reqPosInt(t, p, 'count') },
	moveRows(t, p) {
		reqSheet(t, p); reqPosInt(t, p, 'row'); reqPosInt(t, p, 'count'); reqNonZeroInt(t, p, 'delta')
	},
	moveColumns(t, p) {
		reqSheet(t, p); reqPosInt(t, p, 'col'); reqPosInt(t, p, 'count'); reqNonZeroInt(t, p, 'delta')
	},
	setFrozen(t, p) {
		reqSheet(t, p); reqNonNegInt(t, p, 'rows'); reqNonNegInt(t, p, 'cols')
	},
	addSheet(t, p) {
		if (prop(p, 'name') !== undefined) reqName(t, p)
	},
	deleteSheet(t, p)    { reqSheet(t, p) },
	renameSheet(t, p)    { reqSheet(t, p); reqName(t, p) },
	duplicateSheet(t, p) { reqSheet(t, p) },
	setDefinedName(t, p) {
		reqName(t, p); reqName(t, p, 'formula'); reqScope(t, p)
	},
	deleteDefinedName(t, p) {
		reqName(t, p); reqScope(t, p)
	},
}

function isCommandType(v: unknown): v is CommandType {
	return typeof v === 'string' && (Object.values(CommandTypes) as string[]).includes(v)
}

export interface ValidateOptions {
	inBatch?: boolean
}

export function validateCommand(cmd: unknown, { inBatch = false }: ValidateOptions = {}): Command {
	if (!isPlainObject(cmd)) {
		throw new Error('invalid command: must be a plain object')
	}
	const id = prop(cmd, 'id'), actor = prop(cmd, 'actor'), ts = prop(cmd, 'ts')
	const type = prop(cmd, 'type')
	if (typeof id !== 'string' || id === '') throw new Error('invalid command: "id" must be a non-empty string')
	if (typeof actor !== 'string' || actor === '') throw new Error('invalid command: "actor" must be a non-empty string')
	if (typeof ts !== 'number' || !Number.isFinite(ts)) throw new Error('invalid command: "ts" must be a finite number')
	if (!isCommandType(type)) throw new Error(`invalid command: unknown type "${String(type)}"`)
	const p = prop(cmd, 'payload')
	if (!isPlainObject(p)) throw new Error(`invalid ${type} command: "payload" must be a plain object`)

	if (type === CommandTypes.batch) {
		// Nested batches are rejected: pauseEvaluation/resumeEvaluation do not
		// nest, and a flat list keeps replay semantics obvious.
		if (inBatch) fail('batch', 'nested batch commands are not allowed')
		const subs = prop(p, 'commands')
		if (!Array.isArray(subs) || subs.length === 0) fail('batch', '"commands" must be a non-empty array')
		for (const sub of subs) validateCommand(sub, { inBatch: true })
		return cmd as BatchCommand
	}
	validators[type](type, p)
	return cmd as NonBatchCommand
}
