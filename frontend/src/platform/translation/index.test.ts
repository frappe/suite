import { describe, expect, it } from 'vitest'

describe('translation', () => {
  it('uses context first and supports indexed and named replacements', async () => {
    window.translatedMessages = {
      Save: 'Guardar',
      'Save:Button': 'Guardar botón',
      'Hello {0}': 'Hola {0}',
      'Hello {name}': 'Hola {name}',
    }
    const { translate } = await import('./index')
    expect(translate('Save', undefined, 'Button')).toBe('Guardar botón')
    expect(translate('Hello {0}', ['Faris'])).toBe('Hola Faris')
    expect(translate('Hello {name}', { name: 'Faris' })).toBe('Hola Faris')
  })
})
