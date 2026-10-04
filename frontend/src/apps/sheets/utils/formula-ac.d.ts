// Types for formula-ac.js, so strict TypeScript (canvas/input/autocomplete.ts)
// can import it. Keep in step with the JS file.

/** Function name → its signature text, e.g. SUM → '(number1, [number2], ...)'. */
export const AC_FUNS: { readonly [name: string]: string }
/** AC_FUNS names, sorted. */
export const AC_FUN_KEYS: readonly string[]

/** The function/sheet name token ending at the caret in a formula, or null. */
export function parseAcToken(value: string, cursor: number): { tok: string; tokStart: number } | null

/** The innermost known function call around the caret, and which argument it is in. */
export function parseSignatureContext(value: string, cursor: number): { fn: string; argIndex: number } | null

/** True when the caret sits in an empty first argument of a SUM-style function. */
export function shouldSuggestRange(value: string, cursor: number): boolean

export function isNumericText(v: unknown): boolean

/** The run of ≥ 2 numeric cells directly above (else left of) (r, c), or null. */
export function detectAdjacentRange(
	r: number,
	c: number,
	isNumericAt: (r: number, c: number) => boolean,
): { r0: number; c0: number; r1: number; c1: number } | null

/** The function's parameter names, with the index of the one at argIndex. */
export function describeSignature(fn: string, argIndex: number): { params: string[]; active: number } | null
