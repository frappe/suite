/**
 * A file title's extension without its dot, or null if it has none.
 *
 * The extension is the text after the last dot, when that dot is not the first
 * character and the text is 1 to 10 characters with no whitespace. So `.env`
 * has none, `archive.tar.gz` has `gz`, and `v1.2 notes` has none. The server's
 * `_title_extension` in `suite/drive/_core/nodes.py` matches this, and refuses
 * a file rename that removes or changes it.
 */
export function titleExtension(title: string): string | null {
  const dot = title.lastIndexOf('.')
  const extension = title.slice(dot + 1)
  if (dot < 1 || extension.length < 1 || extension.length > 10 || /\s/.test(extension)) return null
  return extension
}

/** Selects a file title in its input up to the extension, as Finder does. */
export function selectStem(input: HTMLInputElement): void {
  const extension = titleExtension(input.value)
  input.setSelectionRange(0, extension === null ? input.value.length : input.value.length - extension.length - 1)
}
