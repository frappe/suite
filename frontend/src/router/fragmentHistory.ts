import type { RouterHistory } from 'vue-router'

/**
 * Account-scoped pages keep what is open in the URL's fragment, as Gmail does:
 *
 *   /mail/a/0/#inbox/<thread>    in the address bar
 *   /mail/a/0/inbox/<thread>     to the router
 *
 * and likewise /calendar/a/0/#week/2026/10/6.
 *
 * The router still matches plain paths, so routes, guards and params know
 * nothing of the fragment. The history is the one place a URL passes between
 * the router and the browser, and the two forms are swapped there.
 *
 * A space in the fragment is written `+` (#mailbox/Custom+Folder), and a query
 * stays inside it, after the page (#search?from=a@b.c). The plain path form is
 * still read, so /mail/a/0/inbox opens and is rewritten on arrival.
 */
export function withAccountFragments(history: RouterHistory, apps: string[]): RouterHistory {
  const { toAddress, fromAddress } = accountFragments(apps)
  return {
    base: history.base,
    get location() {
      return fromAddress(history.location)
    },
    get state() {
      return history.state
    },
    push: (to, data) => history.push(toAddress(to), data),
    replace: (to, data) => history.replace(toAddress(to), data),
    go: (delta, triggerListeners) => history.go(delta, triggerListeners),
    listen: (callback) =>
      history.listen((to, from, info) => callback(fromAddress(to), fromAddress(from), info)),
    createHref: (location) => history.createHref(toAddress(location)),
    destroy: () => history.destroy(),
  }
}

/** The two forms of a location under `/<app>/a/<number>/`, for the apps named. */
export function accountFragments(apps: string[]) {
  const account = `(/(?:${apps.join('|')})/a/\\d+)`
  const routed = new RegExp(`^${account}/([^?#]+)(\\?[^#]*)?(#.*)?$`)
  const address = new RegExp(`^${account}/?(\\?[^#]*)?#/*([^?]+)(\\?.*)?$`)

  return {
    toAddress: (location: string) =>
      location.replace(
        routed,
        (_, account: string, page: string, query = '') => `${account}/#${spacesAsPlus(page)}${query}`,
      ),
    fromAddress: (location: string) =>
      location.replace(
        address,
        (_, account: string, search = '', page: string, query = '') =>
          `${account}/${page.replace(/\+/g, '%20')}${joinQueries(search, query)}`,
      ),
  }
}

// A literal plus has to be escaped first, or it would read back as a space.
const spacesAsPlus = (page: string) => page.replace(/\+/g, '%2B').replace(/%20/g, '+')

/** A query ahead of the fragment (/mail/a/0/?compose=1#inbox) counts as much as one inside it. */
const joinQueries = (...queries: string[]) => {
  const query = queries
    .map((q) => q.slice(1))
    .filter(Boolean)
    .join('&')
  return query ? `?${query}` : ''
}
