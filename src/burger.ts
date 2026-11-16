export const categories = ['bun', 'patty', 'cheese', 'vegetable', 'sauce', 'topping'] as const
export type CategoryId = typeof categories[number]

export const categoryLabels: Record<CategoryId, string> = {
  bun: 'Roti',
  patty: 'Patty',
  cheese: 'Keju',
  vegetable: 'Sayuran',
  sauce: 'Saus',
  topping: 'Topping',
}

type IngredientInfo = {
  id: string
  label: string
  description: string
  category: CategoryId
  color: string
}

export const buns = {
  brioche: {
    id: 'brioche', label: 'Roti Brioche', description: 'Lembut, manis, dan mengilap',
    category: 'bun', color: '#da8a32', topHeight: 0.61, bottomHeight: 0.29,
  },
  sesame: {
    id: 'sesame', label: 'Roti Wijen', description: 'Panggang keemasan dengan wijen',
    category: 'bun', color: '#c8843f', topHeight: 0.61, bottomHeight: 0.29,
  },
  potato: {
    id: 'potato', label: 'Roti Kentang', description: 'Empuk dengan rasa kentang',
    category: 'bun', color: '#eaae50', topHeight: 0.57, bottomHeight: 0.28,
  },
} as const satisfies Record<string, IngredientInfo & { topHeight: number; bottomHeight: number }>

export const fillings = {
  smash: {
    id: 'smash', label: 'Smash Beef', description: 'Tipis dengan pinggiran garing',
    category: 'patty', color: '#794029', height: 0.23,
  },
  beef: {
    id: 'beef', label: 'Patty Sapi Tebal', description: 'Tebal dengan jejak panggangan',
    category: 'patty', color: '#884531', height: 0.36,
  },
  chicken: {
    id: 'chicken', label: 'Ayam Crispy', description: 'Balutan tepung renyah',
    category: 'patty', color: '#c98135', height: 0.33,
  },
  'mushroom-patty': {
    id: 'mushroom-patty', label: 'Patty Jamur', description: 'Jamur gurih yang dipanggang',
    category: 'patty', color: '#8b6040', height: 0.27,
  },
  cheddar: {
    id: 'cheddar', label: 'Cheddar Leleh', description: 'Lembut dengan rasa tajam',
    category: 'cheese', color: '#ffb02e', height: 0.08,
  },
  mozzarella: {
    id: 'mozzarella', label: 'Mozzarella', description: 'Keju putih yang lembut',
    category: 'cheese', color: '#f7e8ba', height: 0.10,
  },
  'pepper-jack': {
    id: 'pepper-jack', label: 'Pepper Jack', description: 'Keju lembut berbintik cabai',
    category: 'cheese', color: '#e5c78f', height: 0.10,
  },
  lettuce: {
    id: 'lettuce', label: 'Selada Keriting', description: 'Renyah dengan tepi bergelombang',
    category: 'vegetable', color: '#79a241', height: 0.17,
  },
  tomato: {
    id: 'tomato', label: 'Tomat', description: 'Irisan tebal, segar, dan berair',
    category: 'vegetable', color: '#e3432a', height: 0.18,
  },
  pickle: {
    id: 'pickle', label: 'Acar', description: 'Irisan bergelombang yang asam segar',
    category: 'vegetable', color: '#80963c', height: 0.11,
  },
  onion: {
    id: 'onion', label: 'Bawang Merah', description: 'Irisan cincin yang renyah',
    category: 'vegetable', color: '#a75c87', height: 0.10,
  },
  jalapeno: {
    id: 'jalapeno', label: 'Jalapeño', description: 'Cabai hijau dengan rasa pedas segar',
    category: 'vegetable', color: '#537c34', height: 0.09,
  },
  'burger-sauce': {
    id: 'burger-sauce', label: 'Saus Burger', description: 'Kental, gurih, dan sedikit asam',
    category: 'sauce', color: '#d99873', height: 0.07,
  },
  bbq: {
    id: 'bbq', label: 'Saus BBQ', description: 'Manis dengan aroma asap',
    category: 'sauce', color: '#873b29', height: 0.07,
  },
  'spicy-mayo': {
    id: 'spicy-mayo', label: 'Mayo Pedas', description: 'Mayones lembut dengan cabai',
    category: 'sauce', color: '#f08a55', height: 0.07,
  },
  'cheese-sauce': {
    id: 'cheese-sauce', label: 'Saus Keju', description: 'Keju kuning yang lumer',
    category: 'sauce', color: '#efac41', height: 0.07,
  },
  'fried-onion': {
    id: 'fried-onion', label: 'Bawang Goreng', description: 'Taburan bawang yang garing',
    category: 'topping', color: '#b16835', height: 0.14,
  },
  'grilled-mushroom': {
    id: 'grilled-mushroom', label: 'Jamur Panggang', description: 'Irisan lembut dengan aroma panggangan',
    category: 'topping', color: '#9b785e', height: 0.18,
  },
  egg: {
    id: 'egg', label: 'Telur Mata Sapi', description: 'Kuning telur lembut dengan tepi garing',
    category: 'topping', color: '#efb332', height: 0.19,
  },
} as const satisfies Record<string, IngredientInfo & { height: number }>

export type BunId = keyof typeof buns
export type FillingId = keyof typeof fillings

export const presets = [
  { id: 'classic', label: 'Smash Klasik', bun: 'sesame', ingredients: ['burger-sauce', 'smash', 'cheddar', 'pickle', 'onion'] },
  { id: 'spicy', label: 'Ayam Pedas', bun: 'brioche', ingredients: ['spicy-mayo', 'lettuce', 'chicken', 'jalapeno'] },
  { id: 'blank', label: 'Mulai dari Roti', bun: 'brioche', ingredients: [] },
] as const satisfies readonly { id: string; label: string; bun: BunId; ingredients: readonly FillingId[] }[]

export type PresetId = typeof presets[number]['id']
export type FillingLayer = { id: string; ingredientId: FillingId }
export type BurgerDraft = { name: string; bun: BunId; fillings: FillingLayer[] }
export type EditorState = { past: BurgerDraft[]; present: BurgerDraft; future: BurgerDraft[] }

export type BurgerAction =
  | { type: 'add'; layer: FillingLayer }
  | { type: 'remove'; id: string }
  | { type: 'move'; id: string; direction: 'up' | 'down' }
  | { type: 'drop'; id: string; targetId: string; placement: 'before' | 'after' }
  | { type: 'bun'; bun: BunId }
  | { type: 'preset'; draft: BurgerDraft }
  | { type: 'name'; name: string }
  | { type: 'undo' | 'redo' | 'reset' }

export const BOTTOM_BUN_ID = 'bun-bottom'
export const TOP_BUN_ID = 'bun-top'

export type BunModelId = `${BunId}-${'bottom' | 'top'}`
export type SceneLayer = { id: string; ingredientId: FillingId | BunModelId; height: number }

export function createPreset(id: PresetId, createId: () => string): BurgerDraft {
  const preset = presets.find((entry) => entry.id === id) ?? presets[0]

  return {
    name: '',
    bun: preset.bun,
    fillings: (preset.ingredients as readonly FillingId[]).map((ingredientId) => ({ id: createId(), ingredientId })),
  }
}

export function getSceneLayers(draft: BurgerDraft): SceneLayer[] {
  const bun = buns[draft.bun]
  return [
    { id: BOTTOM_BUN_ID, ingredientId: `${bun.id}-bottom`, height: bun.bottomHeight },
    ...draft.fillings.map((layer) => ({ ...layer, height: fillings[layer.ingredientId].height })),
    { id: TOP_BUN_ID, ingredientId: `${bun.id}-top`, height: bun.topHeight },
  ]
}

function commit(state: EditorState, present: BurgerDraft): EditorState {
  return { past: [...state.past, state.present], present, future: [] }
}

function relocate(layers: FillingLayer[], from: number, to: number) {
  if (from === to || from < 0 || to < 0 || to >= layers.length) return layers

  const moved = [...layers]
  const [layer] = moved.splice(from, 1)
  moved.splice(to, 0, layer)
  return moved
}

function isFillingLayerId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id !== BOTTOM_BUN_ID && id !== TOP_BUN_ID
}

export function burgerReducer(state: EditorState, action: BurgerAction): EditorState {
  const { present, past, future } = state

  function updateLayers(nextFillings: FillingLayer[]) {
    return nextFillings === present.fillings ? state : commit(state, { ...present, fillings: nextFillings })
  }

  switch (action.type) {
    case 'add': {
      if (!isFillingLayerId(action.layer.id) || present.fillings.some(({ id }) => id === action.layer.id)) return state
      return updateLayers([...present.fillings, action.layer])
    }
    case 'remove': {
      const nextFillings = present.fillings.filter(({ id }) => id !== action.id)
      return nextFillings.length === present.fillings.length ? state : updateLayers(nextFillings)
    }
    case 'move': {
      const from = present.fillings.findIndex(({ id }) => id === action.id)
      const step = action.direction === 'up' ? 1 : -1
      return updateLayers(relocate(present.fillings, from, from + step))
    }
    case 'drop': {
      if (action.id === action.targetId) return state
      const from = present.fillings.findIndex(({ id }) => id === action.id)
      const target = present.fillings.findIndex(({ id }) => id === action.targetId)
      if (from < 0 || target < 0) return state

      const targetAfterRemoval = from < target ? target - 1 : target
      const to = action.placement === 'before' ? targetAfterRemoval : targetAfterRemoval + 1
      return updateLayers(relocate(present.fillings, from, to))
    }
    case 'bun':
      return action.bun === present.bun ? state : commit(state, { ...present, bun: action.bun })
    case 'preset':
      return commit(state, { ...action.draft, name: present.name })
    case 'reset':
      return present.fillings.length ? updateLayers([]) : state
    case 'name':
      return action.name === present.name ? state : { ...state, present: { ...present, name: action.name } }
    case 'undo': {
      const previous = past.at(-1)
      if (!previous) return state
      return {
        past: past.slice(0, -1),
        present: { ...previous, name: present.name },
        future: [present, ...future],
      }
    }
    case 'redo': {
      const [next, ...remaining] = future
      if (!next) return state
      return {
        past: [...past, present],
        present: { ...next, name: present.name },
        future: remaining,
      }
    }
  }
}

const STORAGE_KEY = 'flame-stack-draft'
const DRAFT_VERSION = 1

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isBunId(value: unknown): value is BunId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(buns, value)
}

function isFillingId(value: unknown): value is FillingId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(fillings, value)
}

function readDraft(): BurgerDraft | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return null
    const value: unknown = JSON.parse(stored)
    if (!isRecord(value) || value.version !== DRAFT_VERSION || !isRecord(value.draft)) return null

    const { bun, name, fillings: storedFillings } = value.draft
    if (!isBunId(bun) || !Array.isArray(storedFillings)) return null

    const ids = new Set<string>()
    const validFillings: FillingLayer[] = []

    for (const layer of storedFillings as unknown[]) {
      if (!isRecord(layer) || !isFillingLayerId(layer.id) || !isFillingId(layer.ingredientId) || ids.has(layer.id)) continue
      ids.add(layer.id)
      validFillings.push({ id: layer.id, ingredientId: layer.ingredientId })
    }

    return { name: typeof name === 'string' ? name : '', bun, fillings: validFillings }
  } catch {
    return null
  }
}

export function loadEditor(): EditorState {
  let sampleLayer = 0
  const present = readDraft() ?? createPreset('classic', () => `sample-${++sampleLayer}`)
  return { past: [], present, future: [] }
}

export function saveDraft(draft: BurgerDraft): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: DRAFT_VERSION, draft }))
    return true
  } catch {
    return false
  }
}

export function getRecipeText(draft: BurgerDraft): string {
  const bun = buns[draft.bun].label
  const labels = [
    `${bun} (bawah)`,
    ...draft.fillings.map(({ ingredientId }) => fillings[ingredientId].label),
    `${bun} (atas)`,
  ]

  return [draft.name.trim() || 'Burger Kreasiku', '', 'Susunan dari bawah ke atas', ...labels.map((label, index) => `${index + 1}. ${label}`)].join('\n')
}
