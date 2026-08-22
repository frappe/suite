<!--
  PROTOTYPE — remove. Week grid, hand-rolled.

  Ink-first: an event is a neutral card with near-black text and a 2px coloured
  rule down its left edge. No fill, no coloured type — the calendar's colour
  survives in that rule alone. Vertical column dividers are gone; the day header
  and the cards carry the columns, so the grid stops reading as a spreadsheet.
-->
<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <!-- Day header. The gutter width and right padding are repeated on every
         row below, so the columns line up with their labels. -->
    <div class="flex shrink-0 pl-12 pr-4">
      <div class="grid flex-1 grid-cols-7">
        <div
          v-for="day in days"
          :key="day.key"
          class="flex flex-col items-center gap-1 pb-3 pt-1"
        >
          <span class="text-2xs text-ink-gray-5">{{ day.weekday }}</span>
          <span
            class="flex size-8 items-center justify-center rounded-full text-xl"
            :class="
              day.isToday
                ? 'bg-surface-gray-7 font-medium text-ink-gray-1'
                : 'text-ink-gray-8'
            "
          >
            {{ day.date }}
          </span>
        </div>
      </div>
    </div>

    <!-- All-day band. Absent, not empty, when the week has none — an empty band
         is a stripe of nothing across the top of every week. -->
    <div v-if="allDayBars.length" class="flex shrink-0 border-b border-outline-gray-1 pr-4">
      <div class="w-12 shrink-0 pr-2 pt-1.5 text-right text-2xs text-ink-gray-5">
        All day
      </div>
      <div class="grid flex-1 auto-rows-[1.375rem] grid-cols-7 gap-y-0.5 pb-1.5">
        <!-- The placement style goes on the button, not on Popover: Popover
             renders no element of its own, so the button is the grid child. -->
        <Popover v-for="bar in allDayBars" :key="bar.event.id" side="bottom" align="start">
          <template #trigger="{ isOpen }">
            <button
              class="relative mx-0.5 flex min-w-0 items-center overflow-hidden rounded-1 pl-2 pr-1.5 text-left"
              :class="isOpen ? 'bg-surface-gray-4' : 'bg-surface-gray-2 hover:bg-surface-gray-3'"
              :style="{ gridColumn: `${bar.column} / span ${bar.span}`, gridRow: bar.lane + 1 }"
            >
              <span
                class="absolute inset-y-0 left-0 w-0.5"
                :class="bar.event.dot"
                aria-hidden="true"
              />
              <span class="truncate text-xs text-ink-gray-8">{{ bar.event.title }}</span>
            </button>
          </template>
          <EventDetails :event="bar.event" />
        </Popover>
      </div>
    </div>

    <!-- Hour grid -->
    <ScrollArea ref="scroller" class="min-h-0 flex-1" viewport-class="pr-4">
      <div class="flex">
        <!-- Gutter. Labels straddle their hour line, so the midnight one is
             dropped: it would be clipped against the top edge. Off-hour labels
             sit a step back, which is half the signal that the scale changed. -->
        <div class="relative w-12 shrink-0" :style="{ height: `${TOTAL_HEIGHT}px` }">
          <span
            v-for="row in rows.slice(1)"
            :key="row.hour"
            class="absolute right-2 -translate-y-1/2 text-2xs tabular-nums"
            :class="row.working ? 'text-ink-gray-4' : 'text-ink-gray-3'"
            :style="{ top: `${row.top}px` }"
          >
            {{ hourLabel(row.hour) }}
          </span>
        </div>

        <div class="relative flex-1">
          <!-- The two lines bounding the working day are drawn a step stronger:
               they are where the scale changes, so they have to be visible. -->
          <div
            v-for="row in rows"
            :key="row.hour"
            class="border-t"
            :class="row.boundary ? 'border-outline-gray-2' : 'border-outline-gray-1'"
            :style="{ height: `${row.height}px` }"
          />

          <div ref="grid" class="absolute inset-0 grid grid-cols-7">
            <div v-for="day in days" :key="day.key" class="relative">
              <Popover
                v-for="block in day.blocks"
                :key="block.event.id"
                side="right"
                align="start"
              >
                <template #trigger="{ isOpen }">
                  <!--
                    Three layouts, chosen by how much room the block actually
                    has. Cards carry no border: the 2px gap the placement leaves
                    between them is what keeps a stack legible.
                  -->
                  <button
                    class="event-card absolute flex flex-col overflow-hidden rounded-1 pl-2 pr-1.5 text-left"
                    :class="[
                      // A quarter-hour block is shorter than one line plus its
                      // padding, so the one-line layouts centre instead of
                      // padding and let the box crop the leading, not the text.
                      layoutFor(block) === 'stacked' ? 'justify-start py-0.5' : 'justify-center',
                    ]"
                    :data-past="block.past ? '' : undefined"
                    :data-active="isOpen ? '' : undefined"
                    :data-lifted="lifted === block.event.id ? '' : undefined"
                    :style="styleFor(block)"
                    @mouseenter="lift($event.currentTarget as HTMLElement, block.event.id)"
                    @mouseleave="drop"
                    @focusin="lift($event.currentTarget as HTMLElement, block.event.id)"
                    @focusout="drop"
                  >
                    <!-- The calendar's colour is a rule down the left edge, not
                         a dot on the first line. A dot belongs to the line it
                         sits on and pushes the title in; a rule belongs to the
                         whole card and leaves both lines on one left edge. -->
                    <span
                      class="absolute inset-y-0 left-0 w-0.5"
                      :class="block.event.dot"
                      aria-hidden="true"
                    />
                    <span class="flex min-w-0 items-center gap-1.5">
                      <!-- data-line marks what the lift measures for overflow. -->
                      <span
                        data-line
                        class="truncate text-xs font-medium leading-4 text-ink-gray-8"
                      >
                        {{ block.event.title }}
                      </span>
                      <!-- One-liner: the start time trails the title rather than
                           taking a second row there is no height for. It never
                           truncates — the title gives way first. -->
                      <span
                        v-if="layoutFor(block) === 'inline'"
                        class="shrink-0 text-2xs leading-4 text-ink-gray-5"
                      >
                        {{ block.startTime }}
                      </span>
                    </span>
                    <span
                      v-if="layoutFor(block) === 'stacked'"
                      data-line
                      class="truncate text-2xs leading-4 text-ink-gray-5"
                    >
                      {{ block.time }}
                    </span>
                  </button>
                </template>
                <EventDetails :event="block.event" />
              </Popover>

              <!-- Now line, today's column only. Across all seven it would be a
                   red rule through the whole week to place one moment. -->
              <div
                v-if="day.isToday"
                class="pointer-events-none absolute inset-x-0 z-10 flex items-center"
                :style="{ top: `${yFor(nowMinutes)}px` }"
              >
                <span class="-ml-0.5 size-1.5 shrink-0 rounded-full bg-surface-red-5" />
                <span class="h-px flex-1 bg-surface-red-5" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </ScrollArea>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import { Popover, ScrollArea } from 'frappe-ui'
import dayjs from 'dayjs'

import { DEMO_NOW, ISO, formatTime, hourLabel, toMinutes, weekOf } from '../calendarDates'
import { eventsBetween, isAllDay, type CalEvent } from '../calendarFixtures'
import EventDetails from './EventDetails.vue'

const props = defineProps<{
  /** Any date inside the week to show. */
  date: string
}>()

/** The working day, in hours. Outside it the scale compresses. */
const WORK_START = 8
const WORK_END = 20
/** An hour in px, inside and outside the working day. */
const WORK_HOUR = 56
const OFF_HOUR = 20
/** Column percentage each cascaded event is stepped in from the one before. */
const CASCADE_STEP = 22
/** Rendered heights a block needs for its two-line and one-line layouts. */
const STACKED_HEIGHT = 40
const INLINE_HEIGHT = 22
/** Room past the text on a lifted card, so the last word is not flush. */
const LIFT_SLACK = 8
/** A lifted card is never shorter than this — enough for a title and a time. */
const LIFT_MIN_HEIGHT = STACKED_HEIGHT

/** Cascade depth past which the fill stops stepping — see the style block. */
const STACK_MAX = 2

/**
 * Minutes → px, on a scale that is piecewise, not linear: night hours are worth
 * a third of a working hour. Nothing is hidden — 3 AM keeps a row you can
 * scroll to and drop an event on — but the twelve hours anyone books get most
 * of the screen instead of sharing it evenly with the twelve nobody does.
 */
function yFor(minutes: number): number {
  const hours = minutes / 60
  const before = Math.min(hours, WORK_START)
  const during = Math.min(Math.max(hours - WORK_START, 0), WORK_END - WORK_START)
  const after = Math.max(hours - WORK_END, 0)
  return before * OFF_HOUR + during * WORK_HOUR + after * OFF_HOUR
}

const TOTAL_HEIGHT = yFor(24 * 60)

const rows = Array.from({ length: 24 }, (_, hour) => {
  const top = yFor(hour * 60)
  return {
    hour,
    top,
    height: yFor((hour + 1) * 60) - top,
    working: hour >= WORK_START && hour < WORK_END,
    boundary: hour === WORK_START || hour === WORK_END,
  }
})

const week = computed(() => weekOf(props.date))
const weekStart = computed(() => week.value[0].format(ISO))
const weekEnd = computed(() => week.value[6].format(ISO))
const events = computed(() => eventsBetween(weekStart.value, weekEnd.value))

// ── Now line ────────────────────────────────────────────────────────────────
// The clock is pinned for the demo (see DEMO_NOW), so the ticker only runs when
// the prototype is following the real time.
const now = ref(dayjs())
let ticker: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  if (!DEMO_NOW) ticker = setInterval(() => (now.value = dayjs()), 60_000)
})
onBeforeUnmount(() => clearInterval(ticker))

const nowMinutes = computed(() =>
  DEMO_NOW ? toMinutes(DEMO_NOW) : now.value.hour() * 60 + now.value.minute(),
)

// ── Lifting a card ──────────────────────────────────────────────────────────
const grid = useTemplateRef<HTMLElement>('grid')

/** The card the pointer or keyboard is on. */
const lifted = ref<string | null>(null)
/** How wide that card has to be to finish its text, 0 when it already fits. */
const liftWidth = ref(0)
/** How tall, for a slot too thin to hold a line. 0 when it is tall enough. */
const liftHeight = ref(0)

/**
 * Lift a card: raise it over its neighbours, grow it down if the slot is too
 * thin to hold a line, and widen it rightwards if its text is cut off. A card
 * that is already on top and complete does not move at all, so hovering the
 * week is quiet rather than a row of boxes twitching.
 *
 * The measurement is the DOM's, not an estimate: `scrollWidth` past
 * `clientWidth` is what the ellipsis is hiding.
 */
async function lift(el: HTMLElement, id: string) {
  lifted.value = id
  liftWidth.value = 0

  // A quarter-hour slot is 14px. Growing downwards keeps the start time, which
  // is the edge that says when the event is; the end is what gives way.
  liftHeight.value = el.offsetHeight < LIFT_MIN_HEIGHT ? LIFT_MIN_HEIGHT : 0

  // The taller card renders a second line. Measure once that line exists, or
  // the width would be computed for a card that no longer looks like this.
  await nextTick()
  if (lifted.value !== id) return

  const lines = [...el.querySelectorAll<HTMLElement>('[data-line]')]
  const short = Math.max(0, ...lines.map((line) => line.scrollWidth - line.clientWidth))
  if (!short) return

  // The week is the limit. On the last day there is nothing to the right to
  // grow into, so the card takes what room is left instead of moving its own
  // left edge — the corner the user is reading from stays put either way.
  const right = grid.value?.getBoundingClientRect().right ?? Infinity
  const room = right - el.getBoundingClientRect().left
  const wanted = Math.min(el.offsetWidth + short + LIFT_SLACK, room)
  if (wanted > el.offsetWidth) liftWidth.value = wanted
}

function drop() {
  lifted.value = null
  liftWidth.value = 0
  liftHeight.value = 0
}

// ── Days, with their timed blocks laid out ──────────────────────────────────
const days = computed(() =>
  week.value.map((day) => {
    const key = day.format(ISO)
    return {
      key,
      weekday: day.format('ddd'),
      date: day.date(),
      isToday: key === now.value.format(ISO),
      blocks: layout(
        events.value.filter((e) => !isAllDay(e) && e.start === key),
        key,
      ),
    }
  }),
)

interface Placed {
  event: CalEvent
  lane: number
  span: number
}

interface Cluster {
  items: Placed[]
  lanes: number
}

/**
 * Pack a day's events into clusters that share screen time, each cluster using
 * the fewest lanes it can. An event then grows rightwards over any lane that is
 * free while it runs — equal shares would leave a 15-minute meeting in a busy
 * hour too narrow to read its own name, and growing gives the room back to
 * whoever can use it.
 *
 */
function pack(dayEvents: CalEvent[]): Cluster[] {
  const sorted = [...dayEvents].sort(
    (a, b) => a.startMin! - b.startMin! || b.endMin! - a.endMin!,
  )

  const clusters: Cluster[] = []
  let items: Placed[] = []
  let laneEnds: number[] = []

  const overlaps = (a: CalEvent, b: CalEvent) =>
    a.startMin! < b.endMin! && b.startMin! < a.endMin!

  const close = () => {
    for (const item of items) {
      let span = 1
      for (let l = item.lane + 1; l < laneEnds.length; l++) {
        const blocked = items.some((o) => o.lane === l && overlaps(o.event, item.event))
        if (blocked) break
        span++
      }
      item.span = span
    }
    clusters.push({ items, lanes: laneEnds.length })
    items = []
    laneEnds = []
  }

  for (const event of sorted) {
    // A gap where nothing is still running ends the cluster.
    if (items.length && laneEnds.every((end) => end <= event.startMin!)) close()

    let lane = laneEnds.findIndex((end) => end <= event.startMin!)
    if (lane === -1) lane = laneEnds.length
    laneEnds[lane] = event.endMin!
    items.push({ event, lane, span: 1 })
  }
  if (items.length) close()

  return clusters
}

/** Turn a day's clusters into cards. */
function layout(dayEvents: CalEvent[], key: string) {
  const nowKey = now.value.format(ISO)
  const isPast = (event: CalEvent) =>
    key < nowKey || (key === nowKey && event.endMin! <= nowMinutes.value)

  function card(item: Placed, left: number, width: number) {
    const { event, lane } = item
    const top = yFor(event.startMin!)
    const box = Math.max(yFor(event.endMin!) - top, 18) - 2

    // The card is laid out for the room it actually got, not for its duration:
    // the same half hour is two lines at 9 AM and one line at 8 PM.
    const layout =
      box >= STACKED_HEIGHT ? 'stacked' : box >= INLINE_HEIGHT ? 'inline' : 'title'

    return {
      event,
      past: isPast(event),
      layout,
      startTime: formatTime(event.startMin!),
      time: `${formatTime(event.startMin!)} – ${formatTime(event.endMin!)}`,
      style: {
        top: `${top}px`,
        height: `${box}px`,
        left: `calc(${left}% + 2px)`,
        width: `calc(${width}% - 4px)`,
        // A later lane sits on top, so the cascade steps forwards.
        zIndex: lane + 1,
        // How far up the stack this card is. The style block turns it into a
        // lightness step, in whichever direction the theme calls for.
        '--stack': Math.min(lane, STACK_MAX),
      },
    }
  }

  const blocks: ReturnType<typeof card>[] = []
  for (const { items, lanes } of pack(dayEvents)) {
    // Two events split the column evenly and both still read. Three or more
    // would leave 50px each, which fits a dot and two letters, so they cascade
    // instead: each one takes the rest of the column, stepped in from the last.
    // Hovering brings a covered card back — see `lift`.
    const cascading = lanes >= 3
    for (const item of items) {
      const [left, width] = cascading
        ? [item.lane * CASCADE_STEP, 100 - item.lane * CASCADE_STEP]
        : [(item.lane * 100) / lanes, (item.span * 100) / lanes]
      blocks.push(card(item, left, width))
    }
  }
  return blocks
}

// A lifted card keeps the top-left corner it already had and grows out of it,
// right and down. Snapping it to the column's left edge or lifting its top
// would move the card while the user is reading it, which reads as a different
// card in a different place.
//
// Three things happen, and any can happen alone. The card comes over its
// neighbours, so whatever the cascade was covering is back. It widens, so a
// title that was cut off finishes. It grows down, so a slot too thin for one
// line gets two. A card already on top and complete stays exactly where it is.
function styleFor(block: { event: CalEvent; style: Record<string, string | number> }) {
  if (lifted.value !== block.event.id) return block.style
  const style = { ...block.style, zIndex: 40 }
  if (liftWidth.value) style.width = `${liftWidth.value}px`
  if (liftHeight.value) style.height = `${liftHeight.value}px`
  return style
}

// A card that grew to two lines' worth of height renders two lines.
function layoutFor(block: { event: CalEvent; layout: string }) {
  const grown = lifted.value === block.event.id && liftHeight.value >= STACKED_HEIGHT
  return grown ? 'stacked' : block.layout
}

// ── All-day bars ────────────────────────────────────────────────────────────
/**
 * A span keeps one continuous bar across the days it covers, clipped to this
 * week. Bars are packed into lanes so two overlapping trips stack instead of
 * landing on top of each other.
 */
const allDayBars = computed(() => {
  const spans = events.value
    .filter(isAllDay)
    .sort((a, b) => a.start.localeCompare(b.start) || b.end.localeCompare(a.end))

  const laneEnds: string[] = []
  return spans.map((event) => {
    const from = event.start < weekStart.value ? weekStart.value : event.start
    const to = event.end > weekEnd.value ? weekEnd.value : event.end

    let lane = laneEnds.findIndex((end) => end < from)
    if (lane === -1) lane = laneEnds.length
    laneEnds[lane] = to

    return {
      event,
      lane,
      column: dayjs(from).diff(week.value[0], 'day') + 1,
      span: dayjs(to).diff(from, 'day') + 1,
    }
  })
})

// ── Opening scroll position ─────────────────────────────────────────────────
const scroller = useTemplateRef<any>('scroller')

// Open on the working day rather than midnight, and near the current hour when
// the week contains today — a 24-hour grid parked at 12 AM shows nothing.
function scrollToOpeningHour() {
  const viewport: HTMLElement | null = scroller.value?.viewportElement ?? null
  if (!viewport) return

  const hasToday = days.value.some((day) => day.isToday)
  const minutes = hasToday ? nowMinutes.value - 90 : WORK_START * 60
  viewport.scrollTop = Math.max(yFor(Math.max(minutes, 0)), 0)
}

onMounted(() => requestAnimationFrame(scrollToOpeningHour))
watch(() => props.date, () => requestAnimationFrame(scrollToOpeningHour))
</script>

<style scoped>
/*
  PROTOTYPE — the card's own colour is raw OKLCH, not the semantic tokens the
  rest of the shell uses. The stack needs steps finer than the surface scale
  has: `surface-gray-2/3/4` are three different greys, and what a stack wants is
  one grey with lightness walked in even amounts, which is what `--stack` does
  below.

  The cost is that nothing here follows the theme on its own: every value is
  written twice, once per theme. If this survives, it belongs in the token
  scale, not in a component.
*/
.event-card {
  --stack: 0;
  --fill: calc(0.968 - var(--stack) * 0.026);
  background-color: oklch(var(--fill) 0 0);
}

.event-card:hover {
  background-color: oklch(calc(var(--fill) - 0.03) 0 0);
}

/*
  A finished event is dimmed, not greyed: the whole card drops to 60% so it
  reads as behind the day. Pointing at one brings it back to full strength:
  a card you are reading should never be the faded one.
*/
.event-card[data-past] {
  opacity: 0.6;
}

.event-card[data-past]:hover,
.event-card[data-past]:focus-visible,
.event-card[data-past][data-lifted],
.event-card[data-past][data-active] {
  opacity: 1;
}

/*
  The open card is the one whose preview is on screen, so it holds a deeper fill
  than hover: hover follows the pointer and is gone the moment it leaves, while
  this has to survive the pointer travelling to the panel.
*/
.event-card[data-active],
.event-card[data-active]:hover {
  background-color: oklch(calc(var(--fill) - 0.07) 0 0);
}

/*
  The lift is four shadows, not one: each layer doubles the blur of the one
  before it and fades as it grows. A single shadow gives one hard edge of dark;
  a ramp gives a tight contact shadow at the card and a wide soft one under it,
  which is what reads as height. It is also the only edge a card gets, now that
  the hairline is gone.
*/
.event-card[data-lifted] {
  box-shadow:
    0 1px 1px oklch(0 0 0 / 0.05),
    0 2px 4px oklch(0 0 0 / 0.06),
    0 6px 10px -2px oklch(0 0 0 / 0.08),
    0 12px 20px -6px oklch(0 0 0 / 0.1);
}

/*
  Dark mode walks the other way: lighter as the stack deepens, because further
  up the stack is further from the page. The lift keeps the same four layers but
  each carries more black, since a shadow has less room to read against a dark
  ground.
*/
[data-theme='dark'] .event-card {
  --fill: calc(0.281 + var(--stack) * 0.032);
}

[data-theme='dark'] .event-card:hover {
  background-color: oklch(calc(var(--fill) + 0.035) 0 0);
}

[data-theme='dark'] .event-card[data-active],
[data-theme='dark'] .event-card[data-active]:hover {
  background-color: oklch(calc(var(--fill) + 0.08) 0 0);
}

[data-theme='dark'] .event-card[data-lifted] {
  box-shadow:
    0 1px 2px oklch(0 0 0 / 0.35),
    0 3px 6px oklch(0 0 0 / 0.4),
    0 8px 14px -2px oklch(0 0 0 / 0.45),
    0 16px 26px -8px oklch(0 0 0 / 0.5);
}
</style>
