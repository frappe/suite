export function transitionKey(element: Record<string, unknown>) {
  return element.type == 'table' ? element.id : element.refId || element.id
}
