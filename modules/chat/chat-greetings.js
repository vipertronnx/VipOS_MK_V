const fs = require('fs')
const path = require('path')
const { userInputError } = require('../utils/errors')
const { createPersistenceError, writeJsonFile } = require('../utils/json-file')

const DEFAULT_GREETINGS_FILE = path.join(__dirname, '..', '..', 'config', 'greetings.json')
const DEFAULT_GREETINGS_EXAMPLE_FILE = path.join(__dirname, '..', '..', 'config', 'greetings.example.json')
const DEFAULT_SETTINGS_FILE = path.join(__dirname, '..', '..', 'config', 'greetings-settings.json')
const CONFIG_DIRECTORY = path.join(__dirname, '..', '..', 'config')
const FALLBACK_POOL = 'all'

function createGreetingService({
  greetingsFile = DEFAULT_GREETINGS_FILE,
  settingsFile = DEFAULT_SETTINGS_FILE,
  logger = console
} = {}) {
  function getStatus() {
    const catalog = loadCatalog(greetingsFile, logger)
    const activePool = resolveActivePool(catalog)

    return {
      activePool,
      file: relativePath(greetingsFile),
      pools: Object.entries(catalog.pools).map(([name, items]) => ({
        active: name === activePool,
        count: items.length,
        name
      })),
      settingsFile: relativePath(settingsFile)
    }
  }

  function pick(options = {}) {
    const file = resolveConfigJsonPath(options.file, greetingsFile)
    const catalog = loadCatalog(file, logger)
    const pool = resolvePool(catalog, options.pool || (!options.file ? readSettings().activePool : null), {
      strict: Boolean(options.pool)
    })
    const items = catalog.pools[pool]

    if (!items || !items.length) {
      throw userInputError(`Greeting pool "${pool}" is empty`)
    }

    return {
      pool,
      value: items[Math.floor(Math.random() * items.length)]
    }
  }

  function setActivePool(poolName) {
    const catalog = loadCatalog(greetingsFile, logger)
    const activePool = resolvePool(catalog, poolName, { strict: true })

    try {
      writeJsonFile(settingsFile, { activePool })
    } catch (error) {
      throw createPersistenceError('Failed to save greeting settings', error)
    }

    return getStatus()
  }

  function readSettings() {
    if (!settingsFile || !fs.existsSync(settingsFile)) return {}

    try {
      const parsed = JSON.parse(fs.readFileSync(settingsFile, 'utf8'))
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch (error) {
      if (logger && typeof logger.warn === 'function') {
        logger.warn(`Failed to load greeting settings ${settingsFile}: ${error.message}`)
      }
      return {}
    }
  }

  function resolveActivePool(catalog) {
    return resolvePool(catalog, readSettings().activePool)
  }

  return {
    getStatus,
    pick,
    setActivePool
  }
}

function loadCatalog(file, logger = console) {
  if (!file || !fs.existsSync(file)) {
    if (file === DEFAULT_GREETINGS_FILE && fs.existsSync(DEFAULT_GREETINGS_EXAMPLE_FILE)) {
      return loadCatalog(DEFAULT_GREETINGS_EXAMPLE_FILE, logger)
    }
    return { defaultPool: FALLBACK_POOL, pools: { [FALLBACK_POOL]: [] } }
  }

  try {
    return normalizeCatalog(JSON.parse(fs.readFileSync(file, 'utf8')))
  } catch (error) {
    if (logger && typeof logger.warn === 'function') {
      logger.warn(`Failed to load greeting pools ${file}: ${error.message}`)
    }
    return { defaultPool: FALLBACK_POOL, pools: { [FALLBACK_POOL]: [] } }
  }
}

function normalizeCatalog(value) {
  if (Array.isArray(value)) {
    return {
      defaultPool: FALLBACK_POOL,
      pools: { [FALLBACK_POOL]: normalizeTextList(value) }
    }
  }

  if (!value || typeof value !== 'object') {
    return { defaultPool: FALLBACK_POOL, pools: { [FALLBACK_POOL]: [] } }
  }

  const sourcePools = value.pools && typeof value.pools === 'object' && !Array.isArray(value.pools)
    ? value.pools
    : value
  const pools = {}

  for (const [name, items] of Object.entries(sourcePools)) {
    if (['activePool', 'defaultPool'].includes(name)) continue
    const normalizedName = normalizePoolName(name)
    const normalizedItems = normalizeTextList(items)
    if (normalizedName && normalizedItems.length) pools[normalizedName] = normalizedItems
  }

  if (!Object.keys(pools).length) pools[FALLBACK_POOL] = []

  return {
    defaultPool: normalizePoolName(value.defaultPool) || Object.keys(pools)[0],
    pools
  }
}

function resolvePool(catalog, poolName, options = {}) {
  const normalized = normalizePoolName(poolName)
  if (normalized && catalog.pools[normalized]) return normalized
  if (normalized && options.strict) throw userInputError(`Unknown greeting pool: ${poolName}`)
  if (catalog.defaultPool && catalog.pools[catalog.defaultPool]) return catalog.defaultPool
  return Object.keys(catalog.pools)[0] || FALLBACK_POOL
}

function normalizeTextList(value) {
  const list = Array.isArray(value) ? value : []
  return list.map(item => String(item || '').trim()).filter(Boolean)
}

function normalizePoolName(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s_]+/g, '-')
}

function resolveConfigJsonPath(value, fallback) {
  if (!value) return fallback

  const text = String(value).trim()
  if (path.isAbsolute(text)) throw userInputError('Greeting file must be relative to config')

  const configRelativePath = text.replace(/^config[\\/]/i, '')
  const resolved = path.resolve(CONFIG_DIRECTORY, configRelativePath)
  const relative = path.relative(CONFIG_DIRECTORY, resolved)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw userInputError('Greeting file must stay within config')
  }
  if (path.extname(resolved).toLowerCase() !== '.json') {
    throw userInputError('Greeting file must be a JSON file')
  }

  return resolved
}

function relativePath(filePath) {
  return path.relative(path.join(__dirname, '..', '..'), filePath).replace(/\\/g, '/')
}

module.exports = {
  createGreetingService,
  DEFAULT_GREETINGS_EXAMPLE_FILE,
  DEFAULT_GREETINGS_FILE,
  DEFAULT_SETTINGS_FILE
}
