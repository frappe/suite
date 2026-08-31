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
})

function fail(type, msg) {
	throw new Error(`invalid ${type} command: ${msg}`)
}

const isPosInt    = n => Number.isInteger(n) && n >= 1
const isNonNegInt = n => Number.isInteger(n) && n >= 0

function reqSheet(t, p) {
	if (typeof p.sheet !== 'string' || p.sheet === '') fail(t, '"sheet" must be a non-empty sheet name')
}
function reqPosInt(t, p, key) {
	if (!isPosInt(p[key])) fail(t, `"${key}" must be an integer >= 1`)
}
function reqNonNegInt(t, p, key) {
	if (!isNonNegInt(p[key])) fail(t, `"${key}" must be an integer >= 0`)
}
function reqName(t, p, key = 'name') {
	if (typeof p[key] !== 'string' || p[key] === '') fail(t, `"${key}" must be a non-empty string`)
}
function reqSize(t, p, key) {
	if (typeof p[key] !== 'number' || !Number.isFinite(p[key]) || p[key] <= 0) {
		fail(t, `"${key}" must be a positive number`)
	}
}
function reqRange(t, p) {
	const r = p.range
	if (!r || typeof r !== 'object' || Array.isArray(r)) fail(t, '"range" must be an object { r1, c1, r2, c2 }')
	for (const k of ['r1', 'c1', 'r2', 'c2']) {
		if (!isPosInt(r[k])) fail(t, `range "${k}" must be an integer >= 1`)
	}
	if (r.r2 < r.r1 || r.c2 < r.c1) fail(t, 'range end must not precede range start')
}
function reqScope(t, p) {
	if (p.scope != null && (typeof p.scope !== 'string' || p.scope === '')) {
		fail(t, '"scope" must be a sheet name or null')
	}
}

// Payload validators. `style` in setRangeStyle is a map of IronCalc style
// paths to scalar values, matching updateRangeStyle(area, path, value) —
// e.g. { "font.b": true, "fill.color": "#FFEE00", "num_fmt": "0.00" }.
const validators = {
	setInput(t, p) {
		reqSheet(t, p); reqPosInt(t, p, 'row'); reqPosInt(t, p, 'col')
		if (typeof p.input !== 'string') fail(t, '"input" must be a string')
	},
	// width/height are the fixed dimensions of the (CSE-style) array result;
	// both default to 1. Dynamic-array spills use setInput instead.
	setArrayFormula(t, p) {
		reqSheet(t, p); reqPosInt(t, p, 'row'); reqPosInt(t, p, 'col')
		if (typeof p.input !== 'string') fail(t, '"input" must be a string')
		if (p.width !== undefined && !isPosInt(p.width)) fail(t, '"width" must be an integer >= 1')
		if (p.height !== undefined && !isPosInt(p.height)) fail(t, '"height" must be an integer >= 1')
	},
	clearContents(t, p) {
		reqSheet(t, p); reqRange(t, p)
	},
	setRangeStyle(t, p) {
		reqSheet(t, p); reqRange(t, p)
		const s = p.style
		if (!s || typeof s !== 'object' || Array.isArray(s)) fail(t, '"style" must be an object of style-path → value')
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
		if (p.c2 < p.c1) fail(t, '"c2" must not precede "c1"')
	},
	setRowsHeight(t, p) {
		reqSheet(t, p); reqPosInt(t, p, 'r1'); reqPosInt(t, p, 'r2'); reqSize(t, p, 'height')
		if (p.r2 < p.r1) fail(t, '"r2" must not precede "r1"')
	},
	insertRows(t, p)    { reqSheet(t, p); reqPosInt(t, p, 'row'); reqPosInt(t, p, 'count') },
	deleteRows(t, p)    { reqSheet(t, p); reqPosInt(t, p, 'row'); reqPosInt(t, p, 'count') },
	insertColumns(t, p) { reqSheet(t, p); reqPosInt(t, p, 'col'); reqPosInt(t, p, 'count') },
	deleteColumns(t, p) { reqSheet(t, p); reqPosInt(t, p, 'col'); reqPosInt(t, p, 'count') },
	moveRows(t, p) {
		reqSheet(t, p); reqPosInt(t, p, 'row'); reqPosInt(t, p, 'count')
		if (!Number.isInteger(p.delta) || p.delta === 0) fail(t, '"delta" must be a non-zero integer')
	},
	moveColumns(t, p) {
		reqSheet(t, p); reqPosInt(t, p, 'col'); reqPosInt(t, p, 'count')
		if (!Number.isInteger(p.delta) || p.delta === 0) fail(t, '"delta" must be a non-zero integer')
	},
	setFrozen(t, p) {
		reqSheet(t, p); reqNonNegInt(t, p, 'rows'); reqNonNegInt(t, p, 'cols')
	},
	addSheet(t, p) {
		if (p.name !== undefined) reqName(t, p)
	},
	deleteSheet(t, p)    { reqSheet(t, p) },
	renameSheet(t, p)    { reqSheet(t, p); reqName(t, p) },
	duplicateSheet(t, p) { reqSheet(t, p) },
	// scope is a sheet name for sheet-scoped names, or null/absent for
	// workbook-global names.
	setDefinedName(t, p) {
		reqName(t, p); reqName(t, p, 'formula'); reqScope(t, p)
	},
	deleteDefinedName(t, p) {
		reqName(t, p); reqScope(t, p)
	},
}

export function validateCommand(cmd, { inBatch = false } = {}) {
	if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd)) {
		throw new Error('invalid command: must be a plain object')
	}
	if (typeof cmd.id !== 'string' || cmd.id === '') throw new Error('invalid command: "id" must be a non-empty string')
	if (typeof cmd.actor !== 'string' || cmd.actor === '') throw new Error('invalid command: "actor" must be a non-empty string')
	if (typeof cmd.ts !== 'number' || !Number.isFinite(cmd.ts)) throw new Error('invalid command: "ts" must be a finite number')
	if (!Object.values(CommandTypes).includes(cmd.type)) throw new Error(`invalid command: unknown type "${cmd.type}"`)
	const p = cmd.payload
	if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error(`invalid ${cmd.type} command: "payload" must be a plain object`)

	if (cmd.type === CommandTypes.batch) {
		// Nested batches are rejected: pauseEvaluation/resumeEvaluation do not
		// nest, and a flat list keeps replay semantics obvious.
		if (inBatch) fail('batch', 'nested batch commands are not allowed')
		if (!Array.isArray(p.commands) || p.commands.length === 0) fail('batch', '"commands" must be a non-empty array')
		for (const sub of p.commands) validateCommand(sub, { inBatch: true })
		return cmd
	}
	validators[cmd.type](cmd.type, p)
	return cmd
}
