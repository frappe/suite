import type { AnyExtension } from '@tiptap/core'
import { getHierarchicalIndexes } from '@tiptap/extension-table-of-contents'
import { CharacterCount, Selection } from '@tiptap/extensions'
import { Heading, RichTextKit, type MentionSuggestionItem } from 'frappe-ui/editor'
import type { Ref } from 'vue'
import CleanStyles from '@/apps/writer/extensions/clean-styles'
import { CommentExtension } from '@/apps/writer/extensions/comments'
import { CoreEditorExtension } from '@/apps/writer/extensions/core-editor'
import EmbedExtension from '@/apps/writer/extensions/embed-extension'
import ExtendedParagraph from '@/apps/writer/extensions/extended-paragraph'
import FontFamily from '@/apps/writer/extensions/font-family'
import { FontSize } from '@/apps/writer/extensions/font-size'
import { HeadingAnchors } from '@/apps/writer/extensions/heading-anchors'
import { JoinAdjacentLists } from '@/apps/writer/extensions/join-adjacent-lists'
import { ListJoin } from '@/apps/writer/extensions/list-join'
import MediaDownload from '@/apps/writer/extensions/media-download'
import OldCommentExtension from '@/apps/writer/extensions/old-comment'
import { PageBreakExtension } from '@/apps/writer/extensions/page-break'
import { ReceivedContentGuard } from '@/apps/writer/extensions/received-content-guard'
import TabTrailingNode from '@/apps/writer/extensions/tab-trailing-node'
import { TabsExtension } from '@/apps/writer/extensions/tabs'
import { WRITER_STARTER_KIT } from '@/apps/writer/schema'

export type WriterEditorOptions = {
  collaborative: boolean
  mentionItems: () => MentionSuggestionItem[]
  onCommentActivated: (id: string) => void
  onAnchors: (anchors: unknown[]) => void
  scrollParent: () => HTMLElement | Window
  comments: unknown
  ydoc: unknown
  activeComment: Ref<unknown>
  showComments: Ref<boolean>
  showResolved: Ref<boolean>
  edited: Ref<unknown>
  onCommentsPainted: () => void
}

export const writerEditorExtensions = (options: WriterEditorOptions): AnyExtension[] => [
  RichTextKit.configure({
    starterKit: {
      ...WRITER_STARTER_KIT,
      trailingNode: { node: 'paragraph', notAfter: 'tab' },
      gapcursor: false,
      listJoin: false,
      ...(options.collaborative && { undoRedo: false }),
    },
    heading: false,
    mention: { items: options.mentionItems },
  }),
  Heading,
  ListJoin,
  ReceivedContentGuard,
  FontSize,
  FontFamily,
  EmbedExtension,
  ExtendedParagraph,
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
  JoinAdjacentLists,
  OldCommentExtension.configure({ onCommentActivated: options.onCommentActivated }),
  HeadingAnchors.configure({
    onUpdate: options.onAnchors,
    getIndex: getHierarchicalIndexes,
    scrollParent: options.scrollParent,
  }),
  MediaDownload,
  CommentExtension.configure({
    comments: options.comments,
    doc: options.ydoc,
    activeComment: options.activeComment,
    showComments: options.showComments,
    showResolved: options.showResolved,
    edited: options.edited,
    onActivated: options.onCommentActivated,
    onDecorationsPainted: options.onCommentsPainted,
  }),
]
