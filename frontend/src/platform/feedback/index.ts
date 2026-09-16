import {
  FrappeUIProvider,
  dialog,
  toast as frappeToast,
  type PromptField as FrappePromptField,
} from 'frappe-ui'
import { defineComponent, h, type VNodeChild } from 'vue'

import type { PlatformError } from '@/platform/transport'

export interface ConfirmOptions {
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  dismissible?: boolean
}

export type PromptField = FrappePromptField

export interface PromptOptions extends ConfirmOptions {
  fields: PromptField[]
}

export const FeedbackProvider = defineComponent({
  name: 'FeedbackProvider',
  setup(_props, { slots }) {
    return () => h(FrappeUIProvider, null, { default: () => slots.default?.() as VNodeChild })
  },
})

export const toast = frappeToast

export function confirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value: boolean) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    const open = options.destructive ? dialog.danger : dialog.confirm
    open({
      title: options.title,
      message: options.message,
      confirmLabel: options.confirmLabel,
      cancelLabel: options.cancelLabel,
      dismissible: options.dismissible,
      onConfirm: () => finish(true),
      onCancel: () => finish(false),
    })
  })
}

export function prompt<T extends Record<string, unknown> = Record<string, unknown>>(
  options: PromptOptions,
): Promise<T | null> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value: T | null) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    dialog.prompt({
      title: options.title,
      message: options.message,
      confirmLabel: options.confirmLabel,
      cancelLabel: options.cancelLabel,
      dismissible: options.dismissible,
      fields: options.fields,
      onConfirm: ({ values }) => finish(values as T),
      onCancel: () => finish(null),
    })
  })
}

export interface ChallengeTarget {
  onChallenge(
    type: string,
    handler: (error: PlatformError, retry: () => Promise<unknown>) => Promise<unknown>,
  ): () => void
}

export interface ChallengePrompt {
  title: string
  message?: (error: PlatformError) => string
  fields: PromptField[]
  resolve(values: Record<string, unknown>, error: PlatformError): void | Promise<void>
}

export function hostChallenge(
  state: ChallengeTarget,
  type: string,
  challenge: ChallengePrompt,
): () => void {
  return state.onChallenge(type, async (error, retry) => {
    const values = await prompt({
      title: challenge.title,
      message: challenge.message?.(error),
      fields: challenge.fields,
      confirmLabel: 'Continue',
    })
    if (!values) return
    await challenge.resolve(values, error)
    return retry()
  })
}

export function reportMutationError(error: PlatformError): void {
  frappeToast.error(error.message)
}
