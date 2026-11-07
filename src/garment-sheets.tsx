import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { ChevronRight, Download, ImagePlus } from 'lucide-react'
import { backupFile, isIntegerInRange } from './backup'
import { parisDay } from './dates'
import type { GarmentInput, State } from './model'
import { preparePhoto } from './photos'
import { maxNameLength, originalFor } from './wardrobe'
import type { Garment, Photo } from './wardrobe'
import { useAction } from './sheets'
import { errorText, FormError, GarmentImage, PhotoImage, Sheet } from './ui'

export function GarmentForm({ garment, defaultThreshold, onSave, onClose }: {
  garment?: Garment
  defaultThreshold: number
  onSave: (input: GarmentInput) => Promise<void>
  onClose: () => void
}) {
  const [name, setName] = useState(garment?.name ?? '')
  const [photo, setPhoto] = useState<Photo>()
  const [initial, setInitial] = useState('')
  const [threshold, setThreshold] = useState(garment?.threshold?.toString() ?? '')
  const action = useAction()
  const fileAction = useAction()
  const busy = action.busy || fileAction.busy
  const hasImage = Boolean(photo || garment)

  function submit(event: FormEvent) {
    event.preventDefault()
    const ports = initial === '' ? 0 : Number(initial)
    const personalThreshold = threshold === '' ? null : Number(threshold)
    void action.run(async () => {
      if (!hasImage) throw new Error('Choisis une photo du vêtement.')
      if (!isIntegerInRange(ports, 0, 9999) || (personalThreshold !== null && !isIntegerInRange(personalThreshold, 1, 99))) {
        throw new Error('Vérifie le nombre de ports et le seuil.')
      }
      await onSave({ name, photo, initial: ports, threshold: personalThreshold })
    })
  }

  return <Sheet title={garment ? 'Modifier le vêtement' : 'Nouveau vêtement'} onClose={onClose}>
    <form className="sheet-form garment-form" onSubmit={submit}>
      <label className="field">Nom du vêtement
        <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={maxNameLength}
          placeholder="Ex. Vert sapin" autoComplete="off" />
      </label>
      <div className="photo-field">
        <label className="field-label" htmlFor="garment-photo">Photo du vêtement</label>
        <div className={`photo-preview ${originalFor(garment?.id ?? '')?.id ?? 'personal'}`}>
          {photo ? <PhotoImage key={photo.key} photo={photo} alt="Aperçu de la nouvelle photo" />
            : garment ? <GarmentImage garment={garment} alt="Photo actuelle" />
            : <div className="photo-placeholder" aria-hidden="true"><ImagePlus size={25} strokeWidth={1.5} /><strong>Choisir une photo</strong><span>Photos ou Fichiers</span></div>}
          {hasImage && <span className="photo-change" aria-hidden="true"><ImagePlus size={15} /> Changer la photo</span>}
          <input id="garment-photo" className="photo-input" type="file" aria-describedby="photo-help"
            accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" disabled={busy} onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void fileAction.run(async () => setPhoto(await preparePhoto(file)))
            }} />
        </div>
        <p className="field-help" id="photo-help" aria-live="polite">
          {fileAction.busy ? 'Préparation de la photo…' : 'PNG, JPEG ou WebP. Le cadre montre l’image entière.'}
        </p>
      </div>
      <div className="garment-options">
        {!garment && <label className="field">Ports de départ
          <input type="number" inputMode="numeric" min={0} max={9999} step={1} value={initial} placeholder="0"
            onChange={(event) => setInitial(event.target.value)} />
        </label>}
        <label className="field">Seuil personnel
          <input type="number" inputMode="numeric" min={1} max={99} step={1} value={threshold}
            placeholder={String(defaultThreshold)} aria-describedby="threshold-help"
            onChange={(event) => setThreshold(event.target.value)} />
        </label>
      </div>
      <p className="field-help" id="threshold-help">Vide, le seuil suit les réglages généraux.</p>
      <FormError error={fileAction.error || action.error} />
      <button type="submit" className="button primary full" disabled={busy}>{garment ? 'Enregistrer' : 'Ajouter à mes sweats'}</button>
    </form>
  </Sheet>
}

export function ArchiveSheet({ wardrobe, onOpen, onClose }: {
  wardrobe: Garment[]
  onOpen: (id: string) => void
  onClose: () => void
}) {
  const archived = wardrobe.filter((garment) => garment.archived)
  return <Sheet title="Vêtements archivés" onClose={onClose}>
    <p className="muted-text">{archived.length
      ? 'Ouvre une fiche pour consulter l’historique ou restaurer le vêtement.'
      : 'Tes vêtements archivés apparaîtront ici avec leur historique.'}</p>
    {archived.length > 0 && <div className="list-panel">
      {archived.map((garment) => <button className="setting-row" key={garment.id} type="button" onClick={() => onOpen(garment.id)}>
        <span className={`event-thumbnail ${originalFor(garment.id)?.id ?? 'personal'}`}><GarmentImage garment={garment} /></span>
        <span className="row-text"><strong>{garment.name}</strong><small>Archivé</small></span>
        <ChevronRight size={16} className="row-arrow" />
      </button>)}
    </div>}
  </Sheet>
}

export function ExportSheet({ state, onClose }: { state: State; onClose: () => void }) {
  const [snapshot] = useState(state)
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    let link: string | undefined
    void backupFile(snapshot).then((file) => {
      if (cancelled) return
      link = URL.createObjectURL(file)
      setUrl(link)
    }).catch((failure) => { if (!cancelled) setError(errorText(failure)) })
    return () => {
      cancelled = true
      if (link) URL.revokeObjectURL(link)
    }
  }, [snapshot])
  return <Sheet title="Exporter mes données" onClose={onClose}>
    <div className="sheet-form">
      <p className="muted-text">Le fichier contient tes vêtements, tes photos personnelles et ton historique.</p>
      <FormError error={error} />
      {url
        ? <a className="button primary full" href={url} download={`sweat-tracker-${parisDay()}.json`}><Download size={17} /> Télécharger le JSON</a>
        : !error && <p className="muted-text" role="status">Préparation de la sauvegarde…</p>}
    </div>
  </Sheet>
}

