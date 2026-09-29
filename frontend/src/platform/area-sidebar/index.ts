/**
 * The platform's area sidebar [T010]. Pages render `<AreaSidebar>`; the shell
 * renders `<AreaSidebarTarget>` once, in its desktop sidebar slot.
 */
export { default as AreaSidebar } from './AreaSidebar.vue'
export { default as AreaSidebarTarget } from './AreaSidebarTarget.vue'
export {
  OPEN_AREA_SIDEBAR_EVENT,
  hasAreaSidebar,
  openAreaSidebar,
  type OpenAreaSidebarDetail,
} from './state'
