import type { OwnerRegistration } from '@/platform/server-state'

const effects = {
  save_ai_settings: { invalidates: ['get_ai_settings'] },
} as const

export const registration: OwnerRegistration = {
  policy(reference) {
    if (reference.kind === 'query') return {}
    const effect = effects[reference.id as keyof typeof effects]
    if (!effect) throw new TypeError(`Missing sheets effects: ${reference.id}`)
    return { effects: effect }
  },
}
