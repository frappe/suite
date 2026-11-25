/** A body's text, a line for each line it shows: blocks and breaks end lines, blank ones collapse. */
const linesOf = (html: string) => {
  const element = document.createElement('div')
  element.innerHTML = html
  for (const br of element.querySelectorAll('br')) br.replaceWith('\n')
  for (const block of element.querySelectorAll('p, div, li, h1, h2, h3, blockquote'))
    block.append('\n')
  return (element.textContent ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

/**
 * What a draft says so far, as the thread shows it on its card: its own words, without the blank
 * lines a reply opens with or the signature added under them. Empty when only the signature is
 * there.
 */
export const writtenText = (html = '', signature = '') => {
  const lines = linesOf(html)
  const signed = linesOf(signature)
  const ends = signed.length && signed.every((line, i) => lines.at(i - signed.length) === line)
  return (ends ? lines.slice(0, -signed.length) : lines).join('\n')
}
