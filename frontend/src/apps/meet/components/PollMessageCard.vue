<template>
	<div class="w-full border border-outline-gray-2 rounded-lg p-3 flex flex-col gap-3">
		<div>
			<h3 class="text-base text-ink-gray-9 leading-snug">{{ livePoll.question }}</h3>
		</div>

		<div class="space-y-2">
			<button
				v-for="option in livePoll.options"
				:key="option.id"
				type="button"
				:disabled="isSelectionDisabled"
				@click="handleVote(option.id)"
				class="relative overflow-hidden rounded-full w-full text-left transition-colors text-sm"
				:class="{
					'hover:bg-surface-gray-2 cursor-pointer': !isSelectionDisabled,
					'opacity-60 cursor-not-allowed': isGuest && !hasVoted,
					'bg-surface-violet-2 cursor-default': hasVoted && localVotedOption === option.id,
					'bg-surface-gray-1 cursor-default': hasVoted && localVotedOption !== option.id,
				}"
			>
				<div
					class="absolute inset-y-0 left-0 transition-all duration-500 ease-out rounded-l-full"
					:class="{
						'bg-surface-violet-5': hasVoted && localVotedOption === option.id,
						'bg-surface-gray-3': hasVoted && localVotedOption !== option.id,
					}"
					:style="{ width: hasVoted ? `${getPercentage(option.votes)}%` : '0%' }"
				/>
				<div class="relative z-10 flex items-center gap-2 px-3.5 py-2">
					<span v-if="!hasVoted" class="size-4 aspect-square rounded-full border border-outline-gray-4 shrink-0" />
					<span
						class="flex-1 min-w-0 truncate leading-snug flex items-center gap-2"
						:class="hasVoted && localVotedOption === option.id ? 'font-semibold text-ink-gray-9' : 'font-normal text-ink-gray-9'"
					>
						{{ option.text }}
						<lucide-circle-check-big v-if="hasVoted && localVotedOption === option.id" class="w-3 h-3 shrink-0" />
					</span>
					<template v-if="hasVoted">
						<span class="text-xs text-ink-gray-6 font-medium shrink-0">{{ option.votes }} votes &bull; {{ getPercentage(option.votes) }}%</span>
					</template>
				</div>
			</button>
		</div>

		<div class="text-sm text-ink-gray-6">
			{{ totalVotes }} {{ totalVotes === 1 ? 'vote' : 'votes' }}
			<span v-if="isGuest">&bull; Guests can't vote in polls</span>
		</div>
	</div>
</template>

<script setup lang="ts">
import { computed, inject, ref } from "vue";
import { PollPayloadFE } from "../types";
import { usePollStore } from "../composables/usePollStore";

const props = defineProps<{
	poll: PollPayloadFE;
	isGuest?: boolean;
}>();

const pollService = inject("poll") as any;
const pollStore = usePollStore()

const localVotedOption = ref<string | null>(null);

const livePoll = computed(() => {
	const storePolls = Object.values(pollStore.polls) as PollPayloadFE[];
	const foundInStore = storePolls?.find(p => p.pollId === props.poll.pollId);
	return foundInStore || props.poll;
});

const hasVoted = computed(() => !!livePoll.value.hasVoted);
const isSelectionDisabled = computed(() => hasVoted.value || props.isGuest);

const handleVote = async (optionId: string) => {
	if (isSelectionDisabled.value) return;
	localVotedOption.value = optionId;
	if (pollService) {
		try {
			await pollService.submitVote(livePoll.value.pollId, optionId);
		} catch (error) {
			localVotedOption.value = null;
		}
	}
};

const totalVotes = computed(() => {
	return livePoll.value.options.reduce((sum, opt) => sum + opt.votes, 0);
});

const getPercentage = (votes: number) => {
	if (totalVotes.value === 0) return 0;
	return Math.round((votes / totalVotes.value) * 100);
};

</script>
