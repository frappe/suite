export type NewCardOption = 'a' | 'b' | 'c'
export type NewCardVariant = NewCardOption | 'current'

/** The New cards option to show: A wins over B over C, and with none on the current cards show. */
export function variantOf(flags: Readonly<Record<NewCardOption, boolean>>): NewCardVariant {
  if (flags.a) return 'a'
  if (flags.b) return 'b'
  if (flags.c) return 'c'
  return 'current'
}
