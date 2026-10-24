// Persistence for the app's data. Everything is stored under one key as
// { version, tabs }, so future shape changes can be migrated instead of breaking.

import { defaultColumns } from './model.js'

export const STORAGE_KEY = 'todo-tabs'
export const VERSION = 2

const HEX = /^#[0-9a-f]{6}$/i

// Upgrades older saves/backups one version at a time.
const MIGRATIONS = {
  // v1 tabs had a placeholder `text` and no columns.
  1: (data) => ({
    version: 2,
    tabs: data.tabs.map((t) => {
      if (!t || typeof t !== 'object') return t
      const { text, ...rest } = t
      return { ...rest, columns: defaultColumns() }
    }),
  }),
}

const isStr = (v) => typeof v === 'string'

// Returns a clean tabs array, or null if `data` isn't a valid save/export.
export function parseData(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.tabs)) return null
  while (MIGRATIONS[data.version]) data = MIGRATIONS[data.version](data)
  if (data.version !== VERSION) return null

  const ids = new Set()
  const fresh = (id) => isStr(id) && !ids.has(id) && ids.add(id)
  const tabs = []
  for (const t of data.tabs) {
    if (!t || !fresh(t.id) || !isStr(t.title) || !HEX.test(t.color) || !Array.isArray(t.columns)) return null
    const columns = []
    for (const c of t.columns) {
      if (!c || !fresh(c.id) || !isStr(c.title) || !Array.isArray(c.items)) return null
      const items = []
      for (const it of c.items) {
        if (!it || !fresh(it.id) || !isStr(it.text)) return null
        // A blank item is one still being typed when the page closed; drop it.
        if (it.text.trim()) items.push({ id: it.id, text: it.text })
      }
      columns.push({ id: c.id, title: c.title, items })
    }
    tabs.push({ id: t.id, title: t.title, color: t.color, columns })
  }
  return tabs
}

export function serialize(tabs) {
  return JSON.stringify({ version: VERSION, tabs })
}

// null means "nothing usable saved" (first run, corrupt data, or storage blocked).
// Unreadable data is copied aside first, so the next save can't silently destroy it.
export function loadTabs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    let tabs = null
    try {
      tabs = parseData(JSON.parse(raw))
    } catch {}
    if (!tabs) localStorage.setItem(`${STORAGE_KEY}-unreadable-${Date.now()}`, raw)
    return tabs
  } catch {
    return null
  }
}

export function saveTabs(tabs) {
  try {
    localStorage.setItem(STORAGE_KEY, serialize(tabs))
  } catch {
    // Storage full or blocked (e.g. some private modes); the app keeps working in memory.
  }
}

// Some Chromium shells (e.g. Electron-based in-app browsers) offer the save picker
// but refuse to write the chosen file. Once we see that, use plain downloads.
let pickerWriteBlocked = false

export class WriteBlockedError extends Error {}

// Resolves true once the file is written, false if the user cancelled the save dialog.
export async function exportTabs(tabs) {
  const json = JSON.stringify({ version: VERSION, exportedAt: new Date().toISOString(), tabs }, null, 2)
  const filename = `todo-tabs-${new Date().toISOString().slice(0, 10)}.json`

  // Chromium browsers: a real save dialog we can await.
  if ('showSaveFilePicker' in window && !pickerWriteBlocked) {
    let handle = null
    try {
      handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: 'JSON backup', accept: { 'application/json': ['.json'] } }],
      })
    } catch (err) {
      if (err.name === 'AbortError') return false // dialog dismissed
      // The picker couldn't open at all (e.g. blocked in an iframe): fall through
      // to a plain download. Only here -- once the user has picked a file, a
      // failure must not trigger a second save dialog.
      console.warn('Save picker unavailable, falling back to download:', err)
    }
    if (handle) {
      // Errors here propagate to the caller to show.
      let writable
      try {
        writable = await handle.createWritable()
      } catch (err) {
        if (err.name !== 'NotAllowedError') throw err
        pickerWriteBlocked = true
        throw new WriteBlockedError('This browser blocked saving through the dialog.', { cause: err })
      }
      await writable.write(json)
      await writable.close()
      return true
    }
  }

  // Elsewhere: a plain download, which gives no signal back, so assume it worked.
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
  return true
}

// Resolves to a tabs array, or rejects with a human-readable message.
export async function readImportFile(file) {
  let data
  try {
    data = JSON.parse(await file.text())
  } catch {
    throw new Error("That file isn't valid JSON.")
  }
  let tabs = null
  try {
    tabs = parseData(data)
  } catch {}
  if (!tabs) throw new Error("That file isn't a todo-tabs backup.")
  return tabs
}
