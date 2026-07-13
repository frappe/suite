<template>
	<AppSettingsHeader :title="__('Profile')" />
	<AppSettingsBody>
		<div class="space-y-11">
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
									v-if="userImage"
									:options="avatarMenuOptions(openFileSelector)"
									placement="right"
								>
									<button
										type="button"
										class="flex rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-outline-gray-3"
										:aria-label="__('Profile picture options')"
										:disabled="uploading || savingPhoto"
									>
										<Avatar
											:image="userImage"
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
									:disabled="uploading || savingPhoto"
									@click="openFileSelector"
								>
									<Avatar
										:image="userImage"
										:label="displayName"
										size="3xl"
										class="!h-16 !w-16"
									/>
								</button>
							</div>
							<div>
								<div class="text-base-medium text-ink-gray-8">
									{{ __('Profile picture') }}
								</div>
								<p class="text-p-sm text-ink-gray-5">
									{{
										uploading
											? __('Uploading…')
											: __('Helps people recognise you')
									}}
								</p>
								<ErrorMessage v-if="error" class="mt-1" :message="error" />
							</div>
						</div>
					</template>
				</FileUploader>

				<div class="grid gap-6 sm:grid-cols-2">
					<FormControl
						v-model="firstName"
						:label="__('First name')"
						variant="outline"
						class="w-full"
						:disabled="savingName"
						@blur="saveName"
					/>
					<FormControl
						v-model="lastName"
						:label="__('Last name')"
						variant="outline"
						class="w-full"
						:disabled="savingName"
						@blur="saveName"
					/>
				</div>
			</section>

			<section v-if="showChangePassword">
				<h2 class="text-lg-semibold text-ink-gray-8">{{ __('Account') }}</h2>
				<div class="mt-2 divide-y divide-outline-gray-1">
					<SettingsRow
						:title="__('Password')"
						:description="__('Manage password and account access')"
					>
						<Button :label="__('Update Password')" @click="showPasswordDialog = true" />
					</SettingsRow>
				</div>
			</section>

			<slot />
		</div>
	</AppSettingsBody>

	<Dialog v-if="showChangePassword" v-model="showPasswordDialog" :options="passwordDialogOptions">
		<template #body-content>
			<div class="space-y-4">
				<FormControl
					v-model="currentPassword"
					type="password"
					:label="__('Current Password')"
					placeholder="••••••••"
					variant="outline"
				/>
				<FormControl
					v-model="newPassword"
					type="password"
					:label="__('New Password')"
					placeholder="••••••••"
					variant="outline"
				/>
				<FormControl
					v-model="confirmPassword"
					type="password"
					:label="__('Confirm New Password')"
					placeholder="••••••••"
					variant="outline"
				/>
				<ErrorMessage :message="passwordError" />
			</div>
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
	call,
	createResource,
	toast,
} from 'frappe-ui'
import AppSettingsHeader from '@/components/settings/AppSettingsHeader.vue'
import AppSettingsBody from '@/components/settings/AppSettingsBody.vue'
import { useSessionStore, userResource } from '@/boot/session'

withDefaults(
	defineProps<{
		showChangePassword?: boolean
	}>(),
	{ showChangePassword: true },
)

const AUTOSAVE_TOAST_ID = 'suite-profile-autosave'

const session = useSessionStore()
const userName = computed(() => session.user as string)

const firstName = ref('')
const lastName = ref('')
const email = ref('')
const userImage = ref<string | null>(null)
const savedFirstName = ref('')
const savedLastName = ref('')
const savingName = ref(false)
const savingPhoto = ref(false)
const showPasswordDialog = ref(false)
const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')

const displayName = computed(() => {
	const name = [firstName.value, lastName.value].filter(Boolean).join(' ')
	return name || email.value || userName.value
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

function applyUserDoc(data: Record<string, string | null>) {
	firstName.value = (data.first_name as string) || ''
	lastName.value = (data.last_name as string) || ''
	savedFirstName.value = firstName.value
	savedLastName.value = lastName.value
	email.value = (data.email as string) || userName.value
	userImage.value = (data.user_image as string) || null
}

const userDoc = createResource({
	url: 'frappe.client.get',
	makeParams: () => ({
		doctype: 'User',
		name: userName.value,
	}),
	auto: false,
	onSuccess: applyUserDoc,
})

watch(
	userName,
	(name) => {
		if (name) userDoc.fetch()
	},
	{ immediate: true },
)

async function saveName() {
	if (!userName.value || savingName.value) return

	const nextFirst = firstName.value.trim()
	const nextLast = lastName.value.trim()
	if (!nextFirst) {
		toast.error(__('First name is required'))
		firstName.value = savedFirstName.value
		return
	}
	if (nextFirst === savedFirstName.value && nextLast === savedLastName.value) return

	savingName.value = true
	try {
		await call('frappe.client.set_value', {
			doctype: 'User',
			name: userName.value,
			fieldname: {
				first_name: nextFirst,
				last_name: nextLast,
			},
		})
		firstName.value = nextFirst
		lastName.value = nextLast
		savedFirstName.value = nextFirst
		savedLastName.value = nextLast
		userResource.reload()
		toast.success(__('Name saved'), { id: AUTOSAVE_TOAST_ID })
	} catch {
		toast.error(__('Could not save name'))
		firstName.value = savedFirstName.value
		lastName.value = savedLastName.value
	} finally {
		savingName.value = false
	}
}

async function onAvatarUploaded(file: { file_url: string }) {
	if (!userName.value) return
	savingPhoto.value = true
	try {
		await call('frappe.client.set_value', {
			doctype: 'User',
			name: userName.value,
			fieldname: 'user_image',
			value: file.file_url,
		})
		userImage.value = file.file_url
		userResource.reload()
		toast.success(__('Profile picture updated'), { id: AUTOSAVE_TOAST_ID })
	} catch {
		toast.error(__('Could not update profile picture'))
	} finally {
		savingPhoto.value = false
	}
}

async function removeAvatar() {
	if (!userName.value || savingPhoto.value || !userImage.value) return
	savingPhoto.value = true
	try {
		await call('frappe.client.set_value', {
			doctype: 'User',
			name: userName.value,
			fieldname: 'user_image',
			value: null,
		})
		userImage.value = null
		userResource.reload()
		toast.success(__('Profile picture removed'), { id: AUTOSAVE_TOAST_ID })
	} catch {
		toast.error(__('Could not remove profile picture'))
	} finally {
		savingPhoto.value = false
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
	}
})
</script>
