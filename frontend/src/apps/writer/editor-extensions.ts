import type { AnyExtension } from '@tiptap/core'
import { getHierarchicalIndexes } from '@tiptap/extension-table-of-contents'
import { LineHeight } from '@tiptap/extension-text-style'
import { CharacterCount, Selection } from '@tiptap/extensions'
import {
  Heading,
  ImageGroup,
  ImageViewer,
  type MentionSuggestionItem,
  type StarterKitOptions,
} from 'frappe-ui/editor'

import { BlockLayout } from '@/apps/writer/extensions/block-layout'
import CleanStyles from '@/apps/writer/extensions/clean-styles'
import { CoreEditorExtension } from '@/apps/writer/extensions/core-editor'
import { DriveMedia, type DocumentMedia } from '@/apps/writer/extensions/drive-media'
import EmbedExtension from '@/apps/writer/extensions/embed-extension'
import ExtendedParagraph from '@/apps/writer/extensions/extended-paragraph'
import FontFamily from '@/apps/writer/extensions/font-family'
import { FontSize } from '@/apps/writer/extensions/font-size'
import { HeadingAnchors } from '@/apps/writer/extensions/heading-anchors'
import { JoinAdjacentLists } from '@/apps/writer/extensions/join-adjacent-lists'
import { ListJoin } from '@/apps/writer/extensions/list-join'
import MediaDownload from '@/apps/writer/extensions/media-download'
import { Image, Video } from '@/apps/writer/extensions/media-sizes'
import { MentionSearch } from '@/apps/writer/extensions/mention-search'
import OldCommentExtension from '@/apps/writer/extensions/old-comment'
import { PageBreakExtension } from '@/apps/writer/extensions/page-break'
import { ReceivedContentGuard } from '@/apps/writer/extensions/received-content-guard'
import TabTrailingNode from '@/apps/writer/extensions/tab-trailing-node'
import { TabsExtension } from '@/apps/writer/extensions/tabs'
import {
  HiddenWhenEmpty,
  KeptFormatting,
  WRITER_STARTER_KIT,
  WriterKit,
} from '@/apps/writer/schema'

declare module '@tiptap/core' {
  interface Storage {
    styleClipboard?: { painting: boolean }
  }
}

export interface WriterEditorOptions {
  isCollaborative: boolean
  mentionItems: () => MentionSuggestionItem[]
  onMentionQuery: (query: string) => void
  onCommentActivated: (id: string) => void
  onAnchors: (anchors: unknown[]) => void
  scrollParent: () => HTMLElement | Window
  media: DocumentMedia | null
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
  Selection,
  CleanStyles.configure({
    allowProperty: (_prop: string, value: string) => value !== '',
    validators: {
      lineHeight: (value: string) => !value.endsWith('%'),
      fontFamily: (value: string) => value.trim() !== '""',
    },
  }),
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
    mention: { items: options.mentionItems },
    styleClipboard: {},
  })
}

export function writerEditorExtensions(options: WriterEditorOptions): AnyExtension[] {
  return [
    writerKit(options),
    ...MEDIA_EXTENSIONS,
    MentionSearch.configure({ onQuery: options.onMentionQuery }),
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
  ]
}
