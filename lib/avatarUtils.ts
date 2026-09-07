const AVATAR_MAX_DIMENSION = 512
const JPEG_QUALITY = 0.8

function isHeic(file: File): boolean {
  if (file.type === 'image/heic' || file.type === 'image/heif') return true
  const name = file.name.toLowerCase()
  return name.endsWith('.heic') || name.endsWith('.heif')
}

async function heicToBlob(file: File): Promise<Blob> {
  const heic2any = (await import('heic2any')).default
  const result = await heic2any({ blob: file, toType: 'image/jpeg', quality: JPEG_QUALITY })
  return Array.isArray(result) ? result[0] : result
}

function compressWithCanvas(blob: Blob, maxDimension: number): Promise<{ base64: string; contentType: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(blob)
    img.onload = () => {
      URL.revokeObjectURL(url)
      let { width, height } = img
      if (width > maxDimension || height > maxDimension) {
        const scale = maxDimension / Math.max(width, height)
        width = Math.round(width * scale)
        height = Math.round(height * scale)
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, width, height)
      const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY)
      const base64 = dataUrl.split(',')[1]
      resolve({ base64, contentType: 'image/jpeg' })
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load image'))
    }
    img.src = url
  })
}

/**
 * Shrink and re-encode an image in the browser before upload.
 * HEIC (every modern iPhone photo) is converted to JPEG first, since nothing
 * else in the pipeline can read it.
 */
export async function processImageFile(
  file: File,
  maxDimension: number,
): Promise<{ base64: string; contentType: string }> {
  const blob = isHeic(file) ? await heicToBlob(file) : file
  return compressWithCanvas(blob, maxDimension)
}

export async function processAvatarFile(file: File) {
  return processImageFile(file, AVATAR_MAX_DIMENSION)
}

/** Talk photos stay legible full-width, so they keep more resolution. */
export const TALK_MAX_DIMENSION = 1600
