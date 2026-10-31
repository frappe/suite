/** Lightweight Drive references: importing these loads no dialogs or sessions. */
import type { TransferRef } from '@/platform/transport'
import { coveredMutation } from '@/platform/transport/covered'

import { api as references } from './generated'
import type { DriveNode } from './types'
import type { UploadSession } from './uploads'

export interface TransferInput {
  parent_node: string
  file: Blob
  filename?: string
  mime?: string
  replaces?: string
  checksum?: string
  start?: { session: UploadSession; offset: number }
}

export const api = {
  ...references,
  grants: {
    ...references.grants,
    update: coveredMutation(references.grants.update),
    delete: coveredMutation(references.grants.delete),
    rotate: coveredMutation(references.grants.rotate),
  },
  threads: { ...references.threads, resolve: coveredMutation(references.threads.resolve) },
  comments: {
    create: coveredMutation(references.comments.create),
    update: coveredMutation(references.comments.update),
    delete: coveredMutation(references.comments.delete),
  },
  uploads: {
    ...references.uploads,
    finish: coveredMutation(references.uploads.finish),
    transfer: { kind: 'transfer', owner: 'drive', id: 'uploads.transfer' } as TransferRef<
      TransferInput,
      DriveNode
    >,
  },
} as const
