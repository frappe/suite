import type { AnyExtension } from '@tiptap/core'
import { getHierarchicalIndexes } from '@tiptap/extension-table-of-contents'
import { LineHeight } from '@tiptap/extension-text-style'
import { CharacterCount } from '@tiptap/extensions'
import { Heading, ImageGroup, ImageViewer, type StarterKitOptions } from 'frappe-ui/editor'

import { BlockLayout } from '@/apps/writer/extensions/block-layout'
import { BlurredSelection } from '@/apps/writer/extensions/blurred-selection'
import CleanStyles from '@/apps/writer/extensions/clean-styles'
import { CoreEditorExtension } from '@/apps/writer/extensions/core-editor'
import { DriveFiles, type PickDriveFile } from '@/apps/writer/extensions/drive-files'
import { DriveMedia, type DocumentMedia } from '@/apps/writer/extensions/drive-media'
import EmbedExtension from '@/apps/writer/extensions/embed-extension'
import ExtendedParagraph from '@/apps/writer/extensions/extended-paragraph'
import FontFamily from '@/apps/writer/extensions/font-family'
import { FontSize } from '@/apps/writer/extensions/font-size'
import { HeadingAnchors } from '@/apps/writer/extensions/heading-anchors'
import { JoinAdjacentLists } from '@/apps/writer/extensions/join-adjacent-lists'
import { WriterKeyboard } from '@/apps/writer/extensions/keyboard'
import { LinkEditing } from '@/apps/writer/extensions/link-editing'
import { ListJoin } from '@/apps/writer/extensions/list-join'
import MediaDownload from '@/apps/writer/extensions/media-download'
import { MediaInsert } from '@/apps/writer/extensions/media-insert'
import { Image, Video } from '@/apps/writer/extensions/media-sizes'
import { MentionMenuExtension } from '@/apps/writer/extensions/mention-menu'
import OldCommentExtension from '@/apps/writer/extensions/old-comment'
import { PageBreakExtension } from '@/apps/writer/extensions/page-break'
import { WriterPaste } from '@/apps/writer/extensions/paste'
import { ReceivedContentGuard } from '@/apps/writer/extensions/received-content-guard'
import { ScrollToInserted } from '@/apps/writer/extensions/scroll-to-inserted'
import { WriterSlashCommands } from '@/apps/writer/extensions/slash-commands'
import TabTrailingNode from '@/apps/writer/extensions/tab-trailing-node'
import { TablePaste } from '@/apps/writer/extensions/table-paste'
import { TablePointer } from '@/apps/writer/extensions/table-pointer'
import { WriterTableView } from '@/apps/writer/extensions/table-view'
import { TabsExtension } from '@/apps/writer/extensions/tabs'
import { UndoCaret } from '@/apps/writer/extensions/undo-caret'
import {
  HiddenWhenEmpty,
  KeptFormatting,
  WRITER_STARTER_KIT,
  WriterKit,
} from '@/apps/writer/schema'

export interface WriterEditorOptions {
  isCollaborative: boolean
  onCommentActivated: (id: string) => void
  onAnchors: (anchors: unknown[]) => void
  scrollParent: () => HTMLElement | Window
  media: DocumentMedia | null
  /** Opens Drive's file picker for "From Drive". Without it, the command is off. */
  pickDriveFile?: PickDriveFile
}

const MEDIA_EXTENSIONS: AnyExtension[] = [Image, ImageGroup, ImageViewer, Video]

const EDITING_EXTENSIONS: AnyExtension[] = [
  Heading,
  ListJoin,
  ReceivedContentGuard,
  FontSize,
  FontFamily,
  LineHeight,
  EmbedExtension,
  ExtendedParagraph,
  BlockLayout,
  CoreEditorExtension,
  PageBreakExtension,
  CharacterCount,
  BlurredSelection,
  WriterKeyboard,
  WriterPaste,
  ScrollToInserted,
  MediaInsert,
  UndoCaret,
  CleanStyles.configure({
    allowProperty: (_prop: string, value: string) => value !== '',
    validators: {
      lineHeight: (value: string) => !value.endsWith('%'),
      fontFamily: (value: string) => value.trim() !== '""',
    },
  }),
  TablePointer,
  TablePaste,
  TabsExtension,
  TabTrailingNode,
  HiddenWhenEmpty,
  JoinAdjacentLists,
]

function writerKit(options: WriterEditorOptions) {
  const starterKit: StarterKitOptions = {
    ...WRITER_STARTER_KIT,
    trailingNode: { node: 'paragraph', notAfter: 'tab' },
    gapcursor: false,
    listJoin: false,
  }
  if (options.isCollaborative) {
    starterKit.undoRedo = false
  }

  return WriterKit.configure({
    starterKit,
    heading: false,
    image: false,
    video: false,
    mention: {},
    slashCommands: false,
    styleClipboard: {},
    table: { View: WriterTableView, cellMinWidth: 64 },
  })
}

export function writerEditorExtensions(options: WriterEditorOptions): AnyExtension[] {
  return [
    writerKit(options),
    ...MEDIA_EXTENSIONS,
    MentionMenuExtension,
    ...EDITING_EXTENSIONS,
    OldCommentExtension.configure({ onCommentActivated: options.onCommentActivated }),
    KeptFormatting,
    HeadingAnchors.configure({
      onUpdate: options.onAnchors,
      getIndex: getHierarchicalIndexes,
      scrollParent: options.scrollParent,
    }),
    MediaDownload,
    DriveMedia.configure({ media: options.media }),
    DriveFiles.configure({ pickFile: options.pickDriveFile ?? null }),
    WriterSlashCommands,
    LinkEditing,
  ]
}
