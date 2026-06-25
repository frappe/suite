import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type { PollPayloadFE } from "../../../../../suite/meet/sfu-server/src/types"

export const usePollStore = defineStore("poll", () => {
	const polls = ref<Record<string, PollPayloadFE>>({});

	const activePolls = computed(() => {
		return Object.values(polls.value).filter((poll) => poll.isActive);
	});

	function addPoll(poll: PollPayloadFE) {
		polls.value = {
			...polls.value,
			[poll.pollId]: poll,
		};
	}

	function updatePoll(poll: PollPayloadFE) {
		polls.value[poll.pollId] = poll;
	}

	function setExistingPolls(existingPolls: PollPayloadFE[]) {
		existingPolls.forEach((poll) => {
			polls.value[poll.pollId] = poll;
		});
	}

	function $reset() {
		polls.value = {};
	}

	return {
		polls,
		activePolls,
		addPoll,
		updatePoll,
		setExistingPolls,
		$reset,
	};
});