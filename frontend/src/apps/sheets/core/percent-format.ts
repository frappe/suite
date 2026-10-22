// The format a typed formula's result should take when it scales one percent
// cell by plain numbers: =A1*2, =2*A1, =A1/2, =($A$1*3)/4 over A1 = 50% show
// 100%, 100%, 25%, 38%, as in Google Sheets (ISSUES #34).
//
// IronCalc already gives a formula the format of its inputs (units.rs), but
// on purpose not here: a percent times an unformatted operand takes the
// operand's (no) format, so =A1*2 showed 1. This covers only that gap; every
// other formula, including a percent times another cell (=A1*A2: "50% of
// 200" is a number) or a percent below a division line (=2/A1), is left to
// IronCalc. Drop it once IronCalc handles the case upstream.

import { getTokens } from '@ironcalc/wasm'

interface RefToken {
  sheet?: string
  row: number
  column: number
}

/** The num_fmt of a cell, by sheet name (null = the formula's own sheet). */
export type NumFmtAt = (sheet: string | null, row: number, col: number) => string

/**
 * The percent num_fmt to give a formula's cell, or null to leave it alone.
 * `formula` is the input as typed, with its leading '='.
 */
export function percentFormatFor(formula: string, numFmtAt: NumFmtAt): string | null {
  // No * or /, nothing to scale: skips the tokenizer for most formulas.
  if (!formula.startsWith('=') || !/[*/]/.test(formula)) return null
  let tokens
  try {
    tokens = getTokens(formula.slice(1))
  } catch {
    return null
  }
  let ref: RefToken | null = null
  // The previous token, ignoring a unary minus: a reference or a '(' right
  // after '/' sits below the division line.
  let afterDivide = false
  // A minus is a sign only where an operand is due: at the start, after
  // '(' or after '*' / '/'.
  let operandDue = true
  for (const { token } of tokens) {
    if (token === 'LeftParenthesis') {
      if (afterDivide) return null
      operandDue = true
      continue
    }
    if (token === 'RightParenthesis') {
      operandDue = false
      continue
    }
    if (typeof token !== 'object' || token == null) return null
    const [kind, value] = Object.entries(token)[0] ?? []
    if (kind === 'Number') {
      afterDivide = false
      operandDue = false
    } else if (kind === 'Product') {
      afterDivide = value === 'Divide'
      operandDue = true
    } else if ((kind === 'Addition' || kind === 'Sum') && value === 'Minus' && operandDue) {
      // A sign (=A1*-2). A subtraction is IronCalc's call.
      continue
    } else if (kind === 'Reference') {
      if (ref || afterDivide) return null
      ref = value as RefToken
      operandDue = false
    } else {
      return null
    }
  }
  if (!ref) return null
  const fmt = numFmtAt(ref.sheet ?? null, ref.row, ref.column)
  return fmt.includes('%') ? fmt : null
}
