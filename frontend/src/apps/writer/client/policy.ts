import type { OwnerRegistration } from '@/platform/server-state'

const effects = {
  document_settings: { invalidates: ['document', 'drive.node_versions', 'drive.view_list'] },
  convert_version: 'none',
} as const

export const registration: OwnerRegistration = {
  policy(reference) {
    if (reference.kind === 'query') return {}
    const effect = effects[reference.id as keyof typeof effects]
    if (!effect) throw new TypeError(`Missing writer effects: ${reference.id}`)
    return { effects: effect }
  },
}
