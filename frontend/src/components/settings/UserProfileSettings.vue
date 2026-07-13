<template>
	<AppSettingsHeader :title="__('Profile')" />
	<AppSettingsBody>
		<div class="flex flex-col gap-5">
			<div class="flex w-full items-center">
				<Avatar
					:image="userImage"
					:label="displayName"
					size="3xl"
					class="h-16 w-16"
				/>
				<div class="mx-4 flex min-w-0 flex-col">
					<span class="text-3xl-semibold text-ink-gray-8 truncate">{{ displayName }}</span>
					<span class="text-base text-ink-gray-6 truncate">{{ email }}</span>
				</div>
				<Button
					:label="__('Edit Photo')"
					class="ml-auto shrink-0"
					@click="showEditPhoto = true"
				/>
			</div>

			<FormControl
				v-model="firstName"
				:label="__('First Name')"
				variant="outline"
			/>
			<FormControl
				v-model="lastName"
				:label="__('Last Name')"
				variant="outline"
			/>
			<ErrorMessage :message="saveError" />
			<div class="flex flex-wrap gap-2">
				<Button
					:label="__('Save')"
					class="min-h-7"
					variant="solid"
					:disabled="!canSave"
					:loading="saving"
					@click="saveProfile"
				/>
				<Button
					v-if="showChangePassword"
					class="min-h-7"
					:label="__('Change Password')"
					@click="showPasswordDialog = true"
				/>
			</div>

			<slot />
		</div>
	</AppSettingsBody>

	<Dialog v-model="showEditPhoto" :options="{ title: __('Edit Photo'), size: 'sm' }">
		<template #body-content>
			<FileUploader
				class="mb-2 w-full"
				:file-types="['image/*']"
				@success="(file) => setPhoto(file.file_url)"
			>
				<template #default="{ error, uploading, openFileSelector }">
					<div class="flex flex-col items-center space-y-4">
						<div
							class="bg-surface-gray-2 flex h-64 w-64 items-center justify-center rounded-full"
						>
							<img
								v-if="userImage"
								:src="userImage"
								class="h-full w-full rounded-full object-cover"
							/>
							<span
								v-else
								class="lucide-user text-ink-gray-4 size-40"
								aria-hidden="true"
							/>
						</div>
						<ErrorMessage :message="error" />
						<Button
							:label="__('Upload New Photo')"
							variant="solid"
							class="w-full"
							:disabled="uploading || saving"
							@click="openFileSelector"
						/>
						<Button
							v-if="userImage"
							:label="__('Remove Current Photo')"
							class="w-full"
							:disabled="uploading || saving"
							@click="setPhoto(null)"
						/>
					</div>
				</template>
			</FileUploader>
		</template>
	</Dialog>

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
	ErrorMessage,
	FileUploader,
	FormControl,
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

const session = useSessionStore()
const userName = computed(() => session.user as string)

const firstName = ref('')
const lastName = ref('')
const email = ref('')
const userImage = ref<string | null>(null)
const savedFirstName = ref('')
const savedLastName = ref('')
const saving = ref(false)
const saveError = ref<string | null>(null)
const showEditPhoto = ref(false)
const showPasswordDialog = ref(false)
const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')

const displayName = computed(() => {
	const name = [firstName.value, lastName.value].filter(Boolean).join(' ')
	return name || email.value || userName.value
})

const canSave = computed(
	() =>
		!!firstName.value.trim() &&
		(firstName.value !== savedFirstName.value || lastName.value !== savedLastName.value),
)

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

async function saveProfile() {
	if (!canSave.value || !userName.value) return
	saving.value = true
	saveError.value = null
	try {
		await call('frappe.client.set_value', {
			doctype: 'User',
			name: userName.value,
			fieldname: {
				first_name: firstName.value,
				last_name: lastName.value,
			},
		})
		toast.success(__('Profile updated.'))
		savedFirstName.value = firstName.value
		savedLastName.value = lastName.value
		userResource.reload()
		await userDoc.fetch()
	} catch (e: any) {
		saveError.value = e?.messages?.[0] || e?.message || __('Failed to update profile.')
	} finally {
		saving.value = false
	}
}

async function setPhoto(image: string | null) {
	if (!userName.value) return
	saving.value = true
	try {
		await call('frappe.client.set_value', {
			doctype: 'User',
			name: userName.value,
			fieldname: 'user_image',
			value: image,
		})
		userImage.value = image
		toast.success(__('Profile photo updated.'))
		showEditPhoto.value = false
		userResource.reload()
		await userDoc.fetch()
	} catch (e: any) {
		toast.error(e?.messages?.[0] || e?.message || __('Failed to update photo.'))
	} finally {
		saving.value = false
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
