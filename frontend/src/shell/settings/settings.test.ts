import { describe, expect, it } from 'vitest'

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
      openSettings('drive.statistics')
      openSettings('account.profile')
      // @ts-expect-error A misspelled tab id fails the type check.
      openSettings('mail.inbx')
    }
    expect(known).toBeTypeOf('function')
  })
})

describe('loading the settings groups', () => {
  it('keeps a group that fails on a later open, and counts one that never loaded', async () => {
    let driveUp = true
    const account = async () => group('Account', [['account.profile']])
    const drive = async () => {
      if (!driveUp) throw new Error('chunk failed')
      return group('Drive', [['drive.statistics']])
    }
    let mailUp = false
    const mail = async () => {
      if (!mailUp) throw new Error('chunk failed')
      return group('Mail', [['mail.general']])
    }
    const { groups, failed, load } = useSettingsGroups([account, drive, mail])
    const labels = () => groups.value?.map((visible) => visible.label)

    await load()
    expect(labels()).toEqual(['Account', 'Drive'])
    expect(failed.value).toBe(1)

    driveUp = false
    mailUp = true
    await load()
    expect(labels()).toEqual(['Account', 'Drive', 'Mail'])
    expect(failed.value).toBe(0)
  })
})
