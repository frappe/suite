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
  const trees = new Map<string, { folders: Set<string>; files: Array<{ folder: string; file: File }> }>()
  for (const file of files) {
    const parts = (file.webkitRelativePath || file.name).split('/').filter(Boolean)
    if (parts.length < 2) continue
    const [top, ...rest] = parts
    const tree = trees.get(top!) ?? { folders: new Set<string>(), files: [] }
    trees.set(top!, tree)
    const folderParts = rest.slice(0, -1)
    for (let depth = 1; depth <= folderParts.length; depth++) tree.folders.add(folderParts.slice(0, depth).join('/'))
    tree.files.push({ folder: folderParts.join('/'), file })
  }
  return [...trees].map(([title, tree]) => ({ title, folders: orderFolders(tree.folders), files: tree.files }))
}

/**
 * What a drop carries, read while the drop event is live. The browser empties
 * `DataTransfer` once the handler returns, so call this synchronously and
 * await `read()` afterwards.
 */
export function captureDrop(transfer: DataTransfer): { hasFiles: boolean; read(): Promise<UploadSelection> } {
  const captured = [...transfer.items]
    .filter((item) => item.kind === 'file')
    .map((item) => ({
      entry: item.webkitGetAsEntry?.() ?? null,
      file: item.getAsFile(),
      handle: (item as HandleItem).getAsFileSystemHandle?.() ?? null,
    }))
  return {
    hasFiles: captured.length > 0,
    async read() {
      const selection: UploadSelection = { files: [], folders: [] }
      for (const item of captured) {
        if (item.entry?.isDirectory) {
          selection.folders.push(await readDirectory(item.entry as FileSystemDirectoryEntry))
          continue
        }
        if (!item.file) continue
        const handle = await item.handle?.catch(() => null)
        selection.files.push({ file: item.file, handle: handle?.kind === 'file' ? (handle as FileSystemFileHandle) : undefined })
      }
      return selection
    },
  }
}

/** True while a drag carries files from outside the page, not text or a row. */
export function dragHasFiles(event: DragEvent): boolean {
  return [...(event.dataTransfer?.types ?? [])].includes('Files')
}

type HandleItem = DataTransferItem & { getAsFileSystemHandle?: () => Promise<FileSystemHandle | null> }

async function readDirectory(root: FileSystemDirectoryEntry): Promise<FolderUpload> {
  const folders = new Set<string>()
  const files: Array<{ folder: string; file: File }> = []
  async function walk(directory: FileSystemDirectoryEntry, path: string) {
    for (const entry of await readEntries(directory)) {
      if (entry.isDirectory) {
        const child = path ? `${path}/${entry.name}` : entry.name
        folders.add(child)
        await walk(entry as FileSystemDirectoryEntry, child)
      } else if (entry.isFile) {
        files.push({ folder: path, file: await readFile(entry as FileSystemFileEntry) })
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
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
    if (!batch.length) return all
    all.push(...batch)
  }
}

function readFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject))
}

function orderFolders(folders: Set<string>): string[] {
  return [...folders].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))
}
