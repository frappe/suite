import type { OwnerRegistration } from '@/platform/server-state'

const effects = {
  apply_theme: {
    invalidates: ['get_public_presentation', 'drive.node_versions', 'drive.view_list'],
  },
  update_theme: {
    invalidates: ['get_public_presentation', 'drive.node_versions', 'drive.view_list'],
  },
  get_updated_json: 'none',
  update_slide_attachments: 'none',
  convert_version: 'none',
} as const

export const registration: OwnerRegistration = {
  policy(reference) {
    if (reference.kind === 'query') return {}
    const effect = Object.entries(effects).find(([id]) => id === reference.id)?.[1]
    if (!effect) throw new TypeError(`Missing slides effects: ${reference.id}`)
    return { effects: effect }
  },
}
