/**
 * Drive SDK for the other suite apps (Writer, Slides, ...).
 *
 * Apps that back their documents with Drive Files import everything they need
 * from here — dialogs, entity fetching, links and share resources. The
 * internals under ui/drive may change freely; this surface is stable.
 */
import { call } from 'frappe-ui'

export { default as ShareDialog } from '@/apps/drive/ui/drive/components/ShareDialog.vue'
export { default as MoveDialog } from '@/apps/drive/ui/drive/components/MoveDialog.vue'
export { default as InfoDialog } from '@/apps/drive/ui/drive/components/InfoDialog.vue'

export { getFileLink, prettyData, copyToClipboard } from '@/apps/drive/ui/drive/js/utils'
export {
  allUsers,
  rename,
  rootInfo,
} from '@/apps/drive/ui/drive/js/resources'

/** The Drive File (with the caller's access) backing a content document. */
export const getFileForDoc = (doctype, docname) =>
  call('suite.drive.overrides.file.get_file_for_doc', { doctype, docname })
