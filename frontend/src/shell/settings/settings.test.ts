import { describe, expect, it } from 'vitest'
import { ref } from 'vue'

import {
  resolveSettingsTab,
  visibleSettingsGroups,
  type SettingsGroup,
} from '@/shell/settings/settings'
import { openSettings, useSettingsGroups } from '@/shell/settings/useSettingsDialog'

const body = async () => ({})

function group(
  label: string,
  tabs: [id: string, shown?: boolean][],
  shown = true,
  area?: string,
): SettingsGroup {
  return {
    label: () => label,
    area,
    condition: () => shown,
    tabs: tabs.map(([id, tabShown = true]) => ({
      id,
      label: () => id,
      icon: 'lucide-circle',
      condition: () => tabShown,
      body,
    })),
  }
}

describe('settings groups', () => {
  const groups = visibleSettingsGroups([
    group('Account', [['account.profile'], ['account.preferences']]),
    group('Drive', [['drive.statistics'], ['drive.external-access', false]]),
    group('Mail', [['mail.general']], false),
    group('Chat', [['chat.layout', false]]),
    group('Workspace', [['workspace.general'], ['workspace.users']]),
  ])

  it('keeps heading order and drops hidden groups, hidden tabs, and groups left empty', () => {
    expect(groups.map((visible) => [visible.label, visible.tabs.map((tab) => tab.id)])).toEqual([
      ['Account', ['account.profile', 'account.preferences']],
      ['Drive', ['drive.statistics']],
      ['Workspace', ['workspace.general', 'workspace.users']],
    ])
  })

  it('leaves a tab that is not for a phone out of a phone, and keeps it on a computer', () => {
    const mail: SettingsGroup = {
      label: () => 'Mail',
      tabs: [
        { id: 'mail.general', label: () => 'General', icon: 'lucide-circle', body },
        {
          id: 'mail.import-export',
          label: () => 'Import',
          icon: 'lucide-circle',
          body,
          onPhone: false,
        },
      ],
    }
    const ids = (phone: boolean) =>
      visibleSettingsGroups([mail], { phone }).flatMap((g) => g.tabs.map((tab) => tab.id))

    expect(ids(true)).toEqual(['mail.general'])
    expect(ids(false)).toEqual(['mail.general', 'mail.import-export'])
  })

  it('opens the requested tab when the user may see it, else the first tab', () => {
    expect(resolveSettingsTab(groups, 'workspace.users')).toBe('workspace.users')
    expect(resolveSettingsTab(groups, 'drive.external-access')).toBe('account.profile')
    expect(resolveSettingsTab(groups, undefined)).toBe('account.profile')
    expect(resolveSettingsTab([], 'account.profile')).toBeUndefined()
  })

  it('opens on the settings of the app on screen when no tab is asked for', () => {
    const suite = visibleSettingsGroups([
      group('Account', [['account.profile']]),
      group('Drive', [['drive.statistics']], true, 'files'),
      group('Mail', [['mail.general'], ['mail.inbox']], true, 'mail'),
      group('Calendar', [['calendar.calendars']], false, 'calendar'),
    ])
    expect(resolveSettingsTab(suite, undefined, 'mail')).toBe('mail.general')
    expect(resolveSettingsTab(suite, undefined, 'files')).toBe('drive.statistics')
    // A tab asked for by name wins over where the user is
    expect(resolveSettingsTab(suite, 'account.profile', 'mail')).toBe('account.profile')
    // An app with no settings, or whose settings the user may not see
    expect(resolveSettingsTab(suite, undefined, 'people')).toBe('account.profile')
    expect(resolveSettingsTab(suite, undefined, 'calendar')).toBe('account.profile')
  })

  it('takes only the tab ids of the composition list', () => {
    // Runs under the type check: each id below must stay a real tab id.
    const known = () => {
      openSettings('mail.inbox')
      openSettings('account.storage')
      openSettings('account.profile')
      // @ts-expect-error A misspelled tab id fails the type check.
      openSettings('mail.inbx')
    }
    expect(known).toBeTypeOf('function')
  })
})

describe('the settings groups', () => {
  it('are there without a wait, and show a tab once the answer it waits on arrives', () => {
    const webdavOn = ref(false)
    const drive: SettingsGroup = {
      ...group('Drive', [['drive.statistics']]),
      tabs: [
        ...group('Drive', [['drive.statistics']]).tabs,
        {
          id: 'drive.external-access',
          label: () => 'External access',
          icon: '',
          body,
          condition: () => webdavOn.value,
        },
      ],
    }
    const { groups } = useSettingsGroups([group('Account', [['account.profile']]), drive])
    const ids = () => groups.value.flatMap((visible) => visible.tabs.map((tab) => tab.id))

    expect(ids()).toEqual(['account.profile', 'drive.statistics'])
    webdavOn.value = true
    expect(ids()).toEqual(['account.profile', 'drive.statistics', 'drive.external-access'])
  })
})
