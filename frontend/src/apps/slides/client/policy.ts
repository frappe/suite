import type { OwnerRegistration } from '@/platform/server-state'

const effects = {
  save_slides: {
    invalidates: [
      'get_public_presentation',
      'get_composite_presentation',
      'composite_manifest',
      'composite_group',
      'drive.node_versions',
      'drive.view_list',
    ],
  },
  get_updated_json: 'none',
  update_slide_attachments: 'none',
} as const

export const registration: OwnerRegistration = {
  policy(reference) {
    if (reference.kind === 'query') return {}
    const effect = effects[reference.id as keyof typeof effects]
    if (!effect) throw new TypeError(`Missing slides effects: ${reference.id}`)
    return { effects: effect }
  },
}
