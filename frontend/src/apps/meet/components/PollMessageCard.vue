<template>
	<div class="w-full border border-gray-200 rounded-lg p-3 flex flex-col gap-3">
		<div>
			<h3 class="text-base text-gray-900 leading-snug">{{ livePoll.question }}</h3>
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
					'hover:bg-gray-50 cursor-pointer': !isSelectionDisabled,
					'opacity-60 cursor-not-allowed': isGuest && !hasVoted,
					'bg-[#f7f6fe] cursor-default': hasVoted && localVotedOption === option.id,
					'bg-gray-50 cursor-default': hasVoted && localVotedOption !== option.id,
				}"
			>
				<div
					class="absolute inset-y-0 left-0 transition-all duration-500 ease-out rounded-l-full"
					:class="{
						'bg-[#d2c5fc]': hasVoted && localVotedOption === option.id,
						'bg-gray-200': hasVoted && localVotedOption !== option.id,
					}"
					:style="{ width: hasVoted ? `${getPercentage(option.votes)}%` : '0%' }"
				/>
				<div class="relative z-10 flex items-center gap-2 px-3.5 py-2">
					<span v-if="!hasVoted" class="size-4 aspect-square rounded-full border border-gray-500 shrink-0" />
					<span
						class="flex-1 min-w-0 truncate text-gray-900 leading-snug"
						:class="hasVoted && localVotedOption === option.id ? 'font-semibold' : 'font-normal'"
					>
						{{ option.text }}
					</span>
					<template v-if="hasVoted">
						<span class="text-xs text-gray-500 font-medium shrink-0">{{ option.votes }} votes &bull; {{ getPercentage(option.votes) }}%</span>
						<lucide-circle-check-big v-if="localVotedOption === option.id" class="w-3 h-3 text-gray-800 shrink-0" />
					</template>
				</div>
			</button>
		</div>

		<div class="text-sm text-gray-500">
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
