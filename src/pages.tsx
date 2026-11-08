import { Archive, CalendarDays, Check, ChevronRight, Download, LogOut, Plus, Shield, Shirt, SlidersHorizontal, Trash2, Upload } from 'lucide-react'
import { capitalise, formatDay } from './dates'
import { compareEvents, wearLabel } from './model'
import type { Event, State } from './model'
import { garmentFor } from './wardrobe'
import type { GarmentId } from './wardrobe'
import { Empty, EventRow, GarmentCard } from './ui'

export function Home({ state, today, onWear, onDetails, onAdd, onNew }: {
  state: State
  today: string
  onWear: (id: GarmentId) => void
  onDetails: (id: GarmentId) => void
  onAdd: () => void
  onNew: () => void
}) {
  const worn = state.events.filter((event) => event.day === today && event.kind === 'wear')
  const active = state.wardrobe.filter((garment) => !garment.archived)
  const names = worn.map((event) => garmentFor(state.wardrobe, event.garment).name).join(' · ')

  return (
    <>
      <div className="masthead">
        <span className="brand"><span className="brand-mark"><img src="/icon.svg" alt="" /></span>Sweat Tracker</span>
        <time dateTime={today} className="top-date">{capitalise(formatDay(today, 'full'))}</time>
      </div>
      <header className="page-title">
        <div>
          <h1>Mes sweats</h1>
          <p>Touche le sweat que tu as porté aujourd’hui.</p>
        </div>
        <button className="new-garment icon-button" type="button" aria-label="Ajouter un vêtement" onClick={onNew}>
          <Plus size={23} strokeWidth={1.7} />
        </button>
      </header>
      <div className={`today-strip ${worn.length ? 'has-wear' : ''}`}>
        <span className="today-icon" aria-hidden="true">{worn.length ? <Check size={18} /> : <CalendarDays size={17} />}</span>
        <div className="today-text">
          <span>Aujourd’hui</span>
          <strong>{worn.length ? names : 'Aucun port enregistré'}</strong>
        </div>
        {worn.length > 0 && active.some(({ id }) => !worn.some((event) => event.garment === id)) && <button className="add-secondary icon-button" type="button" aria-label="Ajouter un autre port aujourd’hui" onClick={onAdd}><Plus size={16} aria-hidden="true" /><span>Autre port</span></button>}
      </div>
      <section className="wardrobe" aria-label="Garde-robe active">
        {active.map((garment) => (
          <GarmentCard key={garment.id} garment={garment} state={state} today={today}
            onWear={() => onWear(garment.id)} onDetails={() => onDetails(garment.id)} />
        ))}
      </section>
      {active.length === 0 && <Empty title="Ta garde-robe est vide" text="Ajoute un sweat ou restaure un vêtement depuis les réglages." />}
    </>
  )
}

export function Journal({ state, today, onAdd, onEdit }: {
  state: State
  today: string
  onAdd: () => void
  onEdit: (event: Event) => void
}) {
  const groups = new Map<string, Event[]>()
  for (const event of [...state.events].sort((a, b) => compareEvents(b, a))) {
    if (!groups.has(event.day)) groups.set(event.day, [])
    groups.get(event.day)!.push(event)
  }

  return (
    <>
      <header className="page-title subpage-title">
        <h1>Journal</h1>
        <p>Retrouve tes ports et tes lavages.</p>
      </header>
      <button type="button" className="button primary journal-add" onClick={onAdd}><Plus size={18} />Ajouter un port</button>
      {groups.size === 0 && <Empty title="Le journal est vide" text="Tes ports et tes lavages apparaîtront ici." />}
      {[...groups].map(([day, events]) => (
        <section className="journal-group" key={day}>
          <h2 className="section-label">{day === today ? 'Aujourd’hui' : capitalise(formatDay(day))}</h2>
          <div className="list-panel">
            {events.map((event) => <EventRow key={event.id} event={event} garment={garmentFor(state.wardrobe, event.garment)} showGarment onEdit={() => onEdit(event)} />)}
          </div>
        </section>
      ))}
    </>
  )
}

type Setting = 'threshold' | 'initial' | 'archived' | 'export' | 'import' | 'reset'

export function Settings({ state, onAction, onLogout }: { state: State; onAction: (setting: Setting) => void; onLogout?: () => void }) {
  const archiveCount = state.wardrobe.filter((garment) => garment.archived).length
  const items = [
    { key: 'threshold', icon: SlidersHorizontal, title: 'Seuil de lavage', subtitle: `Conseil à partir de ${wearLabel(state.threshold)}` },
    { key: 'initial', icon: Shirt, title: 'Ports de départ', subtitle: 'Indiquer les ports avant le début du suivi' },
    { key: 'archived', icon: Archive, title: 'Vêtements archivés', subtitle: archiveCount === 0 ? 'Aucun vêtement archivé' : `${archiveCount} ${archiveCount === 1 ? 'vêtement archivé' : 'vêtements archivés'}` },
    { key: 'export', icon: Download, title: 'Exporter mes données', subtitle: 'Télécharger une sauvegarde JSON' },
    { key: 'import', icon: Upload, title: 'Importer une sauvegarde', subtitle: 'Restaurer depuis un fichier JSON' },
    { key: 'reset', icon: Trash2, title: 'Réinitialiser les données', subtitle: 'Effacer le suivi et les réglages' },
  ] as const
  const row = ({ key, icon: Icon, title, subtitle }: (typeof items)[number]) => (
    <button type="button" className={`setting-row ${key === 'reset' ? 'danger-text' : ''}`} key={key} onClick={() => onAction(key)}>
      <span className="setting-icon"><Icon size={19} /></span>
      <span className="row-text"><strong>{title}</strong><small>{subtitle}</small></span>
      <ChevronRight size={16} className="row-arrow" />
    </button>
  )
  return (
    <>
      <header className="page-title subpage-title">
        <h1>Réglages</h1>
        <p>Adapte le suivi à tes habitudes.</p>
      </header>
      <section className="journal-group">
        <h2 className="section-label">Suivi</h2>
        <div className="list-panel">{items.slice(0, 3).map(row)}</div>
      </section>
      <section className="journal-group">
        <h2 className="section-label">Données</h2>
        <div className="list-panel">{items.slice(3).map(row)}</div>
      </section>
      <p className="privacy-note"><Shield size={19} />Les données restent sur cet appareil. Utilise une sauvegarde pour les transférer entre le PC et l’iPhone.</p>
      {onLogout && <section className="journal-group">
        <h2 className="section-label">Accès</h2>
        <div className="list-panel">
          <button type="button" className="setting-row" onClick={onLogout}>
            <span className="setting-icon"><LogOut size={19} /></span>
            <span className="row-text"><strong>Se déconnecter</strong><small>Fermer la session Sweat Tracker</small></span>
            <ChevronRight size={16} className="row-arrow" />
          </button>
        </div>
      </section>}
    </>
  )
}
