import { describe, expect, it } from 'vitest'

import {
  resolveSettingsTab,
  visibleSettingsGroups,
  type SettingsGroup,
} from '@/shell/settings/settings'
import { openSettings, useSettingsGroups } from '@/shell/settings/useSettingsDialog'

const body = async () => ({})

function group(label: string, tabs: [id: string, shown?: boolean][], shown = true): SettingsGroup {
  return {
    label: () => label,
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
    group('Mail', [['mail.credentials']], false),
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

  it('takes only the tab ids of the composition list', () => {
    // Runs under the type check: each id below must stay a real tab id.
    const known = () => {
      openSettings('mail.screener')
      openSettings('drive.statistics')
      openSettings('workspace.users')
      // @ts-expect-error A misspelled tab id fails the type check.
      openSettings('mail.screner')
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
      return group('Mail', [['mail.credentials']])
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
