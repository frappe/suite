import type { InjectionKey, Ref } from 'vue'

/** Whether the document's side panel (Comments or Versions) is open, so the editor leaves room for it. */
export const SIDE_PANEL: InjectionKey<Ref<boolean>> = Symbol('writer side panel')
