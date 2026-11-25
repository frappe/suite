import { computed, ref, type Ref } from 'vue'

import { translate as __ } from '@/platform/translation'
import {
  readBoolean,
  readJSON,
  readString,
  remove,
  writeBoolean,
  writeJSON,
  writeString,
} from '@/utils/localStorage'

import {
  convertToWebP,
  deleteCustomImage,
  getImageMetadata,
  loadCustomImages,
  saveCustomImage,
  validateImageFile,
} from '../utils/customImages'

interface BackgroundImage {
  name: string
  label: string
  url: string
  isCustom?: boolean
  metadata?: {
    size: number
    width: number
    height: number
    format: string
    createdAt: string
  }
}

export function readBackgroundEffectPreferences(blurIntensityFallback = 4) {
  const blurEnabled = readBoolean('backgroundEffects.blur')
  const imageEnabled = readBoolean('backgroundEffects.image')
  const autoFramingEnabled = readBoolean('backgroundEffects.autoFraming')

  return {
    blurEnabled,
    imageEnabled,
    selectedImage: readString('backgroundEffects.imageName'),
    blurIntensity:
      Number.parseInt(
        readString('backgroundEffects.blurIntensity', blurIntensityFallback.toString()),
        10,
      ) || blurIntensityFallback,
    autoFramingEnabled,
    anyEnabled: blurEnabled || imageEnabled || autoFramingEnabled,
  }
}

const storedPreferences = readBackgroundEffectPreferences()

export const backgroundBlurEnabled: Ref<boolean> = ref(storedPreferences.blurEnabled)
export const backgroundImageEnabled: Ref<boolean> = ref(storedPreferences.imageEnabled)
export const selectedBackgroundImage: Ref<string> = ref(storedPreferences.selectedImage)
export const blurIntensity: Ref<number> = ref(storedPreferences.blurIntensity)
export const autoFramingEnabled: Ref<boolean> = ref(storedPreferences.autoFramingEnabled)

interface FramingCropSnapshot {
  x: number
  y: number
  size: number
}

function readFramingCrop(): FramingCropSnapshot | null {
  try {
    const parsed: unknown = readJSON('backgroundEffects.framingCrop')
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !('x' in parsed) ||
      !('y' in parsed) ||
      !('size' in parsed) ||
      typeof parsed.x !== 'number' ||
      typeof parsed.y !== 'number' ||
      typeof parsed.size !== 'number' ||
      !Number.isFinite(parsed.x) ||
      !Number.isFinite(parsed.y) ||
      !Number.isFinite(parsed.size)
    ) {
      return null
    }
    return { x: parsed.x, y: parsed.y, size: parsed.size }
  } catch {
    return null
  }
}

export const autoFramingPaused: Ref<boolean> = ref(
  readBoolean('backgroundEffects.autoFramingPaused', false),
)
export const framingCrop: Ref<FramingCropSnapshot | null> = ref(readFramingCrop())

export const customBackgroundImages: Ref<BackgroundImage[]> = ref([])

export const availableBackgroundImages: BackgroundImage[] = [
  {
    name: 'beach',
    label: __('Beach'),
    url: '/assets/suite/meet/frontend/backgrounds/beach.webp',
  },
  {
    name: 'mountains',
    label: __('Mountains'),
    url: '/assets/suite/meet/frontend/backgrounds/mountains.webp',
  },
  {
    name: 'space',
    label: __('Earth & Moon'),
    url: '/assets/suite/meet/frontend/backgrounds/earth-and-moon.webp',
  },
  {
    name: 'saturn',
    label: __('Saturn'),
    url: '/assets/suite/meet/frontend/backgrounds/saturn.webp',
  },
]

export const allBackgroundOptions = computed(() => [
  {
    name: 'none',
    label: __('None'),
    url: null,
    type: 'none' as const,
  },
  {
    name: 'blur-low',
    label: __('Slight blur'),
    url: null,
    type: 'blur' as const,
  },
  {
    name: 'blur-high',
    label: __('Blur'),
    url: null,
    type: 'blur' as const,
  },
  ...availableBackgroundImages,
  ...customBackgroundImages.value,
  {
    name: 'add-custom',
    label: __('Add custom'),
    url: null,
    isAddButton: true,
  },
])

loadCustomImages()
  .then((images: BackgroundImage[]) => {
    customBackgroundImages.value = images
  })
  .catch((error: unknown) => {
    console.warn('Failed to load custom background images:', error)
  })

export function setBackgroundBlurEnabled(val: boolean): void {
  backgroundBlurEnabled.value = !!val
  writeBoolean('backgroundEffects.blur', backgroundBlurEnabled.value)
}

export function setBackgroundImageEnabled(val: boolean): void {
  backgroundImageEnabled.value = !!val
  writeBoolean('backgroundEffects.image', backgroundImageEnabled.value)
}

export function setSelectedBackgroundImage(imageName: string): void {
  selectedBackgroundImage.value = imageName
  writeString('backgroundEffects.imageName', imageName)
}

export function setBlurIntensity(intensity: number): void {
  blurIntensity.value = intensity
  writeString('backgroundEffects.blurIntensity', intensity.toString())
}

export function setAutoFramingEnabled(val: boolean): void {
  autoFramingEnabled.value = !!val
  writeBoolean('backgroundEffects.autoFraming', autoFramingEnabled.value)
  if (!autoFramingEnabled.value) setAutoFramingPaused(false)
}

export function setAutoFramingPaused(val: boolean): void {
  autoFramingPaused.value = !!val
  writeBoolean('backgroundEffects.autoFramingPaused', autoFramingPaused.value)
  if (!autoFramingPaused.value) setFramingCrop(null)
}

export function setFramingCrop(crop: FramingCropSnapshot | null): void {
  framingCrop.value = crop
  if (crop) {
    writeJSON('backgroundEffects.framingCrop', crop)
  } else {
    remove('backgroundEffects.framingCrop')
  }
}

export async function addCustomBackgroundImage(file: File): Promise<BackgroundImage> {
  try {
    validateImageFile(file)

    const metadata = await getImageMetadata(file)

    let processedFile = file
    try {
      processedFile = await convertToWebP(file)
    } catch (error) {
      console.warn('WebP conversion failed, using original file:', error)
    }

    const dataUrl = await fileToDataUrl(processedFile)

    const savedImage = await saveCustomImage(dataUrl, {
      name: processedFile.name,
      originalName: file.name,
      size: processedFile.size,
      width: metadata.width,
      height: metadata.height,
      format: processedFile.type,
    })

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
    }
    customBackgroundImages.value.push(customImage)

    return customImage
  } catch (error) {
    console.error('Failed to add custom background image:', error)
    throw error
  }
}

export async function removeCustomBackgroundImage(imageId: string): Promise<void> {
  try {
    await deleteCustomImage(imageId)

    const index = customBackgroundImages.value.findIndex((img) => img.name === imageId)
    if (index !== -1) {
      customBackgroundImages.value.splice(index, 1)
    }

    if (selectedBackgroundImage.value === imageId) {
      setSelectedBackgroundImage('')
    }
  } catch (error) {
    console.error('Failed to remove custom background image:', error)
    throw error
  }
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Expected a data URL from FileReader'))
        return
      }
      resolve(reader.result)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
