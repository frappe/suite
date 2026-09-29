import { MaybeRefOrGetter, toValue, reactive, provide, shallowRef } from 'vue'
import { useDoc } from 'frappe-ui'
import { useSessionStore } from '@/boot/session'
import { readWriterFile, recordVisit, renameNode, type WriterFile } from '@/apps/writer/drive'
import { RENAME_DOCUMENT } from '@/apps/writer/renameDocument'
import { getDocuments } from '@/apps/writer/resources/'
import { prettyData, updateURLSlug } from '@/apps/writer/utils'

type PrettyWriterFile = WriterFile & { relativeModified?: unknown; file_size_pretty?: string }

interface WriterDocumentRow {
  name: string
  settings?: string | Record<string, unknown> | null
}

function openWriterDocument(docname: string) {
  return useDoc<WriterDocumentRow>({
    doctype: 'Writer Document',
    name: docname,
    transform(doc) {
      if (typeof doc.settings === 'string') doc.settings = JSON.parse(doc.settings) as Record<string, unknown>
      else if (!doc.settings) doc.settings = {}
      return doc
    },
    methods: {
      newVersion: 'new_version',
      saveDoc: 'save_doc',
      saveHtml: 'save_html',
      updateSettings: 'update_settings',
    },
  })
}

export interface WriterFileResource {
  doc: PrettyWriterFile | null
  error: unknown
  loading: boolean
  fetch(): Promise<void>
}

/**
 * The old Writer page's document: the Drive node in legacy field names, and
 * the `Writer Document` behind it once the node is read. Also provides
 * `RENAME_DOCUMENT` to the editor below it.
 */
export default function useDocument(docId: MaybeRefOrGetter<string>) {
  const name = toValue(docId)
  const file: WriterFileResource = reactive({
    doc: null,
    error: null,
    loading: false,
    fetch: () => read(),
  })
  // Construct a fake useDoc until we fetch data
  const document = shallowRef<ReturnType<typeof openWriterDocument> | { doc: null }>({ doc: null })
  let opened = false
  let visited = false

  async function read(): Promise<void> {
    file.loading = true
    try {
      const doc = prettyData([await readWriterFile(name)])[0] as PrettyWriterFile
      if (file.doc) doc.is_favourite = file.doc.is_favourite
      file.doc = doc
      file.error = null
      if (!opened) openDocument(doc)
    } catch (error) {
      file.error = error
    } finally {
      file.loading = false
    }
  }

  function openDocument(doc: WriterFile): void {
    opened = true
    document.value = openWriterDocument(doc.content_docname!)
    if (useSessionStore().isLoggedIn && !visited) {
      visited = true
      void recordVisit(name).catch(() => {})
      getDocuments.updateRow({
        name,
        accessed: new Date().toISOString(),
      })
    }
  }

  provide(RENAME_DOCUMENT, async (title: string) => {
    const renamed = await renameNode(name, title)
    if (!file.doc) return
    file.doc.file_name = renamed
    const crumbs = file.doc.breadcrumbs
    crumbs[crumbs.length - 1]!.file_name = renamed
    updateURLSlug(renamed)
  })

  void read()
  return { file, document }
}
