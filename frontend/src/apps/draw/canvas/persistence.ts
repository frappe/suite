/** Per-document saves and recovery. Only acknowledged revisions become clean. */
import { computed, inject, ref, type InjectionKey } from 'vue'

import { api, client } from '@/api'
import type { DocumentSession } from '@/apps/drive'
import { randomId } from '@/platform/random-id'
import { useSession } from '@/platform/session'
import { translate as __ } from '@/platform/translation'
import { TransportError } from '@/platform/transport'

import { readDrafts, removeDraft, writeDraft, type DraftEntry, type DrawingDraft } from './drafts'
import { parseScene, type Scene } from './selection'

export class DrawingPersistence {
  readonly drawingLoading = ref(true)
  readonly dirty = ref(false)
  readonly saving = ref(false)
  readonly error = ref('')
  readonly conflict = ref(false)
  readonly loadError = ref(false)
  readonly recoveryAvailable = ref(true)
  readonly drawingTitle
  readonly recoveryAllowed
  readonly readable
  readonly editable
  private modified = ''
  private pending: DrawingDraft | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private inFlight: Promise<void> | undefined
  private readonly disposed = ref(false)
  private readonly key: string
  private readonly prefix: string
  private recovered: DraftEntry | undefined
  private otherDrafts: DraftEntry[] = []
  private transient = false
  private recoveryWrite: Promise<void> = Promise.resolve()

  constructor(readonly session: DocumentSession) {
    const identity = useSession()
    const user = identity.user.value?.id ?? ''
    this.prefix = `${user}:${session.contentDocname}`
    this.key = `${this.prefix}:${randomId()}`
    this.drawingTitle = session.title
    this.recoveryAllowed = computed(() => !!user && identity.user.value?.id === user)
    this.readable = computed(
      () =>
        this.recoveryAllowed.value &&
        session.state.value !== 'Refused' &&
        (session.access.value.role ?? 0) >= 10,
    )
    this.editable = computed(
      () =>
        !this.disposed.value &&
        this.readable.value &&
        session.state.value === 'Active' &&
        (session.access.value.role ?? 0) >= 40 &&
        !this.drawingLoading.value &&
        !this.loadError.value &&
        !this.conflict.value,
    )
  }

  loadDrawing = async (): Promise<Scene | undefined> => {
    this.drawingLoading.value = true
    this.loadError.value = false
    try {
      const document = await client.query(
        api.draw.documents.get,
        { node: this.session.nodeId },
        {
          context: this.session.credentials.context,
        },
      )
      if (this.disposed.value) return
      this.modified = document.modified
      const drafts = await readDrafts(this.prefix).catch(() => {
        this.recoveryAvailable.value = false
        return []
      })
      this.otherDrafts = drafts
      this.recovered = drafts[0]
      const recovered = this.recovered?.value
      if (this.disposed.value) return
      const scene = parseScene(recovered?.content ?? JSON.parse(document.content))
      if (recovered) {
        this.pending = {
          ...recovered,
          content: scene,
          revision: randomId(),
          updatedAt: Date.now(),
        }
        this.dirty.value = true
        this.conflict.value = drafts.length > 1 || recovered.baseModified !== this.modified
      }
      return scene
    } catch (error) {
      if (!this.disposed.value) {
        this.loadError.value = true
        this.error.value =
          error instanceof Error ? error.message : __('Could not load the drawing.')
      }
    } finally {
      this.drawingLoading.value = false
    }
  }

  queueSave = (scene: Scene): void => {
    if (!this.editable.value) return
    this.retainScene(scene)
    this.transient = false
    this.timer = setTimeout(() => void this.saveDrawing(), 600)
  }

  retainScene = (scene: Scene): void => {
    if (this.disposed.value || this.drawingLoading.value || this.loadError.value) return
    this.pending = {
      content: parseScene(scene),
      baseModified: this.modified,
      revision: randomId(),
      updatedAt: Date.now(),
    }
    this.transient = true
    this.dirty.value = true
    void this.retainRecovery()
    clearTimeout(this.timer)
  }

  saveDrawing = async (): Promise<void> => {
    clearTimeout(this.timer)
    if (this.inFlight) return this.inFlight
    if (!this.pending || !this.editable.value || this.transient) return
    this.inFlight = this.savePending()
    try {
      await this.inFlight
    } finally {
      this.inFlight = undefined
    }
  }

  retainRecovery = (): Promise<void> => {
    const pending = this.pending
    if (!pending) return this.recoveryWrite
    this.recoveryWrite = this.recoveryWrite
      .then(() => writeDraft(this.key, pending))
      .catch(() => {
        this.recoveryAvailable.value = false
      })
    return this.recoveryWrite
  }

  warnUnsaved = (event: BeforeUnloadEvent): void => {
    if (this.dirty.value) {
      event.preventDefault()
      event.returnValue = ''
    }
  }

  downloadRecovery = (): void => {
    if (!this.pending || !this.recoveryAllowed.value) return
    const url = URL.createObjectURL(
      new Blob([JSON.stringify({ ...this.pending, otherDrafts: this.otherDrafts })], {
        type: 'application/json',
      }),
    )
    const link = document.createElement('a')
    link.href = url
    link.download = `${this.session.title.value || 'drawing'}-recovery.json`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  saveRecoveryTo = async (node: string): Promise<void> => {
    if (!this.recoveryAllowed.value) throw new Error(__('Sign in again to recover your drawing.'))
    const pending = this.pending
    if (!pending) throw new Error(__('No recovery draft is available.'))
    const created = await client.query(api.draw.documents.get, { node })
    await client.mutation(
      api.draw.documents.save,
      {
        node,
        content: JSON.stringify(pending.content),
        base_modified: created.modified,
      },
      { silent: true },
    )
    this.pending = undefined
    this.dirty.value = false
    this.removeAcknowledged(pending)
    await this.recoveryWrite
  }

  dispose = (): void => {
    this.disposed.value = true
    clearTimeout(this.timer)
    void this.retainRecovery()
  }

  private async savePending(): Promise<void> {
    this.saving.value = true
    this.error.value = ''
    try {
      while (this.pending && this.editable.value && !this.transient) {
        const next = this.pending
        const result = await client.mutation(
          api.draw.documents.save,
          {
            node: this.session.nodeId,
            content: JSON.stringify(next.content),
            base_modified: this.modified,
          },
          { context: this.session.credentials.context, silent: true },
        )
        this.modified = result.modified
        if (this.pending === next) {
          this.pending = undefined
          this.dirty.value = false
          // Delete behind every draft write so an old write cannot resurrect it.
          this.removeAcknowledged(next)
        } else if (this.pending) {
          this.pending.baseModified = this.modified
          await this.retainRecovery()
        }
      }
    } catch (error) {
      this.conflict.value = error instanceof TransportError && error.type === 'DrawingConflict'
      this.error.value = error instanceof Error ? error.message : __('Could not save the drawing.')
      await this.retainRecovery()
      if (error instanceof TransportError && [401, 403, 404, 410].includes(error.status)) {
        await this.session.refreshAccess().catch(() => undefined)
      }
    } finally {
      this.saving.value = false
    }
  }

  private removeAcknowledged(pending: DrawingDraft): void {
    const recovered = this.recovered
    this.recovered = undefined
    this.recoveryWrite = this.recoveryWrite
      .then(async () => {
        await removeDraft({ key: this.key, value: pending })
        if (recovered) await removeDraft(recovered)
      })
      .catch(() => {
        this.recoveryAvailable.value = false
      })
  }
}

export const DRAWING_PERSISTENCE: InjectionKey<DrawingPersistence> = Symbol('draw-persistence')

export function useDrawingPersistence(): DrawingPersistence {
  const persistence = inject(DRAWING_PERSISTENCE)
  if (!persistence) throw new Error(__('Drawing editor requires a document session.'))
  return persistence
}
