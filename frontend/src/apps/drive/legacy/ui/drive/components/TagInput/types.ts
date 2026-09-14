import type { Component, VNodeChild } from 'vue'

type SelectableOption = {
  type?: 'option'
  label: string
  value: string
  icon?: string | Component
  disabled?: boolean
}

type CustomOption = {
  type: 'custom'
  label: string
  key: string
  icon?: string | Component
  disabled?: boolean
  onClick: (context: { query: string }) => void
  keepOpen?: boolean
  slot?: string
  slots?: { label?: (context: { query: string }) => VNodeChild }
  condition?: (context: { query: string }) => boolean
}

export type SimpleOption = string | SelectableOption | CustomOption
export interface TagInputProps {
  modelValue?: string | null
  placeholder?: string
  disabled?: boolean
  renderIcon?: Function
}
