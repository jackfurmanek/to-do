// Shape of the app's data:
//   Tab    { id, title, color, columns: Column[] }
//   Column { id, title, kind, items: Item[] }
//   Item   { id, text, due }
//
// `kind` marks the columns that carry date rules: 'today', 'tomorrow', or null.
// `due` is a local calendar date ('YYYY-MM-DD') or null. Items get one when created in
// or moved into a dated column; an item whose due date has passed is overdue.

export function uid() {
  return crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

// ---- Dates (local time, so "today" matches the user's wall clock) ----

export function dateKey(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function todayKey() {
  return dateKey(new Date())
}

// ISO 8601 timestamp in local time with its UTC offset, e.g. 2026-10-24T22:05:31-04:00,
// so it reads on the same calendar day as the items' due dates.
export function localTimestamp(date = new Date()) {
  const pad = (n) => String(Math.trunc(Math.abs(n))).padStart(2, '0')
  const off = -date.getTimezoneOffset()
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  return `${dateKey(date)}T${time}${off >= 0 ? '+' : '-'}${pad(off / 60)}:${pad(off % 60)}`
}

export function addDays(key, days) {
  const [y, m, d] = key.split('-').map(Number)
  return dateKey(new Date(y, m - 1, d + days))
}

// The due date an item gets in a column of this kind.
export function dueFor(kind, today) {
  if (kind === 'today') return today
  if (kind === 'tomorrow') return addDays(today, 1)
  return null
}

export const isOverdue = (item, today) => !!item.due && item.due < today

// ---- Construction ----

export const DEFAULT_COLUMNS = [
  { title: 'Today', kind: 'today' },
  { title: 'Tomorrow', kind: 'tomorrow' },
  { title: 'This week', kind: null },
]

export function defaultColumns() {
  return DEFAULT_COLUMNS.map(({ title, kind }) => ({ id: uid(), title, kind, items: [] }))
}

export function makeItem(text = '', due = null) {
  return { id: uid(), text, due }
}

// ---- Day rollover ----

// Items in a Tomorrow column whose day has arrived move to the end of that tab's
// Today column (keeping their due date, so ones that waited several days arrive
// already overdue). Returns the same array when nothing changes.
export function rollOver(tabs, today) {
  let changed = false
  const next = tabs.map((tab) => {
    const todayCol = tab.columns.find((c) => c.kind === 'today')
    const tomorrowCol = tab.columns.find((c) => c.kind === 'tomorrow')
    if (!todayCol || !tomorrowCol) return tab
    const arriving = tomorrowCol.items.filter((i) => i.due && i.due <= today)
    if (!arriving.length) return tab
    changed = true
    return {
      ...tab,
      columns: tab.columns.map((c) =>
        c === todayCol
          ? { ...c, items: [...c.items, ...arriving] }
          : c === tomorrowCol
            ? { ...c, items: c.items.filter((i) => !arriving.includes(i)) }
            : c,
      ),
    }
  })
  return changed ? next : tabs
}
