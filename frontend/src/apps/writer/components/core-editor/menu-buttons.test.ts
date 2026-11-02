import { describe, expect, it } from 'vitest'
import { ref } from 'vue'

import { buildMenuButtons } from './menu-buttons'

describe('Writer toolbar', () => {
  it('has no Settings button while the document settings dialog is missing', () => {
    const labels = buildMenuButtons({
      editor: ref(null),
      settings: {},
      isPainting: ref(false),
    }).map((button: { label?: string }) => button.label)

    expect(labels).toContain('Custom spacing')
    expect(labels).not.toContain('Settings')
  })
})
