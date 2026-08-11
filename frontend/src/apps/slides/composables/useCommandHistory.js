import { ref, computed } from 'vue'
import { markDirty } from '@/apps/slides/stores/saving'
import { isBlockedByLock } from '@/apps/slides/stores/commands'

export const useCommandHistory = (state, historyMeta = {}) => {
	const actionOrder = historyMeta.actionOrder
	const actions = historyMeta.actions

	const prevCommands = ref([])
	const nextCommands = ref([])

	const canUndo = computed(() => prevCommands.value.length > 0)
	const canRedo = computed(() => nextCommands.value.length > 0)

	const getActionSequence = (commandKey, operation) => {
		// since redo performs same action as execute
		const op = operation === 'redo' ? 'execute' : operation
		return actionOrder[op]?.[commandKey]
	}

	const executeAction = async (action, command, operation) => {
		switch (action) {
			case 'execute':
				command.execute(state.value)
				break
			case 'undo':
				command.undo(state.value)
				break
			default: {
				const handler = actions[action]
				if (handler) {
					handler(action, command, operation)
				}
				break
			}
		}
	}

	const execute = async (command) => {
		// undo and redo must still be able to restore a lock
		if (isBlockedByLock(command, state.value)) return

		const sequence = getActionSequence(command.key, 'execute')
		for (const action of sequence) {
			await executeAction(action, command, 'execute')
		}

		prevCommands.value.push(command)
		nextCommands.value = []

		markDirty()
	}

	const undo = async () => {
		if (!canUndo.value) return

		const command = prevCommands.value.pop()

		const sequence = getActionSequence(command.key, 'undo')
		for (const action of sequence) {
			await executeAction(action, command, 'undo')
		}

		nextCommands.value.push(command)

		markDirty()
	}

	const redo = async () => {
		if (!canRedo.value) return

		const command = nextCommands.value.pop()

		const sequence = getActionSequence(command.key, 'redo')
		for (const action of sequence) {
			await executeAction(action, command, 'redo')
		}

		prevCommands.value.push(command)

		markDirty()
	}

	const clearHistory = () => {
		prevCommands.value = []
		nextCommands.value = []
	}

	return {
		canUndo,
		canRedo,
		execute,
		undo,
		redo,
		clearHistory,
	}
}
