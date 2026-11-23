import type { DropdownGroupOption } from 'frappe-ui'
import { h } from 'vue'

import { rolesFor, type PrincipalKind } from '@/apps/drive/client/grants'
import { translate as __ } from '@/platform/translation'

/**
 * The roles a principal can hold on a node, as the first group of its role
 * menu (unified spec §7.5). The current role carries a check, which screen
 * readers hear as "Selected". Choosing another role calls `choose`.
 */
export function roleMenu(
  kind: PrincipalKind,
  nodeKind: string,
  current: number | null,
  choose: (role: number) => unknown,
): DropdownGroupOption {
  return {
    group: 'Role',
    hideLabel: true,
    options: rolesFor(kind, nodeKind).map((role) => {
      const isCurrent = role.value === current
      return {
        label: __(role.label),
        icon: isCurrent ? 'lucide-check' : null,
        slots: isCurrent
          ? { suffix: () => h('span', { class: 'sr-only' }, __('Selected')) }
          : undefined,
        onClick: () => void (isCurrent || choose(role.value)),
      }
    }),
  }
}
