import type { SettingsGroup } from '@/components/settings/types'

export function getVisibleSettingsGroups(groups: SettingsGroup[]) {
  return groups
    .flatMap((group) =>
      !group.condition || group.condition()
        ? [
            {
              ...group,
              items: group.items.filter((tab) => !tab.condition || tab.condition()),
            },
          ]
        : [],
    )
    .filter((group) => group.items.length > 0)
}
