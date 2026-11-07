import test from 'node:test'
import assert from 'node:assert/strict'
import { backupFile, validateBackup } from '../src/backup.ts'
import { isDay, parisDay } from '../src/dates.ts'
import { archiveGarment, emptyState, garmentStats, migrateV1, quickWear, removeEntry, saveEntry, saveGarment, statusFor, undoQuickWear } from '../src/model.ts'

const now = new Date('2026-11-07T20:00:00Z')
const today = parisDay(now)
const count = (state, id) => garmentStats(state, id).count
const entry = (state, garment, day, kind = 'wear', position) =>
  saveEntry(state, { garment, day, kind, position }, now)

test('jour de Paris au changement de date et au passage à l’heure d’été', () => {
  assert.equal(parisDay(new Date('2026-03-28T22:59:59Z')), '2026-03-28')
  assert.equal(parisDay(new Date('2026-03-28T23:00:00Z')), '2026-03-29')
  assert.equal(parisDay(new Date('2026-03-29T22:00:00Z')), '2026-03-30')
  assert.equal(parisDay(new Date('2026-10-25T23:00:00Z')), '2026-10-26')
  assert.equal(isDay('2026-02-29'), false)
  assert.equal(isDay('2028-02-29'), true)
})

test('un second toucher ne double pas le port, un autre sweat corrige le choix', () => {
  const first = quickWear(emptyState(), 'bleu', now)
  const repeat = quickWear(first.state, 'bleu', now)
  assert.equal(repeat.state, first.state)
  assert.equal(repeat.change, null)

  const corrected = quickWear(first.state, 'gris', now)
  assert.equal(count(corrected.state, 'bleu'), 0)
  assert.equal(count(corrected.state, 'gris'), 1)
  assert.equal(corrected.state.corrections.length, 1)

  const restored = undoQuickWear(corrected.state, corrected.change, now)
  assert.equal(count(restored, 'bleu'), 1)
  assert.equal(count(restored, 'gris'), 0)
  assert.equal(count(undoQuickWear(restored, first.change, now), 'bleu'), 0)
})

test('un port supplémentaire survit à une correction du choix principal', () => {
  let state = quickWear(emptyState(), 'bleu', now).state
  state = entry(state, 'gris', today)
  assert.throws(() => entry(state, 'gris', today), /déjà/)
  assert.equal(quickWear(state, 'gris', now).state, state)
  state = quickWear(state, 'noir', now).state
  assert.equal(count(state, 'bleu'), 0)
  assert.equal(count(state, 'gris'), 1)
  assert.equal(count(state, 'noir'), 1)
})

test('port et lavage le même jour dans les deux ordres', () => {
  const beforeWash = quickWear(emptyState(), 'bleu', now).state
  const washed = entry(beforeWash, 'bleu', today, 'wash')
  assert.equal(count(washed, 'bleu'), 0)
  assert.equal(washed.events.length, 2)
  assert.equal(quickWear(washed, 'bleu', now).state, washed)
  assert.throws(() => entry(washed, 'bleu', today, 'wash'), /déjà/)

  const washFirst = entry(emptyState(), 'bleu', today, 'wash')
  const wornAfter = quickWear(washFirst, 'bleu', now).state
  assert.equal(count(wornAfter, 'bleu'), 1)
  const wash = wornAfter.events.find(({ kind }) => kind === 'wash')
  const reordered = saveEntry(wornAfter, { ...wash, position: 'after' }, now)
  assert.equal(count(reordered, 'bleu'), 0)
  assert.equal(count(removeEntry(reordered, wash.id, now), 'bleu'), 1)
})

test('port rétroactif puis correction de date de part et d’autre du lavage', () => {
  let state = entry(emptyState(), 'creme', '2026-11-05', 'wash')
  state = entry(state, 'creme', '2026-11-04')
  assert.equal(count(state, 'creme'), 0)
  const wear = state.events.find(({ kind }) => kind === 'wear')
  state = saveEntry(state, { ...wear, day: '2026-11-06' }, now)
  assert.equal(count(state, 'creme'), 1)
  assert.equal(state.corrections[0].before.day, '2026-11-04')
  assert.equal(state.corrections[0].after.day, '2026-11-06')
  assert.throws(() => entry(state, 'creme', '2026-11-08'), /aujourd’hui/)
})

test('ports de départ sans date, seuil indicatif, compteur non plafonné', () => {
  let state = { ...emptyState(), initial: { rouille: 2 } }
  assert.equal(garmentStats(state, 'rouille').lastWash, undefined)
  assert.equal(garmentStats(state, 'rouille').lastWear, undefined)
  for (const day of ['01', '02', '03', '04']) state = entry(state, 'rouille', `2026-11-${day}`)
  assert.equal(count(state, 'rouille'), 6)
  assert.equal(statusFor(3, 4).tone, 'soon')
  assert.equal(statusFor(6, 4).tone, 'wash')
  assert.equal(statusFor(6, 7).tone, 'soon')
  assert.equal(count(entry(state, 'rouille', '2026-11-05', 'wash'), 'rouille'), 0)
})

test('déplacer un port principal sur une journée déjà occupée conserve les deux ports', () => {
  const earlier = quickWear(emptyState(), 'rouille', new Date('2026-11-06T18:00:00Z'))
  const later = quickWear(earlier.state, 'bleu', now)
  const moved = saveEntry(later.state, { ...earlier.change.after, day: today }, now)
  assert.equal(moved.events.length, 2)
  assert.equal(moved.events.find((event) => event.garment === 'rouille').primary, false)
  assert.equal(moved.events.find((event) => event.garment === 'bleu').primary, true)
  assert.throws(() => undoQuickWear(moved, earlier.change, now), /changé/)
})

test('la sauvegarde conserve les corrections et rejette les données incohérentes', async () => {
  let state = quickWear(emptyState(), 'bleu', now).state
  state = quickWear(state, 'noir', now).state
  assert.deepEqual(await validateBackup(JSON.parse(JSON.stringify(state)), today), state)
  await assert.rejects(() => validateBackup({ ...state, threshold: 0 }, today), /valide/)
  await assert.rejects(() => validateBackup({ ...state, version: 3 }, today), /incompatible/)
  await assert.rejects(() => validateBackup({ ...state, events: [...state.events, ...state.events] }, today), /valide/)
  await assert.rejects(() => validateBackup({ ...state, initial: { inconnu: 5 } }, today), /valide/)
  await assert.rejects(() => validateBackup({ ...state, events: [{ ...state.events[0], day: '2026-02-30' }] }, today), /valide/)
})

test('une fiche ouverte ne remplace pas un événement modifié ailleurs', async () => {
  const before = quickWear(emptyState(), 'bleu', now)
  const corrected = quickWear(before.state, 'gris', now)
  const expected = before.change.after
  assert.throws(() => saveEntry(corrected.state, { ...expected, expected, day: '2026-11-06' }, now), /changé/)
  assert.throws(() => removeEntry(corrected.state, expected.id, now, expected), /changé/)
  const washed = entry(corrected.state, 'bleu', today, 'wash')
  assert.throws(() => undoQuickWear(washed, corrected.change, now), /ordre/)
  assert.deepEqual(await validateBackup(washed, today), washed)
})

test('la migration V1 conserve les six identifiants, réglages, événements et corrections', async () => {
  let state = quickWear(emptyState(), 'bleu', now).state
  state = quickWear(state, 'gris', now).state
  state = entry(state, 'gris', today, 'wash')
  const { wardrobe, ...tracked } = state
  const legacy = { ...tracked, version: 1, threshold: 7, initial: { noir: 3 } }
  const before = structuredClone(legacy)
  const migrated = migrateV1(legacy)
  assert.deepEqual(legacy, before)
  assert.deepEqual(migrated.events, before.events)
  assert.deepEqual(migrated.corrections, before.corrections)
  assert.deepEqual(migrated.wardrobe, wardrobe)
  assert.equal(migrated.threshold, 7)
  assert.equal(count(migrated, 'noir'), 3)
  assert.equal(count(migrated, 'gris'), 0)
  assert.equal(migrateV1(migrated), migrated)
  assert.deepEqual(await validateBackup(before, today), migrated)
  assert.throws(() => migrateV1({ version: 9 }), /migrées/)
})

test('ajouter puis renommer un sweat conserve son ID, son image, ses ports et ses lavages', () => {
  const photo = { key: crypto.randomUUID(), blob: new Blob(['fixture'], { type: 'image/png' }) }
  assert.throws(() => saveGarment(emptyState(), { name: 'Test', threshold: null }), /photo/)
  const added = saveGarment(emptyState(), { name: '  Vert   sapin  ', initial: 3, threshold: 6, photo })
  const garment = added.wardrobe.at(-1)
  assert.equal(garment.name, 'Vert sapin')
  assert.equal(garment.photo, photo)
  assert.equal(garment.threshold, 6)
  assert.equal(count(added, garment.id), 3)

  let state = entry(added, garment.id, '2026-11-05', 'wear')
  state = entry(state, garment.id, '2026-11-06', 'wash')
  state = quickWear(state, garment.id, now).state
  const edited = saveGarment(state, { name: 'Forêt', threshold: null }, garment.id)
  assert.deepEqual(edited.wardrobe.at(-1), { ...garment, name: 'Forêt', threshold: null })
  assert.equal(edited.events, state.events)
  assert.equal(count(edited, garment.id), 1)
  assert.equal(garmentStats(edited, garment.id).lastWash.day, '2026-11-06')
})

test('archiver le choix principal du jour conserve son port quand un autre est enregistré', () => {
  let state = quickWear(emptyState(), 'bleu', now).state
  state = archiveGarment(state, 'bleu', true)
  assert.throws(() => quickWear(state, 'bleu', now), /Restaure/)
  assert.throws(() => entry(state, 'bleu', '2026-11-06'), /Restaure/)
  state = quickWear(state, 'gris', now).state
  assert.equal(count(state, 'bleu'), 1)
  assert.equal(count(state, 'gris'), 1)
  assert.equal(state.events.find(({ garment }) => garment === 'bleu').primary, false)
  const restored = archiveGarment(state, 'bleu', false)
  assert.equal(restored.events, state.events)
  assert.equal(quickWear(restored, 'bleu', now).state, restored)
})

test('les sauvegardes V2 incluent les métadonnées et les octets des photos, et refusent les incohérences', async () => {
  let state = saveGarment(emptyState(), { name: 'Test', threshold: 8, photo: { key: crypto.randomUUID(), blob: new Blob(['xyz'], { type: 'image/png' }) } })
  const custom = state.wardrobe.at(-1)
  state = archiveGarment(state, custom.id, true)
  const data = JSON.parse(await (await backupFile(state)).text())
  assert.equal(data.version, 2)
  assert.deepEqual(data.wardrobe.at(-1), { id: custom.id, name: 'Test', archived: true, threshold: 8, photo: { type: 'image/png', base64: 'eHl6' } })
  await assert.rejects(() => validateBackup(data, today), /PNG/)
  await assert.rejects(() => validateBackup({ ...data, wardrobe: [...emptyState().wardrobe, { ...data.wardrobe.at(-1), photo: null }] }, today), /valide/)
  await assert.rejects(() => validateBackup({ ...emptyState(), wardrobe: [...emptyState().wardrobe, emptyState().wardrobe[0]] }, today), /valide/)
  await assert.rejects(() => validateBackup({ ...emptyState(), wardrobe: emptyState().wardrobe.slice(1) }, today), /valide/)
})
