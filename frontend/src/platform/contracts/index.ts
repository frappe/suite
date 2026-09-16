/**
 * Product-neutral contracts shared by composition, shell and product seams.
 * Types and injection keys only. Behavior lives in the owning module.
 * Sources: tickets 001 (route metadata), 002 (area definition), 009 (document type).
 */
import type { Component, InjectionKey } from 'vue'
import type { RouteRecordRaw } from 'vue-router'

export type PlatformCapability = 'jmap' | 'systemManager'

export type ShellFrame = 'area' | 'document' | 'none'
export type ScrollOwner = 'shell' | 'content'

declare module 'vue-router' {
  interface RouteMeta {
    /** Rail and contextual-panel context. Absent on frame `none`. */
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
  loadPanel: () => Promise<Component>
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
