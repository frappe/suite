// Elements sharing a key across slides get one reused node, which is what Magic Move tweens. A
// table keeps its own id so it cuts with the slide, refId or not. Any truthy refId is a key,
// numbers too, as converted presentations carry them
export function transitionKey(element: Record<string, unknown>) {
  return element.type == 'table' ? element.id : element.refId || element.id
}
