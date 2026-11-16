import { lazy, Suspense, useCallback, useEffect, useId, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent } from 'react'
import {
  ArrowDown, ArrowUp, Check, ChevronLeft, ChevronRight, Copy, GripVertical, Layers, Minus, Plus,
  Redo2, RotateCcw, ScanSearch, Trash2, Undo2,
} from 'lucide-react'
import type { CameraCommand } from './BurgerScene'
import {
  burgerReducer, buns, categories, categoryLabels, createPreset, fillings,
  getRecipeText, getSceneLayers, loadEditor, presets, saveDraft,
} from './burger'
import type { BunId, FillingId, PresetId } from './burger'

const BurgerScene = lazy(() => import('./BurgerScene'))

type Category = (typeof categories)[number]
type Tab = 'ingredients' | 'stack'
/** Visual placement in the list, which is drawn top-of-burger first. */
type DropTarget = { id: string; side: 'above' | 'below' }
type LayerDrag = { id: string; pointerId: number; startY: number }
type SceneLayers = ReturnType<typeof getSceneLayers>
type CopyState = 'idle' | 'copied' | 'error'
type Notice = { id: number; text: string }
type PendingFocus = { id: string; control: 'up' | 'down' | 'select' } | { id: null; control: 'list' }

function newLayerId() {
  return globalThis.crypto?.randomUUID?.() ?? `layer-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const sync = () => setMatches(media.matches)
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [query])
  return matches
}

function IngredientPhoto({ id }: { id: BunId | FillingId }) {
  return (
    <img
      className="ingredient-photo"
      src={`/ingredients/${id}.jpg`}
      alt=""
      width={640}
      height={640}
      loading="lazy"
      decoding="async"
    />
  )
}

function getLayerDetails(ingredientId: string, bun: BunId) {
  return fillings[ingredientId as FillingId] ?? buns[bun]
}

/** Tiny side view of a preset: one stripe per layer, top bun first. */
function PresetGlyph({ presetId }: { presetId: PresetId }) {
  const preset = presets.find((entry) => entry.id === presetId)!
  const bun = buns[preset.bun]
  const stripes = [bun.color, ...[...preset.ingredients].reverse().map((id) => fillings[id].color), bun.color]
  return (
    <span className="preset-glyph" aria-hidden="true">
      {stripes.map((color, index) => (
        <span key={index} style={{ background: color }} data-edge={index === 0 ? 'top' : index === stripes.length - 1 ? 'bottom' : undefined} />
      ))}
    </span>
  )
}

function FlatPreview({
  layers, bun, exploded, selectedId, onSelect,
}: {
  layers: SceneLayers
  bun: BunId
  exploded: boolean
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  return (
    <div className={`flat-preview ${exploded ? 'flat-preview--exploded' : ''}`}>
      <div className="flat-preview-scroll">
        <div className="flat-stack">
          {[...layers].reverse().map((layer) => {
            const ingredient = getLayerDetails(layer.ingredientId, bun)
            const part = layer.id === 'bun-top' ? 'top' : layer.id === 'bun-bottom' ? 'bottom' : ingredient.category
            const style = { '--ingredient-color': ingredient.color, '--layer-height': `${Math.round(12 + layer.height * 75)}px` } as CSSProperties
            return (
              <button
                key={layer.id}
                type="button"
                className="flat-layer"
                data-shape={part}
                style={style}
                title={ingredient.label}
                aria-label={`${ingredient.label}${part === 'top' ? ' atas' : part === 'bottom' ? ' bawah' : ''}`}
                aria-pressed={selectedId === layer.id}
                onClick={() => onSelect(layer.id)}
              />
            )
          })}
        </div>
      </div>
      <span className="flat-grill" aria-hidden="true" />
    </div>
  )
}

function PreviewLoading() {
  return <div className="scene-loading" role="status"><span />Menyalakan panggangan…</div>
}

export default function App() {
  const [editor, dispatch] = useReducer(burgerReducer, undefined, () => loadEditor())
  const draft = editor.present
  const [category, setCategory] = useState<Category>('patty')
  const [tab, setTab] = useState<Tab>('ingredients')
  const [selection, setSelection] = useState<string | null>(null)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [exploded, setExploded] = useState(false)
  const [assemblyKey, setAssemblyKey] = useState(0)
  const [cameraCommand, setCameraCommand] = useState<CameraCommand | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const announceReady = useCallback(() => { window.dispatchEvent(new Event('bunforge:ready')) }, [])
  useEffect(() => { if (unavailable) announceReady() }, [unavailable, announceReady])
  const [copied, setCopied] = useState<CopyState>('idle')
  const [storageWorks, setStorageWorks] = useState(true)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  const [presetNotice, setPresetNotice] = useState<Notice | null>(null)
  const [addNotice, setAddNotice] = useState<Notice | null>(null)
  const [pulse, setPulse] = useState<{ id: string; serial: number } | null>(null)
  const layerDrag = useRef<LayerDrag | null>(null)
  const pendingFocus = useRef<PendingFocus | null>(null)
  const stackListRef = useRef<HTMLOListElement>(null)
  const stageRef = useRef<HTMLElement>(null)
  const rowTops = useRef(new Map<string, number>())
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ ingredients: null, stack: null })
  const nameId = useId()
  const isMobile = useMediaQuery('(max-width: 1023px)')
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const layers = useMemo(() => getSceneLayers(draft), [draft])
  const visualLayers = useMemo(() => [...layers].reverse(), [layers])
  const selectedId = layers.some((layer) => layer.id === selection) ? selection : null
  const highlightId = hoverId && layers.some((layer) => layer.id === hoverId) ? hoverId : selectedId
  const items = category === 'bun' ? Object.values(buns) : Object.values(fillings).filter((item) => item.category === category)
  const fillingCount = draft.fillings.length
  const counts = useMemo(() => {
    const result = new Map<string, number>()
    for (const { ingredientId } of draft.fillings) result.set(ingredientId, (result.get(ingredientId) ?? 0) + 1)
    return result
  }, [draft.fillings])
  const categoryCounts = useMemo(() => {
    const result = new Map<Category, number>()
    for (const { ingredientId } of draft.fillings) {
      const key = fillings[ingredientId].category
      result.set(key, (result.get(key) ?? 0) + 1)
    }
    return result
  }, [draft.fillings])
  const activePreset = presets.find((preset) => (
    draft.bun === preset.bun
    && draft.fillings.length === preset.ingredients.length
    && draft.fillings.every((layer, index) => layer.ingredientId === preset.ingredients[index])
  ))

  useEffect(() => {
    setStorageWorks(saveDraft(draft))
    setCopied('idle')
  }, [draft])

  useEffect(() => {
    if (copied === 'idle') return
    const timer = window.setTimeout(() => setCopied('idle'), 2400)
    return () => window.clearTimeout(timer)
  }, [copied])

  useEffect(() => {
    if (!addNotice) return
    const timer = window.setTimeout(() => setAddNotice(null), 2200)
    return () => window.clearTimeout(timer)
  }, [addNotice])

  useEffect(() => {
    if (!presetNotice) return
    const timer = window.setTimeout(() => setPresetNotice(null), 7000)
    return () => window.clearTimeout(timer)
  }, [presetNotice])

  // Slide rows from their old place to the new one, so a reorder in the list reads like the swap on the grill.
  useLayoutEffect(() => {
    const list = stackListRef.current
    if (!list) return
    const next = new Map<string, number>()
    list.querySelectorAll<HTMLElement>('[data-row]').forEach((row) => {
      const id = row.dataset.row!
      const top = row.offsetTop
      next.set(id, top)
      const before = rowTops.current.get(id)
      if (reducedMotion || before === undefined || tab !== 'stack') return
      const delta = before - top
      if (Math.abs(delta) < 1) return
      row.animate(
        [{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }],
        { duration: 340, easing: 'cubic-bezier(.2, .9, .25, 1.06)' },
      )
    })
    rowTops.current = next
  }, [visualLayers, tab, reducedMotion])

  // Restore keyboard focus after a row moves or disappears, since re-ordering the DOM drops focus.
  useEffect(() => {
    const target = pendingFocus.current
    pendingFocus.current = null
    if (!target) return
    const list = stackListRef.current
    if (!list) return
    if (target.id === null) {
      list.focus()
      return
    }
    const preferred = list.querySelector<HTMLButtonElement>(`[data-control="${target.control}"][data-layer="${target.id}"]`)
    const fallback = list.querySelector<HTMLButtonElement>(`[data-control="select"][data-layer="${target.id}"]`)
    const element = preferred && !preferred.disabled ? preferred : fallback
    element?.focus()
  }, [draft.fillings])

  // Keep the highlighted row in view when the selection comes from the 3D stage.
  useEffect(() => {
    if (!selectedId || tab !== 'stack') return
    const row = stackListRef.current?.querySelector<HTMLElement>(`[data-row="${selectedId}"]`)
    row?.scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' })
  }, [selectedId, tab, reducedMotion])

  const undo = useCallback(() => dispatch({ type: 'undo' }), [])
  const redo = useCallback(() => dispatch({ type: 'redo' }), [])

  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent) {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, [contenteditable="true"]')) return
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      const key = event.key.toLowerCase()
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault()
        undo()
      } else if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  const selectFromScene = useCallback((id: string) => {
    setSelection(id)
    setTab('stack')
  }, [])

  const selectUnavailable = useCallback(() => setUnavailable(true), [])

  function sendCamera(action: CameraCommand['action']) {
    setCameraCommand((previous) => ({ action, serial: (previous?.serial ?? 0) + 1 }))
  }

  function handleSceneKeys(event: KeyboardEvent<HTMLDivElement>) {
    if (unavailable || event.target !== event.currentTarget) return
    const map: Record<string, CameraCommand['action']> = { ArrowLeft: 'left', ArrowRight: 'right', '+': 'zoom-in', '=': 'zoom-in', '-': 'zoom-out', Home: 'reset' }
    const action = map[event.key]
    if (!action) return
    event.preventDefault()
    sendCamera(action)
  }

  async function copyRecipe() {
    try {
      await navigator.clipboard.writeText(getRecipeText(draft))
      setCopied('copied')
    } catch {
      setCopied('error')
    }
  }

  function applyPreset(id: PresetId) {
    const preset = presets.find((entry) => entry.id === id)
    if (!preset) return
    dispatch({ type: 'preset', draft: createPreset(id, newLayerId) })
    setAssemblyKey((value) => value + 1)
    setSelection(null)
    setExploded(false)
    setPresetNotice({ id: Date.now(), text: `${preset.label} dipasang.` })
  }

  /** Toss a copy of the ingredient photo onto the grill, so adding reads as one gesture. */
  function flyToStage(source: HTMLImageElement | null) {
    const stage = stageRef.current
    if (!source?.naturalWidth || !stage || reducedMotion) return
    const from = source.getBoundingClientRect()
    const to = stage.getBoundingClientRect()
    if (to.bottom < 40 || to.top > window.innerHeight - 40) return
    const size = Math.min(from.width, 96)
    const ghost = document.createElement('img')
    ghost.className = 'ingredient-photo fly-ghost'
    ghost.setAttribute('aria-hidden', 'true')
    ghost.src = source.currentSrc || source.src
    ghost.alt = ''
    ghost.style.width = `${size}px`
    ghost.style.left = `${from.left + (from.width - size) / 2}px`
    ghost.style.top = `${from.top + (from.height - size) / 2}px`
    document.body.appendChild(ghost)
    const dx = to.left + to.width / 2 - (from.left + from.width / 2)
    const dy = Math.max(to.top + 40, Math.min(to.bottom - 40, to.top + to.height * 0.42)) - (from.top + from.height / 2)
    const animation = ghost.animate(
      [
        { transform: 'translate(0, 0) scale(1) rotate(0deg)', opacity: 1 },
        { transform: `translate(${dx * 0.55}px, ${dy * 0.55 - 60}px) scale(.85) rotate(-8deg)`, opacity: 1, offset: 0.55 },
        { transform: `translate(${dx}px, ${dy}px) scale(.3) rotate(-14deg)`, opacity: 0 },
      ],
      { duration: 540, easing: 'cubic-bezier(.3, .7, .35, 1)' },
    )
    animation.onfinish = () => ghost.remove()
    animation.oncancel = () => ghost.remove()
  }

  function chooseIngredient(id: BunId | FillingId, event: ReactMouseEvent<HTMLButtonElement>) {
    const photo = event.currentTarget.querySelector<HTMLImageElement>('.ingredient-photo')
    if (category === 'bun') {
      if (draft.bun === id) return
      const bun = buns[id as BunId]
      dispatch({ type: 'bun', bun: id as BunId })
      flyToStage(photo)
      setAddNotice({ id: Date.now(), text: `${bun.label} dipakai` })
      return
    }
    const ingredient = fillings[id as FillingId]
    const nextCount = (counts.get(id) ?? 0) + 1
    dispatch({ type: 'add', layer: { id: newLayerId(), ingredientId: id as FillingId } })
    flyToStage(photo)
    setPulse((previous) => ({ id, serial: (previous?.serial ?? 0) + 1 }))
    setAddNotice({ id: Date.now(), text: nextCount > 1 ? `${ingredient.label} ditambahkan, sekarang ${nextCount}` : `${ingredient.label} ditambahkan` })
  }

  function moveLayer(id: string, direction: 'up' | 'down') {
    pendingFocus.current = { id, control: direction }
    dispatch({ type: 'move', id, direction })
  }

  function removeLayer(id: string) {
    const index = draft.fillings.findIndex((layer) => layer.id === id)
    const neighbour = draft.fillings[index + 1] ?? draft.fillings[index - 1]
    pendingFocus.current = neighbour ? { id: neighbour.id, control: 'select' } : { id: null, control: 'list' }
    if (selection === id) setSelection(null)
    if (hoverId === id) setHoverId(null)
    dispatch({ type: 'remove', id })
  }

  function handleRowKeys(event: KeyboardEvent<HTMLLIElement>, id: string) {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
    event.preventDefault()
    moveLayer(id, event.key === 'ArrowUp' ? 'up' : 'down')
  }

  function handleTabKeys(event: KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const next: Tab = event.key === 'Home' ? 'ingredients' : event.key === 'End' ? 'stack' : tab === 'ingredients' ? 'stack' : 'ingredients'
    setTab(next)
    tabRefs.current[next]?.focus()
  }

  function startLayerDrag(event: PointerEvent<HTMLSpanElement>, id: string) {
    if (event.button !== 0 || !event.isPrimary) return
    layerDrag.current = { id, pointerId: event.pointerId, startY: event.clientY }
    event.currentTarget.setPointerCapture(event.pointerId)
    setHoverId(id)
  }

  function getDropTarget(event: PointerEvent<HTMLSpanElement>, drag: LayerDrag): DropTarget | null {
    if (Math.abs(event.clientY - drag.startY) < 4) return null
    const row = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLLIElement>('[data-filling-layer]')
    const id = row?.dataset.fillingLayer
    if (!row || !id || id === drag.id) return null
    const bounds = row.getBoundingClientRect()
    return { id, side: event.clientY < bounds.top + bounds.height / 2 ? 'above' : 'below' }
  }

  function trackLayerDrag(event: PointerEvent<HTMLSpanElement>) {
    const drag = layerDrag.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const next = getDropTarget(event, drag)
    if (next?.id !== dropTarget?.id || next?.side !== dropTarget?.side) setDropTarget(next)
  }

  function endLayerDrag(event: PointerEvent<HTMLSpanElement>) {
    const drag = layerDrag.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const target = event.type === 'pointerup' ? getDropTarget(event, drag) : null
    // The list shows the top of the burger first, so "above" means later in the stack order.
    if (target) dispatch({ type: 'drop', id: drag.id, targetId: target.id, placement: target.side === 'above' ? 'after' : 'before' })
    layerDrag.current = null
    setDropTarget(null)
    setHoverId(null)
  }

  return (
    <div className="app">
      <header className="topbar">
        <a className="wordmark" href="#" aria-label="Bunforge, kembali ke awal">
          <img src="/brand/bunforge-mark.png" alt="" width={30} height={30} />
          <span>Bunforge</span>
        </a>
        <div className="history" role="group" aria-label="Riwayat perubahan">
          <button type="button" className="history-button" disabled={!editor.past.length} onClick={undo}
            aria-label="Batalkan" title="Batalkan (Ctrl+Z)">
            <Undo2 size={17} aria-hidden="true" /><span>Batalkan</span>
          </button>
          <button type="button" className="history-button" disabled={!editor.future.length} onClick={redo}
            aria-label="Ulangi" title="Ulangi (Ctrl+Shift+Z)">
            <Redo2 size={17} aria-hidden="true" /><span>Ulangi</span>
          </button>
        </div>
      </header>

      <main className="workspace">
        <h1 className="page-title">
          <span>Rakit Burger</span> <span>Versimu.</span>
        </h1>

        <section className="stage" aria-label="Panggung burger" ref={stageRef}>
          <div
            className="stage-viewport"
            tabIndex={unavailable ? undefined : 0}
            onKeyDown={handleSceneKeys}
            aria-label={unavailable ? 'Pratinjau 2D burger' : 'Pratinjau 3D burger. Panah kiri dan kanan untuk memutar, plus dan minus untuk zoom.'}
          >
            {unavailable ? (
              <FlatPreview layers={layers} bun={draft.bun} exploded={exploded} selectedId={highlightId} onSelect={selectFromScene} />
            ) : (
              <Suspense fallback={<PreviewLoading />}>
                <BurgerScene layers={layers} selectedId={highlightId} onSelect={selectFromScene}
                  exploded={exploded} cameraCommand={cameraCommand} assemblyKey={assemblyKey}
                  reducedMotion={reducedMotion} isMobile={isMobile} onUnavailable={selectUnavailable} onSceneReady={announceReady} />
              </Suspense>
            )}
          </div>

          <p className="stage-caption">
            <span className="stage-caption-name">{draft.name.trim() || 'Burger tanpa nama'}</span>
            <span className="stage-caption-meta">{buns[draft.bun].label}, {fillingCount} isian{unavailable ? ', mode 2D' : ''}</span>
          </p>

          <div className="stage-controls">
            <button type="button" className="explode-toggle" aria-pressed={exploded} onClick={() => setExploded(!exploded)}>
              <Layers size={17} aria-hidden="true" />
              <span>{exploded ? 'Satukan Lapisan' : 'Pisahkan Lapisan'}</span>
            </button>
            {!unavailable && (
              <div className="camera-group" role="group" aria-label="Kamera">
                <button type="button" aria-label="Putar ke kiri" title="Putar ke kiri" onClick={() => sendCamera('left')}><ChevronLeft size={18} aria-hidden="true" /></button>
                <button type="button" aria-label="Putar ke kanan" title="Putar ke kanan" onClick={() => sendCamera('right')}><ChevronRight size={18} aria-hidden="true" /></button>
                <span className="camera-divider" aria-hidden="true" />
                <button type="button" aria-label="Perkecil" title="Perkecil" onClick={() => sendCamera('zoom-out')}><Minus size={18} aria-hidden="true" /></button>
                <button type="button" aria-label="Perbesar" title="Perbesar" onClick={() => sendCamera('zoom-in')}><Plus size={18} aria-hidden="true" /></button>
                <span className="camera-divider" aria-hidden="true" />
                <button type="button" aria-label="Atur ulang sudut" title="Atur ulang sudut" onClick={() => sendCamera('reset')}><ScanSearch size={17} aria-hidden="true" /></button>
              </div>
            )}
          </div>
          {!unavailable && <p className="stage-hint" aria-hidden="true">Seret burger untuk memutar</p>}
        </section>

        <section className="editor" aria-label="Editor burger">
          <div className="presets">
            <div className="preset-row" role="group" aria-label="Mulai dari resep">
              {presets.map((preset) => {
                const active = activePreset?.id === preset.id
                return (
                  <button key={preset.id} type="button" className="preset" aria-pressed={active} onClick={() => applyPreset(preset.id)}>
                    <PresetGlyph presetId={preset.id} />
                    <span className="preset-label">{preset.label}</span>
                    {active && <Check className="preset-check" size={15} strokeWidth={3} aria-hidden="true" />}
                  </button>
                )
              })}
            </div>
            <div className="preset-notice" role="status">
              {presetNotice && (
                <span key={presetNotice.id} className="notice">
                  {presetNotice.text}
                  {editor.past.length > 0 && <button type="button" className="text-button" onClick={() => { undo(); setPresetNotice(null) }}>Batalkan</button>}
                </span>
              )}
            </div>
          </div>

          <div className="tabs" role="tablist" aria-label="Panel editor" data-active={tab} onKeyDown={handleTabKeys}>
            <button
              ref={(node) => { tabRefs.current.ingredients = node }}
              type="button" role="tab" id="tab-ingredients" aria-controls="panel-ingredients"
              aria-selected={tab === 'ingredients'} tabIndex={tab === 'ingredients' ? 0 : -1}
              onClick={() => setTab('ingredients')}
            >
              Bahan
            </button>
            <button
              ref={(node) => { tabRefs.current.stack = node }}
              type="button" role="tab" id="tab-stack" aria-controls="panel-stack"
              aria-selected={tab === 'stack'} tabIndex={tab === 'stack' ? 0 : -1}
              onClick={() => setTab('stack')}
            >
              Susunan
              <span className="tab-count" key={fillingCount} aria-label={`${fillingCount} isian`}>{fillingCount}</span>
            </button>
            <span className="tab-indicator" aria-hidden="true" />
          </div>

          <div className="panels">
            <div className="panel panel--ingredients" role="tabpanel" id="panel-ingredients" aria-labelledby="tab-ingredients" hidden={tab !== 'ingredients'}>
              <div className="categories" role="group" aria-label="Kategori bahan">
                {categories.map((option) => {
                  const used = option === 'bun' ? 0 : categoryCounts.get(option) ?? 0
                  return (
                    <button key={option} type="button" className="category" aria-pressed={category === option} onClick={() => setCategory(option)}>
                      {categoryLabels[option]}
                      {used > 0 && <span className="category-count"><span className="visually-hidden">, dipakai </span>{used}</span>}
                    </button>
                  )
                })}
              </div>

              <ul className="tray" aria-label={`Bahan ${categoryLabels[category]}`}>
                {items.map((item, index) => {
                  const isBun = category === 'bun'
                  const chosen = isBun && draft.bun === item.id
                  const count = isBun ? 0 : counts.get(item.id) ?? 0
                  const label = isBun
                    ? chosen ? `${item.label}, sedang dipakai` : `Pakai ${item.label}`
                    : `Tambah ${item.label}${count ? `, sudah ${count}` : ''}`
                  return (
                    <li key={item.id} style={{ '--i': index } as CSSProperties}>
                      <button type="button" className="tile" data-chosen={chosen || undefined} aria-pressed={isBun ? chosen : undefined}
                        aria-label={label} onClick={(event) => chooseIngredient(item.id, event)}>
                        <span className="tile-photo">
                          <IngredientPhoto id={item.id} />
                          {count > 0 && (
                            <span className="tile-count" key={pulse?.id === item.id ? pulse.serial : 'count'} data-pulse={pulse?.id === item.id || undefined} aria-hidden="true">
                              {count}
                            </span>
                          )}
                          {(!isBun || chosen) && (
                            <span className="tile-action" aria-hidden="true">
                              {isBun ? <Check size={16} strokeWidth={3} /> : <Plus size={17} strokeWidth={2.6} />}
                            </span>
                          )}
                        </span>
                        <span className="tile-name">{item.label}</span>
                        <span className="tile-description">{chosen ? 'Sedang dipakai' : item.description}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>

              <div className="add-notice" role="status" aria-live="polite">
                {addNotice && <span key={addNotice.id} className="notice"><Check size={14} aria-hidden="true" /> {addNotice.text}</span>}
              </div>
            </div>

            <div className="panel panel--stack" role="tabpanel" id="panel-stack" aria-labelledby="tab-stack" hidden={tab !== 'stack'}>
              <div className="ticket">
                <label className="ticket-name" htmlFor={nameId}>
                  <span>Nama burger</span>
                  <input id={nameId} placeholder="Beri nama burgermu" value={draft.name} maxLength={80} autoComplete="off"
                    onChange={(event) => dispatch({ type: 'name', name: event.target.value })} />
                </label>

                <p className="ticket-help">Paling atas adalah roti atas. Seret pegangan atau pakai panah untuk memindahkan lapisan.</p>

                <ol className="stack" ref={stackListRef} tabIndex={-1} aria-label="Lapisan burger, dari atas ke bawah"
                  onMouseLeave={() => { if (!layerDrag.current) setHoverId(null) }}>
                  {visualLayers.map((layer) => {
                    const position = layers.indexOf(layer)
                    const isBottom = position === 0
                    const isTop = position === layers.length - 1
                    const isBun = isBottom || isTop
                    const ingredient = getLayerDetails(layer.ingredientId, draft.bun)
                    const selected = selectedId === layer.id
                    const dropSide = dropTarget?.id === layer.id ? dropTarget.side : undefined
                    return (
                      <li
                        key={layer.id}
                        className="layer"
                        data-row={layer.id}
                        data-bun={isBun || undefined}
                        data-selected={selected || undefined}
                        data-hover={hoverId === layer.id || undefined}
                        data-drop={dropSide}
                        data-filling-layer={isBun ? undefined : layer.id}
                        onMouseEnter={() => { if (!layerDrag.current) setHoverId(layer.id) }}
                        onKeyDown={isBun ? undefined : (event) => handleRowKeys(event, layer.id)}
                      >
                        <span className="layer-index" aria-hidden="true">{position + 1}</span>
                        {isBun ? <span className="layer-grip layer-grip--fixed" aria-hidden="true" /> : (
                          <span className="layer-grip" title="Seret untuk memindahkan"
                            onPointerDown={(event) => startLayerDrag(event, layer.id)}
                            onPointerMove={trackLayerDrag}
                            onPointerUp={endLayerDrag}
                            onPointerCancel={endLayerDrag}
                            onLostPointerCapture={endLayerDrag}>
                            <GripVertical size={16} aria-hidden="true" />
                          </span>
                        )}
                        <button type="button" className="layer-select" data-control="select" data-layer={layer.id}
                          aria-pressed={selected} onClick={() => setSelection(selected ? null : layer.id)}
                          onFocus={() => setHoverId(layer.id)} onBlur={() => setHoverId(null)}
                          aria-label={`${ingredient.label}${isBun ? (isTop ? ', roti atas' : ', roti bawah') : `, lapisan ${position + 1}`}${selected ? ', disorot' : ''}`}>
                          <IngredientPhoto id={ingredient.id} />
                          <span className="layer-name">
                            {ingredient.label}
                            {isBun && <small>{isTop ? 'Roti atas' : 'Roti bawah'}</small>}
                          </span>
                          {selected && <span className="layer-flag">Disorot</span>}
                        </button>
                        {!isBun && (
                          <div className="layer-tools">
                            <button type="button" data-control="up" data-layer={layer.id} aria-label={`Naikkan ${ingredient.label}`} title="Naikkan"
                              disabled={position === layers.length - 2} onClick={() => moveLayer(layer.id, 'up')}><ArrowUp size={16} aria-hidden="true" /></button>
                            <button type="button" data-control="down" data-layer={layer.id} aria-label={`Turunkan ${ingredient.label}`} title="Turunkan"
                              disabled={position === 1} onClick={() => moveLayer(layer.id, 'down')}><ArrowDown size={16} aria-hidden="true" /></button>
                            <button type="button" className="layer-delete" aria-label={`Hapus ${ingredient.label}`} title="Hapus"
                              onClick={() => removeLayer(layer.id)}><Trash2 size={16} aria-hidden="true" /></button>
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ol>

                {fillingCount === 0 && (
                  <div className="empty">
                    <p>Belum ada isian di antara roti.</p>
                    <button type="button" className="ghost-button" onClick={() => { setCategory('patty'); setTab('ingredients'); requestAnimationFrame(() => tabRefs.current.ingredients?.focus()) }}>
                      Pilih patty pertama
                    </button>
                  </div>
                )}

                <div className="ticket-foot">
                  <button type="button" className="primary-button" onClick={copyRecipe}>
                    {copied === 'copied' ? <Check size={17} aria-hidden="true" /> : <Copy size={17} aria-hidden="true" />}
                    {copied === 'copied' ? 'Susunan disalin' : 'Salin Susunan'}
                  </button>
                  <div className="ticket-meta">
                    <span className="draft-status" role="status">
                      {copied === 'error' ? 'Gagal menyalin. Izinkan akses papan klip di browser.' : storageWorks ? 'Draf tersimpan otomatis' : 'Draf tidak bisa disimpan di browser ini'}
                    </span>
                    <button type="button" className="text-button text-button--ink" disabled={!fillingCount} onClick={() => {
                      dispatch({ type: 'reset' })
                      setSelection(null)
                      setExploded(false)
                    }}><RotateCcw size={13} aria-hidden="true" /> Kosongkan isian</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
