import { isDay, parisDay } from './dates.ts'
import { defaultWardrobe, garmentFor, garmentName } from './wardrobe.ts'
import type { Garment, GarmentId, Photo } from './wardrobe.ts'
import { maxWardrobePhotos } from './photos.ts'

export type EventKind = 'wear' | 'wash'
export type Event = {
  id: string
  garment: GarmentId
  day: string
  kind: EventKind
  order: number
  primary: boolean
  createdAt: string
}
export type Change = {
  before: Event | null
  after: Event | null
}
export type StateV1 = {
  version: 1
  threshold: number
  initial: Partial<Record<GarmentId, number>>
  events: Event[]
  corrections: (Change & { at: string })[]
}

export type State = Omit<StateV1, 'version'> & { version: 2; wardrobe: Garment[] }

export const emptyState = (): State => ({
  version: 2, threshold: 4, initial: {}, events: [], corrections: [], wardrobe: defaultWardrobe(),
})

export function migrateV1(previous: StateV1 | State): State {
  if (previous?.version === 2) return previous
  if (previous?.version !== 1 || !Array.isArray(previous.events) || !Array.isArray(previous.corrections) ||
      !previous.initial || typeof previous.threshold !== 'number') {
    throw new Error('Les données existantes n’ont pas pu être migrées. Réessaie après avoir fermé l’application.')
  }
  return { ...previous, version: 2, wardrobe: defaultWardrobe() }
}

export type GarmentInput = {
  name: string
  threshold: number | null
  photo?: Photo
  initial?: number
}

export function saveGarment(state: State, input: GarmentInput, id?: GarmentId): State {
  const name = garmentName(input.name)
  const { threshold, initial = 0 } = input
  if (threshold !== null && (!Number.isInteger(threshold) || threshold < 1 || threshold > 99)) {
    throw new Error('Choisis un seuil de 1 à 99 ports.')
  }
  const existing = id ? garmentFor(state.wardrobe, id) : null
  const photo = input.photo ?? existing?.photo ?? null
  if (!existing && !photo) throw new Error('Ajoute une photo du vêtement.')
  if (!existing && (!Number.isInteger(initial) || initial < 0 || initial > 9999)) {
    throw new Error('Choisis un nombre de ports de départ entre 0 et 9 999.')
  }
  const garment = { id: existing?.id ?? crypto.randomUUID(), name, threshold, photo, archived: existing?.archived ?? false }
  const wardrobe = existing
    ? state.wardrobe.map((item) => item.id === id ? garment : item)
    : [...state.wardrobe, garment]
  const photoBytes = wardrobe.reduce((total, item) => total + (item.photo?.blob.size ?? 0), 0)
  if (photoBytes > maxWardrobePhotos) throw new Error('La limite de 48 Mo de photos est atteinte. Essaie une photo plus légère.')
  return { ...state, wardrobe, initial: existing ? state.initial : { ...state.initial, [garment.id]: initial } }
}

export function archiveGarment(state: State, id: GarmentId, archived: boolean): State {
  if (garmentFor(state.wardrobe, id).archived === archived) return state
  const wardrobe = state.wardrobe.map((item) => item.id === id ? { ...item, archived } : item)
  return { ...state, wardrobe }
}

export function compareEvents(a: Event, b: Event) {
  return a.day.localeCompare(b.day) || a.order - b.order || a.id.localeCompare(b.id)
}

export function garmentStats(state: State, garment: GarmentId) {
  const events = state.events.filter((event) => event.garment === garment).sort(compareEvents)
  const lastWash = events.findLast((event) => event.kind === 'wash')
  const lastWear = events.findLast((event) => event.kind === 'wear')
  const count = (lastWash ? 0 : state.initial[garment] ?? 0) + events.filter(
    (event) => event.kind === 'wear' && (!lastWash || compareEvents(event, lastWash) > 0),
  ).length
  return { events, count, lastWear, lastWash }
}

export function statusFor(count: number, threshold: number) {
  if (count >= threshold) return { label: 'Lavage conseillé', tone: 'wash' }
  if (count > 0 && count === threshold - 1) return { label: 'Bientôt à laver', tone: 'soon' }
  return { label: count === 0 ? 'Prêt à porter' : 'Suivi en cours', tone: 'normal' }
}

export function wearLabel(count: number) {
  return `${count} ${count === 1 ? 'port' : 'ports'}`
}

export function collision(events: Event[], event: Event) {
  const sameDay = events.filter((other) => other.id !== event.id && other.day === event.day)
  return sameDay.some((other) => other.garment === event.garment && other.kind === event.kind)
    || (event.primary && sameDay.some((other) => other.primary))
}

function commit(state: State, change: Change, audit: boolean, now: Date): State {
  const { before, after } = change
  const events = state.events.filter((event) => event.id !== before?.id)
  if (after) {
    if (collision(events, after)) throw new Error('Cette journée contient déjà un enregistrement équivalent.')
    if (events.some((event) => event.garment === after.garment && event.day === after.day && event.order === after.order)) {
      throw new Error('L’ordre de cette journée a changé. Modifie l’entrée dans le journal.')
    }
    events.push(after)
  }
  return {
    ...state, events,
    corrections: audit ? [...state.corrections, { ...change, at: now.toISOString() }] : state.corrections,
  }
}

export function quickWear(state: State, garment: GarmentId, now = new Date()) {
  if (garmentFor(state.wardrobe, garment).archived) throw new Error('Restaure ce sweat pour enregistrer un nouveau port.')
  const day = parisDay(now)
  if (state.events.some((event) => event.kind === 'wear' && event.garment === garment && event.day === day)) {
    return { state, change: null }
  }
  let before = state.events.find((event) => event.day === day && event.primary) ?? null
  if (before && garmentFor(state.wardrobe, before.garment).archived) {
    // The archived garment keeps its wear when a new daily choice is made.
    state = commit(state, { before, after: { ...before, primary: false } }, true, now)
    before = null
  }
  const related = state.events.find((event) => event.garment === garment && event.day === day)
  const after: Event = {
    id: before?.id ?? crypto.randomUUID(),
    day, garment, kind: 'wear', primary: true,
    order: related ? related.order + 1 : 0, createdAt: before?.createdAt ?? now.toISOString(),
  }
  const change = { before, after }
  return { state: commit(state, change, Boolean(before), now), change }
}

export type Entry = Pick<Event, 'day' | 'garment' | 'kind'> & {
  id?: string
  expected?: Event
  position?: 'before' | 'after'
}

export function saveEntry(state: State, input: Entry, now = new Date()) {
  if (!isDay(input.day)) throw new Error('Choisis une date valide.')
  if (input.day > parisDay(now)) throw new Error('Choisis une date qui ne dépasse pas aujourd’hui.')
  const before = state.events.find((event) => event.id === input.id) ?? null
  if (input.id && !before) throw new Error('Cette entrée a déjà été supprimée.')
  if (input.expected) assertUnchanged(before, input.expected)
  if (garmentFor(state.wardrobe, input.garment).archived && before?.garment !== input.garment) {
    throw new Error('Restaure ce sweat pour ajouter une entrée.')
  }
  const related = state.events.find((event) =>
    event.id !== input.id && event.garment === input.garment && event.day === input.day && event.kind !== input.kind,
  )
  const sameSlot = before?.day === input.day && before.garment === input.garment
  const order = related && input.position
    ? related.order + (input.position === 'before' ? -1 : 1)
    : sameSlot ? before.order : related ? related.order + 1 : 0
  const primary = input.kind === 'wear' && Boolean(before?.primary) &&
    !state.events.some((event) => event.id !== input.id && event.day === input.day && event.primary)
  const after: Event = {
    id: before?.id ?? crypto.randomUUID(),
    day: input.day, garment: input.garment, kind: input.kind,
    order, primary, createdAt: before?.createdAt ?? now.toISOString(),
  }
  if (JSON.stringify(before) === JSON.stringify(after)) return state
  return commit(state, { before, after }, Boolean(before), now)
}

export function removeEntry(state: State, id: string, now = new Date(), expected?: Event) {
  const before = state.events.find((event) => event.id === id)
  if (!before) throw new Error('Cette entrée a déjà été supprimée.')
  if (expected) assertUnchanged(before, expected)
  return commit(state, { before, after: null }, true, now)
}

function assertUnchanged(current: Event | null | undefined, expected: Event | null): asserts current is Event {
  if (!current || JSON.stringify(current) !== JSON.stringify(expected)) {
    throw new Error('Cette entrée a changé. Tu peux la corriger dans le journal.')
  }
}

export function undoQuickWear(state: State, change: Change, now = new Date()) {
  const current = state.events.find((event) => event.id === change.after?.id)
  assertUnchanged(current, change.after)
  return commit(state, { before: current, after: change.before }, true, now)
}
