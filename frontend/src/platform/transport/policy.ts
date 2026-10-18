import type { OwnerRegistration } from '@/platform/server-state'

import type { Operation } from './index'

export const mutationEffects = {
  temporary_password_post: { invalidates: ['account_get', 'users_get'] },
  mail_account_post: {
    invalidates: ['account_get', 'users_get', 'storage_get', 'mail.get_member'],
  },
  mail_account_delete: {
    invalidates: ['account_get', 'users_get', 'storage_get', 'mail.get_member'],
  },
  onboarding_post: { invalidates: ['account_get', 'onboarding_get', 'storage_get'] },
  user_transfer: {
    invalidates: ['storage_get', 'users_get', 'drive.node_children', 'drive.view_list'],
  },
  users_patch: { invalidates: ['users_get', 'storage_get', 'account_get'] },
  storage_refresh: { invalidates: ['storage_get'] },
  storage_limits: { invalidates: ['storage_get'] },
  storage_default: { invalidates: ['storage_get'] },
  storage_buffers: { invalidates: ['storage_get'] },
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
