// Compositing utilities for background effects
import type { WebGLManager } from './webglShaders'

export class CompositingError extends Error {
  constructor(
    message: string,
    public code = 'COMPOSITING_ERROR',
  ) {
    super(message)
    this.name = 'CompositingError'
  }
}

interface CompositingOptions {
  blurIntensity?: number
  segmentationThreshold?: number
  webglManager?: WebGLManager
}

/**
 * Apply background blur effect using person segmentation mask
 */
export function applyBlurEffect(
  source: HTMLCanvasElement,
  mask: ImageBitmap,
  width: number,
  height: number,
  options: CompositingOptions = {},
): HTMLCanvasElement {
  const { blurIntensity = 4, webglManager } = options

  if (!webglManager) {
    throw new CompositingError(
      'WebGL is required for blur effects but is not available',
      'WEBGL_UNAVAILABLE',
    )
  }

  try {
    return webglManager.applyBlur(source, mask, width, height, blurIntensity / 2)
  } catch (_error) {
    throw new CompositingError('WebGL blur failed', 'WEBGL_BLUR_FAILED')
  }
}

/**
 * Apply virtual background effect using person segmentation mask with light wrapping
 */
export function applyVirtualBackground(
  source: HTMLCanvasElement,
  mask: ImageBitmap,
  backgroundImageData: ImageData,
  options: CompositingOptions = {},
): HTMLCanvasElement {
  const { webglManager } = options

  if (!webglManager) {
    throw new CompositingError(
      'WebGL is required for virtual background but is not available',
      'WEBGL_UNAVAILABLE',
    )
  }

  try {
    return webglManager.applyLightWrap(
      source,
      mask,
      backgroundImageData,
      backgroundImageData.width,
      backgroundImageData.height,
    )
  } catch (error) {
    console.warn('Light wrap WebGL render failed:', error)
    throw new CompositingError('WebGL light wrap failed', 'WEBGL_LIGHTWRAP_FAILED')
  }
}

/**
 * Get background image data with proper orientation
 */
export function getBackgroundImageData(
  backgroundImg: HTMLImageElement,
  width: number,
  height: number,
): ImageData {
  const tempCanvas = document.createElement('canvas')
  const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true })

  if (!tempCtx) {
    throw new CompositingError('Failed to get canvas context for background image')
  }

  tempCanvas.width = width
  tempCanvas.height = height

  // Flip the background image horizontally to compensate for flipped video frames
  tempCtx.scale(-1, 1)
  tempCtx.drawImage(backgroundImg, -width, 0, width, height)

  return tempCtx.getImageData(0, 0, width, height)
}
