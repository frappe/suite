// Types for formula-autoclose.js, so strict TypeScript can import it.

/**
 * The next value and caret when `key` auto-closes a parenthesis in a formula
 * (`(` → `()`, `)` steps over, Backspace clears an empty pair); null when the
 * key should be left to the browser.
 */
export function autoCloseKey(
	key: string,
	value: string,
	selStart: number,
	selEnd: number,
): { value: string; caret: number } | null
