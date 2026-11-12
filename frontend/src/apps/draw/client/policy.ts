import type { OwnerRegistration } from '@/platform/server-state'

export const registration: OwnerRegistration = {
  policy(reference) {
    if (reference.kind === 'query') return {}
    if (reference.id !== 'save_document')
      throw new TypeError(`Missing Draw effects: ${reference.id}`)
    return {
      effects: {
        invalidates: [
          'document',
          'drive.node_get',
          'drive.node_versions',
          'drive.view_list',
          'drive.node_children',
        ],
      },
    }
  },
}
