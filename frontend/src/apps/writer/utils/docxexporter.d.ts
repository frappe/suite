interface AttrElement {
  getAttribute(name: string): string | null
}
interface RowElement {
  querySelectorAll(selector: string): ArrayLike<AttrElement>
}
interface ListLevel {
  level: number
  format: string
  text: string
  alignment: string
  style: {
    paragraph: { indent: { left: number; hanging: number }; spacing: { before: number; after: number } }
    run: { font: string; size: number }
  }
}
interface Spacing {
  before?: number
  after?: number
  line?: number
  lineRule?: string
}

export function cssColorToDocx(c: string | null | undefined): string | undefined
export function cssBackgroundToDocx(c: string | null | undefined): string | undefined
export function cssFontToDocx(f: string | null | undefined): string | undefined
export function pxToDocxSize(px: string | number | null | undefined): number | undefined
export function cssFontWeightToBold(weight: string | number | null | undefined): boolean
export function resolveAlignment(
  el: { style?: { textAlign?: string } } | null | undefined,
): string | undefined
export function clampSpan(v: string | number | null | undefined): number
export function resolveHref(href: string | null | undefined): string | null
export function fitImageSize(
  el: AttrElement,
  maxWidthPx: number,
): { width: number; height: number }
export function paragraphSpacing(
  el: { style?: { marginTop?: string; marginBottom?: string; lineHeight?: string } } | null | undefined,
  defaults: Spacing,
): Spacing & { lineRule: string }
export function buildListLevels(
  reference: string,
  kind: string,
  defaultFont: string,
): { reference: string; levels: ListLevel[] }
export function randomId(): string
export function countCols(tr: RowElement): number
export function computeColumnWidths(
  trs: ArrayLike<RowElement>,
  totalCols: number,
  tableWidthDxa: number,
): number[]

export function downloadDocxFromHtml(
  html: string,
  filename: string,
  settings?: Record<string, unknown>,
): Promise<void>

export function tableFromTABLE(tbl: HTMLTableElement, ctx: unknown): Promise<unknown>

declare const _default: typeof downloadDocxFromHtml
export default _default
