import PrototypeShell from './components/shell/PrototypeShell.vue'
import MeetPlaceholder from './pages/MeetPlaceholder.vue'

export default [
  // Listed first: the shell's own catch-all below would otherwise read a
  // meeting code as an area.
  { path: '/meet/:code', component: MeetPlaceholder, props: true },
  // The landing route: the same shell with no area in the URL, which the nav
  // reads as Home. Being parameterless, it is also the one screen a blind
  // walk of the router can visit.
  { path: '/', component: PrototypeShell },
  { name: 'prototype-shell', path: '/:area?/:sub*', component: PrototypeShell },
]
