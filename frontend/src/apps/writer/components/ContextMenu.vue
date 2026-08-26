<script setup lang="ts">
import { Icon } from '@iconify/vue'
import {
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuItemIndicator,
  ContextMenuLabel,
  ContextMenuPortal,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuRoot,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from 'reka-ui'
import { ref } from 'vue'

const checkboxOne = ref(false)
const checkboxTwo = ref(false)
const person = ref('pedro')

function handleClick() {
  alert('hello!')
}
</script>

<template>
  <ContextMenuRoot>
    <ContextMenuTrigger
      as-child
      class="block border-2 border-dashed border-outline-gray-2 rounded-6 text-ink-gray-7 text-sm select-none py-[45px] w-[300px] text-center"
    >
      <span>Right click here.</span>
    </ContextMenuTrigger>

    <ContextMenuPortal>
      <ContextMenuContent
        class="min-w-[220px] z-30 bg-surface-elevation-2 rounded-6 p-1.5 shadow-2xl ring-1 ring-black ring-opacity-5 focus:outline-none will-change-[opacity,transform] data-[side=top]:animate-slideDownAndFade data-[side=right]:animate-slideLeftAndFade data-[side=bottom]:animate-slideUpAndFade data-[side=left]:animate-slideRightAndFade"
        :side-offset="5"
      >
        <!-- New Tab -->
        <ContextMenuItem
          class="group text-base leading-none text-ink-gray-7 rounded-4 flex items-center h-7 px-2 relative pl-7 select-none outline-none cursor-pointer data-[disabled]:opacity-50 data-[disabled]:pointer-events-none data-[highlighted]:bg-surface-gray-3"
          @click="handleClick"
        >
          New Tab
          <div
            class="ml-auto pl-5 text-ink-gray-5 group-data-[highlighted]:text-ink-gray-7"
          >
            ⌘+T
          </div>
        </ContextMenuItem>

        <!-- New Window -->
        <ContextMenuItem
          class="group text-base leading-none text-ink-gray-7 rounded-4 flex items-center h-7 px-2 relative pl-7 select-none outline-none cursor-pointer data-[disabled]:opacity-50 data-[disabled]:pointer-events-none data-[highlighted]:bg-surface-gray-3"
        >
          New Window
          <div
            class="ml-auto pl-5 text-ink-gray-5 group-data-[highlighted]:text-ink-gray-7"
          >
            ⌘+N
          </div>
        </ContextMenuItem>

        <!-- New Private Window (disabled) -->
        <ContextMenuItem
          class="group text-base leading-none text-ink-gray-7 rounded-4 flex items-center h-7 px-2 relative pl-7 select-none outline-none cursor-pointer data-[disabled]:opacity-50 data-[disabled]:pointer-events-none data-[highlighted]:bg-surface-gray-3"
          disabled
        >
          New Private Window
          <div
            class="ml-auto pl-5 text-ink-gray-5 group-data-[highlighted]:text-ink-gray-7"
          >
            ⇧+⌘+N
          </div>
        </ContextMenuItem>

        <!-- More Tools (sub) -->
        <ContextMenuSub>
          <ContextMenuSubTrigger
            class="group text-base leading-none text-ink-gray-7 rounded-4 flex items-center h-7 px-2 relative pl-7 select-none w-full outline-none cursor-pointer data-[state=open]:bg-surface-gray-2 data-[disabled]:opacity-50 data-[disabled]:pointer-events-none data-[highlighted]:bg-surface-gray-3 data-[highlighted]:data-[state=open]:bg-surface-gray-3"
          >
            More Tools
            <div
              class="ml-auto pl-5 text-ink-gray-5 group-data-[highlighted]:text-ink-gray-7"
            >
              <Icon icon="radix-icons:chevron-right" class="h-4 w-4" />
            </div>
          </ContextMenuSubTrigger>
          <ContextMenuPortal>
            <ContextMenuSubContent
              class="min-w-[220px] z-30 bg-surface-elevation-2 rounded-6 p-1.5 shadow-2xl ring-1 ring-black ring-opacity-5 focus:outline-none will-change-[opacity,transform] data-[side=top]:animate-slideDownAndFade data-[side=right]:animate-slideLeftAndFade data-[side=bottom]:animate-slideUpAndFade data-[side=left]:animate-slideRightAndFade"
              :side-offset="2"
              :align-offset="-5"
            >
              <ContextMenuItem
                class="group text-base leading-none text-ink-gray-7 rounded-4 flex items-center h-7 px-2 relative pl-7 select-none outline-none cursor-pointer data-[highlighted]:bg-surface-gray-3"
              >
                Save Page As…
                <div
                  class="ml-auto pl-5 text-ink-gray-5 group-data-[highlighted]:text-ink-gray-7"
                >
                  ⌘+S
                </div>
              </ContextMenuItem>
              <ContextMenuItem
                class="text-base leading-none text-ink-gray-7 rounded-4 flex items-center h-7 px-2 relative pl-7 select-none outline-none cursor-pointer data-[highlighted]:bg-surface-gray-3"
              >
                Create Shortcut…
              </ContextMenuItem>
              <ContextMenuItem
                class="text-base leading-none text-ink-gray-7 rounded-4 flex items-center h-7 px-2 relative pl-7 select-none outline-none cursor-pointer data-[highlighted]:bg-surface-gray-3"
              >
                Name Window…
              </ContextMenuItem>
              <ContextMenuSeparator
                class="h-[1px] bg-outline-gray-2 my-1.5 mx-1"
              />
              <ContextMenuItem
                class="text-base leading-none text-ink-gray-7 rounded-4 flex items-center h-7 px-2 relative pl-7 select-none outline-none cursor-pointer data-[highlighted]:bg-surface-gray-3"
              >
                Developer Tools
              </ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuPortal>
        </ContextMenuSub>

        <ContextMenuSeparator class="h-[1px] bg-outline-gray-2 my-1.5 mx-1" />

        <!-- Checkboxes -->
        <ContextMenuCheckboxItem
          v-model="checkboxOne"
          class="group text-base leading-none text-ink-gray-7 rounded-4 flex items-center h-7 px-2 relative pl-7 select-none outline-none cursor-pointer data-[disabled]:opacity-50 data-[disabled]:pointer-events-none data-[highlighted]:bg-surface-gray-3"
        >
          <ContextMenuItemIndicator
            class="absolute left-0 w-7 inline-flex items-center justify-center text-ink-gray-7"
          >
            <Icon icon="radix-icons:check" class="h-4 w-4" />
          </ContextMenuItemIndicator>
          Show Bookmarks
          <div
            class="ml-auto pl-5 text-ink-gray-5 group-data-[highlighted]:text-ink-gray-7"
          >
            ⌘+B
          </div>
        </ContextMenuCheckboxItem>

        <ContextMenuCheckboxItem
          v-model="checkboxTwo"
          class="text-base leading-none text-ink-gray-7 rounded-4 flex items-center h-7 px-2 relative pl-7 select-none outline-none cursor-pointer data-[highlighted]:bg-surface-gray-3"
        >
          <ContextMenuItemIndicator
            class="absolute left-0 w-7 inline-flex items-center justify-center text-ink-gray-7"
          >
            <Icon icon="radix-icons:check" class="h-4 w-4" />
          </ContextMenuItemIndicator>
          Show Full URLs
        </ContextMenuCheckboxItem>

        <ContextMenuSeparator class="h-[1px] bg-outline-gray-2 my-1.5 mx-1" />

        <!-- Radio Group -->
        <ContextMenuLabel class="pl-7 text-xs leading-7 text-ink-gray-5">
          People
        </ContextMenuLabel>
        <ContextMenuRadioGroup v-model="person">
          <ContextMenuRadioItem
            class="text-base leading-none text-ink-gray-7 rounded-4 flex items-center h-7 px-2 relative pl-7 select-none outline-none cursor-pointer data-[highlighted]:bg-surface-gray-3"
            value="pedro"
          >
            <ContextMenuItemIndicator
              class="absolute left-0 w-7 inline-flex items-center justify-center text-ink-gray-7"
            >
              <Icon icon="radix-icons:dot-filled" class="h-4 w-4" />
            </ContextMenuItemIndicator>
            Pedro Duarte
          </ContextMenuRadioItem>
          <ContextMenuRadioItem
            class="text-base leading-none text-ink-gray-7 rounded-4 flex items-center h-7 px-2 relative pl-7 select-none outline-none cursor-pointer data-[highlighted]:bg-surface-gray-3"
            value="colm"
          >
            <ContextMenuItemIndicator
              class="absolute left-0 w-7 inline-flex items-center justify-center text-ink-gray-7"
            >
              <Icon icon="radix-icons:dot-filled" class="h-4 w-4" />
            </ContextMenuItemIndicator>
            Colm Tuite
          </ContextMenuRadioItem>
        </ContextMenuRadioGroup>
      </ContextMenuContent>
    </ContextMenuPortal>
  </ContextMenuRoot>
</template>
