import { openSettings } from '@/shell/settings/useSettingsDialog'

export function useSettingsMenuOption() {
  return {
    label: __('Settings'),
    icon: 'lucide-settings',
    onClick: () => openSettings(),
  }
}
