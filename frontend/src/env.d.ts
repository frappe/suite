/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}

declare global {
  interface Window {
    csrf_token?: string
    site_name?: string
    socketio_port?: string | number
    sentry_dsn?: string
    sentry_environment?: string
    sentry_release?: string
    /** First-run onboarding gate flags (served by www/suite.py). */
    suite_is_onboarded?: boolean
    suite_can_onboard?: boolean
    /** Workspace branding for the launcher navbar (served by www/suite.py). */
    suite_workspace_name?: string
    suite_workspace_logo?: string
    /** Kill switch for the slides service worker (site config, served by www/suite.py). */
    disable_slides_service_worker?: boolean
    /** Frappe translation map (message -> translated); populated per-app. */
    translatedMessages?: Record<string, string>
    /** Global translate helper installed by the suite translation plugin. */
    __?: (message: string, replace?: Array<string | number>) => string
  }

  /** Bare `__('text')` available in templates via globalProperties. */
  const __: (message: string, replace?: Array<string | number>) => string

  /** Injected by Vite from sites/common_site_config.json. */
  const __SITE_NAME__: string

  /** Injected by Vite from sites/common_site_config.json. */
  const __SOCKETIO_PORT__: string | number
}

export {}
