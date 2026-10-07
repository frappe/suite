import type { OwnerRegistration } from '@/platform/server-state'

import type { Operation } from './index'

export const mutationEffects = {
  'frappe.login': 'none',
  'frappe.logout': 'none',
  subscribe: 'none',
  unsubscribe: 'none',
  update_preferences: {
    invalidates: ['get_preferences', 'account_get', 'people_get', 'users_get'],
  },
  'frappe.user.switch_theme': { invalidates: ['get_preferences'] },
  'frappe.user.reset_password': 'none',
  'frappe.user.update_password': 'none',
  'site_patch.complete_onboarding': { invalidates: ['site_get', 'account_get'] },
  'site_patch.update_site_settings': { invalidates: ['site_get'] },
  'suite.generate_user_keys': { invalidates: ['drive.webdav_get'] },
  invitations_post: { invalidates: ['invitations_get', 'users_get', 'people_get'] },
} as const

export const registration: OwnerRegistration = {
  policy<I, O>(reference: Operation<I, O>) {
    if (reference.kind === 'query') return {}
    const effect = mutationEffects[reference.id as keyof typeof mutationEffects]
    if (!effect) throw new TypeError(`Missing Suite effects: ${reference.id}`)
    return { effects: effect }
  },
}
