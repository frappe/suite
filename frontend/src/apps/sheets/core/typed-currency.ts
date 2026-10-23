// Typed ₹ and £ amounts. IronCalc reads `$1.50` and `€2` as numbers with a
// currency format, but no other symbol (its locales have no en-IN), so `₹2`
// stayed text and =A1*2 gave #VALUE!. The worker writes these as the `$`
// amount IronCalc understands, then swaps `$` for the real symbol in the
// format it set: `"₹"#,##0.00` paints ₹1,234.50 and formulas over it carry
// the ₹ along.

const AMOUNT = /^([-+]?)\s*([₹£])\s*(\d[\d,]*(?:\.\d+)?)$/

export interface TypedCurrency {
  /** The same amount with `$`, for IronCalc to parse. */
  input: string
  symbol: string
}

export function typedCurrency(input: string): TypedCurrency | null {
  const m = AMOUNT.exec(input.trim())
  if (!m) return null
  const [, sign = '', symbol = '', digits = ''] = m
  // Commas go: IronCalc rejects Indian grouping (1,50,000). It still sets a
  // grouped format, since that comes with the currency.
  return { input: `${sign}$${digits.replace(/,/g, '')}`, symbol }
}

/** IronCalc's `$` format with the typed symbol in its place. */
export function withSymbol(numFmt: string, symbol: string): string {
  return numFmt.replace(/\$/g, `"${symbol}"`)
}
