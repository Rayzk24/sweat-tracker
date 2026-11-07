import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Check, ChevronRight, CircleHelp, Droplets, X } from 'lucide-react'
import { formatDay } from './dates'
import { garmentStats, statusFor, wearLabel } from './model'
import type { Event, State } from './model'
import { originalFor } from './wardrobe'
import type { Garment, Photo } from './wardrobe'

export function GarmentImage({ garment, alt = '' }: { garment: Garment; alt?: string }) {
  const original = originalFor(garment.id)
  const photo = garment.photo
  return photo
    ? <PhotoImage key={photo.key} photo={photo} alt={alt} />
    : <img src={`/images/sweats/${original?.id}.webp`} alt={alt} draggable="false" />
}

export function PhotoImage({ photo, alt }: { photo: Photo; alt: string }) {
  // The key identifies immutable bytes, even when IndexedDB clones the Blob on a new read.
  const [blob] = useState(photo.blob)
  const [url, setUrl] = useState('')
  useEffect(() => {
    const next = URL.createObjectURL(blob)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [blob])
  return url ? <img src={url} alt={alt} draggable="false" /> : null
}

export function WearProgress({ count, threshold }: { count: number; threshold: number }) {
  return <div
    className={`wear-progress ${count >= threshold ? 'is-full' : ''}`}
    role="progressbar" aria-label="Progression vers le lavage"
    aria-valuemin={0} aria-valuemax={threshold} aria-valuenow={Math.min(count, threshold)}
    aria-valuetext={`${wearLabel(count)} sur un seuil de ${wearLabel(threshold)}`}
  ><span style={{ width: `${Math.min(count / threshold, 1) * 100}%` }} /></div>
}

export function GarmentCard({ garment, state, today, onWear, onDetails }: {
  garment: Garment
  state: State
  today: string
  onWear: () => void
  onDetails: () => void
}) {
  const { count, lastWear } = garmentStats(state, garment.id)
  const threshold = garment.threshold ?? state.threshold
  const status = statusFor(count, threshold)
  const selected = lastWear?.day === today

  return (
    <article className={'garment-card' + (selected ? ' is-selected' : '')}>
      <button
        className="wear-card"
        type="button"
        aria-label={`${garment.name} · ${wearLabel(count)} · ${status.label} · ${selected ? 'Porté aujourd’hui' : 'Enregistrer pour aujourd’hui'}`}
        aria-pressed={selected}
        onClick={onWear}
      >
        <span className={`product ${originalFor(garment.id)?.id ?? 'personal'}`}>
          <GarmentImage garment={garment} />
          {selected && <span className="card-check" aria-hidden="true"><Check size={13} strokeWidth={2.8} /></span>}
        </span>
        <span className="card-name">{garment.name}</span>
      </button>
      <button type="button" className="card-details icon-button" aria-label={`Fiche ${garment.name}`} onClick={onDetails}>
        <ChevronRight size={17} />
      </button>
      <div className="card-info">
        <span className="card-count">{wearLabel(count)}<span className="card-target" aria-hidden="true"> / {threshold}</span></span>
        <WearProgress count={count} threshold={threshold} />
        {status.tone !== 'normal'
          ? <span className={`card-status ${status.tone}`}>{status.label}</span>
          : lastWear && <span className="card-date">{selected ? 'Porté aujourd’hui' : `Porté le ${formatDay(lastWear.day, 'short')}`}</span>}
      </div>
    </article>
  )
}

export function Sheet({ title, children, actions, onClose }: { title: string; children: ReactNode; actions?: ReactNode; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    const element = dialog.current!
    const viewport = window.visualViewport
    function fitViewport() {
      if (!viewport || viewport.scale !== 1) return
      element.style.setProperty('--sheet-height', `${viewport.height}px`)
      element.style.setProperty('--sheet-bottom', `${Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)}px`)
    }
    element.showModal()
    document.body.classList.add('sheet-open')
    fitViewport()
    viewport?.addEventListener('resize', fitViewport)
    viewport?.addEventListener('scroll', fitViewport)
    return () => {
      viewport?.removeEventListener('resize', fitViewport)
      viewport?.removeEventListener('scroll', fitViewport)
      element.close()
      document.body.classList.remove('sheet-open')
    }
  }, [])

  useEffect(() => { heading.current?.focus({ preventScroll: true }) }, [title])

  return (
    <dialog
      ref={dialog}
      className="sheet"
      aria-labelledby="sheet-title"
      onCancel={(event) => { event.preventDefault(); onClose() }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
      <div className="sheet-inner">
        <div className="sheet-handle" aria-hidden="true" />
        <div className="sheet-heading">
          <h2 id="sheet-title" ref={heading} tabIndex={-1}>{title}</h2>
          <div className="sheet-actions">
            {actions}
            <button type="button" className="icon-button sheet-close" onClick={onClose} aria-label="Fermer"><X size={19} /></button>
          </div>
        </div>
        {children}
      </div>
    </dialog>
  )
}

export function EventRow({ event, garment, showGarment, onEdit }: {
  event: Event
  garment: Garment
  showGarment?: boolean
  onEdit: () => void
}) {
  const kind = event.kind === 'wash' ? 'Lavage' : 'Port'
  return (
    <button type="button" className="event-row" aria-label={`Modifier · ${garment.name} · ${kind} · ${formatDay(event.day)}`} onClick={onEdit}>
      {showGarment
        ? <span className={`event-thumbnail ${originalFor(garment.id)?.id ?? 'personal'}`}><GarmentImage garment={garment} /></span>
        : <span className="event-icon">{event.kind === 'wash' ? <Droplets size={17} /> : <Check size={17} />}</span>}
      <span className="row-text"><strong>{showGarment ? garment.name : kind}</strong>
        <small>{showGarment ? (garment.archived ? `${kind} · Archivé` : kind) : formatDay(event.day)}</small>
      </span>
      <ChevronRight size={16} className="row-arrow" />
    </button>
  )
}

export function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty">
      <CircleHelp size={24} strokeWidth={1.5} aria-hidden="true" />
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  )
}

export function FormError({ error }: { error: string }) {
  return error ? <p className="form-error" role="alert">{error}</p> : null
}

export function errorText(error: unknown) {
  if (error instanceof DOMException && error.name === 'QuotaExceededError') {
    return 'L’espace disponible est insuffisant. Essaie une photo plus légère ou libère de la place sur cet appareil.'
  }
  if (error instanceof DOMException) return 'Le stockage local est indisponible. Réessaie dans un instant.'
  return error instanceof Error ? error.message : 'L’enregistrement a échoué. Réessaie.'
}
