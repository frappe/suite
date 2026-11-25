/**
 * A document's HTML as Markdown. The browser's download and the server's
 * Markdown read both come here, so they write the same Markdown.
 */
import TurndownService from 'turndown'

/**
 * A table as GitHub-flavoured Markdown: the first row is the heading row,
 * every other row a body row. Written for the editor's own tables, which
 * have one block per cell at most, so a cell's paragraphs are joined with
 * `<br>`; a cell that spans columns is followed by as many empty cells.
 */
function tableRule(turndown: TurndownService): void {
  const cells = (tr: HTMLTableRowElement): string[] =>
    [...tr.cells].flatMap((node) => {
      // The cell itself, not its HTML, which Turndown would parse again
      const text = turndown
        .turndown(node)
        .trim()
        .replace(/\n{2,}/g, '<br>')
        .replace(/\n/g, ' ')
      return [text.replace(/\|/g, '\\|'), ...Array<string>(Math.max(0, node.colSpan - 1)).fill('')]
    })
  const line = (row: string[]): string => `| ${row.join(' | ')} |`
  turndown.addRule('table', {
    filter: 'table',
    replacement: (_content, node) => {
      if (!(node instanceof HTMLTableElement)) return _content
      const rows = [...node.rows].map(cells)
      const heading = rows.shift()
      if (!heading) return ''
      const divider = heading.map(() => '---')
      return `\n\n${[heading, divider, ...rows].map(line).join('\n')}\n\n`
    },
  })
  // Cells are rendered by the table rule; keep their text out of the default output
  turndown.addRule('tableCell', {
    filter: ['th', 'td', 'tr', 'thead', 'tbody'],
    replacement: (content) => content,
  })
}

/** The Markdown of the parsed document under `body`. */
export function markdownOf(body: HTMLElement): string {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  })
  tableRule(turndown)
  return turndown.turndown(body)
}
