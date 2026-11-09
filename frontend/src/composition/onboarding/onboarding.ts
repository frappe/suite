/** Small pure helpers the setup wizard and the join flow share. */

/** Where the wizard's own domain stands; it shows Skip, Finish later or Continue from it. */
export type DomainState = 'idle' | 'pending' | 'verified'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DOMAIN = /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i

export function isEmail(value: string): boolean {
  return EMAIL.test(value.trim())
}

export function isDomain(value: string): boolean {
  return DOMAIN.test(value.trim())
}

/** A mailbox name suggested from a personal email: `Alice.B+x@gmail.com` gives `alice.bx`. */
export function mailboxName(email: string): string {
  return (email.split('@')[0] ?? '').toLowerCase().replace(/[^a-z0-9._-]/g, '')
}

export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? ''
}

export interface AccountName {
  first_name: string
  last_name: string
}

/** Splits a typed name into the first and last name the account takes. */
export function splitName(fullName: string): AccountName {
  const [first = '', ...rest] = fullName.trim().split(/\s+/)
  return { first_name: first, last_name: rest.join(' ') }
}

/** Whole days from `now` until `isoDate`, never below zero. */
export function daysUntil(isoDate: string, now: Date = new Date()): number {
  return Math.max(0, Math.ceil((new Date(isoDate).getTime() - now.getTime()) / 86_400_000))
}

export const IS_MAC =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)

/** The command key as people see it on their keyboard. */
export const MOD_KEY = IS_MAC ? '⌘' : 'Ctrl'

interface Option {
  value: string
}

export interface AccountDefaults {
  locale: string | null
  time_zone: string | null
}

/** The browser's language and time zone, when the mail provider offers them. */
export function browserAccountDefaults(options?: {
  locales: readonly Option[]
  time_zones: readonly Option[]
}): AccountDefaults {
  const languages = typeof navigator === 'undefined' ? [] : navigator.languages
  const locale = languages
    .map(
      (language) =>
        options?.locales.find((option) => option.value.toLowerCase() === language.toLowerCase())
          ?.value,
    )
    .find(Boolean)
  let zone: string | undefined
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    // Without an Intl time zone the server keeps the site default.
  }
  return {
    locale: locale ?? null,
    time_zone: options?.time_zones.find((option) => option.value === zone)?.value ?? null,
  }
}
