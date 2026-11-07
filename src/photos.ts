import type { Photo } from './wardrobe.ts'

const MiB = 1024 ** 2
const maxUpload = 24 * MiB
export const maxPhotoSize = 5 * MiB
export const maxWardrobePhotos = 48 * MiB
export const maxBackupSize = 96 * MiB
const maxPixels = 50_000_000
const maxSide = 1280

export type PhotoType = 'image/jpeg' | 'image/png' | 'image/webp'

export async function photoType(file: Blob): Promise<PhotoType> {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) return 'image/png'
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg'
  if (String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8)) === 'WEBP') return 'image/webp'
  throw new Error('Choisis une image PNG, JPEG ou WebP.')
}

async function withImage<T>(blob: Blob, maxSize: number, read: (image: HTMLImageElement) => T | Promise<T>) {
  const url = URL.createObjectURL(blob)
  try {
    const image = new Image()
    image.src = url
    try { await image.decode() }
    catch { throw new Error('Cette image est illisible. Choisis un autre fichier.') }
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > maxSize) {
      throw new Error('Les dimensions de cette image sont trop grandes.')
    }
    return await read(image)
  } finally {
    URL.revokeObjectURL(url)
  }
}

function canvasBlob(canvas: HTMLCanvasElement, type: PhotoType) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('Impossible de préparer cette image. Essaie avec un fichier plus léger.'))
    }, type, 0.91)
  })
}

export async function preparePhoto(file: Blob): Promise<Photo> {
  if (file.size > maxUpload) throw new Error('Choisis une image de 24 Mo maximum.')
  const type = await photoType(file)
  const source = file.slice(0, file.size, type)
  const blob = await withImage(source, maxPixels, async (image) => {
    const largest = Math.max(image.naturalWidth, image.naturalHeight)
    if (largest <= maxSide && source.size <= 1024 ** 2) return source

    const canvas = document.createElement('canvas')
    try {
      const scale = Math.min(1, maxSide / largest)
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Impossible de préparer cette image.')
      context.imageSmoothingQuality = 'high'
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      // PNG remains the fallback for transparent images when WebP encoding is unavailable.
      let optimized = await canvasBlob(canvas, type === 'image/jpeg' ? type : 'image/webp')
      if (optimized.size > maxPhotoSize) {
        canvas.width = Math.max(1, Math.round(canvas.width * 0.72))
        canvas.height = Math.max(1, Math.round(canvas.height * 0.72))
        context.imageSmoothingQuality = 'high'
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        optimized = await canvasBlob(canvas, type === 'image/jpeg' ? type : 'image/png')
      }
      if (optimized.size > maxPhotoSize) throw new Error('Cette image optimisée dépasse 5 Mo.')
      return optimized
    } finally {
      canvas.width = canvas.height = 0
    }
  })
  return { key: crypto.randomUUID(), blob }
}

export async function verifyStoredPhoto(blob: Blob) {
  if (blob.size > maxPhotoSize || await photoType(blob) !== blob.type) {
    throw new Error('Une image de la sauvegarde est invalide.')
  }
  await withImage(blob, maxSide ** 2, (image) => {
    if (Math.max(image.naturalWidth, image.naturalHeight) > maxSide) {
      throw new Error('Une image de la sauvegarde dépasse les dimensions prises en charge.')
    }
  })
}

export async function blobBase64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const chunks: string[] = []
  for (let index = 0; index < bytes.length; index += 8192) {
    chunks.push(String.fromCharCode(...bytes.subarray(index, index + 8192)))
  }
  return btoa(chunks.join(''))
}

