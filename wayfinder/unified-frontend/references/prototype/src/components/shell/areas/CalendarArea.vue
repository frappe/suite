<!--
  Calendar screen: Week, Month and Year, all hand-rolled.

  The area owns the date. One `cursor` plus the active view is enough to derive
  every title, every range and every step, so the header and the three grids
  never disagree about where they are.
-->
<template>
  <PageHeader v-if="!isMobile">
    <span class="text-xl font-semibold text-ink-gray-9">{{ title }}</span>

    <div class="flex items-center gap-2">
      <div class="flex items-center gap-0.5">
        <Tooltip placement="bottom">
          <Button
            variant="ghost"
            icon="lucide-chevron-left"
            :label="`Previous ${unit}`"
            @click="step(-1)"
          />
          <template #content>
            <span class="flex items-center gap-1.5">
              Previous {{ unit }}
              <KeyboardShortcut combo="left" />
            </span>
          </template>
        </Tooltip>
        <Tooltip placement="bottom">
          <Button variant="ghost" label="Today" @click="cursor = today()" />
          <template #content>
            <span class="flex items-center gap-1.5">
              Today
              <KeyboardShortcut combo="t" />
            </span>
          </template>
        </Tooltip>
        <Tooltip placement="bottom">
          <Button
            variant="ghost"
            icon="lucide-chevron-right"
            :label="`Next ${unit}`"
            @click="step(1)"
          />
          <template #content>
            <span class="flex items-center gap-1.5">
              Next {{ unit }}
              <KeyboardShortcut combo="right" />
            </span>
          </template>
        </Tooltip>
      </div>

      <TabButtons v-model="view" :options="VIEW_OPTIONS">
        <template #suffix="{ button }">
          <span class="text-2xs text-ink-gray-4">{{ SHORTCUT[button.modelValue] }}</span>
        </template>
      </TabButtons>

      <Button variant="solid" icon-left="lucide-plus" label="New event" />
    </div>
  </PageHeader>

  <!-- Mobile drops the keyboard hints and the New event label, and steps the
       period with an icon-only pair either side of the title instead of the
       three-button Previous/Today/Next cluster. -->
  <PageHeaderMobile v-else :title="title">
    <template #prefix>
      <Button
        variant="ghost"
        icon="lucide-chevron-left"
        :aria-label="`Previous ${unit}`"
        @click="step(-1)"
      />
    </template>
    <template #suffix>
      <Button
        variant="ghost"
        icon="lucide-chevron-right"
        :aria-label="`Next ${unit}`"
        @click="step(1)"
      />
    </template>
  </PageHeaderMobile>
  <div
    v-if="isMobile"
    class="flex shrink-0 items-center justify-between gap-2 border-b border-outline-gray-1 px-3 py-2"
  >
    <Button variant="ghost" size="sm" label="Today" @click="cursor = today()" />
    <TabButtons v-model="view" :options="VIEW_OPTIONS" />
  </div>

  <!-- The header above spans the whole app; only the body is split, so the
       panel sits beside the grid rather than beside the app. -->
  <AppSplit>
    <template #panel>
      <CalendarPanel />
    </template>

    <WeekGrid v-if="view === 'Week'" :date="cursor" />
    <MonthView v-else-if="view === 'Month'" :date="cursor" @pick="openWeekOn" />
    <YearView v-else :year="year" @pick="openWeekOn" />
  </AppSplit>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Button, KeyboardShortcut, PageHeader, PageHeaderMobile, TabButtons, Tooltip } from 'frappe-ui'
import dayjs from 'dayjs'

import { ISO, today, weekOf } from '../calendarDates'
import { jumpTo, visibleRange } from '../calendarState'
import AppSplit from '../parts/AppSplit.vue'
import CalendarPanel from '../parts/panels/CalendarPanel.vue'
import MonthView from '../parts/MonthView.vue'
import WeekGrid from '../parts/WeekGrid.vue'
import YearView from '../parts/YearView.vue'
import { isMobile } from '../useIsMobile'

type View = 'Week' | 'Month' | 'Year'

const VIEW_OPTIONS = [
  { label: 'Week', value: 'Week' },
  { label: 'Month', value: 'Month' },
  { label: 'Year', value: 'Year' },
]

const SHORTCUT: Record<string, string> = { Week: 'W', Month: 'M', Year: 'Y' }

// Day is dropped: the shell already gives every screen a wide content area, so
// a single column has nothing to add over Week.
const view = ref<View>('Week')
const cursor = ref(today())

const year = computed(() => dayjs(cursor.value).year())
const unit = computed(() => view.value.toLowerCase())

const title = computed(() => {
  if (view.value === 'Year') return String(year.value)
  if (view.value === 'Month') return dayjs(cursor.value).format('MMMM YYYY')

  const [first] = weekOf(cursor.value)
  const last = weekOf(cursor.value)[6]
  if (first.isSame(last, 'month')) return first.format('MMMM YYYY')
  if (first.isSame(last, 'year')) return `${first.format('MMM')} – ${last.format('MMM YYYY')}`
  return `${first.format('MMM YYYY')} – ${last.format('MMM YYYY')}`
})

function step(delta: number) {
  const by = view.value === 'Week' ? 'week' : view.value === 'Month' ? 'month' : 'year'
  cursor.value = dayjs(cursor.value).add(delta, by).format(ISO)
}

function openWeekOn(date: string) {
  cursor.value = date
  view.value = 'Week'
}

// ── Keyboard ──
const KEYS: Record<string, () => void> = {
  w: () => (view.value = 'Week'),
  m: () => (view.value = 'Month'),
  y: () => (view.value = 'Year'),
  t: () => (cursor.value = today()),
  arrowleft: () => step(-1),
  arrowright: () => step(1),
}

function onKeydown(event: KeyboardEvent) {
  if (event.metaKey || event.ctrlKey || event.altKey) return

  const target = event.target as HTMLElement | null
  if (target?.isContentEditable) return
  if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return

  const act = KEYS[event.key.toLowerCase()]
  if (!act) return
  event.preventDefault()
  act()
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

watch(() => jumpTo.value.seq, () => openWeekOn(jumpTo.value.date))

watch(
  [cursor, view],
  () => {
    if (view.value === 'Week') {
      const week = weekOf(cursor.value)
      visibleRange.value = { start: week[0].format(ISO), end: week[6].format(ISO) }
      return
    }
    const span = view.value === 'Month' ? 'month' : 'year'
    visibleRange.value = {
      start: dayjs(cursor.value).startOf(span).format(ISO),
      end: dayjs(cursor.value).endOf(span).format(ISO),
    }
  },
  { immediate: true },
)
</script>
