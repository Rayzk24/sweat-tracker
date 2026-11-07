import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Archive, ArchiveRestore, Droplets, FileUp, Pencil, Trash2 } from 'lucide-react'
import { isIntegerInRange, validateBackup } from './backup'
import { formatDay, isDay } from './dates'
import { maxBackupSize } from './photos'
import { compareEvents, garmentStats, statusFor, wearLabel } from './model'
import type { Entry, Event, State } from './model'
import { garmentFor, originalFor } from './wardrobe'
import type { GarmentId } from './wardrobe'
import { errorText, EventRow, FormError, GarmentImage, Sheet, WearProgress } from './ui'

type Close = { onClose: () => void }

export function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function run(action: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (failure) {
      setError(errorText(failure))
    } finally {
      setBusy(false)
    }
  }
  return { run, busy, error }
}

export function DetailSheet({ state, id, onEdit, onWash, onEditGarment, onArchive, onClose }: Close & {
  state: State
  id: GarmentId
  onEdit: (event: Event) => void
  onWash: () => void
  onEditGarment: () => void
  onArchive: () => void
}) {
  const garment = garmentFor(state.wardrobe, id)
  const original = originalFor(id)
  const threshold = garment.threshold ?? state.threshold
  const { count, lastWear, lastWash, events } = garmentStats(state, id)
  const status = statusFor(count, threshold)
  const recent = events.slice(-8).reverse()
  return (
    <Sheet title={garment.name} onClose={onClose} actions={
      <button type="button" className="icon-button sheet-edit" onClick={onEditGarment} aria-label="Modifier le vêtement" title="Modifier le vêtement"><Pencil size={17} /></button>
    }>
      {(garment.archived || original) && <p className="sheet-subtitle">{garment.archived ? 'Vêtement archivé' : original?.description}</p>}
      <div className={`detail-product product ${original?.id ?? 'personal'}`}><GarmentImage garment={garment} alt={garment.name} /></div>
      <div className="detail-count">
        <strong>{wearLabel(count)}</strong>
        <span className={`card-status ${status.tone}`}><i aria-hidden="true" />{status.label}</span>
      </div>
      <div className="detail-progress"><WearProgress count={count} threshold={threshold} /><span>Seuil de lavage · {wearLabel(threshold)}</span></div>
      <dl className="detail-dates">
        <div><dt>Dernier port</dt><dd>{lastWear ? formatDay(lastWear.day) : 'Aucun enregistré'}</dd></div>
        <div><dt>Dernier lavage</dt><dd>{lastWash ? <button type="button" className="text-button" onClick={() => onEdit(lastWash)}>{formatDay(lastWash.day)} · Modifier</button> : 'Inconnu'}</dd></div>
      </dl>
      {!garment.archived && <button type="button" className="button primary full" onClick={onWash}><Droplets size={18} />Marquer comme lavé</button>}
      <h3 className="section-label sheet-section">Activité récente</h3>
      {recent.length
        ? <div className="list-panel">{recent.map((event) => <EventRow key={event.id} event={event} garment={garment} onEdit={() => onEdit(event)} />)}</div>
        : <p className="muted-text">Aucun port ni lavage daté pour le moment.</p>}
      <div className="detail-management">
        <button type="button" className="button quiet full" onClick={onArchive}>
          {garment.archived ? <><ArchiveRestore size={17} />Restaurer le vêtement</> : <><Archive size={17} />Archiver le vêtement</>}
        </button>
      </div>
    </Sheet>
  )
}

export function EntrySheet({ event, fixedDay, today, state, onSave, onRemove, onClose }: Close & {
  event?: Event
  fixedDay?: boolean
  today: string
  state: State
  onSave: (entry: Entry) => Promise<void>
  onRemove: (id: string) => Promise<void>
}) {
  const choices = state.wardrobe.filter((item) => {
    if (item.archived && item.id !== event?.garment) return false
    return !fixedDay || !state.events.some(
      (other) => other.day === today && other.kind === 'wear' && other.garment === item.id,
    )
  })
  const [garment, setGarment] = useState(event?.garment ?? '')
  const [chosenDay, setDay] = useState(event?.day ?? today)
  const day = fixedDay ? today : chosenDay
  const [placement, setPlacement] = useState<{ key: string; value: 'before' | 'after' }>()
  const [remove, setRemove] = useState(false)
  const action = useAction()
  const kind = event?.kind ?? 'wear'
  const key = `${garment}/${day}`
  const related = state.events.find((other) =>
    other.id !== event?.id && other.garment === garment && other.day === day && other.kind !== kind,
  )
  const unchanged = event?.day === day && event.garment === garment
  const position = placement?.key === key ? placement.value
    : related && event && unchanged && compareEvents(event, related) < 0 ? 'before' : 'after'
  const title = event ? (kind === 'wash' ? 'Modifier le lavage' : 'Modifier le port')
    : fixedDay ? 'Un autre sweat' : 'Ajouter un port'

  function submit(submission: FormEvent) {
    submission.preventDefault()
    const selected = choices.find((item) => item.id === garment)
    if (selected && isDay(day)) {
      void action.run(() => onSave({ id: event?.id, expected: event, garment: selected.id, day, kind, position: related ? position : undefined }))
    }
  }

  return (
    <Sheet title={remove ? 'Supprimer cette entrée ?' : title} onClose={onClose}>
      {remove && event
        ? <ConfirmButtons action={action} description={`${garmentFor(state.wardrobe, event.garment).name} · ${formatDay(event.day)}. Le compteur sera recalculé.`}
            label="Supprimer" danger onConfirm={() => onRemove(event.id)} onCancel={() => setRemove(false)} />
        : choices.length === 0
          ? <p className="muted-text">Aucun autre sweat actif à enregistrer.</p>
          : <form className="sheet-form" onSubmit={submit}>
              {fixedDay && <p className="muted-text">Ajoute un port pour aujourd’hui en gardant tes autres choix.</p>}
              <div className="field"><label htmlFor="entry-garment">Sweat</label>
                <select id="entry-garment" required value={garment} onChange={(change) => setGarment(change.target.value as GarmentId)}>
                  <option value="" disabled>Choisir un sweat</option>
                  {choices.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </div>
              {!fixedDay && <label className="field">Date
                <input type="date" value={day} required min="0001-01-01" max={today} onChange={(change) => setDay(change.target.value)} />
              </label>}
              {related && <div className="field"><label htmlFor="entry-position">Ordre dans la journée</label>
                <select id="entry-position" value={position} onChange={(change) => setPlacement({ key, value: change.target.value as 'before' | 'after' })}>
                  <option value="before">{kind === 'wear' ? 'Port avant le lavage' : 'Lavage avant le port'}</option>
                  <option value="after">{kind === 'wear' ? 'Port après le lavage' : 'Lavage après le port'}</option>
                </select>
              </div>}
              <FormError error={action.error} />
              <button type="submit" className="button primary full" disabled={action.busy}>Enregistrer</button>
              {event && <button type="button" className="button quiet danger-text full" disabled={action.busy} onClick={() => setRemove(true)}><Trash2 size={17} />Supprimer l’entrée</button>}
            </form>}
    </Sheet>
  )
}

export function NumberSheet({ title, label, description, value, min, max, onSave, onClose }: Close & {
  title: string
  label: string
  description: string
  value: number
  min: number
  max: number
  onSave: (value: number) => Promise<void>
}) {
  const [input, setInput] = useState(String(value))
  const action = useAction()
  return (
    <Sheet title={title} onClose={onClose}>
      <form className="sheet-form" onSubmit={(event) => {
        event.preventDefault()
        if (input.trim() && isIntegerInRange(Number(input), min, max)) void action.run(() => onSave(Number(input)))
      }}>
        <p className="muted-text">{description}</p>
        <label className="field">{label}
          <input type="number" inputMode="numeric" min={min} max={max} step="1" value={input} required onChange={(event) => setInput(event.target.value)} />
        </label>
        <FormError error={action.error} />
        <button type="submit" className="button primary full" disabled={action.busy}>Enregistrer</button>
      </form>
    </Sheet>
  )
}

export function ConfirmSheet({ title, description, label, danger, onConfirm, onClose }: Close & {
  title: string
  description: ReactNode
  label: string
  danger?: boolean
  onConfirm: () => Promise<void>
}) {
  const action = useAction()
  return (
    <Sheet title={title} onClose={onClose}>
      <ConfirmButtons action={action} description={description} label={label} danger={danger} onConfirm={onConfirm} onCancel={onClose} />
    </Sheet>
  )
}

function ConfirmButtons({ action, description, label, danger, onConfirm, onCancel }: {
  action: ReturnType<typeof useAction>
  description: ReactNode
  label: string
  danger?: boolean
  onConfirm: () => Promise<void>
  onCancel: () => void
}) {
  return (
    <div className="sheet-form">
      <p className="muted-text">{description}</p>
      <FormError error={action.error} />
      <button type="button" className={`button full ${danger ? 'danger' : 'primary'}`} disabled={action.busy} onClick={() => void action.run(onConfirm)}>{label}</button>
      <button type="button" className="button quiet full" disabled={action.busy} onClick={onCancel}>Annuler</button>
    </div>
  )
}

export function ImportSheet({ onImport, onClose }: Close & { onImport: (data: State) => Promise<void> }) {
  const [backup, setBackup] = useState<State | null>(null)
  const action = useAction()
  return (
    <Sheet title={backup ? 'Restaurer cette sauvegarde ?' : 'Importer une sauvegarde'} onClose={onClose}>
      {backup
        ? <ConfirmButtons action={action} description={`Entrées dans la sauvegarde : ${backup.events.length} · Vêtements : ${backup.wardrobe.length}. L’import remplace les vêtements, les photos, l’historique et les réglages de cet appareil.`}
            label="Remplacer mes données" danger onConfirm={() => onImport(backup)} onCancel={onClose} />
        : <div className="sheet-form">
            <p className="muted-text">Sélectionne un fichier JSON exporté depuis Sweat Tracker.</p>
            <label className="field import-field"><FileUp size={20} />Fichier de sauvegarde
              <input type="file" accept=".json,application/json" disabled={action.busy} onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (!file) return
                void action.run(async () => {
                  if (file.size > maxBackupSize) throw new Error('Ce fichier dépasse 96 Mo.')
                  let parsed: unknown
                  try { parsed = JSON.parse(await file.text()) }
                  catch { throw new Error('Ce fichier est illisible. Sélectionne une sauvegarde JSON.') }
                  setBackup(await validateBackup(parsed))
                })
              }} />
            </label>
            <FormError error={action.error} />
          </div>}
    </Sheet>
  )
}
