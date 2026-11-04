// IndexedDB utilities for custom background images
const DB_NAME = 'Meet_Backgrounds'
const DB_VERSION = 1
const STORE_NAME = 'custom_images'

// Types and interfaces
interface ImageMetadata {
  width: number
  height: number
  aspectRatio: number
}

interface CustomImageRecord {
  id: string
  name: string
  originalName: string
  data: string // Base64 data URL
  size: number
  width: number
  height: number
  format: string
  createdAt: string
}

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

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        store.createIndex('name', 'name', { unique: true })
      }
    }
  })
}

export async function saveCustomImage(
  imageData: string,
  metadata: {
    name: string
    originalName: string
    size: number
    width: number
    height: number
    format: string
  },
): Promise<CustomImageRecord> {
  try {
    const db = await openDB()
    const transaction = db.transaction([STORE_NAME], 'readwrite')
    const store = transaction.objectStore(STORE_NAME)

    const imageRecord: CustomImageRecord = {
      id: `custom_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: metadata.name,
      originalName: metadata.originalName,
      data: imageData, // Base64 data URL
      size: metadata.size,
      width: metadata.width,
      height: metadata.height,
      format: metadata.format,
      createdAt: new Date().toISOString(),
    }

    await new Promise<void>((resolve, reject) => {
      const request = store.add(imageRecord)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })

    db.close()
    return imageRecord
  } catch (error) {
    console.error('Failed to save custom image:', error)
    throw error
  }
}

export async function loadCustomImages(): Promise<BackgroundImage[]> {
  try {
    const db = await openDB()
    const transaction = db.transaction([STORE_NAME], 'readonly')
    const store = transaction.objectStore(STORE_NAME)

    return new Promise<BackgroundImage[]>((resolve, reject) => {
      const request = store.getAll()
      request.onsuccess = () => {
        const images: BackgroundImage[] = request.result.map((img: CustomImageRecord) => ({
          name: img.id,
          label: img.originalName,
          url: img.data,
          isCustom: true,
          metadata: {
            size: img.size,
            width: img.width,
            height: img.height,
            format: img.format,
            createdAt: img.createdAt,
          },
        }))
        db.close()
        resolve(images)
      }
      request.onerror = () => {
        db.close()
        reject(request.error)
      }
    })
  } catch (error) {
    console.error('Failed to load custom images:', error)
    return []
  }
}

export async function deleteCustomImage(imageId: string): Promise<void> {
  try {
    const db = await openDB()
    const transaction = db.transaction([STORE_NAME], 'readwrite')
    const store = transaction.objectStore(STORE_NAME)

    await new Promise<void>((resolve, reject) => {
      const request = store.delete(imageId)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })

    db.close()
  } catch (error) {
    console.error('Failed to delete custom image:', error)
    throw error
  }
}

export function validateImageFile(file: File): boolean {
  const MAX_SIZE = 5 * 1024 * 1024 // 5MB
  const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']

  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error('Unsupported file type. Please use JPG, PNG, or WebP.')
  }

  if (file.size > MAX_SIZE) {
    throw new Error('File too large. Maximum size is 5MB.')
  }

  return true
}

export async function convertToWebP(file: File): Promise<File> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    const img = new Image()

    img.onload = () => {
      // Check dimensions
      const MAX_WIDTH = 4096
      const MAX_HEIGHT = 4096

      if (img.width > MAX_WIDTH || img.height > MAX_HEIGHT) {
        reject(new Error(`Image too large. Maximum dimensions are ${MAX_WIDTH}x${MAX_HEIGHT}.`))
        return
      }

      // Set canvas size
      canvas.width = img.width
      canvas.height = img.height

      // Draw and convert
      ctx?.drawImage(img, 0, 0)

      canvas.toBlob(
        (blob) => {
          if (blob) {
            const webpFile = new File([blob], file.name.replace(/\.[^/.]+$/, '.webp'), {
              type: 'image/webp',
            })
            resolve(webpFile)
          } else {
            // Fallback to original if WebP conversion fails
            resolve(file)
          }
        },
        'image/webp',
        0.8, // 80% quality
      )
    }

    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = URL.createObjectURL(file)
  })
}

export function getImageMetadata(file: File): Promise<ImageMetadata> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      resolve({
        width: img.width,
        height: img.height,
        aspectRatio: img.width / img.height,
      })
      URL.revokeObjectURL(img.src)
    }
    img.onerror = () => {
      URL.revokeObjectURL(img.src)
      reject(new Error('Invalid image file'))
    }
    img.src = URL.createObjectURL(file)
  })
}
