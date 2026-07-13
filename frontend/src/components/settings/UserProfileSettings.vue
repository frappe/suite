<template>
	<AppSettingsHeader :title="__('Profile')" />
	<AppSettingsBody>
		<div v-if="user?.doc" class="space-y-6">
			<section class="space-y-6">
				<FileUploader
					file-types="image/png,image/jpeg,image/jpg"
					:validate-file="validateAvatarFile"
					@success="onAvatarUploaded"
				>
					<template #default="{ openFileSelector, uploading, error }">
						<div class="flex items-center gap-4">
							<div>
								<Dropdown
									v-if="user.doc.user_image"
									:options="avatarMenuOptions(openFileSelector)"
									placement="right"
								>
									<button
										type="button"
										class="flex rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-outline-gray-3"
										:aria-label="__('Profile picture options')"
										:disabled="uploading || user.setValue.loading"
									>
										<Avatar
											:image="user.doc.user_image"
											:label="displayName"
											size="3xl"
											class="!h-16 !w-16"
										/>
									</button>
								</Dropdown>
								<button
									v-else
									type="button"
									class="flex rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-outline-gray-3"
									:aria-label="__('Upload profile picture')"
									:disabled="uploading || user.setValue.loading"
									@click="openFileSelector"
								>
									<Avatar
										:image="user.doc.user_image"
										:label="displayName"
										size="3xl"
										class="!h-16 !w-16"
									/>
								</button>
							</div>
							<div class="min-w-0">
								<div class="text-3xl-semibold text-ink-gray-8 truncate">
									{{ displayName }}
								</div>
								<p class="text-base text-ink-gray-6 truncate">
									{{ uploading ? __('Uploading…') : user.doc.email || userId }}
								</p>
								<ErrorMessage v-if="error" class="mt-1" :message="error" />
							</div>
						</div>
					</template>
				</FileUploader>

				<div class="grid gap-6 sm:grid-cols-2">
					<FormControl
						v-model="user.doc.first_name"
						:label="__('First name')"
						variant="outline"
						class="w-full"
						autocomplete="given-name"
						:disabled="user.setValue.loading"
						@blur="saveName"
					/>
					<FormControl
						v-model="user.doc.last_name"
						:label="__('Last name')"
						variant="outline"
						class="w-full"
						autocomplete="family-name"
						:disabled="user.setValue.loading"
						@blur="saveName"
					/>
				</div>
			</section>

			<div class="divide-y divide-outline-gray-1">
				<SettingsRow
					:title="__('Password')"
					:description="__('Manage password and account access')"
				>
					<Button :label="__('Update Password')" @click="showPasswordDialog = true" />
				</SettingsRow>
			</div>

			<slot />
		</div>
	</AppSettingsBody>

	<Dialog v-model="showPasswordDialog" :options="passwordDialogOptions">
		<template #body-content>
			<form class="space-y-4" @submit.prevent>
				<!-- Capture username here so Chrome doesn't fill profile last name -->
				<input
					type="text"
					name="username"
					autocomplete="username"
					tabindex="-1"
					aria-hidden="true"
					:value="userId || ''"
					readonly
					class="pointer-events-none absolute h-0 w-0 opacity-0"
				/>
				<FormControl
					v-model="currentPassword"
					type="password"
					name="current-password"
					autocomplete="current-password"
					:label="__('Current Password')"
					placeholder="••••••••"
					variant="outline"
				/>
				<FormControl
					v-model="newPassword"
					type="password"
					name="new-password"
					autocomplete="new-password"
					:label="__('New Password')"
					placeholder="••••••••"
					variant="outline"
				/>
				<FormControl
					v-model="confirmPassword"
					type="password"
					name="confirm-password"
					autocomplete="new-password"
					:label="__('Confirm New Password')"
					placeholder="••••••••"
					variant="outline"
				/>
				<ErrorMessage :message="passwordError" />
			</form>
		</template>
	</Dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
	Avatar,
	Button,
	Dialog,
	Dropdown,
	ErrorMessage,
	FileUploader,
	FormControl,
	SettingsRow,
	createDocumentResource,
	createResource,
	toast,
} from 'frappe-ui'
import AppSettingsHeader from '@/components/settings/AppSettingsHeader.vue'
import AppSettingsBody from '@/components/settings/AppSettingsBody.vue'
import { useSessionStore, userResource } from '@/boot/session'

const AUTOSAVE_TOAST_ID = 'suite-profile-autosave'

const session = useSessionStore()
const userId = session.user as string

// Gameplan-style: edit the User document resource and persist via setValue
const user = createDocumentResource({
	doctype: 'User',
	name: userId,
	auto: true,
	setValue: {
		onSuccess: () => {
			userResource.reload()
		},
	},
})

const showPasswordDialog = ref(false)
const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')

const displayName = computed(() => {
	const doc = user?.doc
	if (!doc) return userId
	const name = [doc.first_name, doc.last_name].filter(Boolean).join(' ')
	return name || doc.email || userId
})

function avatarMenuOptions(openFileSelector: () => void) {
	return [
		{
			label: __('Change image'),
			icon: 'lucide-image-up',
			onClick: openFileSelector,
		},
		{
			label: __('Remove image'),
			icon: 'lucide-trash-2',
			onClick: removeAvatar,
		},
	]
}

function validateAvatarFile(file: File) {
	const ext = file.name.split('.').pop()?.toLowerCase()
	if (!ext || !['png', 'jpg', 'jpeg'].includes(ext)) {
		return __('Only PNG and JPG images are allowed')
	}
}

async function saveName() {
	if (!user?.doc || user.setValue.loading) return

	const nextFirst = (user.doc.first_name || '').trim()
	const nextLast = (user.doc.last_name || '').trim()
	if (!nextFirst) {
		toast.error(__('First name is required'))
		user.doc.first_name = user.originalDoc?.first_name || ''
		return
	}

	const prevFirst = user.originalDoc?.first_name || ''
	const prevLast = user.originalDoc?.last_name || ''
	if (nextFirst === prevFirst && nextLast === prevLast) return

	try {
		await user.setValue.submit({
			first_name: nextFirst,
			last_name: nextLast,
		})
		toast.success(__('Name saved'), { id: AUTOSAVE_TOAST_ID })
	} catch {
		toast.error(__('Could not save name'))
	}
}

async function onAvatarUploaded(file: { file_url: string }) {
	if (!user?.doc) return
	try {
		await user.setValue.submit({ user_image: file.file_url })
		toast.success(__('Profile picture updated'), { id: AUTOSAVE_TOAST_ID })
	} catch {
		toast.error(__('Could not update profile picture'))
	}
}

async function removeAvatar() {
	if (!user?.doc?.user_image || user.setValue.loading) return
	try {
		await user.setValue.submit({ user_image: null })
		toast.success(__('Profile picture removed'), { id: AUTOSAVE_TOAST_ID })
	} catch {
		toast.error(__('Could not remove profile picture'))
	}
}

const passwordError = computed(() =>
	confirmPassword.value && confirmPassword.value !== newPassword.value
		? __('Passwords do not match')
		: updatePassword.error,
)

const passwordDialogOptions = computed(() => ({
	title: __('Change Password'),
	actions: [
		{
			label: __('Confirm'),
			variant: 'solid' as const,
			onClick: () => updatePassword.submit(),
			disabled:
				!(currentPassword.value.length && newPassword.value.length) ||
				confirmPassword.value !== newPassword.value,
			loading: updatePassword.loading,
		},
	],
}))

const updatePassword = createResource({
	url: 'frappe.core.doctype.user.user.update_password',
	makeParams: () => ({
		old_password: currentPassword.value,
		new_password: newPassword.value,
	}),
	onSuccess: () => {
		showPasswordDialog.value = false
		toast.success(__('Password updated.'))
	},
})

watch(showPasswordDialog, (open) => {
	if (!open) {
		currentPassword.value = ''
		newPassword.value = ''
		confirmPassword.value = ''
		updatePassword.reset()
	}
})
</script>
