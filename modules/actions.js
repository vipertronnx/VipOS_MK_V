const fs = require('fs')
const path = require('path')
const { getAudioDurationMs } = require('./audio-duration')
const { createGreetingService } = require('./greetings')

const DEFAULT_SOUND_DIRECTORY = path.join(__dirname, '..', 'public', 'assets', 'sounds')
const DEFAULT_SOUND_TEXT_FILE = path.join(__dirname, '..', 'config', 'sfx-text.json')
const DEFAULT_SOUND_TEXT_EXAMPLE_FILE = path.join(__dirname, '..', 'config', 'sfx-text.example.json')
const DEFAULT_ALERT_SOUND = 'example.mp3'
const MAX_ACTION_DELAY_MS = 10 * 60 * 1000
const SOUND_LIST_CACHE_TTL_MS = 5000
const DEFAULT_LARGE_SOUND_WARNING_BYTES = 25 * 1024 * 1024
const SOUND_FILE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9 _.-]*\.(mp3|ogg|wav)$/i
const SOUND_PATH_PATTERN = /^(?:[a-zA-Z0-9][a-zA-Z0-9 _.-]*\/)*[a-zA-Z0-9][a-zA-Z0-9 _.-]*\.(mp3|ogg|wav)$/i
const ACTION_VALIDATION_RULES = {
  'chat.say': [['message', 'text']],
  'context.pickRandom': [['contextKey', 'key']],
  delay: [],
  log: [],
  'obs.media': [['input', 'source'], ['mediaAction', 'media', 'command']],
  'obs.mute': [['input', 'source']],
  'obs.scene': [['scene']],
  'obs.source': [['source', 'input']],
  'overlay.alert': [['message']],
  'overlay.emit': [['event']],
  'sound.pickRandom': [],
  'sound.play': [['src', 'path']]
}

const soundListCache = new Map()

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

function userInputError(message) {
  const error = new Error(message)
  error.statusCode = 400
  return error
}

function validateSoundSrc(src) {
  if (typeof src !== 'string') return null

  const normalized = src.trim()
  if (!normalized) return null
  if (!SOUND_PATH_PATTERN.test(normalized)) return null

  return normalized
}

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

  function setChatService(service) {
    chatService = service
  }

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

    switch (type) {
      case 'delay': {
        const ms = normalizeActionDelay(action.ms ?? action.duration ?? 0)
        if (ms > 0) await waitForDelay(ms)
        return { type, ms }
      }

      case 'log': {
        const message = hydrate(action.message || '', context)
        logger.log(message)
        return { type, message }
      }

      case 'overlay.emit': {
        const event = hydrate(action.event, context)
        if (!event) throw new Error('overlay.emit requires an event')
        const payload = hydrate(action.payload || {}, context)
        overlayEmit(event, payload)
        return { type, event, payload }
      }

      case 'overlay.alert': {
        const message = hydrate(action.message, context)
        if (!message) throw new Error('overlay.alert requires a message')
        if (action.background !== false) io.emit('bg-alert')
        io.emit('text-alert', { message })
        const soundResult = maybePlayAlertSound(action, context, options)
        return soundResult ? { type, message, sound: soundResult } : { type, message }
      }

      case 'sound.play': {
        const src = validateSoundSrc(hydrate(action.src || action.path, context))
        if (!src) {
          throw userInputError('sound.play requires a local sound path ending in .mp3, .ogg, or .wav')
        }
        assertSoundFileExists(src, soundDirectory)
        const volume = clamp(Number(action.volume ?? 1), 0, 1)
        const durationMs = getSoundDurationMs(src, soundDirectory, logger, largeSoundWarningBytes)
        io.emit('sound-play', { src, volume })
        return { type, src, volume, durationMs }
      }

      case 'sound.pickRandom': {
        const contextKey = hydrate(action.contextKey || action.key || 'sfx', context)
        if (!isSafeContextPath(contextKey)) {
          throw userInputError('sound.pickRandom requires a safe contextKey')
        }

        const configuredTextMap = loadSoundTextMap(soundTextFile, logger)
        const inlineTextMap = normalizeSoundTextMap(action.textMap || action.messages || action.labels)
        const textMap = {
          ...configuredTextMap,
          ...inlineTextMap
        }
        const pickedSound = pickRandomSound({
          soundDirectory,
          textMap,
          eligibleFilenames: [...Object.keys(configuredTextMap), ...Object.keys(inlineTextMap)]
        })
        setPath(context, contextKey, pickedSound)

        return { type, contextKey, ...pickedSound }
      }

      case 'context.pickRandom': {
        const contextKey = hydrate(action.contextKey || action.key, context)
        if (!isSafeContextPath(contextKey)) {
          throw userInputError('context.pickRandom requires a safe contextKey')
        }

        const configuredItems = action.items || action.values || action.list
        const picked = configuredItems
          ? pickInlineItem(hydrate(asArray(configuredItems), context))
          : greetings.pick({
            file: hydrate(action.file || action.path, context),
            pool: hydrate(action.pool || action.theme || action.category, context)
          })
        const value = picked.value
        setPath(context, contextKey, value)

        return { type, contextKey, ...picked }
      }

      case 'chat.say': {
        if (!chatService) throw new Error('Twitch chat is not configured')
        const message = hydrate(action.message || action.text, context)
        if (!message) throw new Error('chat.say requires a message')

        const explicitReplyId = hydrate(action.replyParentMessageId || action.replyTo, context)
        const replyParentMessageId = explicitReplyId || (parseToggle(action.reply) === true ? context.messageId : undefined)
        const sent = await chatService.say(message, { replyParentMessageId, simulated: context.simulated })
        return { type, message, ...sent }
      }

      case 'obs.scene': {
        const scene = hydrate(action.scene, context)
        if (!scene) throw new Error('obs.scene requires a scene')
        await obs.switchScene(scene)
        return { type, scene }
      }

      case 'obs.source': {
        const scene = hydrate(action.scene, context)
        const source = hydrate(action.source || action.input, context)
        if (!source) throw new Error('obs.source requires a source')
        const visible = parseToggle(action.visible ?? action.status ?? true)
        if (visible === 'toggle') {
          const nextVisible = await obs.toggleSourceVisibility(scene, source)
          return { type, scene, source, visible: nextVisible }
        }

        await obs.setSourceVisibility(scene, source, visible)
        return { type, scene, source, visible }
      }

      case 'obs.mute': {
        const input = hydrate(action.input || action.source, context)
        if (!input) throw new Error('obs.mute requires an input')
        const muted = parseToggle(action.muted ?? action.status ?? 'toggle')
        if (muted === 'toggle') {
          const nextMuted = await obs.toggleInputMute(input)
          return { type, input, muted: nextMuted }
        }

        await obs.setInputMute(input, muted)
        return { type, input, muted }
      }

      case 'obs.media': {
        const input = hydrate(action.input || action.source, context)
        const mediaAction = hydrate(action.mediaAction || action.media || action.command, context)
        if (!input) throw new Error('obs.media requires an input')
        if (!mediaAction) throw new Error('obs.media requires a mediaAction')
        await obs.mediaAction(input, mediaAction)
        return { type, input, mediaAction }
      }

      default:
        throw new Error(`Unknown action type: ${type}`)
    }
  }

  function maybePlayAlertSound(action, context, { hasExplicitSoundAction = false } = {}) {
    if (action.sound === false || action.playSound === false) return null
    if (hasExplicitSoundAction && action.sound === undefined && action.soundSrc === undefined && action.src === undefined) return null

    const requestedSrc = action.sound === true
      ? defaultAlertSound
      : action.sound || action.soundSrc || action.src || defaultAlertSound
    const src = validateSoundSrc(hydrate(requestedSrc, context))
    if (!src) return null

    assertSoundFileExists(src, soundDirectory)
    const volume = clamp(Number(action.volume ?? 1), 0, 1)
    const durationMs = getSoundDurationMs(src, soundDirectory, logger, largeSoundWarningBytes)
    io.emit('sound-play', { src, volume })
    return { type: 'sound.play', src, volume, durationMs, source: 'overlay.alert' }
  }

  return {
    run,
    setChatService,
    validateStructure: validateActionStructure
  }
}

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
    if (!Object.hasOwn(ACTION_VALIDATION_RULES, type)) {
      throw userInputError(`Unknown action type: ${type}`)
    }

    validateRequiredActionFields(type, action)
  }

  return actionList
}

function validateRequiredActionFields(type, action) {
  for (const fields of ACTION_VALIDATION_RULES[type]) {
    if (!fields.some(field => hasActionValue(action[field]))) {
      throw userInputError(`${type} requires ${fields.join(' or ')}`)
    }
  }
}

function hasActionValue(value) {
  return value !== undefined && value !== null && value !== ''
}

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
  return path.join(path.dirname(file), 'sfx-text.example.json')
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
  return type === 'overlay.alert' || type === 'overlay.emit' || type === 'sound.play' || type === 'sound.pickRandom'
}

function isSoundAction(action) {
  if (!action || typeof action !== 'object') return false
  const type = action.type || action.action
  return type === 'sound.play' || type === 'sound.pickRandom'
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

function asArray(value) {
  if (value === undefined || value === null || value === '') return []
  return Array.isArray(value) ? value : [value]
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
