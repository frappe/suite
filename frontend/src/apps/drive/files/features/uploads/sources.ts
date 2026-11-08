/**
 * Turns what the user picked or dropped into files and folder trees
 * (spec §6.6, §6.7).
 */

/** One file, with the handle Chromium gives for a picker or a drop. */
export interface PickedFile {
  file: File
  handle?: FileSystemFileHandle
}

/** One folder to create, with everything below it. */
export interface FolderUpload {
  title: string
  /** Paths below the top folder, parents before children: `a`, `a/b`. */
  folders: string[]
  /** Each file with the path of its folder below the top folder; `''` is the top folder. */
  files: Array<{ folder: string; file: File }>
}

export interface UploadSelection {
  files: PickedFile[]
  folders: FolderUpload[]
}

/** Folder trees from an `<input webkitdirectory>` selection, by `webkitRelativePath`. */
export function foldersFromInput(files: readonly File[]): FolderUpload[] {
  const trees = new Map<
    string,
    { folders: Set<string>; files: Array<{ folder: string; file: File }> }
  >()
  for (const file of files) {
    const parts = (file.webkitRelativePath || file.name).split('/').filter(Boolean)
    if (parts.length < 2) continue
    const [top, ...rest] = parts
    const tree = trees.get(top!) ?? { folders: new Set<string>(), files: [] }
    trees.set(top!, tree)
    const folderParts = rest.slice(0, -1)
    for (let depth = 1; depth <= folderParts.length; depth++)
      tree.folders.add(folderParts.slice(0, depth).join('/'))
    tree.files.push({ folder: folderParts.join('/'), file })
  }
  return [...trees].map(([title, tree]) => ({
    title,
    folders: orderFolders(tree.folders),
    files: tree.files,
  }))
}
interface CaptureDropResult {
  hasFiles: boolean
  read(): Promise<UploadSelection>
}

/**
 * What a drop carries, read while the drop event is live. The browser empties
 * `DataTransfer` once the handler returns, so call this synchronously and
 * await `read()` afterwards.
 */
export function captureDrop(transfer: DataTransfer): CaptureDropResult {
  const captured = [...transfer.items].flatMap((item: HandleItem) =>
    item.kind === 'file'
      ? [
          {
            entry: item.webkitGetAsEntry?.() ?? null,
            file: item.getAsFile(),
            handle: item.getAsFileSystemHandle?.() ?? null,
          },
        ]
      : [],
  )
  return {
    hasFiles: captured.length > 0,
    async read() {
      const selection: UploadSelection = { files: [], folders: [] }
      for (const item of captured) {
        if (item.entry && isDirectory(item.entry)) {
          selection.folders.push(await readDirectory(item.entry))
          continue
        }
        if (!item.file) continue
        const handle = await item.handle?.catch(() => null)
        selection.files.push({
          file: item.file,
          handle: handle && isFileHandle(handle) ? handle : undefined,
        })
      }
      return selection
    },
  }
}

/** The images a paste carries, such as a screenshot. Other pasted files and text are left alone. */
export function pastedImages(transfer: DataTransfer | null): PickedFile[] {
  return [...(transfer?.items ?? [])]
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .flatMap((item: HandleItem) => {
      const file = item.getAsFile()
      return file ? [{ file }] : []
    })
}

/** True while a drag carries files from outside the page, not text or a row. */
export function dragHasFiles(event: DragEvent): boolean {
  return [...(event.dataTransfer?.types ?? [])].includes('Files')
}

type HandleItem = DataTransferItem & {
  getAsFileSystemHandle?: () => Promise<FileSystemHandle | null>
}

function isDirectory(entry: FileSystemEntry): entry is FileSystemDirectoryEntry {
  return entry.isDirectory
}

function isFile(entry: FileSystemEntry): entry is FileSystemFileEntry {
  return entry.isFile
}

function isFileHandle(handle: FileSystemHandle): handle is FileSystemFileHandle {
  return handle.kind === 'file'
}

async function readDirectory(root: FileSystemDirectoryEntry): Promise<FolderUpload> {
  const folders = new Set<string>()
  const files: Array<{ folder: string; file: File }> = []
  async function walk(directory: FileSystemDirectoryEntry, path: string) {
    for (const entry of await readEntries(directory)) {
      if (isDirectory(entry)) {
        const child = path ? `${path}/${entry.name}` : entry.name
        folders.add(child)
        await walk(entry, child)
      } else if (isFile(entry)) {
        files.push({ folder: path, file: await readFile(entry) })
      }
    }
  }
  await walk(root, '')
  return { title: root.name, folders: orderFolders(folders), files }
}

/** `readEntries` answers in batches; an empty batch is the end. */
async function readEntries(directory: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = directory.createReader()
  const all: FileSystemEntry[] = []
  while (true) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
      reader.readEntries(resolve, reject),
    )
    if (!batch.length) return all
    all.push(...batch)
  }
}

function readFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject))
}

function orderFolders(folders: Set<string>): string[] {
  return [...folders].sort(
    (a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b),
  )
}
