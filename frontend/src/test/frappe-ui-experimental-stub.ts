// The `frappe-ui` alias in vitest.config.ts also matches `frappe-ui/experimental`, which would
// resolve to a path under the recorder stub. Tests that mount components importing from it
// get this instead, and vi.mock('frappe-ui/experimental', ...) replaces it as needed.
import { defineComponent, h } from 'vue'

const stub = defineComponent({ render: () => h('div') })

export const TextEditor = stub
export const TextEditorFixedMenu = stub
