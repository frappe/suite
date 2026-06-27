<template>
	<SettingsLayoutBase
		:description="'Customize your video background with blur effects or virtual backgrounds'"
	>
		<template #title>
			Background
		</template>
		<template #content>
			<!-- Video Preview -->
			<div class="flex justify-center mb-4">
				<div class="w-96 h-auto aspect-video bg-surface-gray-10 rounded-lg overflow-hidden shadow-sm relative">
					<video
						ref="videoPreviewRef"
						autoplay
						muted
						playsinline
						class="w-full h-full object-cover transform scale-x-[-1]"
					/>
					<div v-if="!previewStream"
						class="absolute inset-0 bg-black bg-opacity-20 flex items-center justify-center">
						<div v-if="isLoadingPreview" class="text-white text-center">
							<lucide-loader class="mx-auto mb-2 w-8 h-8 animate-spin" />
							<p class="text-sm">
								Loading preview...
							</p>
						</div>
					</div>
				</div>
			</div>

			<div class="space-y-4">
				<!-- Image picker -->
				<input ref="fileInputRef" type="file" accept="image/*" class="hidden" @change="handleFileSelect" />

				<!-- Background Options -->
				<div class="grid grid-cols-4 gap-3">
					<div v-for="option in allBackgroundOptionsTyped" :key="option.name"
						@click="handleBackgroundOptionClick(option)"
						class="relative cursor-pointer rounded-lg border-2 overflow-hidden transition-all duration-200 hover:shadow-sm group"
						:class="[
							selectedBackgroundOption === option.name
								? 'border-outline-gray-3 ring-1 ring-outline-gray-2'
								: 'border-outline-gray-1 hover:border-outline-gray-2',
						]">
						<div class="aspect-video bg-surface-gray-2 relative">
							<!-- For blur option -->
							<div v-if="option.type === 'blur'" class="absolute inset-0 flex items-center justify-center"
								:class="option.name === 'blur-low'
									? 'bg-[radial-gradient(circle_at_center,theme(colors.blue.200),theme(colors.blue.300),theme(colors.blue.500))]'
									: 'bg-[radial-gradient(circle_at_center,theme(colors.blue.300),theme(colors.blue.400),theme(colors.blue.600))]'">
								<lucide-circle-user-round class="w-8 h-8 text-ink-gray-9" />
							</div>

							<!-- For add custom option -->
							<div v-else-if="option.isAddButton"
								class="absolute inset-0 bg-surface-gray-2 flex items-center justify-center border-2 border-dashed border-outline-gray-2 hover:border-outline-gray-3 transition-colors">
								<lucide-plus class="w-8 h-8 text-ink-gray-5" />
							</div>

							<!-- For image options -->
							<img v-else-if="option.url" :src="option.url" :alt="option.label"
								class="w-full h-full object-cover" @error="handleImageError" />

							<!-- For none option -->
							<div v-else class="absolute inset-0 bg-surface-gray-1 flex items-center justify-center">
								<lucide-circle-user-round class="w-8 h-8 text-ink-gray-5" />
							</div>

							<!-- Selected indicator -->
							<div v-if="selectedBackgroundOption === option.name"
								class="absolute top-1 right-1 w-5 h-5 bg-surface-gray-9 rounded-full flex items-center justify-center">
								<lucide-check class="w-3 h-3 text-ink-gray-1" />
							</div>

							<!-- Delete button for custom images -->
							<div v-if="option.isCustom" @click.stop="handleDeleteCustomImage(option.name)"
								class="absolute top-1 right-1 w-5 h-5 bg-surface-gray-5 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer hover:bg-surface-gray-6">
								<lucide-x class="w-3 h-3 text-ink-gray-9" />
							</div>
						</div>

						<!-- Label -->
						<div class="p-2 bg-surface-gray-1">
							<p class="text-sm-medium text-center text-ink-gray-8 truncate">
								{{ option.label }}
							</p>
						</div>
					</div>
				</div>
			</div>

			<div class="bg-surface-amber-2 border border-outline-amber-2 rounded-lg p-3 mt-4">
				<div class="flex">
					<div class="flex-shrink-0">
						<lucide-alert-triangle class="h-5 w-5 text-ink-amber-5" />
					</div>
					<div class="ml-3">
						<p class="text-sm text-ink-amber-8">
							<strong>Performance Warning:</strong> Enabling background effects may slow down your computer,
							especially on older devices.
						</p>
					</div>
				</div>
			</div>
		</template>
	</SettingsLayoutBase>
</template>

<script setup lang="ts">
import { toast } from "frappe-ui";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useBackgroundEffects } from "../../composables/useBackgroundEffects";
import { useMeetingContext } from "../../composables/useMeetingContext";
import {
	addCustomBackgroundImage,
	allBackgroundOptions,
	availableBackgroundImages,
	backgroundBlurEnabled,
	backgroundImageEnabled,
	blurIntensity,
	customBackgroundImages,
	removeCustomBackgroundImage,
	selectedBackgroundImage,
	setBackgroundBlurEnabled,
	setBackgroundImageEnabled,
	setBlurIntensity,
	setSelectedBackgroundImage,
} from "../../data/backgroundEffects";
import { selectedCameraId } from "../../data/mediaPreferences";
import SettingsLayoutBase from "./SettingsLayoutBase.vue";

interface BackgroundOption {
	name: string;
	label: string;
	type?: "none" | "blur";
	url?: string | null;
	isAddButton?: boolean;
	isCustom?: boolean;
}

interface BackgroundImageOption {
	label: string;
	value: string;
}

const props = withDefaults(
	defineProps<{
		isVisible?: boolean;
	}>(),
	{
		isVisible: true,
	},
);

const meetingContext = useMeetingContext();
const isInMeeting = computed(() => !!meetingContext?.isInMeeting?.value);
const processedStream = computed(() => meetingContext?.processedStream || null);
const onBackgroundEffectsChanged = meetingContext?.onBackgroundEffectsChanged;

// Video preview
const videoPreviewRef = ref<HTMLVideoElement | null>(null);
const previewStream = ref<MediaStream | null>(null);
const isLoadingPreview = ref(false);
const pendingPreviewRefresh = ref(false);
const fileInputRef = ref<HTMLInputElement | null>(null);
let previewSession: {
	cleanup: () => void;
	updateOptions?: (opts: unknown) => Promise<void>;
	stream?: MediaStream;
} | null = null;
let previewInputStream: MediaStream | null = null; // Raw stream feeding the preview pipeline
let isPreviewStreamDedicated = false; // Track if preview stream is dedicated (not meeting's processed stream; needed when cam is off in meeting)

// Background effects
const backgroundBlurEnabledLocal = ref(backgroundBlurEnabled.value);
const backgroundImageEnabledLocal = ref(backgroundImageEnabled.value);
const selectedBackgroundImageLocal = ref<BackgroundImageOption | string | null>(
	selectedBackgroundImage.value,
);
const blurIntensityLocal = ref(blurIntensity.value);

const allBackgroundOptionsTyped = computed(
	() => allBackgroundOptions.value as unknown as BackgroundOption[],
);

// Background effects composable
const { applyBackgroundEffects, stopProcessing: stopBackgroundProcessing } =
	useBackgroundEffects();

const backgroundImageOptions = computed<BackgroundImageOption[]>(() =>
	availableBackgroundImages.map((image) => ({
		label: image.label,
		value: image.name,
	})),
);

// Selected background option
const selectedBackgroundOption = computed({
	get() {
		if (backgroundBlurEnabledLocal.value) {
			return blurIntensityLocal.value <= 11 ? "blur-low" : "blur-high";
		}
		if (
			backgroundImageEnabledLocal.value &&
			selectedBackgroundImageLocal.value
		) {
			const img = selectedBackgroundImageLocal.value;
			if (typeof img === "string") {
				return img;
			}
			return img.value || img;
		}
		return "none";
	},
	set(value) {
		if (value === "none") {
			handleBackgroundBlurToggle(false);
			handleBackgroundImageToggle(false);
			return;
		}
		if (value === "blur-low") {
			blurIntensityLocal.value = 9;
			setBlurIntensity(9);
			handleBackgroundBlurToggle(true);
			return;
		}
		if (value === "blur-high") {
			blurIntensityLocal.value = 20;
			setBlurIntensity(20);
			handleBackgroundBlurToggle(true);
			return;
		}

		const predefinedImage = backgroundImageOptions.value.find(
			(opt) => opt.value === value,
		);
		if (predefinedImage) {
			selectedBackgroundImageLocal.value = predefinedImage;
			setSelectedBackgroundImage(predefinedImage.value);
			handleBackgroundImageToggle(true);
			return;
		}

		const customImage = customBackgroundImages.value.find(
			(img) => img.name === value,
		);
		if (customImage) {
			selectedBackgroundImageLocal.value = {
				label: customImage.label,
				value: customImage.name,
			};
			setSelectedBackgroundImage(customImage.name);
			handleBackgroundImageToggle(true);
		}
	},
});

function handleBackgroundOptionClick(option: BackgroundOption) {
	if (option.isAddButton) {
		fileInputRef.value?.click();
	} else {
		selectedBackgroundOption.value = option.name;
	}
}

async function handleFileSelect(event: Event) {
	const target = event.target as HTMLInputElement;
	const file = target.files?.[0];
	if (!file) return;

	try {
		const customImage = await addCustomBackgroundImage(file);
		selectedBackgroundOption.value = customImage.name;
		toast.success(`Added custom background: ${file.name}`);
	} catch (error) {
		console.error("Failed to add custom image:", error);
		toast.error(error.message || "Failed to add custom background image");
	}

	target.value = "";
}

async function handleDeleteCustomImage(imageId: string) {
	try {
		await removeCustomBackgroundImage(imageId);
		toast.success("Custom background removed");
	} catch (error) {
		console.error("Failed to remove custom image:", error);
		toast.error("Failed to remove custom background");
	}
}

async function startVideoPreview(deviceId: string) {
	try {
		isLoadingPreview.value = true;

		// Stop any existing processing before creating a new preview session
		stopBackgroundProcessing();

		if (previewSession) {
			previewSession.cleanup();
			previewSession = null;
		}

		if (previewStream.value && isPreviewStreamDedicated) {
			for (const track of previewStream.value.getTracks()) {
				track.stop();
			}
		}

		if (previewInputStream) {
			for (const track of previewInputStream.getTracks()) {
				track.stop();
			}
			previewInputStream = null;
		}

		previewStream.value = null;
		isPreviewStreamDedicated = false;

		// If in a meeting, don't create a new stream
		// Reuse processedStream to avoid breaking
		if (isInMeeting.value && processedStream.value) {
			previewStream.value = processedStream.value;
			if (videoPreviewRef.value) {
				videoPreviewRef.value.srcObject = previewStream.value;
			}
			isLoadingPreview.value = false;
			return;
		}

		// This is a dedicated stream that we created
		// for when we don't have a cam on in a meeting
		isPreviewStreamDedicated = true;

		const constraints: MediaStreamConstraints = {
			video: deviceId ? { deviceId: { exact: deviceId } } : true,
			audio: false,
		};

		const rawStream = await navigator.mediaDevices.getUserMedia(constraints);
		previewInputStream = rawStream;

		const hasBackgroundEffects =
			backgroundBlurEnabledLocal.value || backgroundImageEnabledLocal.value;

		if (hasBackgroundEffects) {
			try {
				previewSession = await applyBackgroundEffects(rawStream, {
					backgroundBlurEnabled: backgroundBlurEnabledLocal.value,
					backgroundImageEnabled: backgroundImageEnabledLocal.value,
					selectedBackgroundImage: (() => {
						const img = selectedBackgroundImageLocal.value;
						if (typeof img === "string") return img;
						if (img && typeof img === "object") return img.value;
						return null;
					})(),
					blurIntensity: blurIntensityLocal.value,
				});
				previewStream.value = previewSession.stream;
			} catch (error) {
				console.error("Failed to apply background effects to preview:", error);
				previewSession = null;
				previewStream.value = rawStream;
			}
		} else {
			previewStream.value = rawStream;
		}

		if (videoPreviewRef.value) {
			videoPreviewRef.value.srcObject = previewStream.value;
		}

		isLoadingPreview.value = false;
	} catch (error) {
		console.error("Failed to start video preview:", error);
		previewStream.value = null;
		previewSession = null;
		if (previewInputStream) {
			for (const track of previewInputStream.getTracks()) {
				track.stop();
			}
			previewInputStream = null;
		}
		isLoadingPreview.value = false;
	}
}

function stopVideoPreview() {
	isLoadingPreview.value = false;
	stopBackgroundProcessing();

	if (previewSession) {
		previewSession.cleanup();
		previewSession = null;
	}

	if (previewStream.value && isPreviewStreamDedicated) {
		for (const track of previewStream.value.getTracks()) {
			track.stop();
		}
		previewStream.value = null;
		isPreviewStreamDedicated = false;
	}

	if (previewInputStream) {
		for (const track of previewInputStream.getTracks()) {
			track.stop();
		}
		previewInputStream = null;
	}

	if (videoPreviewRef.value) {
		videoPreviewRef.value.srcObject = null;
	}
}

async function applyPreviewOptions() {
	// the meeting logic will handle it
	// via the localStorage watcher in useMeetingLogic
	const shouldSkipPreviewUpdate =
		isInMeeting.value && !isPreviewStreamDedicated;
	if (shouldSkipPreviewUpdate) {
		return;
	}

	if (!previewSession || typeof previewSession.updateOptions !== "function") {
		if (selectedCameraId.value) {
			await startVideoPreview(selectedCameraId.value);
		}
		return;
	}

	const selectedImageValue = (() => {
		const img = selectedBackgroundImageLocal.value;
		if (typeof img === "string") return img;
		if (img && typeof img === "object") return img.value;
		return null;
	})();

	try {
		await previewSession.updateOptions({
			backgroundBlurEnabled: backgroundBlurEnabledLocal.value,
			backgroundImageEnabled: backgroundImageEnabledLocal.value,
			selectedBackgroundImage: selectedImageValue,
			blurIntensity: blurIntensityLocal.value,
		});
	} catch (error) {
		console.error("Failed to update preview background options:", error);
		if (selectedCameraId.value) {
			await startVideoPreview(selectedCameraId.value);
		}
	}
}

function handleImageError(event: Event) {
	// Replace broken image with a placeholder
	const target = event.target as HTMLImageElement;
	target.style.display = "none";
	const parent = target.parentElement;
	if (parent) {
		const placeholder =
			parent.querySelector(".image-placeholder") ||
			document.createElement("div");
		placeholder.className =
			"image-placeholder absolute inset-0 bg-gray-200 flex items-center justify-center";
		placeholder.innerHTML =
			'<svg class="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>';
		if (!parent.contains(placeholder)) {
			parent.appendChild(placeholder);
		}
	}
}

function handleBackgroundBlurToggle(enabled: boolean) {
	backgroundBlurEnabledLocal.value = enabled;

	if (enabled && backgroundImageEnabledLocal.value) {
		backgroundImageEnabledLocal.value = false;
		setBackgroundImageEnabled(false);
	}

	setBackgroundBlurEnabled(enabled);
}

function handleBackgroundImageToggle(enabled: boolean) {
	backgroundImageEnabledLocal.value = enabled;

	if (enabled && backgroundBlurEnabledLocal.value) {
		backgroundBlurEnabledLocal.value = false;
		setBackgroundBlurEnabled(false);
	}

	setBackgroundImageEnabled(enabled);

	// Auto-select first image if enabling and none selected
	if (
		enabled &&
		!selectedBackgroundImageLocal.value &&
		availableBackgroundImages.length > 0
	) {
		const firstImage = availableBackgroundImages[0];
		const firstOption = backgroundImageOptions.value.find(
			(option) => option.value === firstImage.name,
		);
		selectedBackgroundImageLocal.value = firstOption || null;
		setSelectedBackgroundImage(firstImage.name);
	}
}

// Watch for background effects changes to update preview
watch(
	[
		backgroundBlurEnabledLocal,
		backgroundImageEnabledLocal,
		selectedBackgroundImageLocal,
		blurIntensityLocal,
	],
	() => {
		const shouldUpdateMeeting =
			isInMeeting.value && typeof onBackgroundEffectsChanged === "function";
		const shouldUpdatePreview =
			!isInMeeting.value || isPreviewStreamDedicated || !processedStream.value;

		if (shouldUpdateMeeting) {
			onBackgroundEffectsChanged();
		}

		if (!shouldUpdatePreview) {
			return;
		}

		if (isLoadingPreview.value) {
			pendingPreviewRefresh.value = true;
			return;
		}

		void applyPreviewOptions();
	},
);

watch(isLoadingPreview, (loading) => {
	if (!loading && pendingPreviewRefresh.value) {
		pendingPreviewRefresh.value = false;
		void applyPreviewOptions();
	}
});

watch(backgroundBlurEnabled, (newVal) => {
	backgroundBlurEnabledLocal.value = newVal;
});

watch(backgroundImageEnabled, (newVal) => {
	backgroundImageEnabledLocal.value = newVal;
});

watch(selectedBackgroundImage, (newVal) => {
	// for autocomplete
	const matchingOption = backgroundImageOptions.value.find(
		(option) => option.value === newVal,
	);

	if (matchingOption) {
		selectedBackgroundImageLocal.value = matchingOption;
	} else if (newVal) {
		// if custom image, create a local option object
		const customImage = customBackgroundImages.value.find(
			(img) => img.name === newVal,
		);
		if (customImage) {
			selectedBackgroundImageLocal.value = {
				label: customImage.label,
				value: customImage.name,
			};
		} else {
			// no custom image found
			selectedBackgroundImageLocal.value = null;
		}
	} else {
		// No selection
		selectedBackgroundImageLocal.value = null;
	}
});

watch(selectedBackgroundImageLocal, (newImageOption) => {
	const imageValue = (() => {
		if (typeof newImageOption === "string") return newImageOption;
		if (newImageOption && typeof newImageOption === "object")
			return newImageOption.value;
		return "";
	})();
	if (imageValue && imageValue !== selectedBackgroundImage.value) {
		setSelectedBackgroundImage(imageValue);
		setBackgroundImageEnabled(true);
	} else if (
		!imageValue &&
		selectedBackgroundImage.value &&
		!selectedBackgroundImage.value.startsWith("custom_")
	) {
		setBackgroundImageEnabled(false);
		setSelectedBackgroundImage("");
	}
});

watch(processedStream, (newStream) => {
	if (isInMeeting.value && newStream && videoPreviewRef.value) {
		previewStream.value = newStream;
		videoPreviewRef.value.srcObject = newStream;
	}
});

onMounted(() => {
	if (selectedCameraId.value) {
		startVideoPreview(selectedCameraId.value);
	}
});

onUnmounted(() => {
	stopVideoPreview();
	stopBackgroundProcessing();
});

watch(
	() => props.isVisible,
	(isVisible) => {
		if (!isVisible) {
			stopVideoPreview();
			stopBackgroundProcessing();
		}
	},
);
</script>