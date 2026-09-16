import type { Component } from 'vue'

export type SettingsTab = {
  label: string
  value: string
  icon?: Component | string
  component?: Component
  condition?: () => boolean
  props?: Record<string, unknown>
  listeners?: Record<string, (...args: any[]) => void>
}

export type SettingsGroup = {
  id: string
  label: string
  items: SettingsTab[]
  condition?: () => boolean
}
