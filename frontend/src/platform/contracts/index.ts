/**
 * Product-neutral contracts shared by composition, shell and product seams.
 * Types and injection keys only. Behavior lives in the owning module.
 * Sources: tickets 001 (route metadata), 002 (area definition), 009 (document type),
 * 010 (the frame set: in the shell or outside it).
 */
import type { Component, InjectionKey } from 'vue'
import type { RouteLocationRaw, RouteRecordRaw } from 'vue-router'

export type PlatformCapability = 'jmap' | 'systemManager' | 'suiteAdmin'

/**
 * `shell`: the route renders inside the shell, with the rail and one
 * full-height box. The page draws its own sidebar with `<AreaSidebar>`.
 * `none`: the route renders outside the shell.
 */
export type ShellFrame = 'shell' | 'none'
export type ScrollOwner = 'shell' | 'content'
/**
 * Who draws the phone chrome: the top safe-area inset and the bottom bar.
 * `shell`: the shell pads its header target and draws its bottom nav.
 * `page`: the page applies the inset and draws its own bottom bar, so the shell
 * does neither (Mail, spec section 9.3). A page may ask for the shell's chrome
 * back with `useShellPhoneChrome`.
 */
export type PhoneChromeOwner = 'shell' | 'page'

declare module 'vue-router' {
  interface RouteMeta {
    /** Rail context. Absent on frame `none`. */
    area?: string
    frame?: ShellFrame
    scroll?: ScrollOwner
    /** Absent reads as `shell`. */
    phoneChrome?: PhoneChromeOwner
    /**
     * A list that runs on under a floating phone bar, leaving room at its own end, where another
     * page stops short of the bar.
     */
    scrollsUnderPhoneBar?: boolean
    allowGuest?: boolean
    title?: string
    /**
     * Onboarding: the page runs its own steps, so the suite's command menu and
     * Settings stay closed. Its Cmd+K step opens a practice menu instead.
     */
    onboarding?: boolean
  }
}

/** What an area has waiting for the reader, drawn on its entry in the rail and the phone's menus. */
export interface AreaBadge {
  count: number
  /** None of it is the reader's alone to deal with, so it is drawn without the alarm of red. */
  quiet: boolean
  /** Where the count is, when it is spread over more than one place: each, with its share. */
  parts?: readonly { label: string; count: number }[]
}

interface AreaBase {
  id: string
  /** Translated label, evaluated at render time. */
  label: () => string
  icon: Component
  /** Canonical entry route, for example `/files`. */
  to: string
  loadRoutes: () => Promise<{ routes: RouteRecordRaw[] }>
  requires?: PlatformCapability[]
  /** What the rail's dot counts, in its tooltip ("3 unread"). Translated; "unread" when unset. */
  badgeNoun?: () => string
  /**
   * Installs on a phone as an app of its own, from its own pages: they link
   * the manifest in `public/pwa/<id>/`, scoped to `to` (ticket 047).
   */
  installable?: boolean
  /**
   * The area's own bottom bar on a phone, in place of the shell's, for an area
   * that is an app of its own there (ticket 047). It leads to the area's own
   * pages, its profile included, not to the shell's account sheet.
   */
  phoneNav?: Component
  /**
   * The area's own bottom bar floats over its pages, which run on under it to the foot of the
   * screen. The shell's offer to install floats with it then, a card at the foot of the screen, and
   * the bar stands on it through `--suite-phone-nav-height`.
   */
  phoneNavFloats?: boolean
}

/**
 * Where an area's entry sits. `rail` (the default) is the desktop rail and the
 * phone bottom nav. `workspace` areas open from the workspace menu, and
 * `account` areas from the account menu and the phone account sheet. A rail
 * area with `phonePlacement: 'account'` keeps its rail entry on desktop and is
 * a row in the phone account sheet instead of a bottom nav tab. Every area
 * stays in the command palette's app switcher and reachable by URL.
 */
export type AreaDefinition = AreaBase &
  (
    | { placement?: 'rail'; phonePlacement?: never; menuIcon?: never }
    | {
        placement?: 'rail'
        phonePlacement: 'account'
        /** Lucide class for the area's row in the phone account sheet. */
        menuIcon: string
      }
    | { placement: 'workspace'; phonePlacement?: never; menuIcon?: never }
    | {
        placement: 'account'
        phonePlacement?: never
        /** Lucide class for the area's row, so every account menu row has the same icon style. */
        menuIcon: string
      }
  )

/** An area whose entry is a row in the desktop account menu (and the phone account sheet). */
export type AccountArea = Extract<AreaDefinition, { placement: 'account' }>

/** An area with a row in the phone account sheet: an account area, or a rail area moved there on a phone. */
export type AccountSheetArea = Extract<AreaDefinition, { menuIcon: string }>

export interface DocumentTypeDefinition {
  /** Stable name for the type, for example `sheets`. */
  key: string
  /** Frappe content doctype this product renders, for example `Writer Document`. */
  contentDoctype: string
  /** Translated New-menu label, evaluated at render time. */
  newLabel: () => string
  icon: Component
  /**
   * Drive's New from template offers this type. Slides ships templates, and
   * Writer's came over from the old app. No other type has any.
   */
  hasTemplates?: boolean
  /** Lazy document surface. It receives the prop `session: DocumentSession`. */
  loadSurface: () => Promise<Component>
  /**
   * Lazy editor the host shows while a document just created opens, so typing
   * starts at once. It receives the prop `node`; the surface takes over what
   * was typed in it.
   */
  loadOpeningEditor?: () => Promise<Component>
  /** Lazy list of this type's work kept on this device that never reached the server. */
  loadUnsavedWork?: () => Promise<Component>
  /** Each such copy this device keeps, without loading the list. */
  listUnsavedCopies?: () => Promise<UnsavedCopy[]>
  /** Drops what this device keeps of the node, once the user lost access to it. */
  forgetNode?: (nodeId: string) => void
}

/** One copy of work kept on this device, by the document it belongs to. */
export interface UnsavedCopy {
  document: string
}

/**
 * Composition provides the ordered document registry at the app root.
 * Products inject it for their New menus without importing composition.
 */
export const DOCUMENT_TYPES_KEY: InjectionKey<readonly DocumentTypeDefinition[]> =
  Symbol('suite:document-types')

/**
 * What the guest frame offers the page inside it (spec §10.3, §10.8).
 *
 * A page that a visitor without a session cannot read asks the frame for the
 * Sign-in screen. The screen never says whether the item exists. The frame
 * shows the page again on the next navigation. Outside the guest frame
 * nothing provides it.
 */
export interface GuestFrame {
  requireSignIn(): void
}

export const GUEST_FRAME_KEY: InjectionKey<GuestFrame> = Symbol('suite:guest-frame')

/** One item a palette search found. */
export interface PaletteSearchResult {
  /** Unique among one search's results. */
  id: string
  title: string
  /** Icon classes for the row: the item's type icon and its ink. */
  icon: string
  /** Where the item is, such as its parent folder. */
  location?: string
  /** Where Enter opens the item. */
  to: RouteLocationRaw
}

/** A running palette search, as `PaletteSearchSource.use` returns it. */
export interface PaletteSearch {
  readonly results: readonly PaletteSearchResult[]
  readonly isFetching: boolean
  cancel(): void
}

/**
 * What the command palette searches on pages whose area has no search of its
 * own. Composition provides it at the app root; a product implements it.
 */
export interface PaletteSearchSource {
  /** Translated group label, evaluated at render time. */
  label: () => string
  /**
   * Call in the palette's setup. Searches while `term` returns a string and
   * stops while it returns `false`. The palette debounces the term.
   */
  use(term: () => string | false): PaletteSearch
}

export const PALETTE_SEARCH_KEY: InjectionKey<PaletteSearchSource> = Symbol('suite:palette-search')
