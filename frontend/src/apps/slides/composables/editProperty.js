import { commandHistory } from '@/apps/slides/stores/historyMeta'
import { batchCommand, editElementCommand, editSlideCommand } from '@/apps/slides/stores/commands'
import { activeElementIds, activeElements } from '@/apps/slides/stores/element'
import { currentSlide } from '@/apps/slides/stores/slide'

const editableElements = () => activeElements.value.filter((el) => !el.locked)

const pushToHistory = (commands) => {
	if (!commands.length) return

	if (commands.length === 1 && activeElementIds.value.length === 1) {
		commandHistory.execute(commands[0])
		return
	}

	commandHistory.execute(
		batchCommand({
			slideId: currentSlide.value.clientId,
			elementIds: activeElementIds.value,
			commands,
		}),
	)
}

const bindProperty = (getTargets, property, buildCommand, recordCommands) => {
	let snapshots = null

	const setEach = (fn) => getTargets().forEach(fn)

	const set = (value) => setEach((target) => (target[property] = value))

	const begin = (properties = [property]) => {
		snapshots = getTargets().map((target) => ({
			target,
			values: Object.fromEntries(properties.map((p) => [p, target[p]])),
		}))
	}

	const commit = () => {
		if (!snapshots) return
		const commands = snapshots.flatMap(({ target, values }) =>
			Object.entries(values)
				.filter(([p, oldValue]) => target[p] !== oldValue)
				.map(([p, oldValue]) => buildCommand(target, p, oldValue, target[p])),
		)
		snapshots = null
		if (recordCommands) recordCommands(commands)
		else commands.forEach((command) => commandHistory.execute(command))
	}

	return { set, setEach, begin, commit }
}

export const useElementProperty = (property) =>
	bindProperty(
		editableElements,
		property,
		(element, property, oldValue, newValue) =>
			editElementCommand({
				slideId: currentSlide.value.clientId,
				elementIds: [element.id],
				property,
				oldValue,
				newValue,
			}),
		pushToHistory,
	)

export const useSlideProperty = (property) =>
	bindProperty(
		() => [currentSlide.value],
		property,
		(slide, property, oldValue, newValue) =>
			editSlideCommand({
				slideId: slide.clientId,
				property,
				oldValue,
				newValue,
			}),
	)

export const pushSlideCommands = (commands) => {
	if (!commands.length) return
	commandHistory.execute(
		batchCommand({
			slideId: currentSlide.value.clientId,
			elementIds: [],
			commands,
		}),
	)
}

export const setElementProperty = (property, value) => {
	pushToHistory(
		editableElements()
			.filter((element) => element[property] !== value)
			.map((element) =>
				editElementCommand({
					slideId: currentSlide.value.clientId,
					elementIds: [element.id],
					property,
					oldValue: element[property],
					newValue: value,
				}),
			),
	)
}

export const setElementProperties = (changes) => {
	const commands = changes
		.filter((c) => c.oldValue !== c.newValue)
		.map((c) =>
			editElementCommand({
				slideId: currentSlide.value.clientId,
				elementIds: activeElementIds.value,
				property: c.property,
				oldValue: c.oldValue,
				newValue: c.newValue,
			}),
		)
	if (!commands.length) return
	if (commands.length === 1) {
		commandHistory.execute(commands[0])
		return
	}
	commandHistory.execute(
		batchCommand({
			slideId: currentSlide.value.clientId,
			elementIds: activeElementIds.value,
			commands,
		}),
	)
}
