import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { motion, AnimatePresence, MotionConfig, animate, useMotionValue } from 'motion/react'
import Board from './Board.jsx'
import Home from './Home.jsx'
import { tint, labelColor } from './colors.js'
import { defaultColumns, makeItem, dueFor, rollOver, todayKey } from './model.js'
import { STORAGE_KEY, loadTabs, saveTabs, parseData, exportTabs, readImportFile, WriteBlockedError } from './storage.js'

// Demo data for the very first run.
function initialTabs() {
  const today = todayKey()
  const withItems = (lists) =>
    defaultColumns().map((col, i) => ({ ...col, items: (lists[i] ?? []).map((t) => makeItem(t, dueFor(col.kind, today))) }))
  return [
    { id: 'inbox', title: 'Inbox', color: '#e5383b', columns: withItems([['Buy milk', 'Water the plants'], ['Reply to emails'], ['Book dentist']]) },
    { id: 'work', title: 'Work', color: '#2bb24c', columns: withItems([]) },
    { id: 'home', title: 'Home', color: '#2f6fed', columns: withItems([]) },
    { id: 'someday', title: 'Someday', color: '#8e44d9', columns: withItems([]) },
  ]
}

const SWATCHES = ['#e5383b', '#f2871d', '#e8b500', '#2bb24c', '#14a3a3', '#2f6fed', '#8e44d9', '#d6338a', '#5c5f66']

const TAB_H = 64 // height of a resting tab
const PLUS_W = 64 // the "+" tab is roughly square
const PLUS_COLOR = '#8a8f98'
const BORDER = 14 // frame thickness when a tab is open
const RADIUS = 14
const GAP = 6 // px between resting tabs, and at the left/right edges
const HOVER_LIFT = 6 // px a hovered tab grows upward
// Set inline (not in CSS) so Motion scale-corrects it during layout animations.
//const TAB_SHADOW = '0 -1px 3px rgba(0, 0, 0, 0.12), 0 -3px 10px rgba(0, 0, 0, 0.08)'

const spring = { type: 'spring', bounce: 0.18, duration: 0.6 }
const hoverSpring = { type: 'spring', bounce: 0.3, duration: 0.35 }

export default function App() {
  // Demo tabs only on the very first run; after that the save is the source of truth.
  const [tabs, setTabs] = useState(() => rollOver(loadTabs() ?? initialTabs(), todayKey()))
  // The current local date. Re-checked every minute and when the window regains
  // focus, so leaving the app open overnight still rolls Tomorrow into Today.
  const [today, setToday] = useState(todayKey)
  const [active, setActive] = useState(null)
  const [adding, setAdding] = useState(false)
  const [hovered, setHovered] = useState(null) // tab id, 'add', or null
  const [confirmDelete, setConfirmDelete] = useState(null) // tab pending deletion
  const [pendingImport, setPendingImport] = useState(null) // tabs from a backup file, awaiting OK
  const prevActive = usePrevious(active)
  const [draggingTab, setDraggingTab] = useState(null) // id of the tab being dragged along the bar

  useEffect(() => {
    const onKey = (e) => {
      if (adding || confirmDelete || pendingImport) return // dialogs handle their own keys
      if (e.target.closest?.('input, textarea, [contenteditable="true"]')) return
      if (e.key === 'Escape') setActive(null)
      const n = Number(e.key)
      if (n >= 1 && n <= tabs.length) setActive(tabs[n - 1].id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [adding, confirmDelete, pendingImport, tabs])

  useEffect(() => saveTabs(tabs), [tabs])

  useEffect(() => {
    const check = () => setToday(todayKey())
    const timer = setInterval(check, 60_000)
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', check)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', check)
      document.removeEventListener('visibilitychange', check)
    }
  }, [])

  useEffect(() => setTabs((t) => rollOver(t, today)), [today])

  // Another browser window changed the save: adopt it so neither clobbers the other.
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key !== STORAGE_KEY || !e.newValue) return
      try {
        const next = parseData(JSON.parse(e.newValue))
        if (next) setTabs(rollOver(next, todayKey()))
      } catch {}
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // If the open tab vanished (deleted elsewhere, or replaced by an import), close it.
  useEffect(() => {
    if (active && !tabs.some((t) => t.id === active)) setActive(null)
  }, [tabs, active])

  const addTab = ({ title, color }) => {
    const id = `${Date.now()}`
    setTabs((t) => [...t, { id, title, color, columns: defaultColumns() }])
    setAdding(false)
  }

  const updateColumns = (tabId, fn) =>
    setTabs((ts) => ts.map((t) => (t.id === tabId ? { ...t, columns: fn(t.columns) } : t)))

  // Close the tab first so it shrinks back into its slot, then drop it out of the bar.
  const deleteTab = (id) => {
    setConfirmDelete(null)
    setActive((cur) => (cur === id ? null : cur))
    setTimeout(() => setTabs((t) => t.filter((tab) => tab.id !== id)), 450)
  }

  const activeTab = tabs.find((t) => t.id === active)
  const n = tabs.length
  // Regular tabs split whatever width the "+" tab and the n + 2 gaps leave over.
  const slotWidth = `((100% - ${PLUS_W + (n + 2) * GAP}px) / ${n})`
  const slotLeft = (i) => `calc(${GAP + i * GAP}px + ${slotWidth} * ${i})`
  // A hovered tab swallows the gaps on both sides and rises a little.
  const restingRect = (i, hover) => ({
    left: hover ? `calc(${slotLeft(i)} - ${GAP}px)` : slotLeft(i),
    width: hover ? `calc(${slotWidth} + ${2 * GAP}px)` : `calc(${slotWidth})`,
    top: `calc(100% - ${TAB_H + (hover ? HOVER_LIFT : 0)}px)`,
    height: TAB_H + (hover ? HOVER_LIFT : 0),
  })
  // Mouse only, so a tap on touch screens doesn't leave a tab stuck "hovered".
  // While a tab is being dragged, it keeps the hover and its neighbours don't take it.
  const hoverProps = (id) => ({
    onPointerEnter: (e) => e.pointerType === 'mouse' && !tabDrag.current && setHovered(id),
    onPointerLeave: () => !tabDrag.current && setHovered((h) => (h === id ? null : h)),
  })

  // ---- Dragging tabs to reorder them ----
  // The dragged tab is reordered in `tabs` as it crosses its neighbours' midpoints, so
  // they slide aside with their usual layout animation. The dragged tab itself opts out
  // of layout animation and is placed with `tabDragX`, an offset from its current slot.
  const appRef = useRef(null)
  const tabDrag = useRef(null) // { id, grab, desiredLeft } while dragging
  const suppressClick = useRef(false)
  const tabDragX = useMotionValue(0)

  // Slot geometry in px, mirroring slotLeft/slotWidth above.
  const slotPx = (count) => {
    const w = (appRef.current.clientWidth - PLUS_W - (count + 2) * GAP) / count
    return { w, left: (i) => GAP + i * (w + GAP) }
  }

  // After each re-render the dragged tab's slot may have moved; re-aim the offset
  // before paint so it stays glued to the pointer.
  useLayoutEffect(() => {
    const d = tabDrag.current
    if (!d) return
    const i = tabs.findIndex((t) => t.id === d.id)
    if (i >= 0) tabDragX.set(d.desiredLeft - slotPx(tabs.length).left(i))
  }, [tabs])

  const pressTab = (e, id) => {
    if (e.button !== 0 || tabDrag.current) return
    const startX = e.clientX
    const onMove = (ev) => {
      const count = tabsRef.current.length
      const { w, left } = slotPx(count)
      let d = tabDrag.current
      if (!d) {
        if (Math.abs(ev.clientX - startX) < 5) return // still a click
        const i = tabsRef.current.findIndex((t) => t.id === id)
        d = tabDrag.current = { id, grab: startX - left(i), desiredLeft: left(i) }
        setDraggingTab(id)
        setHovered(id)
        document.body.classList.add('is-dragging')
      }
      d.desiredLeft = ev.clientX - d.grab
      const target = Math.max(0, Math.min(count - 1, Math.round((d.desiredLeft - GAP) / (w + GAP))))
      const cur = tabsRef.current.findIndex((t) => t.id === id)
      if (target !== cur) {
        setTabs((ts) => {
          const from = ts.findIndex((t) => t.id === id)
          if (from < 0 || from === target) return ts
          const next = [...ts]
          next.splice(target, 0, ...next.splice(from, 1))
          return next
        })
      }
      tabDragX.set(d.desiredLeft - left(cur))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      if (!tabDrag.current) return
      tabDrag.current = null
      document.body.classList.remove('is-dragging')
      // The click that follows this release shouldn't also open/close the tab.
      suppressClick.current = true
      setTimeout(() => (suppressClick.current = false), 0)
      animate(tabDragX, 0, hoverSpring).then(() => setDraggingTab((cur) => (cur === id ? null : cur)))
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs

  return (
    <MotionConfig transition={spring}>
      <div className="app" ref={appRef}>
        <Home tabs={tabs} today={today} bottomSpace={TAB_H + 32} />

        {/* Tab backgrounds. Each one is a single element that morphs between its
            resting slot and the full-window frame via a layout animation. The open
            one sits *below* resting tabs, so a closing tab shrinks over it. */}
        <AnimatePresence>
        {tabs.map((tab, i) => {
          const open = tab.id === active
          const r = open ? 0 : RADIUS
          // Opening/closing gets the big spring; hover nudges get the quick one.
          const toggling = open || tab.id === prevActive
          const dragged = tab.id === draggingTab
          return (
            <motion.div
              key={tab.id}
              layout={!dragged}
              className="tab-bg"
              initial={{ y: TAB_H }}
              animate={{ y: 0, borderTopLeftRadius: r, borderTopRightRadius: r }}
              exit={{ y: TAB_H + HOVER_LIFT, transition: { duration: 0.25, ease: 'easeIn' } }}
              transition={{ default: spring, layout: toggling ? spring : hoverSpring }}
              style={{
                background: tab.color,
                // A dragged tab rises above the label layer (.tab-bar, z 30), carrying its own label.
                zIndex: open ? 10 : dragged ? 35 : 20,
                x: dragged && !open ? tabDragX : 0, // an open tab is the frame: it stays put
                //boxShadow: open ? 'none' : TAB_SHADOW,
                
                ...(open
                  ? { left: 0, top: 0, width: '100%', height: '100%' }
                  : restingRect(i, hovered === tab.id)),
              }}
            >
              {dragged && !open && (
                <div className="tab-bg-label" style={{ height: TAB_H, color: labelColor(tab.color) }}>
                  {tab.title}
                  <TodayCount tab={tab} />
                </div>
              )}
            </motion.div>
          )
        })}
        </AnimatePresence>

        {/* The "+" tab's background morphs into the add-tab modal and back. */}
        {!adding && (
          <motion.div
            layoutId="add-tab"
            className="tab-bg"
            transition={{ layout: hoverSpring }}
            style={{
              background: PLUS_COLOR,
              //boxShadow: TAB_SHADOW,
              zIndex: 20,
              right: hovered === 'add' ? 0 : GAP,
              bottom: 0,
              width: PLUS_W + (hovered === 'add' ? 2 * GAP : 0),
              height: TAB_H + (hovered === 'add' ? HOVER_LIFT : 0),
              borderTopLeftRadius: RADIUS,
              borderTopRightRadius: RADIUS,
              borderBottomLeftRadius: 0,
              borderBottomRightRadius: 0,
            }}
          />
        )}

        {/* Lighter inner sheet of the open tab, inset to leave the hard border. */}
        <AnimatePresence>
          {activeTab && (
            <motion.section
              key={activeTab.id}
              className="sheet"
              style={{
                background: tint(activeTab.color, 0.96),
                inset: `${BORDER}px ${BORDER}px ${TAB_H + BORDER}px ${BORDER}px`,
              }}
              initial={{ opacity: 0, scale: 0.96, y: 24 }}
              animate={{ opacity: 1, scale: 1, y: 0, transition: { ...spring, delay: 0.12 } }}
              exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.15 } }}
            >
              <Board
                tab={activeTab}
                today={today}
                onUpdateColumns={(fn) => updateColumns(activeTab.id, fn)}
                onDelete={() => setConfirmDelete(activeTab)}
              />
            </motion.section>
          )}
        </AnimatePresence>

        {/* Clickable labels, always on top. */}
        <nav className="tab-bar" style={{ height: TAB_H, gap: GAP, padding: `0 ${GAP}px` }}>
          {tabs.map((tab) => (
            <motion.button
              key={tab.id}
              layout={tab.id === draggingTab ? false : 'position'}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              // While dragged, the tab's background shows its label instead (see .tab-bg-label);
              // .dragging hides this one with `visibility`, which swaps back in the same frame.
              className={`tab-label${tab.id === draggingTab ? ' dragging' : ''}`}
              style={{ color: labelColor(tab.color), x: tab.id === draggingTab ? tabDragX : 0 }}
              aria-pressed={tab.id === active}
              {...hoverProps(tab.id)}
              onPointerDown={(e) => pressTab(e, tab.id)}
              onClick={() => {
                if (suppressClick.current) return
                setActive((cur) => (cur === tab.id ? null : tab.id))
              }}
            >
              {tab.title}
              <TodayCount tab={tab} />
            </motion.button>
          ))}
          <motion.button
            className="tab-label plus"
            // margin-left: auto keeps it at the right end even when there are no tabs.
            style={{ flex: `0 0 ${PLUS_W}px`, marginLeft: 'auto' }}
            animate={{ opacity: adding ? 0 : 1 }}
            aria-label="Add tab"
            {...hoverProps('add')}
            onClick={() => { setHovered(null); setAdding(true) }}
          >
            +
          </motion.button>
        </nav>

        <AnimatePresence>
          {adding && (
            <AddTabModal
              onCancel={() => setAdding(false)}
              onAdd={addTab}
              onExport={() => exportTabs(tabs)}
              onImport={(imported) => { setAdding(false); setPendingImport(imported) }}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {confirmDelete && (
            <ConfirmDialog
              title={`Delete "${confirmDelete.title}"?`}
              message="This tab and everything in it will be gone for good."
              confirmLabel="Delete"
              onCancel={() => setConfirmDelete(null)}
              onConfirm={() => deleteTab(confirmDelete.id)}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {pendingImport && (
            <ConfirmDialog
              title="Replace all tabs?"
              message={`Your ${tabs.length} current tab${tabs.length === 1 ? '' : 's'} will be replaced by the ${pendingImport.length} from the backup.`}
              confirmLabel="Replace"
              onCancel={() => setPendingImport(null)}
              // An older backup catches up on the days since it was made.
              onConfirm={() => { setActive(null); setTabs(rollOver(pendingImport, todayKey())); setPendingImport(null) }}
            />
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  )
}

function usePrevious(value) {
  const ref = useRef(value)
  useEffect(() => { ref.current = value })
  return ref.current
}

function ConfirmDialog({ title, message, confirmLabel, onCancel, onConfirm }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onCancel()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <>
      <motion.div
        className="backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onCancel}
      />
      <div className="modal-wrap">
        <motion.div
          role="alertdialog"
          aria-modal="true"
          className="modal confirm"
          style={{ borderRadius: 18, background: '#fff' }}
          initial={{ opacity: 0, scale: 0.9, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
        >
          <div className="modal-body">
            <h2>{title}</h2>
            <p className="muted">{message}</p>
            <div className="actions">
              {/* Focus lands on the safe choice. */}
              <button type="button" className="btn ghost" autoFocus onClick={onCancel}>Cancel</button>
              <button type="button" className="btn danger" onClick={onConfirm}>{confirmLabel}</button>
            </div>
          </div>
        </motion.div>
      </div>
    </>
  )
}

function AddTabModal({ onCancel, onAdd, onExport, onImport }) {
  const [title, setTitle] = useState('')
  const [color, setColor] = useState(SWATCHES[1])
  // The ring only gets a layoutId once the open morph finishes; before that,
  // Motion would pin it to its final spot while the modal grows around it.
  const [settled, setSettled] = useState(false)
  const ringId = settled ? 'swatch-ring' : undefined
  const inputRef = useRef(null)
  const fileRef = useRef(null)
  const [backupError, setBackupError] = useState(null)
  const [exported, setExported] = useState(false)

  useEffect(() => {
    if (!exported) return
    const t = setTimeout(() => setExported(false), 2000)
    return () => clearTimeout(t)
  }, [exported])

  const exportFile = async () => {
    setBackupError(null)
    try {
      setExported(await onExport())
    } catch (err) {
      console.error('Export failed:', err)
      setBackupError(
        err instanceof WriteBlockedError
          ? 'This browser blocked saving there. Click Export JSON again to download it instead.'
          : `Couldn't save the file (${err.name}: ${err.message}).`,
      )
    }
  }

  const pickFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = '' // so picking the same file again still fires
    if (!file) return
    try {
      onImport(await readImportFile(file))
    } catch (err) {
      setBackupError(err.message)
    }
  }

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onCancel()
    window.addEventListener('keydown', onKey)
    // Focus after the morph has started so the browser doesn't scroll/jank it.
    const t = setTimeout(() => inputRef.current?.focus(), 150)
    return () => {
      window.removeEventListener('keydown', onKey)
      clearTimeout(t)
    }
  }, [onCancel])

  const submit = (e) => {
    e.preventDefault()
    if (title.trim()) onAdd({ title: title.trim(), color })
  }

  return (
    <>
      <motion.div
        className="backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onCancel}
      />
      <div className="modal-wrap">
        <motion.form
          layoutId="add-tab"
          className="modal"
          style={{ borderRadius: 18, background: '#fff' }}
          onSubmit={submit}
          onLayoutAnimationComplete={() => setSettled(true)}
        >
          <motion.div
            className="modal-body"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0, transition: { ...spring, delay: 0.15 } }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
          >
            <h2>New tab</h2>

            <label className="field">
              <span>Title</span>
              <input
                ref={inputRef}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Groceries"
                maxLength={24}
              />
            </label>

            <div className="field">
              <span>Color</span>
              <div className="swatches">
                {SWATCHES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className="swatch"
                    style={{ background: c }}
                    aria-label={c}
                    aria-pressed={c === color}
                    onClick={() => setColor(c)}
                  >
                    {c === color && <motion.span layoutId={ringId} className="swatch-ring" />}
                  </button>
                ))}
                <label className="swatch custom" title="Custom color" style={{ background: SWATCHES.includes(color) ? undefined : color }}>
                  <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
                  {!SWATCHES.includes(color) && <motion.span layoutId={ringId} className="swatch-ring" />}
                </label>
              </div>
            </div>

            {/* Live preview of the tab being made. */}
            <div className="preview" style={{ background: color, color: labelColor(color) }}>
              {title.trim() || 'Untitled'}
            </div>

            <div className="actions">
              <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
              <button type="submit" className="btn" disabled={!title.trim()} style={{ background: color, color: labelColor(color) }}>
                Add tab
              </button>
            </div>

            <div className="backup">
              <span>Backup</span>
              <button type="button" className="link" onClick={exportFile}>
                {exported ? 'Exported!' : 'Export JSON'}
              </button>
              <button type="button" className="link" onClick={() => fileRef.current?.click()}>Import JSON</button>
              <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={pickFile} />
            </div>
            {backupError && <p className="error">{backupError}</p>}
          </motion.div>
        </motion.form>
      </div>
    </>
  )
}

// How many items sit in a tab's Today column, as a small badge beside its title.
// Hidden at zero; pops when the number changes.
function TodayCount({ tab }) {
  const count = tab.columns.find((c) => c.kind === 'today')?.items.length ?? 0
  return (
    <AnimatePresence initial={false}>
      {count > 0 && (
        <motion.span
          className="tab-count"
          style={{ background: labelColor(tab.color), color: tab.color }}
          aria-label={`${count} in Today`}
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.5, transition: { duration: 0.15 } }}
        >
          <motion.span key={count} initial={{ y: -6, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
            {count}
          </motion.span>
        </motion.span>
      )}
    </AnimatePresence>
  )
}
