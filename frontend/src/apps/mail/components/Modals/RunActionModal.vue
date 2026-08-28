<template>
	<Dialog v-model:open="show" v-bind="dialogOptions">
		<template #default>
			<div class="space-y-4">
				<template v-for="field in fields" :key="field.name">
					<!-- A set-valued input (e.g. the recipients): one row per entry. -->
					<div v-if="field.type === 'list'">
						<label class="text-ink-gray-5 mb-1.5 block text-xs">{{ __(field.label) }}</label>
						<div class="space-y-2">
							<div v-for="(entry, index) in entriesOf(field)" :key="index" class="flex items-center gap-2">
								<FormControl
									class="flex-1"
									:model-value="entry"
									:placeholder="field.placeholder"
									:disabled="hasRun"
									@update:model-value="(value: string) => setEntry(field, index, value)"
								/>
								<Button
									variant="ghost"
									:disabled="hasRun || entriesOf(field).length === 1"
									:tooltip="__('Remove')"
									@click="removeEntry(field, index)"
								>
									<template #icon><FeatherIcon name="x" class="h-4 w-4" /></template>
								</Button>
							</div>
						</div>
						<Button class="mt-2" variant="ghost" :label="__('Add')" :disabled="hasRun" @click="addEntry(field)">
							<template #prefix><FeatherIcon name="plus" class="h-4 w-4" /></template>
						</Button>
					</div>
					<FormControl
						v-else
						v-model="values[field.name]"
						:label="__(field.label)"
						:type="field.type || 'text'"
						:placeholder="field.placeholder"
						:options="field.type === 'select' ? selectOptions(field) : undefined"
						:required="field.required"
						:disabled="hasRun"
					/>
				</template>
				<ErrorMessage
					:message="
						validationError ||
						(runAction.error &&
							(runAction.error?.messages?.[0] || runAction.error?.message || __('Request failed.')))
					"
				/>
				<div v-if="result">
					<label class="text-ink-gray-5 mb-1 block text-xs">{{ __('Result') }}</label>
					<pre
						class="bg-surface-gray-2 max-h-[45vh] overflow-auto rounded-4 p-4 text-xs whitespace-pre-wrap"
						>{{ result }}</pre
					>
				</div>
			</div>
		</template>
	</Dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Button, Dialog, ErrorMessage, FormControl, createResource } from 'frappe-ui'
import { Icon as FeatherIcon } from 'frappe-ui/experimental'

import { raiseToast } from '@/apps/mail/utils'

type ActionOption = { value: string; label: string }
type ActionField = {
	name: string
	label: string
	type?: string
	placeholder?: string
	required?: boolean
	options?: ActionOption[]
}
type ActionInfo = { value: string; label: string; schema_name?: string | null }
type FieldValue = string | boolean | string[]

const show = defineModel<boolean>()
const { action, fields } = defineProps<{ action: ActionInfo | null; fields: ActionField[] }>()

const values = ref<Record<string, FieldValue>>({})
const resultData = ref<Record<string, unknown> | null>(null)
const validationError = ref('')

const result = computed(() => (resultData.value ? JSON.stringify(resultData.value, null, 2) : ''))
// The inputs freeze once the action has run, so the result on screen always reflects them; reopening
// the dialog starts a fresh run.
const hasRun = computed(() => resultData.value !== null)

const dialogOptions = computed(() => ({
	title: action?.label,
	size: '2xl',
	actions: hasRun.value
		? [{ label: __('Close'), variant: 'subtle', onClick: () => (show.value = false) }]
		: [{ label: __('Run'), variant: 'solid', loading: runAction.loading, onClick: run }],
}))

const emptyValue = (field: ActionField): FieldValue =>
	field.type === 'checkbox' ? false : field.type === 'list' ? [''] : ''

watch(show, () => {
	if (show.value) {
		values.value = Object.fromEntries(fields.map((f) => [f.name, emptyValue(f)]))
		resultData.value = null
		validationError.value = ''
		runAction.reset()
	}
})

// A select is only ever optional here, so it needs a blank choice to mean "unset".
const selectOptions = (field: ActionField) => [{ value: '', label: '' }, ...(field.options || [])]

const entriesOf = (field: ActionField) => (values.value[field.name] as string[]) || ['']
const setEntry = (field: ActionField, index: number, value: string) => {
	const entries = [...entriesOf(field)]
	entries[index] = value
	values.value[field.name] = entries
}
const addEntry = (field: ActionField) => (values.value[field.name] = [...entriesOf(field), ''])
const removeEntry = (field: ActionField, index: number) =>
	(values.value[field.name] = entriesOf(field).filter((_, i) => i !== index))

const isBlank = (field: ActionField) => {
	const value = values.value[field.name]
	if (field.type === 'checkbox') return false
	if (field.type === 'list') return !(value as string[]).some((entry) => entry.trim())
	return !String(value ?? '').trim()
}

// The action only makes sense with every required input filled in, and the server would just report
// its own generic failure, so hold the request back until they are.
const run = () => {
	const missing = fields.filter((f) => f.required && isBlank(f))
	if (missing.length) {
		const labels = missing.map((f) => __(f.label)).join(', ')
		validationError.value =
			missing.length === 1
				? __('{0} is required.').replace('{0}', labels)
				: __('These fields are required: {0}').replace('{0}', labels)
		return
	}
	validationError.value = ''
	return runAction.submit()
}

const runAction = createResource({
	url: 'suite.mail.api.admin.run_action',
	makeParams: () => {
		const params: Record<string, FieldValue> = {}
		for (const field of fields) {
			const value = values.value[field.name]
			if (field.type === 'checkbox') {
				params[field.name] = Boolean(value)
			} else if (field.type === 'list') {
				const entries = (value as string[]).map((entry) => entry.trim()).filter(Boolean)
				if (entries.length) params[field.name] = entries
			} else {
				const text = String(value ?? '').trim()
				if (text) params[field.name] = text
			}
		}
		return { action_type: action?.value, params }
	},
	onSuccess: (data: Record<string, unknown>) => {
		resultData.value = data || {}
		raiseToast(__('Action completed.'))
	},
})
</script>
