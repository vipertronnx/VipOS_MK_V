const fs = require('fs')
const path = require('path')
const { getAudioDurationMs } = require('../utils/audio-duration')
const { userInputError } = require('../utils/errors')
const { createGreetingService } = require('./greetings')
const { asArray } = require('../utils/value-normalization')

const DEFAULT_SOUND_DIRECTORY = path.join(__dirname, '..', '..', 'public', 'assets', 'sounds')
const DEFAULT_SOUND_TEXT_FILE = path.join(__dirname, '..', '..', 'config', 'sfx-text.json')
const DEFAULT_SOUND_TEXT_EXAMPLE_FILE = path.join(__dirname, '..', '..', 'config', 'examples', 'sfx-text.example.json')
const DEFAULT_ALERT_SOUND = 'example.mp3'
const MAX_ACTION_DELAY_MS = 10 * 60 * 1000
const SOUND_LIST_CACHE_TTL_MS = 5000
const DEFAULT_LARGE_SOUND_WARNING_BYTES = 25 * 1024 * 1024
const SOUND_FILE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9 _.-]*\.(mp3|ogg|wav)$/i
const SOUND_PATH_PATTERN = /^(?:[a-zA-Z0-9][a-zA-Z0-9 _.-]*\/)*[a-zA-Z0-9][a-zA-Z0-9 _.-]*\.(mp3|ogg|wav)$/i
const ACTION_DEFINITIONS = {
  'chat.say': { execute: executeChatSay, requiredFields: [['message', 'text']] },
  'context.pickRandom': { execute: executeContextPickRandom, requiredFields: [['contextKey', 'key']] },
  delay: { execute: executeDelay, requiredFields: [] },
  log: { execute: executeLog, requiredFields: [] },
  'obs.media': { execute: executeObsMedia, requiredFields: [['input', 'source'], ['mediaAction', 'media', 'command']] },
  'obs.mute': { execute: executeObsMute, requiredFields: [['input', 'source']] },
  'obs.scene': { execute: executeObsScene, requiredFields: [['scene']] },
  'obs.source': { execute: executeObsSource, requiredFields: [['source', 'input']] },
  'overlay.alert': { execute: executeOverlayAlert, quietable: true, requiredFields: [['message']] },
  'overlay.emit': { execute: executeOverlayEmit, quietable: true, requiredFields: [['event']] },
  'sound.pickRandom': { execute: executeSoundPickRandom, quietable: true, requiredFields: [], sound: true },
  'sound.play': { execute: executeSoundPlay, quietable: true, requiredFields: [['src', 'path']], sound: true }
}

const soundListCache = new Map()

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Validates a relative local sound path without permitting traversal or unsupported extensions.
 *
 * @param {*} src Candidate path using forward-slash directory separators.
 * @returns {string|null} Trimmed MP3, OGG, or WAV path, or `null` when invalid.
 */
function validateSoundSrc(src) {
  if (typeof src !== 'string') return null

  const normalized = src.trim()
  if (!normalized) return null
  if (!SOUND_PATH_PATTERN.test(normalized)) return null

  return normalized
}

/**
 * Recursively scans supported sounds for the control interface and caches the resulting metadata.
 *
 * @param {object} [options] Sound directory, cache, warning, and logging settings.
 * @param {string} [options.soundDirectory] Root directory containing local sound assets.
 * @param {number} [options.cacheTtlMs=5000] List-cache lifetime in milliseconds; non-positive values force a directory rescan while unchanged duration entries may remain cached.
 * @param {number} [options.largeSoundWarningBytes=26214400] File size in bytes above which duration reads emit a warning.
 * @returns {Array<object>} Sorted metadata with relative source paths and `durationMs: null` when duration detection fails.
 */
function listSoundFiles({
  cacheTtlMs = SOUND_LIST_CACHE_TTL_MS,
  largeSoundWarningBytes = DEFAULT_LARGE_SOUND_WARNING_BYTES,
  soundDirectory = DEFAULT_SOUND_DIRECTORY,
  logger = console
} = {}) {
  const resolvedSoundDirectory = path.resolve(soundDirectory)
  const cached = soundListCache.get(resolvedSoundDirectory)
  const now = Date.now()

  if (cached && cacheTtlMs > 0 && now - cached.loadedAt < cacheTtlMs) {
    return cloneSoundList(cached.sounds)
  }

  const sounds = []
  const durationCache = cached ? cached.durationCache : new Map()
  collectSoundFiles(resolvedSoundDirectory, '', sounds, logger, durationCache, largeSoundWarningBytes)
  sounds.sort((a, b) => a.src.localeCompare(b.src))

  soundListCache.set(resolvedSoundDirectory, {
    durationCache,
    loadedAt: now,
    sounds
  })

  return cloneSoundList(sounds)
}

/**
 * Creates the action dispatcher used by chat automation, macros, and manual control routes.
 *
 * @param {object} options Runtime services and configurable local asset dependencies.
 * @param {object} options.io Socket server used for overlay and sound events.
 * @param {object} options.obs OBS service used by OBS action types.
 * @returns {{run: Function, setChatService: Function, validateStructure: Function}} Action execution API.
 */
function createActionRunner({
  io,
  obs,
  logger = console,
  greetings = createGreetingService({ logger }),
  quietMode = null,
  defaultAlertSound = process.env.DEFAULT_ALERT_SOUND || DEFAULT_ALERT_SOUND,
  largeSoundWarningBytes = DEFAULT_LARGE_SOUND_WARNING_BYTES,
  soundDirectory = DEFAULT_SOUND_DIRECTORY,
  soundTextFile = DEFAULT_SOUND_TEXT_FILE,
  waitForDelay = wait,
  overlayEmit = (event, payload) => io.emit(event, payload)
}) {
  let chatService = null
  const runtime = {
    defaultAlertSound,
    getChatService: () => chatService,
    greetings,
    io,
    largeSoundWarningBytes,
    logger,
    obs,
    overlayEmit,
    soundDirectory,
    soundTextFile,
    waitForDelay
  }

  function setChatService(service) {
    chatService = service
  }

  /**
   * Validates and executes actions sequentially against a shared context that picker actions may extend.
   * Depending on action type, execution can wait, send chat or OBS requests, emit socket events, and read local sound configuration.
   *
   * @param {object|Array<object>} actions One action or ordered action list.
   * @param {object} [context={}] Event data available to placeholders and context-picking actions.
   * @returns {Promise<Array<object>>} Results in the same order as the executed actions.
   * @throws {Error} Rejects when an action is invalid or its executor fails.
   */
  async function run(actions, context = {}) {
    const actionList = validateActionStructure(actions)
    const hasExplicitSoundAction = actionList.some(isSoundAction)
    const results = []

    for (const action of actionList) {
      results.push(await runOne(action, context, { hasExplicitSoundAction }))
    }

    return results
  }

  async function runOne(action, context, options = {}) {
    if (!action || typeof action !== 'object') {
      throw new Error('Action must be an object')
    }

    const type = action.type || action.action
    if (!type) throw new Error('Action type is required')

    if (shouldSuppressAction(type, context, quietMode)) {
      return { type, suppressed: true, reason: 'quiet-mode' }
    }

    const definition = getActionDefinition(type)
    if (!definition) throw new Error(`Unknown action type: ${type}`)
    return definition.execute(action, context, options, runtime)
  }

  return {
    run,
    setChatService,
    validateStructure: validateActionStructure
  }
}

async function executeChatSay(action, context, options, runtime) {
  const chatService = runtime.getChatService()
  if (!chatService) throw new Error('Twitch chat is not configured')
  const message = hydrate(action.message || action.text, context)
  if (!message) throw new Error('chat.say requires a message')

  const explicitReplyId = hydrate(action.replyParentMessageId || action.replyTo, context)
  const replyParentMessageId = explicitReplyId || (parseToggle(action.reply) === true ? context.messageId : undefined)
  const sent = await chatService.say(message, { replyParentMessageId, simulated: context.simulated })
  return { type: 'chat.say', message, ...sent }
}

function executeContextPickRandom(action, context, options, runtime) {
  const contextKey = hydrate(action.contextKey || action.key, context)
  if (!isSafeContextPath(contextKey)) {
    throw userInputError('context.pickRandom requires a safe contextKey')
  }

  const configuredItems = action.items || action.values || action.list
  const picked = configuredItems
    ? pickInlineItem(hydrate(asArray(configuredItems), context))
    : runtime.greetings.pick({
      file: hydrate(action.file || action.path, context),
      pool: hydrate(action.pool || action.theme || action.category, context)
    })
  const value = picked.value
  setPath(context, contextKey, value)

  return { type: 'context.pickRandom', contextKey, ...picked }
}

async function executeDelay(action, context, options, runtime) {
  const ms = normalizeActionDelay(action.ms ?? action.duration ?? 0)
  if (ms > 0) await runtime.waitForDelay(ms)
  return { type: 'delay', ms }
}

function executeLog(action, context, options, runtime) {
  const message = hydrate(action.message || '', context)
  runtime.logger.log(message)
  return { type: 'log', message }
}

async function executeObsMedia(action, context, options, runtime) {
  const input = hydrate(action.input || action.source, context)
  const mediaAction = hydrate(action.mediaAction || action.media || action.command, context)
  if (!input) throw new Error('obs.media requires an input')
  if (!mediaAction) throw new Error('obs.media requires a mediaAction')
  await runtime.obs.mediaAction(input, mediaAction)
  return { type: 'obs.media', input, mediaAction }
}

async function executeObsMute(action, context, options, runtime) {
  const input = hydrate(action.input || action.source, context)
  if (!input) throw new Error('obs.mute requires an input')
  const muted = parseToggle(action.muted ?? action.status ?? 'toggle')
  if (muted === 'toggle') {
    const nextMuted = await runtime.obs.toggleInputMute(input)
    return { type: 'obs.mute', input, muted: nextMuted }
  }

  await runtime.obs.setInputMute(input, muted)
  return { type: 'obs.mute', input, muted }
}

async function executeObsScene(action, context, options, runtime) {
  const scene = hydrate(action.scene, context)
  if (!scene) throw new Error('obs.scene requires a scene')
  await runtime.obs.switchScene(scene)
  return { type: 'obs.scene', scene }
}

async function executeObsSource(action, context, options, runtime) {
  const scene = hydrate(action.scene, context)
  const source = hydrate(action.source || action.input, context)
  if (!source) throw new Error('obs.source requires a source')
  const visible = parseToggle(action.visible ?? action.status ?? true)
  if (visible === 'toggle') {
    const nextVisible = await runtime.obs.toggleSourceVisibility(scene, source)
    return { type: 'obs.source', scene, source, visible: nextVisible }
  }

  await runtime.obs.setSourceVisibility(scene, source, visible)
  return { type: 'obs.source', scene, source, visible }
}

function executeOverlayAlert(action, context, options, runtime) {
  const message = hydrate(action.message, context)
  if (!message) throw new Error('overlay.alert requires a message')
  if (action.background !== false) runtime.io.emit('bg-alert')
  runtime.io.emit('text-alert', { message })
  const soundResult = maybePlayAlertSound(action, context, options, runtime)
  return soundResult ? { type: 'overlay.alert', message, sound: soundResult } : { type: 'overlay.alert', message }
}

function executeOverlayEmit(action, context, options, runtime) {
  const event = hydrate(action.event, context)
  if (!event) throw new Error('overlay.emit requires an event')
  const payload = hydrate(action.payload || {}, context)
  runtime.overlayEmit(event, payload)
  return { type: 'overlay.emit', event, payload }
}

function executeSoundPickRandom(action, context, options, runtime) {
  const contextKey = hydrate(action.contextKey || action.key || 'sfx', context)
  if (!isSafeContextPath(contextKey)) {
    throw userInputError('sound.pickRandom requires a safe contextKey')
  }

  const configuredTextMap = loadSoundTextMap(runtime.soundTextFile, runtime.logger)
  const inlineTextMap = normalizeSoundTextMap(action.textMap || action.messages || action.labels)
  const textMap = {
    ...configuredTextMap,
    ...inlineTextMap
  }
  const pickedSound = pickRandomSound({
    soundDirectory: runtime.soundDirectory,
    textMap,
    eligibleFilenames: [...Object.keys(configuredTextMap), ...Object.keys(inlineTextMap)]
  })
  setPath(context, contextKey, pickedSound)

  return { type: 'sound.pickRandom', contextKey, ...pickedSound }
}

function executeSoundPlay(action, context, options, runtime) {
  const src = validateSoundSrc(hydrate(action.src || action.path, context))
  if (!src) {
    throw userInputError('sound.play requires a local sound path ending in .mp3, .ogg, or .wav')
  }
  assertSoundFileExists(src, runtime.soundDirectory)
  const volume = clamp(Number(action.volume ?? 1), 0, 1)
  const durationMs = getSoundDurationMs(src, runtime.soundDirectory, runtime.logger, runtime.largeSoundWarningBytes)
  runtime.io.emit('sound-play', { src, volume })
  return { type: 'sound.play', src, volume, durationMs }
}

function maybePlayAlertSound(action, context, { hasExplicitSoundAction = false } = {}, runtime) {
  if (action.sound === false || action.playSound === false) return null
  if (hasExplicitSoundAction && action.sound === undefined && action.soundSrc === undefined && action.src === undefined) return null

  const requestedSrc = action.sound === true
    ? runtime.defaultAlertSound
    : action.sound || action.soundSrc || action.src || runtime.defaultAlertSound
  const src = validateSoundSrc(hydrate(requestedSrc, context))
  if (!src) return null

  assertSoundFileExists(src, runtime.soundDirectory)
  const volume = clamp(Number(action.volume ?? 1), 0, 1)
  const durationMs = getSoundDurationMs(src, runtime.soundDirectory, runtime.logger, runtime.largeSoundWarningBytes)
  runtime.io.emit('sound-play', { src, volume })
  return { type: 'sound.play', src, volume, durationMs, source: 'overlay.alert' }
}

/**
 * Checks action objects and required fields before a queue or dispatcher accepts them.
 *
 * @param {object|Array<object>} actions One action or action list using a supported `type` or `action` field.
 * @returns {Array<object>} The supplied actions normalized to an array without cloning items.
 * @throws {Error} Throws a client input error for invalid objects, unknown types, or missing required fields.
 */
function validateActionStructure(actions) {
  const actionList = Array.isArray(actions) ? actions : [actions]
  if (!actionList.length) throw userInputError('At least one action is required')

  for (const action of actionList) {
    if (!action || typeof action !== 'object' || Array.isArray(action)) {
      throw userInputError('Action must be an object')
    }

    const type = action.type || action.action
    if (typeof type !== 'string' || !type.trim()) {
      throw userInputError('Action type is required')
    }
    const definition = getActionDefinition(type)
    if (!definition) {
      throw userInputError(`Unknown action type: ${type}`)
    }

    validateRequiredActionFields(type, action, definition)
  }

  return actionList
}

function getActionDefinition(type) {
  return Object.hasOwn(ACTION_DEFINITIONS, type) ? ACTION_DEFINITIONS[type] : null
}

function validateRequiredActionFields(type, action, definition) {
  for (const fields of definition.requiredFields) {
    if (!fields.some(field => hasActionValue(action[field]))) {
      throw userInputError(`${type} requires ${fields.join(' or ')}`)
    }
  }
}

function hasActionValue(value) {
  return value !== undefined && value !== null && value !== ''
}

/**
 * Replaces `{path.to.value}` placeholders throughout a value using the event context.
 *
 * @param {*} value String, array, object, or scalar action value to hydrate.
 * @param {object} context Source data for dot-separated placeholders.
 * @returns {*} Hydrated value; arrays and non-null objects are recreated from their enumerable properties.
 */
function hydrate(value, context) {
  if (typeof value === 'string') {
    return value.replace(/\{([a-zA-Z0-9_.-]+)\}/g, (_, key) => {
      const found = getPath(context, key)
      return found === undefined || found === null ? '' : String(found)
    })
  }

  if (Array.isArray(value)) return value.map(item => hydrate(item, context))

  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, hydrate(item, context)]))
  }

  return value
}

function getPath(source, path) {
  return path.split('.').reduce((current, key) => {
    if (current === undefined || current === null) return undefined
    return current[key]
  }, source)
}

function setPath(target, pathValue, value) {
  const keys = pathValue.split('.')
  const lastKey = keys.pop()
  const parent = keys.reduce((current, key) => {
    if (!current[key] || typeof current[key] !== 'object') current[key] = {}
    return current[key]
  }, target)
  parent[lastKey] = value
}

function isSafeContextPath(pathValue) {
  const unsafeKeys = new Set(['__proto__', 'constructor', 'prototype'])
  const keys = String(pathValue || '').split('.')
  return keys.every(key => /^[a-zA-Z][a-zA-Z0-9_]*$/.test(key) && !unsafeKeys.has(key))
}

function loadSoundTextMap(file, logger = console) {
  const source = resolveSoundTextFile(file)
  if (!source) return {}
  const fallback = getSoundTextExampleFile(source)

  try {
    return normalizeSoundTextMap(JSON.parse(fs.readFileSync(source, 'utf8')))
  } catch (error) {
    if (logger && typeof logger.warn === 'function') {
      logger.warn(`Failed to load sound text map ${source}: ${error.message}`)
    }
    if (!fallback || fallback === source || !fs.existsSync(fallback)) return {}
  }

  try {
    const fallbackMap = normalizeSoundTextMap(JSON.parse(fs.readFileSync(fallback, 'utf8')))
    if (logger && typeof logger.warn === 'function') {
      logger.warn(`Using fallback sound text map ${fallback}`)
    }
    return fallbackMap
  } catch (fallbackError) {
    if (logger && typeof logger.warn === 'function') {
      logger.warn(`Failed to load fallback sound text map ${fallback}: ${fallbackError.message}`)
    }
    return {}
  }
}

function resolveSoundTextFile(file) {
  if (file && fs.existsSync(file)) return file
  const fallback = getSoundTextExampleFile(file)
  if (fallback && fs.existsSync(fallback)) return fallback
  return null
}

function getSoundTextExampleFile(file) {
  if (!file) return null
  if (file === DEFAULT_SOUND_TEXT_FILE) return DEFAULT_SOUND_TEXT_EXAMPLE_FILE
  if (path.basename(file) !== 'sfx-text.json') return null
  return path.join(path.dirname(file), 'examples', 'sfx-text.example.json')
}

function normalizeSoundTextMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  return Object.fromEntries(Object.entries(value)
    .filter(([filename, text]) => SOUND_FILE_PATTERN.test(filename) && text !== undefined && text !== null)
    .map(([filename, text]) => [filename, String(text)]))
}

function shouldSuppressAction(type, context, quietMode) {
  if (!quietMode || typeof quietMode.isEnabled !== 'function' || !quietMode.isEnabled()) return false
  if (!isViewerTriggeredContext(context)) return false
  return isQuietableAction(type)
}

function isQuietableAction(type) {
  const definition = getActionDefinition(type)
  return Boolean(definition && definition.quietable)
}

function isSoundAction(action) {
  if (!action || typeof action !== 'object') return false
  const type = action.type || action.action
  const definition = getActionDefinition(type)
  return Boolean(definition && definition.sound)
}

function isViewerTriggeredContext(context = {}) {
  return [
    'automatic-redemption',
    'chat',
    'chat-entry',
    'follow',
    'raid',
    'redemption',
    'reward',
    'subscription',
    'twitch'
  ].includes(context.source)
}

/**
 * Selects a configured sound present in the local sound directory and derives its display text.
 *
 * @param {object} options Candidate sound source and configured filename-to-text mapping.
 * @param {string} options.soundDirectory Directory containing selectable files.
 * @param {Record<string, string>} [options.textMap={}] Display text keyed by eligible filename.
 * @param {string[]} [options.eligibleFilenames=[]] Filenames allowed by configured text maps.
 * @returns {{filename: string, name: string, src: string, text: string}} Selected sound metadata.
 * @throws {Error} Throws a client input error when the directory cannot be read or has no eligible sound.
 */
function pickRandomSound({ soundDirectory, textMap = {}, eligibleFilenames = [] }) {
  let entries

  try {
    entries = fs.readdirSync(soundDirectory, { withFileTypes: true })
  } catch (error) {
    throw userInputError('sound.pickRandom could not read the local sound directory')
  }

  const eligibleFilenameSet = new Set(eligibleFilenames)
  const filenames = entries
    .filter(entry => entry.isFile() && SOUND_FILE_PATTERN.test(entry.name))
    .filter(entry => eligibleFilenameSet.has(entry.name))
    .map(entry => entry.name)

  if (!filenames.length) {
    throw userInputError('sound.pickRandom found no configured sound files in the local sound directory')
  }

  const src = filenames[Math.floor(Math.random() * filenames.length)]
  const name = path.basename(src, path.extname(src))

  return {
    filename: src,
    name,
    src,
    text: getSoundText(src, textMap)
  }
}

function getSoundText(src, textMap) {
  const mappedText = textMap[src]
  if (mappedText !== undefined && mappedText !== null && String(mappedText).trim()) return String(mappedText)
  return path.basename(src, path.extname(src)).replace(/[_ .-]+/g, ' ').trim()
}

function collectSoundFiles(soundDirectory, relativeDirectory, sounds, logger, durationCache, largeSoundWarningBytes) {
  const directory = path.join(soundDirectory, relativeDirectory)
  let entries

  try {
    entries = fs.readdirSync(directory, { withFileTypes: true })
  } catch (error) {
    if (logger && typeof logger.warn === 'function') {
      logger.warn(`Failed to read sound directory ${directory}: ${error.message}`)
    }
    return
  }

  for (const entry of entries) {
    const relativePath = relativeDirectory ? path.join(relativeDirectory, entry.name) : entry.name
    const src = relativePath.replace(/\\/g, '/')

    if (entry.isDirectory()) {
      collectSoundFiles(soundDirectory, relativePath, sounds, logger, durationCache, largeSoundWarningBytes)
    } else if (entry.isFile() && validateSoundSrc(src)) {
      const filePath = path.join(soundDirectory, relativePath)
      try {
        const stat = fs.statSync(filePath)
        const durationMs = getCachedSoundDurationMs(src, soundDirectory, stat, logger, durationCache, largeSoundWarningBytes)
        sounds.push({
          directory: path.dirname(src) === '.' ? '' : path.dirname(src),
          durationMs,
          extension: path.extname(src).slice(1).toLowerCase(),
          filename: entry.name,
          name: path.basename(src, path.extname(src)).replace(/[_ .-]+/g, ' ').trim(),
          sizeBytes: stat.size,
          src
        })
      } catch (error) {
        if (logger && typeof logger.warn === 'function') {
          logger.warn(`Failed to read sound file ${src}: ${error.message}`)
        }
      }
    }
  }
}

function getCachedSoundDurationMs(src, soundDirectory, stat, logger, durationCache, largeSoundWarningBytes) {
  const cached = durationCache && durationCache.get(src)
  if (cached && cached.sizeBytes === stat.size && cached.mtimeMs === stat.mtimeMs) {
    return cached.durationMs
  }

  warnIfLargeSoundFile(src, stat, logger, largeSoundWarningBytes)
  const durationMs = readSoundDurationMs(src, soundDirectory, logger)
  if (durationCache) {
    durationCache.set(src, {
      durationMs,
      mtimeMs: stat.mtimeMs,
      sizeBytes: stat.size
    })
  }

  return durationMs
}

/**
 * Reads and caches a sound's duration, warning before reading files above the configured size threshold.
 *
 * @param {string} src Validated relative sound path.
 * @param {string} soundDirectory Root directory used to resolve `src`.
 * @param {object} [logger=console] Logger exposing `warn` for read failures or oversized files.
 * @param {number} [largeSoundWarningBytes=26214400] File size in bytes above which a warning is logged before the duration read.
 * @returns {number|null} Duration in milliseconds, or `null` when the path is invalid or duration detection fails.
 */
function getSoundDurationMs(
  src,
  soundDirectory,
  logger = console,
  largeSoundWarningBytes = DEFAULT_LARGE_SOUND_WARNING_BYTES
) {
  const filePath = resolveSoundPath(src, soundDirectory)
  if (!filePath) return null

  try {
    const stat = fs.statSync(filePath)
    return getCachedSoundDurationMs(
      src,
      soundDirectory,
      stat,
      logger,
      getSoundDurationCache(soundDirectory),
      largeSoundWarningBytes
    )
  } catch (error) {
    if (logger && typeof logger.warn === 'function') {
      logger.warn(`Failed to read sound duration for ${src}: ${error.message}`)
    }
    return null
  }
}

/**
 * Ensures a validated relative sound path resolves to a regular file beneath the sound directory.
 *
 * @param {string} src Relative local sound path.
 * @param {string} [soundDirectory] Directory permitted to contain the file; defaults to the public sound asset directory.
 * @returns {void}
 * @throws {Error} Throws a client input error for unsafe, missing, or non-file targets.
 */
function assertSoundFileExists(src, soundDirectory = DEFAULT_SOUND_DIRECTORY) {
  const filePath = resolveSoundPath(src, soundDirectory)
  if (!filePath) {
    throw userInputError('sound.play requires a local sound path within the sound directory')
  }

  try {
    if (fs.statSync(filePath).isFile()) return
  } catch (error) {
    throw userInputError(`sound.play file was not found: ${src}`)
  }

  throw userInputError(`sound.play file was not found: ${src}`)
}

function warnIfLargeSoundFile(src, stat, logger, largeSoundWarningBytes = DEFAULT_LARGE_SOUND_WARNING_BYTES) {
  if (!largeSoundWarningBytes || stat.size <= largeSoundWarningBytes) return
  if (!logger || typeof logger.warn !== 'function') return

  logger.warn(
    `Sound file ${src} is ${formatBytes(stat.size)}; duration detection reads the full file once and may briefly slow playback startup.`
  )
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

function getSoundDurationCache(soundDirectory) {
  const resolvedSoundDirectory = path.resolve(soundDirectory)
  let cached = soundListCache.get(resolvedSoundDirectory)
  if (!cached) {
    cached = {
      durationCache: new Map(),
      loadedAt: 0,
      sounds: []
    }
    soundListCache.set(resolvedSoundDirectory, cached)
  }
  return cached.durationCache
}

function readSoundDurationMs(src, soundDirectory, logger = console) {
  const filePath = resolveSoundPath(src, soundDirectory)
  if (!filePath) return null

  try {
    return getAudioDurationMs(filePath)
  } catch (error) {
    if (logger && typeof logger.warn === 'function') {
      logger.warn(`Failed to read sound duration for ${src}: ${error.message}`)
    }
    return null
  }
}

function resolveSoundPath(src, soundDirectory) {
  const resolvedSoundDirectory = path.resolve(soundDirectory)
  const resolved = path.resolve(resolvedSoundDirectory, src)
  const relative = path.relative(resolvedSoundDirectory, resolved)
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null
  return resolved
}

function cloneSoundList(sounds) {
  return sounds.map(sound => ({ ...sound }))
}

function normalizeActionDelay(value) {
  if (value === undefined || value === null || value === '') return 0

  const delay = Number(value)
  if (!Number.isFinite(delay)) {
    throw userInputError('delay action requires a finite millisecond value')
  }
  if (delay <= 0) return 0

  return Math.min(Math.round(delay), MAX_ACTION_DELAY_MS)
}

function pickInlineItem(value) {
  const items = asArray(value).map(item => String(item || '').trim()).filter(Boolean)
  if (!items.length) throw userInputError('context.pickRandom requires at least one item')
  return {
    pool: 'inline',
    value: items[Math.floor(Math.random() * items.length)]
  }
}

function parseToggle(value) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0

  const normalized = String(value).trim().toLowerCase()
  if (['toggle', 'flip'].includes(normalized)) return 'toggle'
  if (['on', 'true', 'yes', '1', 'show', 'visible', 'unmuted'].includes(normalized)) return true
  if (['off', 'false', 'no', '0', 'hide', 'hidden', 'muted'].includes(normalized)) return false

  return Boolean(value)
}

function clamp(value, min, max) {
  if (Number.isNaN(value)) return max
  return Math.min(Math.max(value, min), max)
}

module.exports = {
  assertSoundFileExists,
  createActionRunner,
  listSoundFiles,
  validateActionStructure,
  validateSoundSrc
}
