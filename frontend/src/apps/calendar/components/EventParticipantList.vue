<script setup lang="ts">
import { computed } from 'vue'
import { Avatar, Button } from 'frappe-ui'

import { participationStatusDisplay } from '@/apps/calendar/utils'
import { extractNameFromEmail } from '@/apps/calendar/utils/format'
import { userStore } from '@/apps/calendar/stores/user'

const { participants, dontShowRemove } = defineProps<{
	participants: any[]
	dontShowRemove?: boolean
}>()

defineEmits(['removeParticipant'])

const { participantIdentities } = userStore()

const organizer = computed(() => participants.find((p) => p.isOrganizer)?.email)

const isUserOrganizer = computed(
	() => participantIdentities.data?.some((id) => id.email === organizer.value?.replace('mailto:', '')) ?? false,
)

const showRemoveParticipant = (participant: any) =>
	!participant.isOrganizer && (isUserOrganizer.value || participant.isNew) && !dontShowRemove

</script>
<template>
	<div v-for="p in participants" :key="p.email">
		<div class="flex items-center justify-between text-left">
			<div class="flex items-center space-x-2">
				<Avatar :image="p.user_image" :label="p._name || p.email" size="lg" />
				<div class="flex flex-col space-y-0.5">
					<div class="flex items-center space-x-1">
						<span class="text-ink-gray-8 text-sm-medium">
							{{ extractNameFromEmail(p._name || p.email) }}
						</span>
						<!-- Same ink as the email below it: both are secondary to the name, and
						     size + position already tell them apart. -->
						<span v-if="p.email === organizer" class="text-ink-gray-5 text-xs">
							({{ __('Organizer') }})
						</span>

						<div
							v-if="
								p.participation_status && p.participation_status !== 'NEEDS-ACTION'
							"
							class="rounded-full p-px"
							:class="participationStatusDisplay(p.participation_status).class"
						>
							<component
								:is="participationStatusDisplay(p.participation_status).icon"
								class="h-3 w-3"
							/>
						</div>
					</div>
					<!-- The paragraph variant, not `text-sm`: at 13px its 1.15 leading gives a
					     line box shorter than the glyphs themselves, so the descender of a g or a
					     y hung below it and the participants list clipped it at its scroll edge. -->
					<span class="text-ink-gray-5 text-p-sm">{{ p.email }}</span>
				</div>
			</div>

			<Button
				v-if="showRemoveParticipant(p)"
				variant="ghost"
				icon="lucide-x"
				@click="$emit('removeParticipant', p.email)"
			/>
		</div>
	</div>
</template>
