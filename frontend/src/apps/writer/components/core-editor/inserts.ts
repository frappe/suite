import type { Editor } from '@tiptap/core'
import { isInTable } from '@tiptap/pm/tables'

import { BLOCK_STYLES, type BlockStyle } from './formatting'
import { openTableSizePicker } from './table/tableSizePicker'

export interface Insert {
  /** English; translate it where it renders */
  label: string
  icon: string
  /** English menu section */
  group: 'Media' | 'Blocks'
  isAvailable: (editor: Editor) => boolean
  /** Inserts at the selection; media entries open a picker first */
  insert: (editor: Editor) => void
}

const has = (command: string) => (editor: Editor) => command in editor.commands
const always = () => true

function fromStyle(value: string): Insert {
  const style = BLOCK_STYLES.find((block) => block.value === value) as BlockStyle
  return {
    label: style.label,
    icon: style.icon,
    group: 'Blocks',
    isAvailable: always,
    insert: (editor) => style.apply(editor.chain().focus()).run(),
  }
}

/** What the Insert menu and the slash menu add to a document, with one name each, in menu order. */
export const INSERTS: readonly Insert[] = [
  {
    label: 'Image',
    icon: 'lucide-image',
    group: 'Media',
    isAvailable: has('selectAndUploadImage'),
    insert: (editor) => editor.chain().focus().selectAndUploadImage().run(),
  },
  {
    label: 'Video',
    icon: 'lucide-video',
    group: 'Media',
    isAvailable: has('selectAndUploadVideo'),
    insert: (editor) => editor.chain().focus().selectAndUploadVideo().run(),
  },
  {
    label: 'Attachment',
    icon: 'lucide-paperclip',
    group: 'Media',
    isAvailable: has('selectAndUploadFile'),
    insert: (editor) => editor.chain().focus().selectAndUploadFile().run(),
  },
  {
    label: 'From Drive',
    icon: 'lucide-hard-drive',
    group: 'Media',
    isAvailable: (editor) => has('insertFromDrive')(editor) && editor.can().insertFromDrive(),
    insert: (editor) => editor.chain().focus().insertFromDrive().run(),
  },
  {
    label: 'Embed',
    icon: 'lucide-code-xml',
    group: 'Media',
    isAvailable: has('openIframeDialog'),
    insert: (editor) => editor.chain().focus().openIframeDialog().run(),
  },
  {
    label: 'Table',
    icon: 'lucide-table',
    group: 'Blocks',
    // A table does not nest in a cell
    isAvailable: (editor) => !isInTable(editor.state),
    insert: (editor) => openTableSizePicker(editor),
  },
  fromStyle('codeBlock'),
  fromStyle('blockquote'),
  {
    label: 'Divider',
    icon: 'lucide-minus',
    group: 'Blocks',
    isAvailable: always,
    insert: (editor) => editor.chain().focus().setHorizontalRule().run(),
  },
  {
    label: 'Page break',
    icon: 'lucide-separator-horizontal',
    group: 'Blocks',
    isAvailable: always,
    insert: (editor) => editor.chain().focus().setPageBreak().run(),
  },
]
