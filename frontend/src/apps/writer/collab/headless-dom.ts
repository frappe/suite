// Stands in for innerText only for frappe-ui's tag span, whose parse reads it and jsdom lacks it
export function addInnerText(window: { HTMLElement: typeof HTMLElement }) {
  const prototype = window.HTMLElement.prototype
  if ('innerText' in prototype) {
    return
  }

  Object.defineProperty(prototype, 'innerText', {
    configurable: true,
    get(this: HTMLElement) {
      return this.textContent ?? ''
    },
  })
}
