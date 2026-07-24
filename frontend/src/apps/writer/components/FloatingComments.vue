<template>
  <div ref="scrollContainer" class="absolute inset-0">
    <template v-if="showComments" v-for="comment in filteredComments" :key="comment.id">
      <Teleport v-if="!collapsed || activeComment === comment.id" :disabled="!isMobile" to="body">
        <div :id="'comment-' + comment.id" :ref="(el) => {
        if (el) commentRefs[comment.id] = el
        else delete commentRefs[comment.id]
      }
        " v-on-outside-click="(e) => onOutsideCardClick(e, comment)"
          class="absolute rounded shadow w-56 comment-group scroll-m-24 bg-surface-base dark:border max-md:fixed max-md:inset-x-4 max-md:bottom-4 max-md:top-auto max-md:w-auto max-md:max-w-sm max-md:mx-auto max-md:max-h-[65vh] max-md:overflow-y-auto max-md:shadow-xl"
          :class="[
            activeComment === comment.id && 'shadow-xl ',
            isMobile || comment.top
              ? 'opacity-100 pointer-events-auto'
              : 'opacity-0 pointer-events-none',
          ]" :style="cardStyle(comment)" @click="activeComment = comment.id">
          <Button class="md:!hidden absolute top-1 right-1" size="sm" variant="ghost" :icon="LucideX"
            @click.stop="activeComment = null" />
        <div v-show="activeComment === comment.id &&
          currentUserId !== 'Guest' &&
          !comment.new &&
          (comment.owner == currentUserId || file.doc.write)
          " class="p-1.5 text-sm flex gap-1 border-b text-ink-gray-9"
          :class="comment.loading && !comment.edit && 'opacity-70'">
          <Button v-if="
            !comment.resolved &&
            (comment.owner == currentUserId || file.doc.write)
          " :disabled="comment.loading" variant="ghost" class="!h-5 !text-xs !px-1.5 !rounded-sm"
            @click="resolve(comment)">
            <template #prefix>
              <LucideCheck class="size-3.5" />
            </template>
            Resolve
          </Button>
          <Button v-if="
            comment.resolved &&
            (comment.owner == currentUserId || file.doc.write)
          " :disabled="comment.loading" variant="ghost" class="!h-5 !text-xs !px-1.5 !rounded-sm"
            @click="resolve(comment, false)">
            <template #prefix>
              <LucideMessageCircleCode class="size-3.5" />
            </template>
            Unresolve
          </Button>
          <Button v-if="
            comment.owner == currentUserId ||
            (comment.owner === 'Guest' && file.doc.write)
          " :disabled="comment.loading" variant="ghost" class="!h-5 !text-xs !px-1.5 !rounded-sm"
            @click="removeComment(comment.id, true)">
            <template #prefix>
              <LucideX class="size-3.5" />
            </template>
            Delete
          </Button>
        </div>
        <div class="p-3 max-md:px-4" :class="activeComment !== comment.id &&
          comment.replies.length > 0 &&
          'pb-1.5'
          ">
          <blockquote v-if="comment.detached" class="text-xs text-ink-gray-8 mb-4">
            Replying to:
            <span class="text-ink-gray-5 italic">{{ comment.anchorText }}</span>
          </blockquote>
          <div class="flex flex-col gap-5">
            <div v-for="(reply, index) in activeComment === comment.id
              ? [
                comment,
                ...comment.replies.toSorted((a, b) =>
                  new Date(a.creation) > new Date(b.creation) ? 1 : -1,
                ),
              ]
              : [comment]" :key="reply.name || reply.id" class="group flex-grow flex gap-3"
              :class="reply.loading && !reply.edit && 'opacity-70'">
              <div class="w-8 flex justify-center">
                <Avatar size="xl" class="bg-surface-base" :label="$user(reply.owner)?.full_name || reply.owner"
                  :image="$user(reply.owner)?.user_image" />
              </div>
              <div class="grow flex flex-col min-w-0"
                :class="reply.edit || reply.new ? 'gap-1.5' : 'gap-1'">
                <div class="w-full flex justify-between items-start label-group gap-1 text-sm">
                  <div class="flex gap-1 min-w-0">
                    <label class="font-medium text-ink-gray-8 truncate">{{ $user(reply.owner)?.full_name ||
                      reply.owner }}</label>

                    <label class="text-ink-gray-6 shrink-0 whitespace-nowrap" :title="new Date(reply.creation)">
                      &#183;
                      {{ formatDateOrTime(reply.creation) }}</label>
                  </div>
                  <Dropdown v-if="comment.owner == currentUserId && !reply.new && !reply.edit"
                    class="ml-auto shrink-0 opacity-0" :class="activeComment === comment.id &&
                    !reply.edit &&
                    !reply.resolved &&
                    comment.owner == currentUserId &&
                    'opacity-100'
                    " :options="dynamicList([
                      {
                        label: 'Edit',
                        icon: 'lucide-pencil',
                        onClick: () => (reply.edit = true),
                        cond: comment.owner == currentUserId && !reply.new,
                      },
                      {
                        label: 'Delete',
                        onClick: () => removeReply(comment.id, reply.id),
                        cond:
                          comment.owner == currentUserId &&
                          index !== 0 &&
                          !reply.new,
                      },
                    ])
                      ">
                    <Button :disabled="activeComment !== comment.id ||
                      reply.edit ||
                      reply.resolved
                      " size="xs" class="opacity-0" :class="activeComment === comment.id &&
                        !reply.edit &&
                        !reply.resolved &&
                        comment.owner == currentUserId &&
                        'opacity-100'
                        " variant="ghost" :icon="LucideMoreVertical" />
                  </Dropdown>
                  <LucideBadgeCheck v-if="comment.resolved" class="text-ink-gray-6 size-4" />
                </div>
                <div class="comment-content text-sm">
                  <CommentEditor v-model="commentContents[reply.id]" placeholder="Edit" :disabled="isEmpty(commentContents[reply.id]) ||
                    commentContents[reply.id] == reply.text
                    " :editable="!!(reply.edit || reply.new) &&
                      reply.owner === currentUserId
                      " :content="reply.text" @change="setCommentHeights" @submit="
                        (editor) => {
                          updateComment(reply, comment, editor)
                        }
                      " @cancel="
                      (editor) => {
                        if (reply.new) {
                          removeComment(reply.id)
                        } else {
                          editor.commands.setContent(reply.text)
                          reply.edit = false
                        }
                      }
                    " />
                </div>
              </div>
            </div>

            <div v-show="activeComment === comment.id &&
              !(comment.edit || comment.new) &&
              !comment.resolved
              " class="flex gap-3">
              <Avatar size="xl" class="self-center" :label="$user(currentUserId)?.full_name || currentUserId
                " :image="$user(currentUserId)?.user_image" />

              <CommentEditor v-model="newReplies[comment.id]" placeholder="Reply"
                :is-empty="isEmpty(newReplies[comment.id])" @change="setCommentHeights"
                @submit="(editor) => newReply(comment, editor)" @cancel="
                  (editor) => {
                    newReplies[comment.id] = ''
                    editor.commands.setContent('')
                    editor.commands.blur()
                  }
                " />
            </div>
          </div>
        </div>
        <div v-if="activeComment !== comment.id && comment.replies.length > 0"
          class="replies-count text-ink-gray-6 font-base text-xs p-3 pt-0 max-md:px-4">
          {{ comment.replies.length }}
          {{ comment.replies.length === 1 ? 'reply' : 'replies' }}
        </div>
        </div>
      </Teleport>
      <button v-else :id="'comment-' + comment.id" :ref="(el) => {
        if (el) commentRefs[comment.id] = el
        else delete commentRefs[comment.id]
      }
        " class="absolute flex items-center rounded-full border border-outline-gray-2 bg-surface-base p-0.5 transition-colors hover:bg-surface-gray-2"
        :class="comment.top ? 'opacity-100' : 'opacity-0 pointer-events-none'"
        :style="{ top: `${comment.top}px`, right: '1rem' }" @click.stop="activeComment = comment.id">
        <Avatar size="sm" :label="$user(comment.owner)?.full_name || comment.owner"
          :image="$user(comment.owner)?.user_image" />
        <span v-if="comment.replies.length" class="px-1 text-[10px] leading-none text-ink-gray-6">
          {{ comment.replies.length + 1 }}</span>
      </button>
    </template>
  </div>
</template>
<script setup>
import {
  computed,
  reactive,
  watch,
  onMounted,
  ref,
  onBeforeUnmount,
  nextTick,
} from 'vue'
import { Avatar, Button, Dropdown, onOutsideClickDirective as vOnOutsideClick } from 'frappe-ui'
import { formatDate } from '@/apps/writer/utils/format'
import { dynamicList } from '@/apps/writer/utils/'
import { v4 } from 'uuid'
import { useDebounceFn, useEventListener, useMediaQuery } from '@vueuse/core'
import LucideX from '~icons/lucide/x'
import LucideCheck from '~icons/lucide/check'
import LucideMessageCircleCode from '~icons/lucide/message-circle-code'
import LucideMoreVertical from '~icons/lucide/more-vertical'

import { useSessionStore } from '@/boot/session'
const currentUserId = computed(() => useSessionStore().user)
import { useUsers } from '@/apps/writer/composables/useUsers'
import CommentEditor from './CommentEditor.vue'
import { rebuild, getEditorPos } from '@/apps/writer/extensions/comments'

// Template compat for the `$store` / `$user` globals the templates reference.
const $store = store
const { getUser: $user } = useUsers()

const props = defineProps({
  file: Object,
  editor: Object,
  yComments: Object,
  showComments: Boolean,
  showResolved: Boolean,
  showUnanchored: Boolean,
})
const emit = defineEmits(['save'])

const activeComment = defineModel('activeComment')
const scrollContainer = ref('scrollContainer')

const isMobile = useMediaQuery('(max-width: 767px)')
const compact = ref(false)
const collapsed = computed(() => compact.value || isMobile.value)

const onOutsideCardClick = (e, comment) => {
  if (activeComment.value !== comment.id || comment.new) return
  const t = e.target
  if (t.getAttribute?.('data-comment-name')) return
  if (!t.closest?.('.comment-group')) activeComment.value = null
}

const cardStyle = (comment) =>
  isMobile.value ? {} : { top: `${comment.top}px`, right: '1rem' }

const newReplies = reactive({})
const commentRefs = reactive({})
const commentContents = reactive({})

// for old schema, where comment positions isn't in the map
const commentPositions = computed(() => {
  const positions = new Map()

  props.editor.state.doc.descendants((node, pos) => {
    node.marks.forEach((mark) => {
      if (mark.type.name === 'comment' && mark.attrs.commentId) {
        if (!positions.has(mark.attrs.commentId)) {
          positions.set(mark.attrs.commentId, pos)
        }
      }
    })
  })
  return positions
})

function useYMapReactive(yMap) {
  const local = ref([])

  const update = () => {
    const prev = new Map(local.value.map((c) => [c.id, c]))
    const arr = []
    yMap.forEach((v) => {
      let pos
      if (!v.anchor?.from) pos = commentPositions.value.get(v.id) ?? 0
      else pos = getEditorPos(v.anchor.from, props.editor)
      const old = prev.get(v.id)
      arr.push({ top: old?.top, detached: old?.detached, ...v, pos })
    })
    local.value = arr.sort((a, b) => a.pos - b.pos)
  }

  update()
  const onChange = () => {
    update()
    setCommentHeights()
  }
  yMap.observe(onChange)

  onBeforeUnmount(() => yMap.unobserve(onChange))

  return local
}
const comments = useYMapReactive(props.yComments)

const filteredComments = computed(() => {
  const filtered = props.showResolved
    ? comments.value
    : comments.value.filter((k) => !k.resolved)
  return filtered
})

watch(
  () => props.showResolved,
  () => rebuild(props.editor),
)

watch([activeComment, collapsed, () => props.showUnanchored], () => {
  setCommentHeights()
})

const sanitize = (comment) => {
  delete comment.new
  comment.edit = false
  const obj = { ...comment }
  delete obj.edit
  delete obj.new
  delete obj.top
  return obj
}

const updateComment = (comment, thread, editor) => {
  comment.text = commentContents[comment.id]
  comment.edit = false
  comment.mentions = editor.commands.getMentions()

  // // Prompt to share for users without access.
  // const usersMentioned = comment.mentions.filter((k) => k.id)

  // if (usersMentioned.length)
  //   toast.info('Share with the tagged people?', {
  //     action: {
  //       label: 'Go',
  //       onClick: () => emitter.emit('share', usersMentioned),
  //     },
  //   })
  if (comment.id === thread.id) {
    props.yComments.set(comment.id, sanitize(comment))
  } else {
    thread.replies = thread.replies.map((r) =>
      r.id === comment.id ? sanitize(comment) : r,
    )
    props.yComments.set(thread.id, sanitize(thread))
  }
  emit('save')
}

const newReply = (comment, editor) => {
  const id = v4()
  const reply = {
    id,
    text: newReplies[comment.id],
    owner: currentUserId.value,
    creation: Date.now(),
    mentions: editor.commands.getMentions(),
  }
  comment.replies.push(reply)
  props.yComments.set(comment.id, comment)

  editor.commands.setContent('')
  setCommentHeights()
  emit('save')
}

const removeReply = (commentId, replyId) => {
  const comment = comments.value.find((c) => c.id === commentId)
  if (!comment) return

  const updatedReplies = comment.replies.filter((r) => r.id !== replyId)
  const updatedComment = { ...comment, replies: updatedReplies }
  props.yComments.set(commentId, updatedComment)

  setCommentHeights()
  emit('save')
}

const removeComment = (commentId) => {
  props.yComments.delete(commentId)
  setCommentHeights()
  emit('save')
  rebuild(props.editor)
}

const resolve = (comment, value = true) => {
  const updatedComment = { ...comment, resolved: value }
  props.yComments.set(comment.id, sanitize(updatedComment))
  emit('save')
}

const isEmpty = (editorContent) => {
  return (
    !editorContent ||
    !editorContent.length ||
    editorContent.replace(/\s/g, '') == '<p></p>'
  )
}

const formatDateOrTime = (datetimeNum) => {
  const now = new Date()
  const datetime = new Date(datetimeNum)
  const isToday =
    datetime.getDate() === now.getDate() &&
    datetime.getMonth() === now.getMonth() &&
    datetime.getFullYear() === now.getFullYear()
  const [dateStr, timeStr] = formatDate(datetime).split(', ')
  return isToday ? timeStr : dateStr
}

const setCommentHeights = useDebounceFn(() => {
  let lastBottom = 0
  nextTick(() => {
    const containerTop = scrollContainer.value.getBoundingClientRect().top
    for (const comment of filteredComments.value) {
      try {
        const el =
          document.querySelector(`[data-comment-name="${comment.id}"]`) ||
          document.querySelector(`[data-comment-id="${comment.id}"]`)
        let anchorTop
        if (comment.new && comment.owner !== currentUserId.value) anchorTop = 0
        else if (!el && comment.anchorText) {
          comment.detached = 1
          anchorTop = props.showUnanchored ? 48 : 0
        } else {
          const elTop = el.getBoundingClientRect().top
          anchorTop = elTop ? elTop - containerTop : 0
          comment.detached = 0
        }
        const adjustedTop = anchorTop ? Math.max(anchorTop, lastBottom) : 0
        comment.top = adjustedTop
        if (adjustedTop)
          lastBottom = adjustedTop + commentRefs[comment.id].offsetHeight + 12
      } catch (e) {
        console.log(e)
      }
    }
  })
}, 100)

onMounted(() => {
  setCommentHeights()
  const onTabChange = () => {
    activeComment.value = null
    setCommentHeights()
  }
  props.editor.view.dom.addEventListener('tab-changed', onTabChange)
  const resizeObserver = new ResizeObserver(setCommentHeights)
  resizeObserver.observe(props.editor.view.dom)
  const railObserver = new ResizeObserver(([entry]) => {
    compact.value = entry.contentRect.width < 220
  })
  railObserver.observe(scrollContainer.value)
  onBeforeUnmount(() => {
    resizeObserver.disconnect()
    railObserver.disconnect()
    try {
      const dom = props.editor?.view?.dom
      dom.removeEventListener('tab-changed', onTabChange)
    } catch { }
  })
})

watch(() => filteredComments.value.length, setCommentHeights)
useEventListener(window, 'resize', setCommentHeights)

props.editor.on('update', () => {
  setCommentHeights()
})

const purgeNewEmptyComments = () => {
  for (const comment of comments.value)
    if (comment.new) removeComment(comment.id, true)
}

onBeforeUnmount(purgeNewEmptyComments)
useEventListener(window, 'beforeunload', purgeNewEmptyComments)
</script>
