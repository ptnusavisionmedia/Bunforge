import { lazy, Suspense, useCallback, useEffect, useId, useMemo, useReducer, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react'
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

const thumbnailIds = [
  'brioche', 'sesame', 'potato', 'smash', 'beef',
  'chicken', 'mushroom-patty', 'cheddar', 'mozzarella', 'pepper-jack',
  'lettuce', 'tomato', 'pickle', 'onion', 'jalapeno',
  'burger-sauce', 'bbq', 'spicy-mayo', 'cheese-sauce', 'fried-onion',
  'grilled-mushroom', 'egg',
]

type Category = (typeof categories)[number]
type Tab = 'ingredients' | 'stack'
/** Visual placement in the list, which is drawn top-of-burger first. */
type DropTarget = { id: string; side: 'above' | 'below' }
type LayerDrag = { id: string; pointerId: number; startY: number }
type SceneLayers = ReturnType<typeof getSceneLayers>
type CopyState = 'idle' | 'copied' | 'error'
type Notice = { id: number; text: string; undoable?: boolean }
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

function IngredientPhoto({ id, color, className = '' }: { id: string; color: string; className?: string }) {
  const index = thumbnailIds.indexOf(id)
  const style = {
    '--sprite-x': `${Math.max(index % 5, 0) * 25}%`,
    '--sprite-y': `${Math.max(Math.floor(index / 5), 0) * 25}%`,
    '--ingredient-color': color,
  } as CSSProperties

  return <span aria-hidden="true" className={`ingredient-photo ${className}`} style={style} />
}

function getLayerDetails(ingredientId: string, bun: BunId) {
  return fillings[ingredientId as FillingId] ?? buns[bun]
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
  return <div className="scene-loading" role="status"><span />Menyiapkan panggangan…</div>
}

export default function App() {
  const [editor, dispatch] = useReducer(burgerReducer, undefined, () => loadEditor())
  const draft = editor.present
  const [category, setCategory] = useState<Category>('patty')
  const [tab, setTab] = useState<Tab>('ingredients')
  const [selection, setSelection] = useState<string | null>(null)
  const [exploded, setExploded] = useState(false)
  const [assemblyKey, setAssemblyKey] = useState(0)
  const [cameraCommand, setCameraCommand] = useState<CameraCommand | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [copied, setCopied] = useState<CopyState>('idle')
  const [storageWorks, setStorageWorks] = useState(true)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  const [presetNotice, setPresetNotice] = useState<Notice | null>(null)
  const [addNotice, setAddNotice] = useState<Notice | null>(null)
  const [pulse, setPulse] = useState<{ id: string; serial: number } | null>(null)
  const layerDrag = useRef<LayerDrag | null>(null)
  const pendingFocus = useRef<PendingFocus | null>(null)
  const stackListRef = useRef<HTMLOListElement>(null)
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ ingredients: null, stack: null })
  const nameId = useId()
  const isMobile = useMediaQuery('(max-width: 1023px)')
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const layers = useMemo(() => getSceneLayers(draft), [draft])
  const selectedId = layers.some((layer) => layer.id === selection) ? selection : null
  const items = category === 'bun' ? Object.values(buns) : Object.values(fillings).filter((item) => item.category === category)
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
    const action = ({ ArrowLeft: 'left', ArrowRight: 'right', '+': 'zoom-in', '=': 'zoom-in', '-': 'zoom-out', Home: 'reset' } as const)[
      event.key as 'ArrowLeft' | 'ArrowRight' | '+' | '=' | '-' | 'Home'
    ]
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
    setPresetNotice({ id: Date.now(), text: `${preset.label} dipasang.`, undoable: true })
  }

  function undoPreset() {
    undo()
    setPresetNotice(null)
  }

  function chooseIngredient(id: BunId | FillingId) {
    if (category === 'bun') {
      const bun = buns[id as BunId]
      dispatch({ type: 'bun', bun: id as BunId })
      setSelection('bun-top')
      setAddNotice({ id: Date.now(), text: `${bun.label} dipakai` })
      return
    }
    const ingredient = fillings[id as FillingId]
    const nextCount = (counts.get(id) ?? 0) + 1
    dispatch({ type: 'add', layer: { id: newLayerId(), ingredientId: id as FillingId } })
    setPulse((previous) => ({ id, serial: (previous?.serial ?? 0) + 1 }))
    setAddNotice({ id: Date.now(), text: nextCount > 1 ? `${ingredient.label} ditambahkan · ${nextCount}×` : `${ingredient.label} ditambahkan` })
  }

  function moveLayer(id: string, direction: 'up' | 'down') {
    pendingFocus.current = { id, control: direction }
    dispatch({ type: 'move', id, direction })
  }

  function removeLayer(id: string) {
    const index = draft.fillings.findIndex((layer) => layer.id === id)
    // Focus the layer that takes its visual place: the one above it, otherwise the one below.
    const neighbour = draft.fillings[index + 1] ?? draft.fillings[index - 1]
    pendingFocus.current = neighbour ? { id: neighbour.id, control: 'select' } : { id: null, control: 'list' }
    if (selection === id) setSelection(null)
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
  }

  const visualLayers = [...layers].reverse()
  const fillingCount = draft.fillings.length

  return (
    <div className="app">
      <header className="topbar">
        <a className="wordmark" href="#" aria-label="Bunforge, kembali ke awal">
          <img src="/brand/bunforge-mark.png" alt="" width={30} height={30} />
          <span>BUN<b>FORGE</b></span>
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
        <h1 className="page-title">Rakit Burger <em>Versimu.</em></h1>

        <section className="stage" aria-label="Panggung burger">
          <div
            className="stage-viewport"
            tabIndex={unavailable ? undefined : 0}
            onKeyDown={handleSceneKeys}
            aria-label={unavailable ? 'Pratinjau 2D burger' : 'Pratinjau 3D burger. Panah kiri dan kanan untuk memutar, plus dan minus untuk zoom.'}
          >
            {unavailable ? (
              <FlatPreview layers={layers} bun={draft.bun} exploded={exploded} selectedId={selectedId} onSelect={selectFromScene} />
            ) : (
              <Suspense fallback={<PreviewLoading />}>
                <BurgerScene layers={layers} selectedId={selectedId} onSelect={selectFromScene}
                  exploded={exploded} cameraCommand={cameraCommand} assemblyKey={assemblyKey}
                  reducedMotion={reducedMotion} isMobile={isMobile} onUnavailable={selectUnavailable} />
              </Suspense>
            )}
          </div>

          <p className="stage-caption">
            <span className="stage-caption-name">{draft.name.trim() || buns[draft.bun].label}</span>
            <span>{fillingCount} isian{unavailable ? ' · mode 2D' : ''}</span>
          </p>

          <div className="stage-controls">
            <button type="button" className="explode-toggle" aria-pressed={exploded} onClick={() => setExploded(!exploded)}>
              <Layers size={17} aria-hidden="true" />
              <span>{exploded ? 'Satukan Lapisan' : 'Pisahkan Lapisan'}</span>
            </button>
            {!unavailable && (
              <div className="camera-group" role="group" aria-label="Kamera">
                <span className="camera-hint">Seret untuk memutar</span>
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
        </section>

        <section className="editor" aria-label="Editor burger">
          <div className="presets">
            <h2 className="eyebrow" id="presets-title">Mulai cepat</h2>
            <div className="preset-row" role="group" aria-labelledby="presets-title">
              {presets.map((preset) => {
                const active = activePreset?.id === preset.id
                return (
                  <button key={preset.id} type="button" className="preset" aria-pressed={active} onClick={() => applyPreset(preset.id)}>
                    {active && <Check size={14} strokeWidth={3} aria-hidden="true" />}
                    {preset.label}
                  </button>
                )
              })}
            </div>
            <div className="preset-notice" role="status">
              {presetNotice && (
                <>
                  <span>{presetNotice.text}</span>
                  {presetNotice.undoable && editor.past.length > 0 && (
                    <button type="button" className="text-button" onClick={undoPreset}>Batalkan</button>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="tabs" role="tablist" aria-label="Panel editor" onKeyDown={handleTabKeys}>
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
          </div>

          <div className="panels">
            <div className="panel" role="tabpanel" id="panel-ingredients" aria-labelledby="tab-ingredients" hidden={tab !== 'ingredients'}>
              <div className="categories" role="group" aria-label="Kategori bahan">
                {categories.map((option) => {
                  const used = option === 'bun' ? 0 : categoryCounts.get(option) ?? 0
                  return (
                    <button key={option} type="button" className="category" aria-pressed={category === option} onClick={() => setCategory(option)}>
                      {categoryLabels[option]}
                      {used > 0 && <span className="category-count" aria-label={`, ${used} dipakai`}>{used}</span>}
                    </button>
                  )
                })}
              </div>

              <div className="add-notice" role="status" aria-live="polite">
                {addNotice && <span key={addNotice.id}><Check size={14} aria-hidden="true" /> {addNotice.text}</span>}
              </div>

              <ul className="catalog">
                {items.map((item) => {
                  const isBun = category === 'bun'
                  const chosen = isBun && draft.bun === item.id
                  const count = isBun ? 0 : counts.get(item.id) ?? 0
                  return (
                    <li key={item.id} className="catalog-item" data-chosen={chosen || undefined}>
                      <IngredientPhoto id={item.id} color={item.color} />
                      <div className="catalog-text">
                        <span className="catalog-name">
                          {item.label}
                          {count > 0 && (
                            <span className="catalog-count" key={pulse?.id === item.id ? pulse.serial : 'count'} data-pulse={pulse?.id === item.id || undefined}>
                              {count}× dipakai
                            </span>
                          )}
                          {chosen && <span className="catalog-count">Dipakai</span>}
                        </span>
                        <span className="catalog-description">{item.description}</span>
                      </div>
                      {isBun ? (
                        <button type="button" className="add-button" data-variant={chosen ? 'chosen' : 'pick'} aria-pressed={chosen}
                          aria-label={chosen ? `${item.label} sedang dipakai` : `Pakai ${item.label}`} onClick={() => chooseIngredient(item.id)}>
                          {chosen ? <><Check size={16} aria-hidden="true" /> Terpasang</> : 'Pakai'}
                        </button>
                      ) : (
                        <button type="button" className="add-button" aria-label={`Tambah ${item.label}`} onClick={() => chooseIngredient(item.id)}>
                          <Plus size={16} aria-hidden="true" /> Tambah
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>

            <div className="panel" role="tabpanel" id="panel-stack" aria-labelledby="tab-stack" hidden={tab !== 'stack'}>
              <p className="stack-help">
                Urutan sama dengan burger: paling atas di sini adalah roti atas. Seret <GripVertical size={13} aria-hidden="true" /> atau pakai panah untuk memindahkan.
              </p>
              <ol className="stack" ref={stackListRef} tabIndex={-1} aria-label="Lapisan burger, dari atas ke bawah">
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
                      data-drop={dropSide}
                      data-filling-layer={isBun ? undefined : layer.id}
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
                        aria-label={`${ingredient.label}${isBun ? (isTop ? ', roti atas' : ', roti bawah') : `, lapisan ${position + 1}`}${selected ? ', disorot' : ''}`}>
                        <IngredientPhoto id={ingredient.id} color={ingredient.color} />
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
            </div>
          </div>

          <div className="finish">
            <label className="name-field" htmlFor={nameId}>
              <span>Nama burger</span>
              <input id={nameId} placeholder="Smash Buatanku" value={draft.name} maxLength={80} autoComplete="off"
                onChange={(event) => dispatch({ type: 'name', name: event.target.value })} />
            </label>
            <button type="button" className="primary-button" onClick={copyRecipe}>
              {copied === 'copied' ? <Check size={17} aria-hidden="true" /> : <Copy size={17} aria-hidden="true" />}
              {copied === 'copied' ? 'Tersalin' : 'Salin Susunan'}
            </button>
            <div className="finish-meta">
              <span className="draft-status" role="status">
                {copied === 'error' ? 'Gagal menyalin. Izinkan akses papan klip.' : storageWorks ? 'Draf tersimpan otomatis' : 'Draf tidak bisa disimpan di browser ini'}
              </span>
              <button type="button" className="text-button" disabled={!fillingCount} onClick={() => {
                dispatch({ type: 'reset' })
                setSelection(null)
                setExploded(false)
              }}><RotateCcw size={13} aria-hidden="true" /> Kosongkan isian</button>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
