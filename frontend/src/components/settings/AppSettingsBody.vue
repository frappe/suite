<template>
	<SettingsBody v-bind="$attrs">
		<div class="pt-6">
			<slot />
		</div>
	</SettingsBody>
</template>

<script setup lang="ts">
import { SettingsBody } from 'frappe-ui'

defineOptions({ inheritAttrs: false })
</script>
