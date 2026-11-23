// non-reactive registry of editor-mode element DOM nodes keyed by element id
// replaces document.querySelector('[data-index="..."]') lookups, which scan
// the whole DOM and can collide with previews that render the same ids
const elementDivs = new Map()

const registerElementDiv = (id, el) => {
  if (el) elementDivs.set(id, el)
  else elementDivs.delete(id)
}

const getElementDiv = (id) => elementDivs.get(id) || null

export { registerElementDiv, getElementDiv }
