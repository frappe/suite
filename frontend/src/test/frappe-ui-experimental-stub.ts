// The `frappe-ui` alias in vitest.config.ts also matches `frappe-ui/experimental`, which would
// resolve to a path under the recorder stub. Tests that mount components importing from it
// get this instead, and vi.mock('frappe-ui/experimental', ...) replaces it as needed.
// The palette family is the real one: a palette test drives its listbox, which a stub cannot.
export * from '../../../node_modules/frappe-ui/experimental/CommandPalette'
