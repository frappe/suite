import type { SettingsSection, SettingsTab, VisibleSettingsGroup } from '@/shell/settings/settings'

interface FoundSettingsTab {
  readonly tab: SettingsTab
  /** The tab's sections the search names. None when nothing was searched for. */
  readonly sections: readonly SettingsSection[]
}

export interface FoundSettingsGroup {
  readonly label: string
  readonly tabs: readonly FoundSettingsTab[]
}

function wordsOf(text: string): string[] {
  return text.toLocaleLowerCase().split(/\s+/).filter(Boolean)
}

/** The texts as one, lowercased to be looked through. */
function searchable(...texts: Array<string | undefined>): string {
  return texts.join(' ').toLocaleLowerCase()
}

/** The tab, with the sections the words name, when the words find it. */
function findIn(
  group: VisibleSettingsGroup,
  tab: SettingsTab,
  words: readonly string[],
): FoundSettingsTab[] {
  const tabText = searchable(group.label, tab.label(), tab.description?.(), tab.keywords?.())
  const sections = (tab.sections ?? []).filter((section) => {
    const name = searchable(section.label(), section.keywords?.())
    const description = searchable(section.description?.())
    // A word the tab answers too, such as `'mail'`, is in many descriptions under it
    function isOwn(word: string) {
      return name.includes(word) || (description.includes(word) && !tabText.includes(word))
    }

    return words.some(isOwn) && words.every((word) => isOwn(word) || tabText.includes(word))
  })
  if (sections.length > 0 || words.every((word) => tabText.includes(word))) {
    return [{ tab, sections }]
  }

  return []
}

/**
 * The tabs and sections a search finds, in the order Settings lists them. Every word searched for
 * must be found, in any order, as part of a word: `'mail imp'` finds Mail's Import.
 *
 * A tab is found by its group's name, its own, its description and its keywords. A section is found
 * by those with its own label, description and keywords, and at least one word must be the section's
 * own: `'mail'` finds Mail's tabs, not every section under them that says mail in its description.
 * Nothing searched for finds every tab and no section.
 */
export function searchSettings(
  groups: readonly VisibleSettingsGroup[],
  query: string,
): FoundSettingsGroup[] {
  const words = wordsOf(query)
  return groups.flatMap((group) => {
    const tabs = group.tabs.flatMap((tab) => findIn(group, tab, words))
    if (tabs.length === 0) {
      return []
    }

    return [{ label: group.label, tabs }]
  })
}
