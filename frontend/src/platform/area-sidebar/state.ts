import { ref, type InjectionKey, type Ref } from 'vue'

import { isPhoneWidth } from '@/platform/phone-width'

/**
 * The window event that asks the active area's sidebar to open its phone
 * sheet. The shell's bottom nav and a page header both send it, so neither
 * imports the other [T015].
 */
export const OPEN_AREA_SIDEBAR_EVENT = 'suite:open-active-area-panel'

export interface OpenAreaSidebarDetail {
  area: string
}

/** The element id of the desktop slot that `<AreaSidebar>` teleports into. */
export const AREA_SIDEBAR_TARGET_ID = 'suite-area-sidebar'

/** The element that `<AreaSidebarFooter>` teleports into, below the body. */
export const AREA_SIDEBAR_FOOTER_KEY: InjectionKey<Readonly<Ref<HTMLElement | null>>> =
  Symbol('area-sidebar-footer')

/** The shell's phone layout: the same state as the shell's, so the two switch together. */
export const isPhone = isPhoneWidth

const mounted = ref<Readonly<Record<string, number>>>({})

export function openAreaSidebar(area: string): void {
  window.dispatchEvent(
    new CustomEvent<OpenAreaSidebarDetail>(OPEN_AREA_SIDEBAR_EVENT, { detail: { area } }),
  )
}

/** Whether a page of this area has an `<AreaSidebar>` on screen. */
export function hasAreaSidebar(area: string): boolean {
  return (mounted.value[area] ?? 0) > 0
}

export function trackAreaSidebar(area: string): () => void {
  mounted.value = { ...mounted.value, [area]: (mounted.value[area] ?? 0) + 1 }
  return () => {
    mounted.value = { ...mounted.value, [area]: Math.max(0, (mounted.value[area] ?? 0) - 1) }
  }
}
