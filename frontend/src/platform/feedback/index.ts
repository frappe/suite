import {
  dialog,
  toast as frappeToast,
  FrappeUIProvider,
  type PromptField as FrappePromptField,
  type ImperativeDialogAction,
} from 'frappe-ui'
import { defineComponent, h } from 'vue'

import { translate as __ } from '@/platform/translation'
import {
  isTransientStatus,
  MIN_SERVER_ERROR_STATUS,
  type PlatformError,
} from '@/platform/transport'

export { default as ContextMenu } from './ContextMenu.vue'
export { default as Dropdown } from './Dropdown.vue'

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
    return () => h(FrappeUIProvider, null, { default: () => slots.default?.() })
  },
})

export const toast = frappeToast
export type { ToastId } from 'frappe-ui'

/** Button passes attributes it does not declare to its `<button>`, and the Dialog focuses an `[autofocus]` one on open. */
type FocusableAction = ImperativeDialogAction & { autofocus?: boolean }

export function confirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value: boolean) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    // The dialog opens with focus on a button, never on the close ×: the confirm
    // button, or Cancel when the action destroys something, so Enter is safe.
    const destructive = options.destructive === true
    const actions: FocusableAction[] = [
      {
        label: options.cancelLabel ?? __('Cancel'),
        variant: 'outline',
        autofocus: destructive,
        onClick: () => finish(false),
      },
      {
        label: options.confirmLabel ?? (destructive ? __('Delete') : __('Confirm')),
        variant: 'solid',
        theme: destructive ? 'red' : undefined,
        autofocus: !destructive,
        onClick: () => finish(true),
      },
    ]
    const open = destructive ? dialog.danger : dialog.confirm
    open({
      title: options.title,
      message: options.message,
      dismissible: options.dismissible,
      actions,
      // Esc and the close × still answer no.
      onCancel: () => finish(false),
    })
  })
}

export function prompt(options: PromptOptions): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value: Record<string, unknown> | null) => {
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
      onConfirm: ({ values }) => finish(values),
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

const reportedErrors = new WeakSet<Error | PlatformError>()

/** A workflow can handle the same refusal as the engine without reporting it twice. */
export function reportMutationError(error: Error | PlatformError): void {
  if (('name' in error && error.name === 'AbortError') || reportedErrors.has(error)) return
  reportedErrors.add(error)
  frappeToast.error(failureText(error))
}

/**
 * What to tell a person about a failed action: the server's own reason when it gave one, a plain
 * sentence for a network or server failure, never the raw status line or a browser's error text.
 */
export function failureText(error: Error | PlatformError): string {
  const status = 'status' in error && typeof error.status === 'number' ? error.status : null
  if (status === null) {
    // Code that means to say something throws a plain Error with its message; a TypeError or the
    // like is a fault, not something to show.
    return error instanceof Error && error.name === 'Error' && error.message
      ? error.message
      : __('Could not complete the request. Try again.')
  }
  if (status === 0) return __("Couldn't reach the server. Check your connection and try again.")
  if (isTransientStatus(status)) return __('The server is busy. Try again in a moment.')
  if (status >= MIN_SERVER_ERROR_STATUS)
    return __('The server had a problem. Try again in a moment.')
  const details =
    'details' in error && error.details && typeof error.details === 'object' ? error.details : error
  return 'fromServer' in details && details.fromServer === true && error.message
    ? error.message
    : __('Could not complete the request. Try again.')
}
