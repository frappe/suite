/**
 * The platform's area sidebar [T010]. Pages render `<AreaSidebar>`; the shell
 * renders `<AreaSidebarTarget>` once, in its desktop sidebar slot. Content in
 * the sidebar's body may render `<AreaSidebarFooter>` to sit below the body.
 */
export { accountSubmenu } from './accountSubmenu'
export { default as AreaSidebar } from './AreaSidebar.vue'
export { default as AreaSidebarFooter } from './AreaSidebarFooter.vue'
export { default as AreaSidebarTarget } from './AreaSidebarTarget.vue'
export {
  OPEN_AREA_SIDEBAR_EVENT,
  hasAreaSidebar,
  openAreaSidebar,
  type OpenAreaSidebarDetail,
} from './state'
