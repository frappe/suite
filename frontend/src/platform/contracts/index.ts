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

declare module 'vue-router' {
  interface RouteMeta {
    /** Rail context. Absent on frame `none`. */
    area?: string
    frame?: ShellFrame
    scroll?: ScrollOwner
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
