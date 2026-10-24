// Shape of the app's data:
//   Tab    { id, title, color, columns: Column[] }
//   Column { id, title, items: Item[] }
//   Item   { id, text }

export function uid() {
  return crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

export const DEFAULT_COLUMN_TITLES = ['Today', 'Tomorrow', 'This week']

export function defaultColumns() {
  return DEFAULT_COLUMN_TITLES.map((title) => ({ id: uid(), title, items: [] }))
}

export function makeItem(text = '') {
  return { id: uid(), text }
}
