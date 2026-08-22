import { computed, type Ref, ref } from "vue";
import {
	convertToWebP,
	deleteCustomImage,
	getImageMetadata,
	loadCustomImages,
	saveCustomImage,
	validateImageFile,
} from "../utils/customImages";

// Types and interfaces
interface BackgroundImage {
	name: string;
	label: string;
	url: string;
	isCustom?: boolean;
	metadata?: {
		size: number;
		width: number;
		height: number;
		format: string;
		createdAt: string;
	};
}

function readBool(key: string, def = false) {
	const v = localStorage.getItem(key);
	if (v === null) return def;
	return v === "1";
}

function readString(key: string, def = "") {
	const v = localStorage.getItem(key);
	return v !== null ? v : def;
}

// Background effects preferences
export const backgroundBlurEnabled: Ref<boolean> = ref(
	readBool("backgroundEffects.blur", false),
);
export const backgroundImageEnabled: Ref<boolean> = ref(
	readBool("backgroundEffects.image", false),
);
export const selectedBackgroundImage: Ref<string> = ref(
	readString("backgroundEffects.imageName", ""),
);
export const blurIntensity: Ref<number> = ref(
	Number.parseInt(readString("backgroundEffects.blurIntensity", "4"), 10) || 4,
);
export const autoFramingEnabled: Ref<boolean> = ref(
	readBool("backgroundEffects.autoFraming", false),
);

export interface FramingCropSnapshot {
	x: number;
	y: number;
	size: number;
}

function readFramingCrop(): FramingCropSnapshot | null {
	try {
		const raw = localStorage.getItem("backgroundEffects.framingCrop");
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Partial<FramingCropSnapshot> | null;
		if (
			typeof parsed?.x !== "number" ||
			typeof parsed?.y !== "number" ||
			typeof parsed?.size !== "number" ||
			!Number.isFinite(parsed.x) ||
			!Number.isFinite(parsed.y) ||
			!Number.isFinite(parsed.size)
		) {
			return null;
		}
		return { x: parsed.x, y: parsed.y, size: parsed.size };
	} catch {
		return null;
	}
}

export const autoFramingPaused: Ref<boolean> = ref(
	readBool("backgroundEffects.autoFramingPaused", false),
);
export const framingCrop: Ref<FramingCropSnapshot | null> =
	ref(readFramingCrop());

// Custom background images
export const customBackgroundImages: Ref<BackgroundImage[]> = ref([]);

// Available background images (predefined set)
export const availableBackgroundImages: BackgroundImage[] = [
	{
		name: "beach",
		label: "Beach",
		url: "/assets/suite/meet/frontend/backgrounds/beach.webp",
	},
	{
		name: "mountains",
		label: "Mountains",
		url: "/assets/suite/meet/frontend/backgrounds/mountains.webp",
	},
	{
		name: "space",
		label: "Earth & Moon",
		url: "/assets/suite/meet/frontend/backgrounds/earth-and-moon.webp",
	},
	{
		name: "saturn",
		label: "Saturn",
		url: "/assets/suite/meet/frontend/backgrounds/saturn.webp",
	},
];

// Combined background options (none + blur + built-in + custom + add new)
export const allBackgroundOptions = computed(() => [
	{
		name: "none",
		label: "None",
		url: null,
		type: "none" as const,
	},
	{
		name: "blur-low",
		label: "Slight Blur",
		url: null,
		type: "blur" as const,
	},
	{
		name: "blur-high",
		label: "Blur",
		url: null,
		type: "blur" as const,
	},
	...availableBackgroundImages,
	...customBackgroundImages.value,
	{
		name: "add-custom",
		label: "Add Custom",
		url: null,
		isAddButton: true,
	},
]);

// Load custom images on module initialization
loadCustomImages()
	.then((images: BackgroundImage[]) => {
		customBackgroundImages.value = images;
	})
	.catch((error: unknown) => {
		console.warn("Failed to load custom background images:", error);
	});

export function setBackgroundBlurEnabled(val: boolean): void {
	backgroundBlurEnabled.value = !!val;
	localStorage.setItem(
		"backgroundEffects.blur",
		backgroundBlurEnabled.value ? "1" : "0",
	);
}

export function setBackgroundImageEnabled(val: boolean): void {
	backgroundImageEnabled.value = !!val;
	localStorage.setItem(
		"backgroundEffects.image",
		backgroundImageEnabled.value ? "1" : "0",
	);
}

export function setSelectedBackgroundImage(imageName: string): void {
	selectedBackgroundImage.value = imageName;
	localStorage.setItem("backgroundEffects.imageName", imageName);
}

export function setBlurIntensity(intensity: number): void {
	blurIntensity.value = intensity;
	localStorage.setItem("backgroundEffects.blurIntensity", intensity.toString());
}

export function setAutoFramingEnabled(val: boolean): void {
	autoFramingEnabled.value = !!val;
	localStorage.setItem(
		"backgroundEffects.autoFraming",
		autoFramingEnabled.value ? "1" : "0",
	);
	if (!autoFramingEnabled.value) setAutoFramingPaused(false);
}

export function setAutoFramingPaused(val: boolean): void {
	autoFramingPaused.value = !!val;
	localStorage.setItem(
		"backgroundEffects.autoFramingPaused",
		autoFramingPaused.value ? "1" : "0",
	);
	if (!autoFramingPaused.value) setFramingCrop(null);
}

export function setFramingCrop(crop: FramingCropSnapshot | null): void {
	framingCrop.value = crop;
	if (crop) {
		localStorage.setItem("backgroundEffects.framingCrop", JSON.stringify(crop));
	} else {
		localStorage.removeItem("backgroundEffects.framingCrop");
	}
}

// Add a custom background image
export async function addCustomBackgroundImage(
	file: File,
): Promise<BackgroundImage> {
	try {
		validateImageFile(file);

		const metadata = await getImageMetadata(file);

		// WebP conversion
		let processedFile = file;
		try {
			processedFile = await convertToWebP(file);
		} catch (error) {
			console.warn("WebP conversion failed, using original file:", error);
		}

		// Convert to base64 data URL
		const dataUrl = await fileToDataUrl(processedFile);

		// Save to IndexedDB
		const savedImage = await saveCustomImage(dataUrl, {
			name: processedFile.name,
			originalName: file.name,
			size: processedFile.size,
			width: metadata.width,
			height: metadata.height,
			format: processedFile.type,
		});

		const customImage: BackgroundImage = {
			name: savedImage.id,
			label: savedImage.originalName,
			url: savedImage.data,
			isCustom: true,
			metadata: {
				size: savedImage.size,
				width: savedImage.width,
				height: savedImage.height,
				format: savedImage.format,
				createdAt: savedImage.createdAt,
			},
		};
		customBackgroundImages.value.push(customImage);

		return customImage;
	} catch (error) {
		console.error("Failed to add custom background image:", error);
		throw error;
	}
}

export async function removeCustomBackgroundImage(
	imageId: string,
): Promise<void> {
	try {
		await deleteCustomImage(imageId);

		const index = customBackgroundImages.value.findIndex(
			(img) => img.name === imageId,
		);
		if (index !== -1) {
			customBackgroundImages.value.splice(index, 1);
		}

		if (selectedBackgroundImage.value === imageId) {
			setSelectedBackgroundImage("");
		}
	} catch (error) {
		console.error("Failed to remove custom background image:", error);
		throw error;
	}
}

function fileToDataUrl(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as string);
		reader.onerror = reject;
		reader.readAsDataURL(file);
	});
}
