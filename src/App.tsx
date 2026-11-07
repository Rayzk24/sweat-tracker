import { useCallback, useEffect, useState } from 'react'
import { BookOpen, Check, ChevronRight, Settings2, Shirt, X } from 'lucide-react'
import { parisDay } from './dates'
import { readState, subscribeToStorage, updateState } from './db'
import { archiveGarment, emptyState, quickWear, removeEntry, saveEntry, saveGarment, undoQuickWear, wearLabel } from './model'
import type { Change, Event, State } from './model'
import { ArchiveSheet, ExportSheet, GarmentForm } from './garment-sheets'
import { Home, Journal, Settings } from './pages'
import { ConfirmSheet, DetailSheet, EntrySheet, ImportSheet, NumberSheet } from './sheets'
import { errorText, GarmentImage, Sheet } from './ui'
import { garmentFor, originalFor } from './wardrobe'
import type { GarmentId } from './wardrobe'

const tabs = [
  { id: 'home', label: 'Mes sweats', icon: Shirt },
  { id: 'journal', label: 'Journal', icon: BookOpen },
  { id: 'settings', label: 'Réglages', icon: Settings2 },
] as const
type Tab = (typeof tabs)[number]['id']
type Overlay =
  | { type: 'detail' | 'wash' | 'initial-count'; id: GarmentId }
  | { type: 'garment'; id?: GarmentId }
  | { type: 'archive'; id: GarmentId; archived: boolean }
  | { type: 'entry'; event?: Event; fixedDay?: boolean; returnTo?: GarmentId }
  | { type: 'threshold' | 'initial' | 'archived' | 'export' | 'import' | 'reset' | 'reset-final' }
type Toast = { text: string; undo?: Change; error?: boolean }

export default function App({ onLogout }: { onLogout?: () => void }) {
  const [state, setState] = useState<State>()
  const [loadingError, setLoadingError] = useState('')
  const [today, setToday] = useState(() => parisDay())
  const [tab, setTab] = useState<Tab>('home')
  const [overlay, setOverlay] = useState<Overlay | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)

  const refresh = useCallback(() => {
    setToday(parisDay())
    void readState().then((data) => { setState(data); setLoadingError('') })
      .catch((error) => setLoadingError(errorText(error)))
  }, [])

  useEffect(() => {
    refresh()
    const unsubscribe = subscribeToStorage(refresh)
    const timer = window.setInterval(() => setToday(parisDay()), 15_000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.clearInterval(timer)
      unsubscribe()
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [refresh])

  useEffect(() => {
    if (!toast) return
    const timeout = window.setTimeout(() => setToast(null), toast.undo ? 10_000 : 6000)
    return () => window.clearTimeout(timeout)
  }, [toast])

  const selectedGarment = state?.wardrobe.find(({ id }) => overlay && 'id' in overlay && overlay.id === id)

  function closeSheet() {
    if (overlay?.type === 'entry' && overlay.returnTo) setOverlay({ type: 'detail', id: overlay.returnTo })
    else if (overlay?.type === 'wash' || overlay?.type === 'archive') setOverlay({ type: 'detail', id: overlay.id })
    else if (overlay?.type === 'garment' && overlay.id) setOverlay({ type: 'detail', id: overlay.id })
    else if (overlay?.type === 'detail' && selectedGarment?.archived && tab === 'settings') setOverlay({ type: 'archived' })
    else if (overlay?.type === 'initial-count') setOverlay({ type: 'initial' })
    else setOverlay(null)
  }

  async function save(update: (current: State) => State, message: string, options?: { next?: Overlay | null; purgeLegacy?: boolean }) {
    const next = await updateState(update, options?.purgeLegacy)
    setState(next)
    setToast({ text: message })
    if (options?.next !== undefined) setOverlay(options.next)
    else closeSheet()
  }

  async function wear(id: GarmentId) {
    let change: Change | null = null
    const now = new Date()
    setToday(parisDay(now))
    try {
      const next = await updateState((current) => {
        const result = quickWear(current, id, now)
        change = result.change
        return result.state
      })
      setState(next)
      if (change) {
        const undo: Change = change
        setToast({ text: `${garmentFor(next.wardrobe, id).name} · port ${undo.before ? 'corrigé' : 'enregistré'}`, undo })
      }
    } catch (error) {
      setToast({ text: errorText(error), error: true })
    }
  }

  async function undo(change: Change) {
    try {
      setState(await updateState((current) => undoQuickWear(current, change)))
      setToast({ text: 'Modification annulée' })
    } catch (error) {
      setToast({ text: errorText(error), error: true })
    }
  }

  if (!state) return <main className="app loading">
    <div className="brand"><span className="brand-mark"><img src="/icon.svg" alt="" /></span>Sweat Tracker</div>
    <h1>Mes sweats</h1>
    {loadingError
      ? <><p role="alert">{loadingError}</p><button type="button" className="button primary" onClick={refresh}>Réessayer</button></>
      : <p role="status">Ouverture du journal…</p>}
  </main>

  return (
    <>
      <main className="app" id="main">
        {tab === 'home' && <Home state={state} today={today} onWear={(id) => void wear(id)}
          onDetails={(id) => setOverlay({ type: 'detail', id })} onNew={() => setOverlay({ type: 'garment' })} onAdd={() => setOverlay({ type: 'entry', fixedDay: true })} />}
        {tab === 'journal' && <Journal state={state} today={today} onAdd={() => setOverlay({ type: 'entry' })}
          onEdit={(event) => setOverlay({ type: 'entry', event })} />}
        {tab === 'settings' && <Settings state={state} onLogout={onLogout} onAction={(type) => setOverlay({ type })} />}
      </main>
      <nav className="nav" aria-label="Navigation principale">
        <div className="nav-inner">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" className="nav-link" aria-current={tab === id ? 'page' : undefined}
              onClick={() => { setTab(id); window.scrollTo(0, 0) }}>
              <span className="nav-icon" aria-hidden="true"><Icon size={20} strokeWidth={tab === id ? 2.1 : 1.7} /></span><span>{label}</span>
            </button>
          ))}
        </div>
      </nav>
      <div className="toast-region" aria-live="polite" aria-atomic="true">
        {toast && <div className={`toast ${toast.error ? 'toast-error' : ''}`}>
          {!toast.error && <Check size={17} className="toast-check" />}
          <span>{toast.text}</span>
          {toast.undo && <button type="button" className="text-button" onClick={() => void undo(toast.undo!)}>Annuler</button>}
          <button type="button" className="icon-button" aria-label="Fermer le message" onClick={() => setToast(null)}><X size={16} /></button>
        </div>}
      </div>
      {overlay?.type === 'detail' && selectedGarment && <DetailSheet state={state} id={overlay.id} onClose={closeSheet}
        onEdit={(event) => setOverlay({ type: 'entry', event, returnTo: overlay.id })}
        onWash={() => setOverlay({ type: 'wash', id: overlay.id })}
        onEditGarment={() => setOverlay({ type: 'garment', id: overlay.id })}
        onArchive={() => setOverlay({ type: 'archive', id: overlay.id, archived: !selectedGarment.archived })} />}
      {overlay?.type === 'garment' && (!overlay.id || selectedGarment) && <GarmentForm garment={selectedGarment}
        defaultThreshold={state.threshold} onClose={closeSheet}
        onSave={(input) => save((current) => saveGarment(current, input, overlay.id), overlay.id ? 'Vêtement modifié' : 'Vêtement ajouté')} />}
      {overlay?.type === 'archived' && <ArchiveSheet wardrobe={state.wardrobe} onClose={closeSheet}
        onOpen={(id) => setOverlay({ type: 'detail', id })} />}
      {overlay?.type === 'archive' && selectedGarment && <ConfirmSheet
        title={overlay.archived ? 'Archiver ce vêtement ?' : 'Restaurer ce vêtement ?'}
        description={overlay.archived
          ? `${selectedGarment.name} sera retiré de la grille. Son historique restera accessible dans le Journal.`
          : `${selectedGarment.name} reviendra dans ta garde-robe avec son compteur et son historique.`}
        label={overlay.archived ? 'Archiver le vêtement' : 'Restaurer le vêtement'} onClose={closeSheet}
        onConfirm={() => save((current) => archiveGarment(current, overlay.id, overlay.archived),
          overlay.archived ? 'Vêtement archivé' : 'Vêtement restauré',
          { next: overlay.archived ? null : { type: 'archived' } })} />}
      {overlay?.type === 'wash' && selectedGarment && <ConfirmSheet title="Confirmer le lavage"
        description={`Le compteur de ${selectedGarment.name} repartira à zéro. Les ports précédents resteront dans le journal.`}
        label="Enregistrer le lavage" onClose={closeSheet}
        onConfirm={() => save((current) => saveEntry(current, { garment: overlay.id, day: parisDay(), kind: 'wash' }), 'Lavage enregistré')} />}
      {overlay?.type === 'entry' && (!overlay.event || state.wardrobe.some(({ id }) => id === overlay.event?.garment)) && <EntrySheet event={overlay.event} fixedDay={overlay.fixedDay} today={today} state={state}
        onClose={closeSheet}
        onSave={(entry) => save((current) => saveEntry(current, entry), entry.id ? 'Entrée corrigée' : 'Port enregistré')}
        onRemove={(id) => save((current) => removeEntry(current, id, new Date(), overlay.event), 'Entrée supprimée')} />}
      {overlay?.type === 'threshold' && <NumberSheet title="Seuil de lavage" label="Nombre de ports"
        description="Un conseil de lavage apparaît à partir de ce nombre de ports. Tu peux continuer à enregistrer des ports."
        value={state.threshold} min={1} max={99} onClose={closeSheet}
        onSave={(threshold) => save((current) => ({ ...current, threshold }), 'Seuil mis à jour')} />}
      {overlay?.type === 'initial' && <Sheet title="Ports de départ" onClose={closeSheet}>
        <p className="muted-text">Indique combien de fois tu avais déjà porté chaque sweat au début du suivi. Le premier lavage enregistré remet ce compteur à zéro.</p>
        <div className="list-panel">
          {state.wardrobe.map((garment) => <button className="setting-row" key={garment.id} type="button" onClick={() => setOverlay({ type: 'initial-count', id: garment.id })}>
            <span className={`event-thumbnail ${originalFor(garment.id)?.id ?? 'personal'}`}><GarmentImage garment={garment} /></span>
            <span className="row-text"><strong>{garment.name}</strong><small>{wearLabel(state.initial[garment.id] ?? 0)}</small></span>
            <ChevronRight size={16} className="row-arrow" />
          </button>)}
        </div>
      </Sheet>}
      {overlay?.type === 'initial-count' && selectedGarment && <NumberSheet title={`Ports de départ · ${selectedGarment.name}`}
        label="Ports avant le suivi" description="Ces ports sans date comptent jusqu’au premier lavage enregistré."
        value={state.initial[overlay.id] ?? 0} min={0} max={9999} onClose={closeSheet}
        onSave={(count) => save((current) => ({ ...current, initial: { ...current.initial, [overlay.id]: count } }), 'Ports de départ enregistrés')} />}
      {overlay?.type === 'export' && <ExportSheet state={state} onClose={closeSheet} />}
      {overlay?.type === 'import' && <ImportSheet onClose={closeSheet} onImport={(data) => save(() => data, 'Sauvegarde restaurée')} />}
      {overlay?.type === 'reset' && <ConfirmSheet key="reset" title="Réinitialiser les données ?"
        description="Les ports, lavages, vêtements personnels, photos et réglages seront effacés de cet appareil. Tu peux d’abord exporter une sauvegarde."
        label="Continuer" danger onClose={closeSheet} onConfirm={async () => setOverlay({ type: 'reset-final' })} />}
      {overlay?.type === 'reset-final' && <ConfirmSheet key="reset-final" title="Tout effacer ?"
        description="Confirme une seconde fois pour effacer définitivement le suivi local."
        label="Tout effacer" danger onClose={closeSheet}
        onConfirm={() => save(emptyState, 'Données effacées', { purgeLegacy: true })} />}
    </>
  )
}
