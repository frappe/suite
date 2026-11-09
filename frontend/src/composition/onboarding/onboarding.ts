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

/** Whether a person walks the site wizard: they may set the site up, and no one has yet. */
export function needsSiteSetup(site: { isOnboarded: boolean; canOnboard: boolean }): boolean {
  return site.canOnboard && !site.isOnboarded
}

/** Where creating an account stands. `signin-failed`: it exists, but signing in to it did not work. */
export type AccountSetupState = 'idle' | 'working' | 'failed' | 'ready' | 'signin-failed'

/** The account step's title and subtitle, which follow the setup. `inviter` is a name, or empty. */
export function accountHeading(
  state: AccountSetupState,
  inviter: string,
): { title: string; subtitle: string } {
  switch (state) {
    case 'idle':
      return { title: __('Create your account'), subtitle: __('Your name is what teammates see.') }
    case 'working':
      return { title: __('Setting up your account'), subtitle: __('This takes a few seconds.') }
    case 'failed':
      return {
        title: __("Setup didn't finish"),
        subtitle: inviter
          ? __('Nothing you entered is lost. Try again, or tell {0} if it keeps failing.', [
              firstName(inviter),
            ])
          : __('Nothing you entered is lost. Try again.'),
      }
    case 'ready':
      return { title: __('Your account is ready'), subtitle: __('One moment.') }
    case 'signin-failed':
      return { title: __('Your account is ready'), subtitle: __('Sign in to continue.') }
  }
}

export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? ''
}

/**
 * Whether a people-list row is someone the person works with: a user other than
 * themselves, and not Administrator, which is the site's recovery account.
 */
export function isTeammate<Row extends { kind: string; name: string }>(
  row: Row,
  self: string | undefined,
): row is Extract<Row, { kind: 'user' }> {
  return row.kind === 'user' && row.name !== self && row.name !== 'Administrator'
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
