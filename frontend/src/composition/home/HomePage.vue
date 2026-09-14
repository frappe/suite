<template>
  <div class="flex h-full min-h-0 flex-col">
    <PageHeader v-if="!isMobile">
      <div class="flex w-full items-center justify-between">
        <PageHeaderTitle :title="__('Home')" />
        <Dropdown :options="newMenuItems" align="end">
          <Button
            :loading="createDocumentMutation.isPending"
            :label="__('New')"
            icon-right="lucide-chevrons-up-down"
            variant="subtle"
          />
        </Dropdown>
      </div>
    </PageHeader>
    <PageHeaderMobile v-else :title="__('Home')">
      <template #suffix>
        <Dropdown :options="newMenuItems" align="end">
          <Button
            :loading="createDocumentMutation.isPending"
            :label="__('New')"
            icon-right="lucide-chevrons-up-down"
            variant="subtle"
          />
        </Dropdown>
      </template>
    </PageHeaderMobile>

    <ScrollArea class="min-h-0 flex-1">
      <div
        class="mx-auto flex w-full max-w-4xl flex-col gap-8 px-3 pb-40 pt-5 sm:px-5 sm:py-6"
      >
        <section aria-labelledby="home-recent-heading">
          <div class="flex items-center justify-between pb-3">
            <h2
              id="home-recent-heading"
              class="text-lg-semibold text-ink-gray-8"
            >
              {{ __("Recent") }}
            </h2>
            <Button
              :label="__('View all')"
              route="/files/recent"
              variant="ghost"
            />
          </div>

          <div
            v-if="recentQuery.status === 'pending' && !recentRows.length"
            class="grid grid-cols-2 gap-3 lg:grid-cols-4"
            aria-label="Loading recent documents"
          >
            <div
              v-for="index in 4"
              :key="index"
              class="rounded-5 border border-outline-gray-1 p-3"
            >
              <Skeleton class="mb-3 size-4.5" />
              <Skeleton class="mb-2 h-4 w-4/5" />
              <Skeleton class="h-3 w-2/5" />
            </div>
          </div>
          <div
            v-else-if="recentQuery.status === 'error' && !recentRows.length"
            class="flex items-center justify-between rounded-5 border border-outline-gray-1 px-3 py-4"
            data-testid="recent-error"
          >
            <p class="text-p-sm text-ink-red-7">
              {{
                recentQuery.error?.message || __("Could not load recent files.")
              }}
            </p>
            <Button
              :label="__('Retry')"
              variant="ghost"
              @click="recentQuery.refetch()"
            />
          </div>
          <div
            v-else-if="!recentRows.length"
            class="flex items-center justify-between rounded-5 border border-outline-gray-1 px-3 py-4"
          >
            <p class="text-p-sm text-ink-gray-5">{{ __("Nothing yet") }}</p>
            <Dropdown :options="newMenuItems" align="end">
              <Button
                :label="__('New')"
                icon-left="lucide-plus"
                variant="ghost"
              />
            </Dropdown>
          </div>
          <div
            v-else
            class="grid grid-cols-2 gap-3 lg:grid-cols-4"
            data-testid="recent-rows"
          >
            <RouterLink
              v-for="node in recentRows"
              :key="node.name"
              :to="driveNodeRoute(node)"
              class="flex min-w-0 flex-col items-start gap-3 rounded-5 border border-outline-gray-1 bg-surface-base p-3 text-left hover:bg-surface-gray-1"
            >
              <span
                class="size-4.5"
                :class="nodeIcon(node)"
                aria-hidden="true"
              />
              <span class="flex w-full min-w-0 flex-col gap-0.5">
                <span class="w-full truncate text-base-medium text-ink-gray-8">
                  {{ node.title }}
                </span>
                <span class="text-xs text-ink-gray-5">
                  {{ formatOpenedAt(node.opened_at, homeNow) }}
                </span>
              </span>
            </RouterLink>
          </div>
          <div
            v-if="recentQuery.status === 'error' && recentRows.length"
            class="mt-3 flex items-center justify-between rounded-4 bg-surface-red-2 px-3 py-2"
          >
            <p class="text-p-sm text-ink-red-7">
              {{ __("Recent files could not be refreshed.") }}
            </p>
            <Button
              :label="__('Retry')"
              variant="ghost"
              theme="red"
              @click="recentQuery.refetch()"
            />
          </div>
        </section>

        <section aria-labelledby="home-upcoming-heading">
          <div class="flex flex-wrap items-center justify-between gap-2 pb-3">
            <h2
              id="home-upcoming-heading"
              class="text-lg-semibold text-ink-gray-8"
            >
              {{ __("Upcoming") }}
            </h2>
            <div class="flex items-center gap-1">
              <Dropdown :options="meetMenuItems" align="end">
                <Button
                  :loading="createRoomMutation.isPending"
                  :label="__('Meet')"
                  icon-right="lucide-chevron-down"
                  variant="ghost"
                />
              </Dropdown>
              <Dropdown :options="scheduleMenuItems" align="end">
                <Button
                  :label="__('Schedule')"
                  icon-right="lucide-chevron-down"
                  variant="ghost"
                />
              </Dropdown>
              <Button
                :label="__('View all')"
                route="/calendar"
                variant="ghost"
              />
            </div>
          </div>

          <div
            v-if="upcomingQuery.status === 'pending' && !upcomingEvents.length"
            class="space-y-2"
            aria-label="Loading upcoming events"
          >
            <Skeleton v-for="index in 3" :key="index" class="h-10 w-full" />
          </div>
          <div
            v-else-if="
              upcomingQuery.status === 'error' && !upcomingEvents.length
            "
            class="flex items-center justify-between rounded-5 border border-outline-gray-1 px-3 py-4"
            data-testid="upcoming-error"
          >
            <p class="text-p-sm text-ink-red-7">
              {{
                upcomingQuery.error?.message ||
                __("Could not load upcoming events.")
              }}
            </p>
            <Button
              :label="__('Retry')"
              variant="ghost"
              @click="upcomingQuery.refetch()"
            />
          </div>
          <p
            v-else-if="!eventGroups.length"
            class="rounded-5 border border-outline-gray-1 px-3 py-8 text-center text-p-sm text-ink-gray-5"
          >
            {{ __("Nothing scheduled") }}
          </p>
          <List
            v-else
            class="-mx-3 list-row-px-3"
            :columns="
              isMobile
                ? ['5.5rem', 'minmax(0,1fr)', '4rem']
                : ['7rem', 'minmax(0,1fr)', '5rem']
            "
            :row-height="isMobile ? 48 : 40"
            data-testid="upcoming-rows"
          >
            <ListGroup
              v-for="group in eventGroups"
              :key="group.day"
              :label="__(group.day)"
            >
              <ListRow
                v-for="event in group.events"
                :key="eventKey(event)"
                :value="eventKey(event)"
              >
                <ListCell>
                  <span class="truncate text-base text-ink-gray-5">
                    {{ formatEventTime(event) }}
                  </span>
                </ListCell>
                <ListCell>
                  <span class="truncate text-base text-ink-gray-8">
                    {{ event.title || __("Untitled event") }}
                  </span>
                </ListCell>
                <ListCell class="justify-end">
                  <Button
                    v-if="event.conferencing"
                    :label="__('Join')"
                    icon-left="lucide-video"
                    variant="outline"
                    :route="meetRoute(event.conferencing.meeting_id)"
                  />
                </ListCell>
              </ListRow>
            </ListGroup>
          </List>
          <div
            v-if="upcomingQuery.status === 'error' && upcomingEvents.length"
            class="mt-3 flex items-center justify-between rounded-4 bg-surface-red-2 px-3 py-2"
          >
            <p class="text-p-sm text-ink-red-7">
              {{ __("Upcoming events could not be refreshed.") }}
            </p>
            <Button
              :label="__('Retry')"
              variant="ghost"
              theme="red"
              @click="upcomingQuery.refetch()"
            />
          </div>
        </section>
      </div>
    </ScrollArea>

    <Dialog
      v-model:open="joinDialogOpen"
      :title="__('Join with code')"
      size="sm"
    >
      <FormControl
        v-model="meetingCode"
        :error="meetingCodeError"
        :label="__('Meeting code')"
        placeholder="abcd-efgh-ijkl"
        @keydown.enter="joinWithCode"
      />
      <template #actions>
        <div class="flex justify-end gap-2">
          <Button :label="__('Cancel')" @click="joinDialogOpen = false" />
          <Button :label="__('Join')" variant="solid" @click="joinWithCode" />
        </div>
      </template>
    </Dialog>

    <Dialog
      v-model:open="scheduleDialogOpen"
      :title="__('Schedule meeting')"
      size="md"
    >
      <div class="space-y-4">
        <FormControl v-model="meetingTitle" :label="__('Title')" required />
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormControl
            v-model="meetingStart"
            :label="__('Starts')"
            type="datetime-local"
            required
          />
          <FormControl
            v-model="meetingEnd"
            :label="__('Ends')"
            type="datetime-local"
            required
          />
        </div>
        <p v-if="scheduleError" class="text-p-sm text-ink-red-7">
          {{ scheduleError }}
        </p>
      </div>
      <template #actions>
        <div class="flex justify-end gap-2">
          <Button :label="__('Cancel')" @click="scheduleDialogOpen = false" />
          <Button
            :disabled="!meetingTitle.trim()"
            :label="__('Schedule')"
            :loading="scheduleMeetingMutation.isPending"
            variant="solid"
            @click="submitScheduledMeeting"
          />
        </div>
      </template>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import {
  Button,
  Dialog,
  Dropdown,
  FormControl,
  PageHeader,
  PageHeaderMobile,
  PageHeaderTitle,
  ScrollArea,
  Skeleton,
  toast,
} from "frappe-ui";
import { List, ListCell, ListGroup, ListRow } from "frappe-ui/list";
import { RouterLink, useRouter } from "vue-router";

import {
  upcomingEvents as upcomingEventsDescriptor,
  type CalendarEvent,
} from "@/apps/calendar";
import {
  createDriveDocument,
  driveNodeRoute,
  driveRecents,
  type DriveNodeSummary,
} from "@/apps/drive";
import { createRoom, scheduleMeeting } from "@/apps/meet";
import {
  formatEventTime,
  formatOpenedAt,
  groupHomeEvents,
  homeEventWindow,
  toLocalDateTimeInput,
} from "@/composition/home/homeTime";
import { useMutation, useQuery } from "@/platform/server-state";
import { translate as __ } from "@/platform/translation";
import { isMobile } from "@/shell/useIsMobile";

const router = useRouter();
const homeNow = new Date();
const eventWindow = homeEventWindow(homeNow);
const recentQuery = useQuery(driveRecents());
const upcomingQuery = useQuery(upcomingEventsDescriptor(eventWindow));
const createDocumentMutation = useMutation(createDriveDocument());
const createRoomMutation = useMutation(createRoom);
const scheduleMeetingMutation = useMutation(scheduleMeeting);

const recentRows = computed(() => recentQuery.rows as DriveNodeSummary[]);
const upcomingEvents = computed(
  () => (upcomingQuery.data ?? []) as CalendarEvent[],
);
const eventGroups = computed(() =>
  groupHomeEvents(upcomingEvents.value, homeNow),
);

const joinDialogOpen = ref(false);
const meetingCode = ref("");
const meetingCodeError = ref("");
const scheduleDialogOpen = ref(false);
const nextHour = new Date(homeNow);
nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
const meetingTitle = ref("");
const meetingStart = ref(toLocalDateTimeInput(nextHour));
const meetingEnd = ref(
  toLocalDateTimeInput(new Date(nextHour.getTime() + 60 * 60_000)),
);
const scheduleError = ref("");

const newMenuItems = [
  {
    label: __("Document"),
    icon: "lucide-file-text",
    onClick: () => createDocument("Writer Document"),
  },
  {
    label: __("Spreadsheet"),
    icon: "lucide-sheet",
    onClick: () => createDocument("Spreadsheet"),
  },
  {
    label: __("Presentation"),
    icon: "lucide-presentation",
    onClick: () => createDocument("Presentation"),
  },
];

const meetMenuItems = [
  {
    label: __("Start instant meeting"),
    icon: "lucide-zap",
    onClick: () => startMeeting("instant"),
  },
  {
    label: __("Start restricted meeting"),
    icon: "lucide-lock",
    onClick: () => startMeeting("restricted"),
  },
  {
    label: __("Join with code"),
    icon: "lucide-log-in",
    onClick: () => {
      meetingCodeError.value = "";
      joinDialogOpen.value = true;
    },
  },
];

const scheduleMenuItems = [
  {
    label: __("Event"),
    icon: "lucide-calendar-plus",
    onClick: () => router.push("/calendar"),
  },
  {
    label: __("Meeting"),
    icon: "lucide-video",
    onClick: () => {
      scheduleError.value = "";
      scheduleDialogOpen.value = true;
    },
  },
];

async function createDocument(contentDoctype: string) {
  const node = await createDocumentMutation.run({
    content_doctype: contentDoctype,
  });
  if (node) await router.push(driveNodeRoute(node));
}

async function startMeeting(type: "instant" | "restricted") {
  const room = await createRoomMutation.run({ type });
  if (room) await router.push(meetRoute(room.code));
}

function joinWithCode() {
  const code = meetingCode.value.trim();
  meetingCodeError.value = "";
  if (!/^[a-zA-Z0-9]{4}(?:-[a-zA-Z0-9]{4}){2}$/.test(code)) {
    meetingCodeError.value = __("Enter a valid meeting code.");
    return;
  }
  joinDialogOpen.value = false;
  void router.push(meetRoute(code));
}

async function submitScheduledMeeting() {
  scheduleError.value = "";
  const start = new Date(meetingStart.value);
  const end = new Date(meetingEnd.value);
  if (
    !meetingTitle.value.trim() ||
    Number.isNaN(start.getTime()) ||
    end <= start
  ) {
    scheduleError.value = __(
      "Enter a title and an end time after the start time.",
    );
    return;
  }
  const result = await scheduleMeetingMutation.run({
    title: meetingTitle.value.trim(),
    start: start.toISOString(),
    end: end.toISOString(),
    attendees: [],
  });
  if (!result) return;
  scheduleDialogOpen.value = false;
  meetingTitle.value = "";
  toast.success(__("Meeting scheduled."));
  await upcomingQuery.refetch();
}

function meetRoute(code: string): string {
  return `/meet/${encodeURIComponent(code)}`;
}

function eventKey(event: CalendarEvent): string {
  return String(
    event.id ?? event.name ?? event.uid ?? `${event.start}-${event.title}`,
  );
}

function nodeIcon(node: DriveNodeSummary): string[] {
  if (node.content_doctype === "Writer Document")
    return ["lucide-file-text", "text-ink-blue-5"];
  if (node.content_doctype === "Spreadsheet")
    return ["lucide-sheet", "text-ink-green-5"];
  if (node.content_doctype === "Presentation")
    return ["lucide-presentation", "text-ink-orange-5"];
  if (node.mime === "application/pdf")
    return ["lucide-file-text", "text-ink-red-5"];
  if (node.mime?.startsWith("image/"))
    return ["lucide-image", "text-ink-violet-5"];
  return ["lucide-file", "text-ink-gray-5"];
}
</script>
