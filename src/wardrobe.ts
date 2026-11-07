export const originals = [
  { id: 'rouille', name: 'Rouille', description: 'Maille à motif crème' },
  { id: 'bleu', name: 'Bleu clair', description: 'Sweat H&M' },
  { id: 'creme', name: 'Crème', description: 'Hoodie H&M' },
  { id: 'gris', name: 'Gris chiné', description: 'Sweat H&M' },
  { id: 'bordeaux', name: 'Bordeaux', description: 'Hoodie zippé H&M' },
  { id: 'noir', name: 'Noir', description: 'Hoodie zippé H&M' },
] as const

export type GarmentId = string
export type Photo = { key: string; blob: Blob }
export type Garment = {
  id: GarmentId
  name: string
  archived: boolean
  threshold: number | null
  photo: Photo | null
}

export const uuidPattern = /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i
export const maxNameLength = 36

export function originalFor(id: GarmentId) {
  return originals.find((item) => item.id === id)
}

export function defaultWardrobe(): Garment[] {
  return originals.map(({ id, name }) => ({ id, name, archived: false, threshold: null, photo: null }))
}

export function garmentFor(wardrobe: Garment[], id: GarmentId) {
  const garment = wardrobe.find((item) => item.id === id)
  if (!garment) throw new Error('Ce sweat ne figure plus dans la garde-robe.')
  return garment
}

export function garmentName(value: string) {
  const name = value.trim().replace(/\s+/g, ' ')
  if (!name || name.length > maxNameLength) {
    throw new Error(`Saisis un nom de 1 à ${maxNameLength} caractères.`)
  }
  return name
}

