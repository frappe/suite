import type { InjectionKey } from 'vue'

/**
 * Renames the open document. The page that opened the document provides it:
 * the old Writer page renames through Writer's Drive calls, and the `/d/`
 * surface renames through its `DocumentSession`. It rejects when Drive refuses.
 */
export type RenameDocument = (title: string) => Promise<void>

export const RENAME_DOCUMENT: InjectionKey<RenameDocument> = Symbol('writer rename document')
