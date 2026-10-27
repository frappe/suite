import type { Replacement } from './index'

export function format(message: string, replace?: Replacement): string {
  if (!replace || typeof replace !== 'object') return message
  return message.replace(/\{([^}]+)\}/g, (match, key: string) => {
    const value = Array.isArray(replace) ? replace[Number(key)] : replace[key]
    return value === undefined ? match : String(value)
  })
}
