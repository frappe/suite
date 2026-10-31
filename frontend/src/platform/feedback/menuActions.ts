import type { DropdownOption, DropdownOptions } from 'frappe-ui'
import { computed, getCurrentInstance } from 'vue'

/** Frappe UI menus discard callback promises, so their owner must report rejections. */
export function useMenuActions(options: () => DropdownOptions) {
  const instance = getCurrentInstance()

  function handle<T>(action: ((value: T) => void) | undefined) {
    if (!action) return undefined
    return async (value: T) => {
      try {
        await action(value)
      } catch (error) {
        const report = instance?.appContext.config.errorHandler
        if (report) report(error, instance?.proxy ?? null, 'menu action')
        else console.error(error)
      }
    }
  }

  function item(option: DropdownOption): DropdownOption {
    if (option.submenu) return { ...option, submenu: map(option.submenu) }
    if (option.switch) return { ...option, onClick: handle(option.onClick) }
    return { ...option, onClick: handle(option.onClick) }
  }

  function map(entries: DropdownOptions): DropdownOptions {
    return entries.map((entry) =>
      'group' in entry ? { ...entry, options: entry.options.map(item) } : item(entry),
    )
  }

  return computed(() => map(options()))
}
