import { isDay, parisDay } from './dates.ts'
import type { Event, State } from './model.ts'
import { defaultWardrobe, garmentName, originalFor, originals, uuidPattern } from './wardrobe.ts'
import type { Garment, Photo } from './wardrobe.ts'
import { blobBase64, maxPhotoSize, maxWardrobePhotos, verifyStoredPhoto } from './photos.ts'
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isTimestamp = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value

export function isIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum
}

function invalid(): never {
  throw new Error('Le fichier ne contient pas une sauvegarde Sweat Tracker valide.')
}

function parseEvent(value: unknown, today: string, identifiers: Set<string>): Event {
  if (!isRecord(value)) invalid()
  const { id, garment, kind, day, order, primary, createdAt } = value
  if (
    typeof id !== 'string' || !uuidPattern.test(id) ||
    (typeof garment !== 'string' || !identifiers.has(garment)) || (kind !== 'wear' && kind !== 'wash') ||
    !isDay(day) || day > today || !isIntegerInRange(order, -1_000_000, 1_000_000) ||
    typeof primary !== 'boolean' || (kind === 'wash' && primary) || !isTimestamp(createdAt)
  ) invalid()
  return { id, garment, kind, day, order, primary, createdAt }
}

async function parseWardrobe(value: unknown): Promise<Garment[]> {
  if (!Array.isArray(value)) invalid()
  const wardrobe: Garment[] = []
  const ids = new Set<string>()
  let totalBytes = 0
  for (const item of value) {
    if (!isRecord(item)) invalid()
    const { id, name, archived, threshold, photo } = item
    if (
      typeof id !== 'string' || (!originalFor(id) && (!uuidPattern.test(id) || id !== id.toLowerCase())) ||
      ids.has(id) || typeof name !== 'string' || typeof archived !== 'boolean' ||
      (threshold !== null && !isIntegerInRange(threshold, 1, 99))
    ) invalid()
    const normalized = garmentName(name)
    let storedPhoto: Photo | null = null
    if (photo !== null) {
      if (!isRecord(photo)) invalid()
      const { type, base64 } = photo
      if (
        (type !== 'image/png' && type !== 'image/jpeg' && type !== 'image/webp') ||
        typeof base64 !== 'string' || base64.length > Math.ceil(maxPhotoSize / 3) * 4 ||
        base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)
      ) invalid()
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))
      totalBytes += bytes.length
      if (totalBytes > maxWardrobePhotos) invalid()
      const blob = new Blob([bytes], { type })
      await verifyStoredPhoto(blob)
      storedPhoto = { key: crypto.randomUUID(), blob }
    } else if (!originalFor(id)) invalid()
    ids.add(id)
    wardrobe.push({ id, name: normalized, archived, threshold, photo: storedPhoto })
  }
  if (originals.some(({ id }) => !ids.has(id))) invalid()
  return wardrobe
}

export async function validateBackup(value: unknown, today = parisDay()): Promise<State> {
  if (!isRecord(value)) invalid()
  if (value.version !== 1 && value.version !== 2) throw new Error('Cette version de sauvegarde est incompatible.')
  if (
    !isIntegerInRange(value.threshold, 1, 99) || !isRecord(value.initial) ||
    !Array.isArray(value.events) || !Array.isArray(value.corrections)
  ) invalid()

  const wardrobe = value.version === 1 ? defaultWardrobe() : await parseWardrobe(value.wardrobe)
  const identifiers = new Set(wardrobe.map(({ id }) => id))
  const initial: State['initial'] = {}
  for (const [id, count] of Object.entries(value.initial)) {
    if (!identifiers.has(id) || !isIntegerInRange(count, 0, 9999)) invalid()
    initial[id] = count
  }

  const events = value.events.map((event: unknown) => parseEvent(event, today, identifiers))
  const ids = new Set<string>()
  const slots = new Set<string>()
  const positions = new Set<string>()
  const primaryDays = new Set<string>()
  for (const event of events) {
    const key = `${event.day}/${event.garment}`
    const slot = `${key}/${event.kind}`
    const position = `${key}/${event.order}`
    if (ids.has(event.id) || slots.has(slot) || positions.has(position) ||
      (event.primary && primaryDays.has(event.day))) invalid()
    ids.add(event.id)
    slots.add(slot)
    positions.add(position)
    if (event.primary) primaryDays.add(event.day)
  }

  const corrections = value.corrections.map((change: unknown) => {
    if (!isRecord(change) || !isTimestamp(change.at)) invalid()
    const before = change.before === null ? null : parseEvent(change.before, today, identifiers)
    const after = change.after === null ? null : parseEvent(change.after, today, identifiers)
    if ((!before && !after) || (before && after && before.id !== after.id)) invalid()
    return { before, after, at: change.at }
  })

  return { version: 2, threshold: value.threshold, initial, events, corrections, wardrobe }
}

export async function backupFile(state: State) {
  const wardrobe = []
  // Encode one photo at a time to avoid decoding the entire wardrobe into memory at once.
  for (const garment of state.wardrobe) {
    const blob = garment.photo?.blob
    wardrobe.push({
      ...garment,
      photo: blob ? { type: blob.type, base64: await blobBase64(blob) } : null,
    })
  }
  return new Blob([JSON.stringify({ ...state, wardrobe }, null, 2)], { type: 'application/json' })
}
