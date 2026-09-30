import { computed, reactive, shallowReactive, watch } from 'vue'

import { createNode, findChild } from '@/apps/drive/client/nodes'
import { readRootUsage } from '@/apps/drive/client/roots'
import { DRIVE_ROLES, hasRole, type DriveNode } from '@/apps/drive/client/types'
import { openUpload, uploadTransfer, type UploadSession } from '@/apps/drive/client/uploads'
import { serverState } from '@/platform/server-state'
import { TransportError, type PlatformError } from '@/platform/transport'

import { sha256 } from './checksum'
import { createUploadRecords, type UploadRecord, type UploadRecords } from './records'
import type { FolderUpload, PickedFile } from './sources'

/**
 * Drive's upload queue (spec §6). One per tab: it survives folder and area
 * changes. Files upload side by side, up to `PARALLEL_FILES` at a time; the
 * chunks of one file go one after another.
 */

export const PARALLEL_FILES = 3
/** How long the full ring stays after the last upload finishes. */
export const DONE_RING_MS = 3000

export type UploadState =
  | 'queued'
  | 'checking'
  | 'uploading'
  /** Stopped because the root is full. Retry all starts it again. */
  | 'held'
  | 'done'
  | 'failed'
  /** Stopped by a reload. Resume continues it. */
  | 'interrupted'
  | 'skipped'

export interface UploadEntry {
  readonly id: string
  /** The title the file is created under. */
  title: string
  readonly size: number
  readonly parent: string
  /** Set for a replace: the file the bytes replace. */
  replaces: string | null
  state: UploadState
  /** Bytes the server confirmed. */
  sent: number
  error: string | null
  /** A failed entry that Retry can continue. */
  retryable: boolean
  /** The created or replaced node, once done. */
  node: string | null
}

/** Where a batch lands. `root` is the root node, for the quota check. */
export interface UploadTarget {
  parent: string
  root: string
}

export type CollisionChoice =
  | { action: 'replace' }
  | { action: 'keep-both' }
  | { action: 'rename'; title: string }
  | { action: 'skip' }

export interface UploadPrompts {
  /** A file title is taken. Replace is offered only with EDIT on the file there. */
  collision(input: {
    title: string
    freeTitle: string
    canReplace: boolean
    /** More than one file in the batch: offer "Apply to all". */
    batch: boolean
  }): Promise<CollisionChoice & { applyToAll: boolean }>
  /** A top folder title is taken. There is no merge. */
  folderCollision(input: { title: string; freeTitle: string }): Promise<'keep-both' | 'skip'>
  /** The batch does not fit in the root. */
  quota(input: { total: number; free: number; fitting: number; count: number }): Promise<'fit' | 'cancel'>
  /** Resume without a stored handle: the user picks the file again. */
  pickFile(input: { name: string }): Promise<File | null>
}

export interface UploadIndicator {
  fraction: number | null
  tone: 'running' | 'paused' | 'done'
  attention: boolean
}

interface Batch {
  size: number
  applied: (CollisionChoice & { applyToAll: boolean }) | null
}

interface Job {
  entry: UploadEntry
  file: File | null
  handle?: FileSystemFileHandle
  /** The file's own name and time, for the resume match. */
  fileName: string
  lastModified: number
  session: UploadSession | null
  /** Resumed after a reload: finish sends a sha256. */
  resumed: boolean
  batch: Batch
  run: number
  createdAt: number
}

export interface UploadQueueOptions {
  records?: UploadRecords
  now?: () => number
  parallel?: number
}

const ACTIVE: readonly UploadState[] = ['queued', 'checking', 'uploading', 'held']

export function createUploadQueue(options: UploadQueueOptions = {}) {
  const records = options.records ?? createUploadRecords(options.now)
  const now = options.now ?? Date.now
  const parallel = options.parallel ?? PARALLEL_FILES
  const jobs = shallowReactive(new Map<string, Job>())
  const state = reactive({
    /** A 413 stopped the queue. It starts nothing until Retry all. */
    halted: null as string | null,
    /** Folder uploads still creating their folders. */
    preparing: 0,
    /** The user looked at the tracker since the last failure. */
    seen: true,
    trackerOpen: false,
    showDone: false,
  })
  let prompts: UploadPrompts | null = null
  let promptTail: Promise<unknown> = Promise.resolve()
  let running = 0
  let nextId = 0
  let run = 0
  let doneTimer: ReturnType<typeof setTimeout> | null = null
  let restored: Promise<void> | null = null

  const entries = computed(() => [...jobs.values()].map((job) => job.entry))
  const active = computed(() => entries.value.filter((entry) => ACTIVE.includes(entry.state)))

  const indicator = computed<UploadIndicator | null>(() => {
    const attention = !state.seen && entries.value.some((entry) => entry.state === 'failed' || entry.state === 'interrupted')
    if (active.value.length || state.preparing) {
      const counted = [...jobs.values()].filter((job) => job.run === run && job.entry.state !== 'skipped')
      const size = counted.reduce((sum, job) => sum + job.entry.size, 0)
      const sent = counted.reduce((sum, job) => sum + (job.entry.state === 'done' ? job.entry.size : job.entry.sent), 0)
      return { fraction: size ? sent / size : 0, tone: state.halted ? 'paused' : 'running', attention }
    }
    if (state.showDone) return { fraction: 1, tone: 'done', attention }
    return attention ? { fraction: null, tone: 'running', attention } : null
  })

  // The ring completes, then goes; a new run counts its own bytes.
  watch(
    () => active.value.length + state.preparing,
    (count, previous) => {
      if (count || !previous) return
      const finished = [...jobs.values()].some((job) => job.run === run && job.entry.state === 'done')
      run += 1
      if (!finished) return
      state.showDone = true
      if (doneTimer) clearTimeout(doneTimer)
      doneTimer = setTimeout(() => {
        state.showDone = false
      }, DONE_RING_MS)
    },
  )

  function setPrompts(next: UploadPrompts | null) {
    prompts = next
  }

  /** One dialog at a time: parallel files that collide wait their turn. */
  function ask<T>(question: (prompts: UploadPrompts) => Promise<T>): Promise<T> {
    const answer = promptTail.then(() => {
      if (!prompts) throw new Error('No upload prompts are mounted')
      return question(prompts)
    })
    promptTail = answer.catch(() => undefined)
    return answer
  }

  function addJob(picked: PickedFile, parent: string, batch: Batch, replaces: string | null = null, title = picked.file.name) {
    const entry = reactive<UploadEntry>({
      id: `upload-${nextId++}`,
      title,
      size: picked.file.size,
      parent,
      replaces,
      state: 'queued',
      sent: 0,
      error: null,
      retryable: true,
      node: null,
    }) as UploadEntry
    jobs.set(entry.id, {
      entry,
      file: picked.file,
      handle: picked.handle,
      fileName: picked.file.name,
      lastModified: picked.file.lastModified,
      session: null,
      resumed: false,
      batch,
      run,
      createdAt: now(),
    })
    return entry
  }

  /** Files into one folder. Returns after the quota check; the uploads go on. */
  async function uploadFiles(picked: readonly PickedFile[], target: UploadTarget): Promise<void> {
    const fitting = await preflight(picked.map((item) => item.file.size), target.root)
    if (!fitting) return
    const batch: Batch = { size: fitting.length, applied: null }
    for (const index of fitting) addJob(picked[index]!, target.parent, batch)
    reveal()
    pump()
  }

  /** Folder trees into one folder: folders top-down with `POST /nodes`, then their files. */
  async function uploadFolders(folders: readonly FolderUpload[], target: UploadTarget): Promise<void> {
    const sizes = folders.flatMap((folder) => folder.files.map((item) => item.file.size))
    const fitting = await preflight(sizes, target.root)
    if (!fitting) return
    const keep = new Set(fitting)
    let index = 0
    const trimmed = folders.map((folder) => ({
      ...folder,
      files: folder.files.filter(() => keep.has(index++)),
    }))
    const batch: Batch = { size: fitting.length, applied: null }
    state.preparing += 1
    reveal()
    try {
      for (const folder of trimmed) await createTree(folder, target.parent, batch)
    } finally {
      state.preparing -= 1
    }
    pump()
  }

  async function createTree(folder: FolderUpload, parent: string, batch: Batch) {
    const top = await createTopFolder(parent, folder.title)
    if (!top) return
    const ids = new Map<string, string | null>([['', top]])
    for (const path of folder.folders) {
      const at = path.lastIndexOf('/')
      const above = ids.get(at < 0 ? '' : path.slice(0, at)) ?? null
      const created = above ? await createFolder(above, path.slice(at + 1)) : null
      ids.set(path, created && !('error' in created) ? created.name : null)
    }
    for (const item of folder.files) {
      const into = ids.get(item.folder) ?? null
      const entry = addJob({ file: item.file }, into ?? parent, batch)
      if (!into) fail(jobs.get(entry.id)!, 'Its folder could not be created.', false)
    }
    pump()
  }

  async function createTopFolder(parent: string, title: string): Promise<string | null> {
    let next = title
    while (true) {
      const created = await createFolder(parent, next)
      if (!('error' in created)) return created.name
      const freeTitle = created.error.free_title
      if (created.error.type !== 'DriveConflict' || typeof freeTitle !== 'string') {
        const entry = addJob({ file: new File([], title) }, parent, { size: 1, applied: null })
        fail(jobs.get(entry.id)!, created.error.message, false)
        return null
      }
      const choice = await ask((p) => p.folderCollision({ title: next, freeTitle }))
      if (choice === 'skip') return null
      next = freeTitle
    }
  }

  async function createFolder(parent: string, title: string): Promise<DriveNode | { error: PlatformError }> {
    const mutation = serverState.useMutation(createNode(), { silent: true })
    const created = (await mutation.run({ parent, title, kind: 'folder' })) as DriveNode | undefined
    return created ?? { error: mutation.error ?? { type: 'RequestError', message: 'The folder could not be created.', status: 0 } }
  }

  /** A browser replace keeps no old version (spec §6.8). */
  function replaceFile(target: { node: string; parent: string; title: string }, picked: PickedFile): UploadEntry {
    const entry = addJob(picked, target.parent, { size: 1, applied: null }, target.node, target.title)
    pump()
    return entry
  }

  /**
   * Indexes of the sizes to upload, in order: all of them when they fit or
   * the usage is unknown, the ones that fit when the user says so, or `null`.
   * Advisory only: `create_upload` stays the gate (spec §6.5).
   */
  async function preflight(sizes: readonly number[], root: string): Promise<number[] | null> {
    const all = sizes.map((_size, index) => index)
    const total = sizes.reduce((sum, size) => sum + size, 0)
    const usage = await readRootUsage(root).catch(() => null)
    if (!usage?.effective_quota) return all
    const free = Math.max(usage.effective_quota - usage.used_bytes, 0)
    if (total <= free) return all
    let room = free
    const fitting = all.filter((index) => {
      if (sizes[index]! > room) return false
      room -= sizes[index]!
      return true
    })
    const choice = await ask((p) => p.quota({ total, free, fitting: fitting.length, count: sizes.length }))
    return choice === 'fit' && fitting.length ? fitting : null
  }

  function pump() {
    if (state.halted) return
    for (const job of jobs.values()) {
      if (running >= parallel) return
      if (job.entry.state !== 'queued') continue
      running += 1
      void execute(job).finally(() => {
        running -= 1
        pump()
      })
    }
  }

  async function execute(job: Job) {
    try {
      if (!job.session && !(await open(job))) return
      await transfer(job)
    } catch (cause) {
      fail(job, platformError(cause).message)
    }
  }

  /** Opens the session. A taken title asks the user before any byte moves (spec §6.4). */
  async function open(job: Job): Promise<boolean> {
    const { entry, file } = job
    while (true) {
      try {
        job.session = await openUpload({
          parent: entry.parent,
          filename: entry.title,
          size: entry.size,
          ...(file?.type ? { mime: file.type } : {}),
          ...(entry.replaces ? { replaces: entry.replaces } : {}),
        })
        entry.sent = 0
        await persist(job)
        return true
      } catch (cause) {
        const error = platformError(cause)
        if (await settleRefusal(job, error)) continue
        return false
      }
    }
  }

  async function transfer(job: Job) {
    const { entry } = job
    if (!job.file || !job.session) return
    if (job.session.mode !== 'chunked') {
      fail(job, 'This site stores uploads in a way the browser uploader does not support yet.')
      return
    }
    let checksum: string | undefined
    if (job.resumed) {
      entry.state = 'checking'
      checksum = await sha256(job.file)
    }
    entry.state = 'uploading'
    entry.error = null
    while (true) {
      const mutation = serverState.useMutation(uploadTransfer(entry.parent), { silent: true })
      const stop = watch(
        () => mutation.progress,
        (progress) => {
          if (progress == null) return
          entry.sent = Math.round(progress * entry.size)
          void persist(job)
        },
      )
      const node = await mutation.run({
        parent: entry.parent,
        filename: entry.title,
        size: entry.size,
        ...(entry.replaces ? { replaces: entry.replaces } : {}),
        ...(checksum ? { checksum } : {}),
        file: job.file,
        start: { session: job.session, offset: entry.sent },
      })
      stop()
      if (node) {
        entry.state = 'done'
        entry.sent = entry.size
        entry.node = node.name
        await records.remove(job.session.upload_id)
        return
      }
      const error = mutation.error ?? { type: 'RequestError', message: 'The upload failed.', status: 0 }
      // The title was taken while the bytes travelled. The session stays; finish again.
      if (!(await settleRefusal(job, error))) return
      entry.state = 'uploading'
    }
  }

  /**
   * Handles a refusal of open or finish. `true` means try again with the
   * entry as the user changed it.
   */
  async function settleRefusal(job: Job, error: PlatformError): Promise<boolean> {
    const { entry } = job
    if (isOverQuota(error)) {
      entry.state = 'held'
      entry.error = error.message
      state.halted = error.message
      return false
    }
    const freeTitle = error.free_title
    if (error.type !== 'DriveConflict' || typeof freeTitle !== 'string') {
      fail(job, error.message)
      return false
    }
    const choice = await resolveCollision(job, freeTitle)
    if (choice.action === 'skip') {
      entry.state = 'skipped'
      if (job.session) await records.remove(job.session.upload_id)
      return false
    }
    if (choice.action === 'keep-both') entry.title = freeTitle
    if (choice.action === 'rename') entry.title = choice.title
    if (choice.action === 'replace') entry.replaces = choice.node ?? null
    await persist(job)
    return true
  }

  function resolveCollision(job: Job, freeTitle: string): Promise<CollisionChoice & { node?: string }> {
    const { entry, batch } = job
    return ask(async (p) => {
      const existing = await findChild(entry.parent, entry.title).catch(() => null)
      const canReplace = !!existing && existing.kind === 'file' && hasRole(existing, DRIVE_ROLES.edit)
      const remembered = batch.applied
      const choice = remembered && (remembered.action !== 'replace' || canReplace)
        ? remembered
        : await p.collision({ title: entry.title, freeTitle, canReplace, batch: batch.size > 1 })
      if (choice.applyToAll && choice.action !== 'rename') batch.applied = choice
      if (choice.action === 'replace') {
        return existing && canReplace ? { action: 'replace', node: existing.name } : { action: 'skip' }
      }
      return choice
    })
  }

  function fail(job: Job, message: string, retryable = true) {
    job.entry.state = 'failed'
    job.entry.error = message
    job.entry.retryable = retryable && !!job.file
    state.seen = false
  }

  async function persist(job: Job) {
    if (!job.session) return
    const record: UploadRecord = {
      upload_id: job.session.upload_id,
      parent: job.entry.parent,
      name: job.fileName,
      title: job.entry.title,
      size: job.entry.size,
      lastModified: job.lastModified,
      bytesSent: job.entry.sent,
      createdAt: job.createdAt,
      ...(job.handle ? { handle: job.handle } : {}),
      ...(job.entry.replaces ? { replaces: job.entry.replaces } : {}),
    }
    await records.save(record).catch(() => undefined)
  }

  /** Retry resumes from the bytes the server holds (spec §6.11). */
  function retry(id: string) {
    const job = jobs.get(id)
    if (!job || (job.entry.state !== 'failed' && job.entry.state !== 'held')) return
    if (!job.file || !job.entry.retryable) return
    job.entry.state = 'queued'
    job.entry.error = null
    job.run = run
    pump()
  }

  function retryAll() {
    state.halted = null
    for (const job of jobs.values()) {
      if ((job.entry.state === 'failed' || job.entry.state === 'held') && job.file && job.entry.retryable) {
        job.entry.state = 'queued'
        job.entry.error = null
        job.run = run
      }
    }
    pump()
  }

  /**
   * Resume after a reload. A stored handle reads the file again after
   * permission; otherwise the user picks it, and only the same name, size and
   * modified time continue. Another file starts a new upload and leaves the
   * old session alone (spec §6.2).
   */
  async function resume(id: string) {
    const job = jobs.get(id)
    if (!job || job.entry.state !== 'interrupted') return
    let file = await readHandle(job.handle)
    if (!file) {
      const picked = await ask((p) => p.pickFile({ name: job.fileName }))
      if (!picked) return
      const same = picked.name === job.fileName && picked.size === job.entry.size && picked.lastModified === job.lastModified
      if (!same) {
        const batch: Batch = { size: 1, applied: null }
        addJob({ file: picked }, job.entry.parent, batch)
        reveal()
        pump()
        return
      }
      file = picked
    }
    job.file = file
    job.entry.state = 'queued'
    job.entry.error = null
    job.run = run
    pump()
  }

  /** Interrupted uploads from an earlier page load. Runs once; later calls wait for it. */
  function restore(): Promise<void> {
    restored ??= (async () => {
      const found = await records.load().catch(() => [] as UploadRecord[])
      for (const record of found) {
        if ([...jobs.values()].some((job) => job.session?.upload_id === record.upload_id)) continue
        const entry = reactive<UploadEntry>({
          id: `upload-${nextId++}`,
          title: record.title ?? record.name,
          size: record.size,
          parent: record.parent,
          replaces: record.replaces ?? null,
          state: 'interrupted',
          sent: record.bytesSent,
          error: null,
          retryable: true,
          node: null,
        }) as UploadEntry
        jobs.set(entry.id, {
          entry,
          file: null,
          handle: record.handle,
          fileName: record.name,
          lastModified: record.lastModified,
          session: { upload_id: record.upload_id, mode: 'chunked' },
          resumed: true,
          batch: { size: 1, applied: null },
          run,
          createdAt: record.createdAt,
        })
      }
      if (found.length) state.seen = false
    })()
    return restored
  }

  /** Removes an entry that is not running. An interrupted one also forgets its record. */
  async function dismiss(id: string) {
    const job = jobs.get(id)
    if (!job || job.entry.state === 'uploading' || job.entry.state === 'checking' || job.entry.state === 'queued') return
    jobs.delete(id)
    if (job.session && job.entry.state !== 'done') await records.remove(job.session.upload_id)
  }

  /** Clears finished entries: done and skipped. */
  function clearFinished() {
    for (const [id, job] of jobs) {
      if (job.entry.state === 'done' || job.entry.state === 'skipped') jobs.delete(id)
    }
  }

  function reveal() {
    state.trackerOpen = true
  }

  function openTracker() {
    state.trackerOpen = true
    state.seen = true
  }

  function closeTracker() {
    state.trackerOpen = false
    clearFinished()
  }

  return {
    entries,
    state: state as Readonly<typeof state>,
    indicator,
    setPrompts,
    uploadFiles,
    uploadFolders,
    replaceFile,
    retry,
    retryAll,
    resume,
    restore,
    dismiss,
    openTracker,
    closeTracker,
    markSeen: () => {
      state.seen = true
    },
  }
}

export type UploadQueue = ReturnType<typeof createUploadQueue>

async function readHandle(handle: FileSystemFileHandle | undefined): Promise<File | null> {
  if (!handle) return null
  try {
    const permissioned = handle as PermissionHandle
    const options = { mode: 'read' as const }
    let permission = (await permissioned.queryPermission?.(options)) ?? 'granted'
    if (permission !== 'granted') permission = (await permissioned.requestPermission?.(options)) ?? 'denied'
    return permission === 'granted' ? await handle.getFile() : null
  } catch {
    return null
  }
}

type PermissionHandle = FileSystemFileHandle & {
  queryPermission?: (options: { mode: 'read' }) => Promise<PermissionState>
  requestPermission?: (options: { mode: 'read' }) => Promise<PermissionState>
}

/** A full root answers `DriveOverQuota`; a proxy's body cap answers a bare 413. */
function isOverQuota(error: PlatformError): boolean {
  return error.type === 'DriveOverQuota' || error.status === 413
}

function platformError(cause: unknown): PlatformError {
  if (cause instanceof TransportError) return { ...cause.details, type: cause.type, message: cause.message, status: cause.status }
  return { type: 'RequestError', message: cause instanceof Error ? cause.message : 'The upload failed.', status: 0 }
}

let queue: UploadQueue | null = null

/** The tab's one queue. Interrupted uploads from an earlier load appear on first use. */
export function uploadQueue(): UploadQueue {
  if (!queue) {
    queue = createUploadQueue()
    void queue.restore()
  }
  return queue
}
