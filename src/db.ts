import { emptyState, migrateV1 } from './model.ts'
import type { State, StateV1 } from './model.ts'

const legacyKey = 'state'
const stateKey = 'state-v2'
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('sweat-tracker') : null
let connection: Promise<IDBDatabase> | undefined

function openDatabase() {
  connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('sweat-tracker', 2)
    let migrationError: unknown
    let blocked = false
    request.onupgradeneeded = ({ oldVersion }) => {
      if (oldVersion === 0) {
        request.result.createObjectStore('app')
        return
      }
      const transaction = request.transaction!
      const store = transaction.objectStore('app')
      const previous = store.get(legacyKey)
      previous.onsuccess = () => {
        if (previous.result === undefined) return
        try {
          store.put(migrateV1(previous.result as StateV1), stateKey)
        } catch (error) {
          migrationError = error
          transaction.abort()
        }
      }
    }
    request.onerror = () => reject(migrationError ?? request.error)
    request.onblocked = () => {
      blocked = true
      reject(new Error('Ferme les autres fenêtres de Sweat Tracker puis réessaie.'))
    }
    request.onsuccess = () => {
      const database = request.result
      if (blocked) {
        database.close()
        return
      }
      database.onversionchange = () => {
        database.close()
        connection = undefined
      }
      resolve(database)
    }
  }).catch((error) => {
    connection = undefined
    throw error
  })
  return connection
}

export async function readState(): Promise<State> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const request = database.transaction('app').objectStore('app').get(stateKey)
    request.onsuccess = () => resolve(request.result ?? emptyState())
    request.onerror = () => reject(request.error)
  })
}

export async function updateState(update: (state: State) => State, purgeLegacy = false): Promise<State> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('app', 'readwrite')
    const store = transaction.objectStore('app')
    const request = store.get(stateKey)
    let result: State
    let failure: unknown
    let changed = false
    request.onsuccess = () => {
      try {
        const current = request.result ?? emptyState()
        result = update(current)
        changed = result !== current
        if (changed) store.put(result, stateKey)
        if (purgeLegacy) store.delete(legacyKey)
      } catch (error) {
        failure = error
        transaction.abort()
      }
    }
    transaction.onabort = () => reject(failure ?? transaction.error)
    transaction.oncomplete = () => {
      if (changed) channel?.postMessage('updated')
      resolve(result)
    }
  })
}

export function subscribeToStorage(refresh: () => void) {
  channel?.addEventListener('message', refresh)
  return () => channel?.removeEventListener('message', refresh)
}

