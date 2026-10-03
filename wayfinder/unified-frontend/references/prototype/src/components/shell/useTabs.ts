// Browser-style tabs for the shell.
//
// The strip owns which tabs exist; the route owns where the active one points.
// So a tab is just a remembered location the router can be sent back to, and
// navigating inside an app — opening a mailbox, descending a folder — sticks
// to the tab it happened in.
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import { ALL_APPS, type AreaId } from './fixtures'
import { useShellNav } from './useShellNav'

export interface ShellTab {
  id: string
  area: AreaId
  sub: string[]
}

let seq = 0

function makeTab(area: AreaId = 'home', sub: string[] = []): ShellTab {
  seq += 1
  return { id: `tab-${seq}`, area, sub }
}

export const tabs = ref<ShellTab[]>([makeTab('home')])
export const activeTabId = ref(tabs.value[0].id)

/** The tab strip's + opens a picker rather than guessing at an app. */
export const newTabOpen = ref(false)

/** A tab wears its app's name and icon; an open document is its own kind. */
export function tabMeta(tab: ShellTab) {
  if (tab.area === 'doc') return { label: 'Document', icon: 'lucide-file-text' }
  const app = ALL_APPS.find((item) => item.id === tab.area)
  return { label: app?.label ?? 'Home', icon: app?.icon ?? 'lucide-home' }
}

export function useTabRouting() {
  const router = useRouter()
  const { area, segments } = useShellNav()

  // The route is the truth for where the active tab is standing.
  watch(
    [area, segments],
    () => {
      const tab = tabs.value.find((item) => item.id === activeTabId.value)
      if (!tab) return
      tab.area = area.value
      tab.sub = [...segments.value]
    },
    { immediate: true },
  )

  function goToTab(tab: ShellTab) {
    activeTabId.value = tab.id
    router.push({ name: 'prototype-shell', params: { area: tab.area, sub: tab.sub } })
  }

  function selectTab(id: string) {
    const tab = tabs.value.find((item) => item.id === id)
    if (tab) goToTab(tab)
  }

  /** A pinned app focuses the tab it is already open in, the way a browser does. */
  function openApp(target: AreaId) {
    const open = tabs.value.find((item) => item.area === target)
    if (open) {
      goToTab(open)
      return
    }
    const tab = makeTab(target)
    tabs.value.push(tab)
    goToTab(tab)
  }

  /**
   * The + flow. Always a new tab, even when that app is already open
   * somewhere: asking for a new tab and being sent to an old one is the one
   * thing a tab strip must not do.
   */
  function openInNewTab(target: AreaId) {
    const tab = makeTab(target)
    tabs.value.push(tab)
    goToTab(tab)
  }

  function closeTab(id: string) {
    const index = tabs.value.findIndex((item) => item.id === id)
    if (index === -1) return
    tabs.value.splice(index, 1)

    // The shell has nowhere to render without a tab, so the strip is never empty.
    if (!tabs.value.length) tabs.value.push(makeTab('home'))
    if (activeTabId.value === id) {
      goToTab(tabs.value[Math.min(index, tabs.value.length - 1)])
    }
  }

  return { selectTab, openApp, openInNewTab, closeTab }
}
