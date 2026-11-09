export function requireTestElement<T extends Element>(
  value: unknown,
  constructor: new (...args: never[]) => T,
): T {
  if (!(value instanceof constructor)) throw new Error(`Expected ${constructor.name}`)
  return value
}
