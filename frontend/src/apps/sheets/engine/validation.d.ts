// Types for validation.js, so strict TypeScript can import it.

export type RuleOperator = 'between' | 'not_between' | 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq'

/** A data-validation rule on one cell. */
export interface ValidationRule {
	type: 'list' | 'number' | 'text_length' | 'checkbox' | string
	/** list: the allowed values, in order. */
	options?: string[]
	/** list: a custom chip colour per option. */
	colors?: { [value: string]: string }
	operator?: RuleOperator
	min?: number
	max?: number
	message?: string
	/** 'reject' (default) blocks the edit; 'warn' lets it through. */
	severity?: 'reject' | 'warn'
}

export interface RuleResult {
	valid: boolean
	message?: string | null
	severity?: 'reject' | 'warn'
}

/** Is `value` allowed by `rule`? No rule allows anything. */
export function checkRule(rule: ValidationRule | null | undefined, value: unknown): RuleResult

export interface ValidationEngine {
	get(id: string, sheet?: string): ValidationRule | null
	set(id: string, rule: ValidationRule | null, sheet?: string): void
	clear(id: string, sheet?: string): void
	getAll(sheet?: string): { [id: string]: ValidationRule }
	validate(id: string, value: unknown, sheet?: string): RuleResult
	insertRow(atRow: number, sheet?: string): void
	deleteRow(atRow: number, sheet?: string): void
	insertCol(atCol: number, sheet?: string): void
	deleteCol(atCol: number, sheet?: string): void
	remapCols(mapCol: (c: number) => number | null | undefined, sheet?: string): void
	remapRows(mapRow: (r: number) => number | null | undefined, sheet?: string): void
	renameSheet(oldName: string, newName: string): void
	duplicateSheet(srcName: string, newName: string): void
	deleteSheet(name: string): void
	snapshot(): { [sheet: string]: { [id: string]: ValidationRule } }
	restore(snap: { [sheet: string]: { [id: string]: ValidationRule } }): void
}

export function createValidationEngine(): ValidationEngine
