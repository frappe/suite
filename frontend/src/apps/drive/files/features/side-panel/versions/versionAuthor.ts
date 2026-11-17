import type { DocumentVersion } from '@/apps/drive/client/session'

/**
 * Who took a version, by name. A version ported from an account deleted before
 * the port is credited to Guest; Drive then names that author's email in
 * `deleted_author`, to a signed-in reader only, and it is shown instead.
 */
export function versionAuthor(
  version: Pick<DocumentVersion, 'actor' | 'person' | 'deleted_author'>,
): string {
  return version.deleted_author ?? (version.person.full_name || version.actor)
}
