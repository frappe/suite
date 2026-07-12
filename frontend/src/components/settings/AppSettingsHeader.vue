<template>
	<SettingsHeader v-bind="$attrs">
		<template v-if="$slots.default" #default>
			<slot />
		</template>
		<template v-if="$slots.actions" #actions>
			<slot name="actions" />
		</template>
	</SettingsHeader>
</template>

<script setup lang="ts">
import { SettingsHeader } from 'frappe-ui'

defineOptions({ inheritAttrs: false })
</script>
