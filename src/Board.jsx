import { forwardRef, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence, animate, useMotionValue } from 'motion/react'
import { tint, labelColor } from './colors.js'
import { makeItem } from './model.js'

const spring = { type: 'spring', bounce: 0.18, duration: 0.6 }
const itemSpring = { type: 'spring', bounce: 0.2, duration: 0.4 }
const dropSpring = { type: 'spring', bounce: 0.15, duration: 0.35 }

const DRAG_THRESHOLD = 5 // px the pointer must travel before a press becomes a drag
const ITEM_GAP = 12 // keep in sync with .item-list gap
const SCROLL_ZONE = 48 // px from a list's edge where dragging auto-scrolls it
const SCROLL_SPEED = 10 // px per frame

const inRect = (el, x, y) => {
  const r = el?.getBoundingClientRect()
  return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
}

// The inside of an open tab: its columns, each a list of items plus a "+" box.
//
// Dragging is hand-rolled on top of Motion so items can move between columns: the
// card lifts into a floating copy (portalled to <body>, so no column clips it), an
// empty slot marks where it will land, and Motion's layout animations slide the other
// cards aside. Dropping on the drawer at the bottom of a column completes the item.
export default function Board({ tab, onUpdateColumns, onDelete }) {
  // The item just created with "+", which should open straight into editing.
  const [newItemId, setNewItemId] = useState(null)
  // While dragging: { item, fromCol, fromIndex, overCol, index, overDrawer, w, h, dropping }
  const [drag, setDrag] = useState(null)
  // The item just dropped: it mounts in its new spot without the entrance animation.
  const [landedId, setLandedId] = useState(null)

  const dragRef = useRef(null) // live copy of `drag` for listeners and the frame loop
  const pointer = useRef({ x: 0, y: 0 })
  const stopDrag = useRef(null) // detaches the current drag's listeners
  const columnRefs = useRef({})
  const listRefs = useRef({})
  const drawerRefs = useRef({})
  const cloneX = useMotionValue(0)
  const cloneY = useMotionValue(0)

  const colors = {
    column: tint(tab.color, 0.84),
    item: tint(tab.color, 0.95),
    accent: tab.color,
    onAccent: labelColor(tab.color),
  }
  const cssVars = { '--accent': colors.accent, '--on-accent': colors.onAccent, '--item': colors.item }

  const updateItems = (columnId, fn) =>
    onUpdateColumns((cols) => cols.map((c) => (c.id === columnId ? { ...c, items: fn(c.items) } : c)))

  const addItem = (columnId) => {
    const item = makeItem()
    updateItems(columnId, (items) => [...items, item])
    setNewItemId(item.id)
  }

  const setDragState = (d) => {
    dragRef.current = d
    setDrag(d)
  }

  // Leaving the tab mid-drag: drop everything on the floor.
  useEffect(() => () => stopDrag.current?.(), [])

  // A press on a card becomes a drag once the pointer has moved a few pixels,
  // so clicks and double-clicks still work.
  const pressCard = (e, item, columnId) => {
    if (e.button !== 0 || dragRef.current) return
    const el = e.currentTarget
    const start = { x: e.clientX, y: e.clientY }
    const onMove = (ev) => {
      if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_THRESHOLD) return
      cleanup()
      startDrag(ev, el, start, item, columnId)
    }
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', cleanup)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', cleanup)
  }

  const startDrag = (ev, el, start, item, columnId) => {
    const r = el.getBoundingClientRect()
    const offset = { x: start.x - r.left, y: start.y - r.top }
    const follow = (e) => {
      pointer.current = { x: e.clientX, y: e.clientY }
      cloneX.set(e.clientX - offset.x)
      cloneY.set(e.clientY - offset.y)
    }
    follow(ev)

    const fromIndex = tab.columns.find((c) => c.id === columnId).items.findIndex((i) => i.id === item.id)
    setLandedId(null)
    setDragState({ item, fromCol: columnId, fromIndex, overCol: columnId, index: fromIndex, overDrawer: false, w: r.width, h: r.height })
    document.body.classList.add('is-dragging')

    let frame = requestAnimationFrame(function loop() {
      track()
      frame = requestAnimationFrame(loop)
    })
    const onUp = () => drop(false)
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation() // cancel the drag, don't also close the tab
        drop(true)
      }
    }
    window.addEventListener('pointermove', follow)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('keydown', onKey, true)
    stopDrag.current = () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', follow)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('keydown', onKey, true)
      document.body.classList.remove('is-dragging')
      stopDrag.current = null
    }
  }

  // Every frame: which column is the pointer over, where in it would the item land,
  // is it over the drawer, and should the list scroll?
  const track = () => {
    const d = dragRef.current
    if (!d || d.dropping) return
    const { x, y } = pointer.current

    let overCol = d.overCol
    for (const [id, el] of Object.entries(columnRefs.current)) {
      const r = el?.getBoundingClientRect()
      if (r && x >= r.left && x <= r.right) overCol = id
    }

    const list = listRefs.current[overCol]
    const drawer = drawerRefs.current[overCol]
    if (list) {
      const r = list.getBoundingClientRect()
      const bottom = drawer ? drawer.getBoundingClientRect().top : r.bottom
      if (y < r.top + SCROLL_ZONE) list.scrollTop -= SCROLL_SPEED
      else if (y > bottom - SCROLL_ZONE && y < bottom) list.scrollTop += SCROLL_SPEED
    }

    const overDrawer = inRect(drawer, x, y)

    // Insertion index = how many other items sit above the pointer. Uses layout
    // positions (offsetTop), not on-screen ones, so cards mid-animation don't make the
    // slot flicker; cards after the current slot are shifted down by it, so undo that.
    let index = 0
    if (list) {
      const listTop = list.getBoundingClientRect().top - list.scrollTop
      const slotShown = overCol === d.overCol && !d.overDrawer
      list.querySelectorAll('[data-item-id]').forEach((el, i) => {
        const shift = slotShown && i >= d.index ? d.h + ITEM_GAP : 0
        if (listTop + el.offsetTop - shift + el.offsetHeight / 2 < y) index++
      })
    }

    if (overCol !== d.overCol || index !== d.index || overDrawer !== d.overDrawer) {
      setDragState({ ...d, overCol, index, overDrawer })
    }
  }

  const drop = (cancel) => {
    const d = dragRef.current
    if (!d || d.dropping) return
    stopDrag.current?.()
    const target = cancel ? { overCol: d.fromCol, index: d.fromIndex, overDrawer: false } : d

    if (target.overDrawer) {
      // Completed: remove it now; the floating copy shrinks away, then unmounts.
      updateItems(d.fromCol, (items) => items.filter((i) => i.id !== d.item.id))
      setDragState({ ...d, dropping: 'complete' })
      return
    }

    setDragState({ ...d, ...target, dropping: 'move' })
    // Next frame the slot is in its final place: glide the copy into it, then commit.
    requestAnimationFrame(async () => {
      // Aim at the slot's layout position; its on-screen box may still be animating.
      // (Looked up in the DOM: AnimatePresence's popLayout replaces a child's ref.)
      const slot = columnRefs.current[target.overCol]?.querySelector('.item-slot')
      const list = slot?.offsetParent
      if (list) {
        const lr = list.getBoundingClientRect()
        const left = lr.left + slot.offsetLeft - list.scrollLeft
        const top = lr.top + slot.offsetTop - list.scrollTop
        await Promise.all([animate(cloneX, left, dropSpring), animate(cloneY, top, dropSpring)])
      }
      onUpdateColumns((cols) => {
        const without = cols.map((c) => (c.id === d.fromCol ? { ...c, items: c.items.filter((i) => i.id !== d.item.id) } : c))
        return without.map((c) =>
          c.id === target.overCol ? { ...c, items: [...c.items.slice(0, target.index), d.item, ...c.items.slice(target.index)] } : c,
        )
      })
      setLandedId(d.item.id)
      setDragState(null)
    })
  }

  return (
    <div className="board" style={cssVars}>
      <div className="columns">
        {tab.columns.map((col, i) => {
          const items = col.items.filter((it) => it.id !== drag?.item.id)
          const slotHere = drag && drag.overCol === col.id && !drag.overDrawer && drag.dropping !== 'complete'
          const children = items.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              landed={item.id === landedId}
              autoEdit={item.id === newItemId}
              onPress={(e) => pressCard(e, item, col.id)}
              onSave={(text) => updateItems(col.id, (its) => its.map((it) => (it.id === item.id ? { ...it, text } : it)))}
              onRemove={() => updateItems(col.id, (its) => its.filter((it) => it.id !== item.id))}
              onEditEnd={() => setNewItemId((id) => (id === item.id ? null : id))}
            />
          ))
          if (slotHere) {
            children.splice(
              Math.min(drag.index, children.length),
              0,
              <motion.div
                key="__slot"
                layout
                className="item-slot"
                style={{ height: drag.h }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: 0 } }}
                transition={itemSpring}
              />,
            )
          }

          return (
            <motion.section
              key={col.id}
              ref={(el) => (columnRefs.current[col.id] = el)}
              className="column"
              style={{ background: colors.column }}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0, transition: { ...spring, delay: 0.15 + i * 0.05 } }}
            >
              <h2>{col.title}</h2>
              <motion.div className="items" layoutScroll ref={(el) => (listRefs.current[col.id] = el)}>
                <div className="item-list">
                  {/* The lifted card leaves its slot instantly (custom = dragged id). */}
                  <AnimatePresence initial={false} mode="popLayout" custom={drag?.item.id}>
                    {children}
                  </AnimatePresence>
                </div>
                <motion.button
                  layout
                  transition={itemSpring}
                  className="add-item"
                  aria-label={`Add item to ${col.title}`}
                  onClick={() => addItem(col.id)}
                >
                  +
                </motion.button>
              </motion.div>

              {/* Completion drawer: attached to the bottom of whichever column the drag is over. */}
              <AnimatePresence>
                {drag && !drag.dropping && drag.overCol === col.id && (
                  <motion.div
                    ref={(el) => (drawerRefs.current[col.id] = el)}
                    className={`drawer${drag.overDrawer ? ' over' : ''}`}
                    aria-label="Drop to complete"
                    initial={{ y: '100%' }}
                    animate={{ y: 0 }}
                    exit={{ y: '100%', transition: { duration: 0.2, ease: 'easeIn' } }}
                    transition={itemSpring}
                  >
                    <CheckIcon />
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.section>
          )
        })}
      </div>

      <div className="board-footer">
        <button className="btn danger-outline" onClick={onDelete}>Delete tab</button>
      </div>

      {/* The floating copy that follows the pointer. */}
      {drag &&
        createPortal(
          <motion.div
            className={`drag-clone${drag.overDrawer ? ' over-drawer' : ''}`}
            style={{ ...cssVars, x: cloneX, y: cloneY, width: drag.w, height: drag.h }}
            initial={{ scale: 1 }}
            animate={
              drag.dropping === 'complete'
                ? { scale: 0.3, opacity: 0, transition: { duration: 0.2, ease: 'easeIn' } }
                : { scale: drag.dropping ? 1 : drag.overDrawer ? 0.82 : 1.03 }
            }
            transition={itemSpring}
            onAnimationComplete={() => dragRef.current?.dropping === 'complete' && setDragState(null)}
          >
            <div className="item card">
              <span className="grip" aria-hidden="true">
                <GripIcon />
              </span>
            </div>
          </motion.div>,
          document.body,
        )}
    </div>
  )
}

// Hover shows the drag grip and a pencil to edit; double-click or Enter also edits.
// While editing: Enter saves, Shift+Enter adds a line, Esc cancels; saving empty removes it.
const ItemCard = forwardRef(function ItemCard({ item, landed, autoEdit, onPress, onSave, onRemove, onEditEnd }, ref) {
  const [editing, setEditing] = useState(autoEdit)
  const [draft, setDraft] = useState(item.text)
  const inputRef = useRef(null)
  const done = useRef(false) // guards against finishing twice (e.g. Enter, then blur)

  useEffect(() => {
    if (!editing) return
    done.current = false
    const el = inputRef.current
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [editing])

  // Switching tabs unmounts the board mid-edit; keep what was typed.
  const latest = useRef()
  latest.current = { editing, draft, text: item.text, onSave }
  useEffect(
    () => () => {
      const { editing, draft, text, onSave } = latest.current
      if (editing && !done.current && draft.trim() && draft.trim() !== text) onSave(draft.trim())
    },
    [],
  )

  const startEdit = () => {
    setDraft(item.text)
    setEditing(true)
  }

  const finish = (save) => {
    if (done.current) return
    done.current = true
    setEditing(false)
    onEditEnd()
    const text = draft.trim()
    if (!save) {
      if (!item.text) onRemove() // cancelled a brand-new item
      else setDraft(item.text)
    } else if (!text) onRemove()
    else if (text !== item.text) onSave(text)
  }

  return (
    <motion.div
      ref={ref}
      layout
      className="item-wrap"
      data-item-id={item.id}
      initial={landed ? false : { opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      variants={{
        // `custom` comes from AnimatePresence: the id being dragged, whose card vanishes at once.
        exit: (draggedId) =>
          draggedId === item.id ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, scale: 0.6, transition: { duration: 0.2 } },
      }}
      exit="exit"
      transition={itemSpring}
    >
      {editing ? (
        <textarea
          ref={inputRef}
          className="item editing"
          value={draft}
          placeholder="New item…"
          rows={2}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => finish(true)}
          onKeyDown={(e) => {
            e.stopPropagation() // keep tab shortcuts (1–9, Esc) out of typing
            if (e.nativeEvent.isComposing) return
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              finish(true)
            } else if (e.key === 'Escape') finish(false)
          }}
        />
      ) : (
        <div
          className="item card"
          tabIndex={0}
          aria-label={item.text}
          onPointerDown={onPress}
          onDoubleClick={startEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              e.stopPropagation()
              startEdit()
            }
          }}
        >
          <span className="item-text">{item.text}</span>
          <span className="grip" aria-hidden="true">
            <GripIcon />
          </span>
          <button
            type="button"
            className="edit-btn"
            aria-label="Edit item"
            onPointerDown={(e) => e.stopPropagation()} // a press here edits, never drags
            onClick={startEdit}
          >
            <PencilIcon />
          </button>
        </div>
      )}
    </motion.div>
  )
})

function GripIcon() {
  return (
    <svg width="34" height="22" viewBox="0 0 34 22" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
      <path d="M3 3h28M3 11h28M3 19h28" />
    </svg>
  )
}

function PencilIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}
