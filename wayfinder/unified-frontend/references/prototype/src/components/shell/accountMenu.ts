// The account menu, shared by the two places it can appear: the rail's footer
// while the rail is pinned, and the top bar while it is not. One array, so
// the two can never drift into offering different things.
export const ACCOUNT_OPTIONS = [
  { label: 'Settings', icon: 'lucide-user-round', onClick: () => {} },
  { label: 'Upgrade plan', icon: 'lucide-arrow-up-circle', onClick: () => {} },
  { label: 'Log out', icon: 'lucide-log-out', onClick: () => {} },
]
