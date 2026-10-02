/**
 * Product-neutral contracts shared by composition, shell and product seams.
 * Types and injection keys only. Behavior lives in the owning module.
 * Sources: tickets 001 (route metadata), 002 (area definition), 009 (document type),
 * 010 (the frame set: in the shell or outside it).
 */
import type { Component, InjectionKey } from 'vue'
import type { RouteRecordRaw } from 'vue-router'

export type PlatformCapability = 'jmap' | 'systemManager'

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
 * `page`: the page applies the inset and draws its own tab bar, so the shell
 * does neither (Mail and Calendar, spec section 9.3).
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
    allowGuest?: boolean
    title?: string
    favicon?: string
  }
}

export interface AreaDefinition {
  id: string
  /** Translated label, evaluated at render time. */
  label: () => string
  icon: Component
  /** Canonical entry route, for example `/files`. */
  to: string
  loadRoutes: () => Promise<{ routes: RouteRecordRaw[] }>
  requires?: PlatformCapability[]
}

export interface DocumentTypeDefinition {
  /** Stable name for the type, for example `sheets`. */
  key: string
  /** Frappe content doctype this product renders, for example `Writer Document`. */
  contentDoctype: string
  /** Translated New-menu label, evaluated at render time. */
  newLabel: () => string
  icon: Component
  /** Lazy document surface. It receives the prop `session: DocumentSession`. */
  loadSurface: () => Promise<Component>
}

/**
 * Composition provides the ordered document registry at the app root.
 * Products inject it for their New menus without importing composition.
 */
export const DOCUMENT_TYPES_KEY: InjectionKey<readonly DocumentTypeDefinition[]> = Symbol('suite:document-types')

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
