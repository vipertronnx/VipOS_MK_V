const fs = require('fs')
const path = require('path')
const { normalizeCompletionDelay } = require('./completion-delay')
const { asArray } = require('./value-normalization')

const DEFAULT_MACROS_FILE = path.join(__dirname, '..', '..', 'config', 'macros.json')
const DEFAULT_MACROS_EXAMPLE_FILE = path.join(__dirname, '..', '..', 'config', 'macros.example.json')

const FALLBACK_MACROS = [
  {
    id: 'test-alert',
    name: 'Test Alert',
    description: 'Send a quick overlay and sound check.',
    actions: [
      { type: 'overlay.alert', message: 'VipOS MK V test alert' },
      { type: 'sound.play', src: 'example.mp3', volume: 1 }
    ]
  },
  {
    id: 'random-sfx',
    name: 'Random SFX',
    description: 'Pick a random local sound effect and show its label.',
    actions: [
      { type: 'sound.pickRandom', contextKey: 'sfx' },
      { type: 'overlay.alert', message: '{sfx.text}' },
      { type: 'sound.play', src: '{sfx.src}', volume: 0.8 }
    ]
  },
  {
    id: 'reset-border',
    name: 'Reset Border',
    description: 'Reset the stream border overlay.',
    actions: [
      { type: 'overlay.emit', event: 'bg-reset' }
    ]
  }
]

function createMacroService({
  macrosFile = DEFAULT_MACROS_FILE,
  logger = console
} = {}) {
  function list() {
    return loadMacros(macrosFile, logger)
  }

  function find(id) {
    const macroId = normalizeId(id)
    return list().find(macro => macro.id === macroId) || null
  }

  return {
    find,
    list
  }
}

function loadMacros(file, logger = console) {
  const source = resolveMacroSource(file)
  if (!source) return FALLBACK_MACROS

  try {
    const parsed = JSON.parse(fs.readFileSync(source, 'utf8'))
    const macros = normalizeMacros(parsed)
    return macros.length ? macros : FALLBACK_MACROS
  } catch (error) {
    if (logger && typeof logger.warn === 'function') {
      logger.warn(`Failed to load macros ${source}: ${error.message}`)
    }
    return FALLBACK_MACROS
  }
}

function resolveMacroSource(file) {
  if (file && fs.existsSync(file)) return file
  if (fs.existsSync(DEFAULT_MACROS_EXAMPLE_FILE)) return DEFAULT_MACROS_EXAMPLE_FILE
  return null
}

function normalizeMacros(value) {
  const list = Array.isArray(value) ? value : asArray(value && value.macros)

  return list
    .map(normalizeMacro)
    .filter(Boolean)
}

function normalizeMacro(macro) {
  if (!macro || typeof macro !== 'object' || macro.enabled === false) return null
  const actions = macro.actions || macro.action
  if (!actions) return null

  const name = String(macro.name || macro.label || macro.id || '').trim()
  const id = normalizeId(macro.id || name)
  const delayValue = macro.completionDelayMs ?? macro.delayMs ?? macro.queueDelayMs
  if (!id || !name) return null

  return {
    id,
    name,
    description: String(macro.description || macro.help || '').trim(),
    completionDelayMs: delayValue === undefined ? undefined : normalizeCompletionDelay(delayValue),
    actions
  }
}

function normalizeId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

module.exports = {
  createMacroService,
  DEFAULT_MACROS_EXAMPLE_FILE,
  DEFAULT_MACROS_FILE
}
