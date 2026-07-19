// Load environment variables
require('dotenv').config()

// Express App + Socket.IO inits
const express = require('express')
const http = require('http')
const { Server } = require("socket.io")
const cors = require('cors')
const favicon = require('serve-favicon')
const fs = require('fs')
const path = require('path')

const { assertSoundFileExists, createActionRunner, listSoundFiles, validateSoundSrc } = require('./modules/actions')
const { createActionQueue } = require('./modules/action-queue')
const { createChatService } = require('./modules/chat/chat')
const { normalizeCompletionDelay } = require('./modules/utils/completion-delay')
const { createGreetingService } = require('./modules/greetings')
const { createMacroService } = require('./modules/macros')
const { createObsService } = require('./modules/obs')
const { createRaffleService } = require('./modules/raffle')
const { parseBool } = require('./modules/utils/value-normalization')

const PORT = Number(process.env.PORT) || 5000
const APP_NAME = process.env.APP_NAME || 'VipOS MK V'
const APP_DESCRIPTION = process.env.APP_DESCRIPTION || 'Chat Bot + Overlay Platform'
const DEFAULT_ALERT_SOUND = process.env.DEFAULT_ALERT_SOUND || 'example.mp3'
const DEFAULT_SOUND_COMPLETION_DELAY_MS = numberOrDefault(process.env.QUEUE_SOUND_COMPLETION_DELAY_MS, 4000)
const SOUND_COMPLETION_BUFFER_MS = numberOrDefault(process.env.QUEUE_SOUND_COMPLETION_BUFFER_MS, 250)
const NEWS_CHYRON_ROTATE_INTERVAL_MS = numberOrDefault(process.env.NEWS_CHYRON_ROTATE_INTERVAL_MS, 30000)
const NEWS_CHYRON_ITEMS_DEFAULT = process.env.NEWS_CHYRON_ITEMS_DEFAULT || 'config/news-chyron.example.json'
const NEWS_CHYRON_ITEMS = readNewsChyronItems()
const LOWER_THIRD_TOGGLE_INTERVAL_MS = numberOrDefault(process.env.LOWER_THIRD_TOGGLE_INTERVAL_MS, 3 * 60 * 1000)
const NEWS_CHYRON_LOWER_THIRD_SLIDE_DISTANCE = cssLengthOrDefault(process.env.NEWS_CHYRON_LOWER_THIRD_SLIDE_DISTANCE, '140px')
const NEWS_CHYRON_LOWER_THIRD_SLIDE_DURATION = cssTimeOrDefault(process.env.NEWS_CHYRON_LOWER_THIRD_SLIDE_DURATION, '600ms')
const VENOM_COIN_LOWER_THIRD_SLIDE_DISTANCE = cssLengthOrDefault(process.env.VENOM_COIN_LOWER_THIRD_SLIDE_DISTANCE, '100%')
const VENOM_COIN_LOWER_THIRD_SLIDE_DURATION = cssTimeOrDefault(process.env.VENOM_COIN_LOWER_THIRD_SLIDE_DURATION, '300ms')
const TV_GUIDE_ITEMS_DEFAULT = process.env.TV_GUIDE_ITEMS_DEFAULT || 'config/tv-guide.example.json'
const TV_GUIDE_ITEMS = readTvGuideItems()

function createSocketServer(server, { port = PORT, portContext = createPortContext(port) } = {}) {
  return new Server(server, {
    allowRequest(req, callback) {
      if (portContext.isAllowedOrigin(req.headers.origin)) return callback(null, true)
      return callback('Origin is not allowed', false)
    },
    cors: {
      methods: ['GET', 'POST'],
      origin(origin, callback) {
        if (portContext.isAllowedOrigin(origin)) return callback(null, true)
        return callback(null, false)
      }
    }
  })
}

function createRuntimeServices({ io }) {
  const quietMode = createQuietMode()
  const lowerThirdSync = createLowerThirdSync(io, LOWER_THIRD_TOGGLE_INTERVAL_MS)
  const obs = createObsService()
  const greetings = createGreetingService()
  const actions = createActionRunner({ io, obs, greetings, quietMode, overlayEmit: lowerThirdSync.emitOverlayEvent })
  const actionQueue = createActionQueue({
    actions,
    soundCompletionBufferMs: SOUND_COMPLETION_BUFFER_MS,
    soundCompletionFallbackMs: DEFAULT_SOUND_COMPLETION_DELAY_MS
  })
  const macros = createMacroService()
  const raffle = createRaffleService({
    announce(actionList, context = {}) {
      return actionQueue.enqueue({
        name: 'Raffle',
        actions: actionList,
        context,
        source: 'raffle'
      })
    },
    announceImmediate(actionList, context = {}) {
      return actions.run(actionList, { ...context, source: 'raffle' })
    }
  })
  const chat = createChatService({
    actions,
    actionQueue,
    // Restored raffles may announce through chat, so recover their timers only once it is usable.
    onReady: () => raffle.startTimers(),
    raffle
  })
  actions.setChatService(chat)

  return {
    actions,
    actionQueue,
    chat,
    greetings,
    io,
    lowerThirdSync,
    macros,
    obs,
    quietMode,
    raffle
  }
}

async function startRuntimeServices({ chat, obs, raffle }) {
  obs.connect()
  await chat.start()
  if (!chat.getStatus().enabled) raffle.startTimers()
}

function createQuietMode() {
  let enabled = false
  let updatedAt = null

  function set(nextEnabled) {
    enabled = Boolean(nextEnabled)
    updatedAt = new Date().toISOString()
    return getStatus()
  }

  function getStatus() {
    return {
      enabled,
      updatedAt
    }
  }

  return {
    disable: () => set(false),
    enable: () => set(true),
    getStatus,
    isEnabled: () => enabled,
    set,
    toggle: () => set(!enabled)
  }
}

function createLowerThirdSync(io, toggleIntervalMs) {
  let hidden = false
  let timer = null

  function emitState(event = 'lower-third-toggle') {
    io.emit(event, { hidden })
  }

  function setHidden(nextHidden, event) {
    hidden = Boolean(nextHidden)
    emitState(event)
    return getStatus()
  }

  function toggle() {
    hidden = !hidden
    emitState()
    return getStatus()
  }

  function emitOverlayEvent(event, payload = {}) {
    if (event === 'lower-third-hide') return setHidden(true, event)
    if (event === 'lower-third-show') return setHidden(false, event)
    if (event === 'lower-third-toggle') {
      if (payload && typeof payload.hidden === 'boolean') return setHidden(payload.hidden, event)
      return toggle()
    }

    io.emit(event, payload)
  }

  function getStatus() {
    return {
      hidden,
      toggleIntervalMs
    }
  }

  io.on('connection', socket => {
    socket.emit('lower-third-sync', { hidden })
    socket.on('lower-third-sync-request', () => {
      socket.emit('lower-third-sync', { hidden })
    })
  })

  if (toggleIntervalMs > 0) {
    timer = setInterval(toggle, toggleIntervalMs)
  }

  return {
    getStatus,
    emitOverlayEvent,
    hide: () => setHidden(true, 'lower-third-hide'),
    show: () => setHidden(false, 'lower-third-show'),
    stop: () => {
      if (timer) clearInterval(timer)
      timer = null
    },
    toggle
  }
}

function numberOrDefault(value, defaultValue) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : defaultValue
}

function readNewsChyronItems() {
  const itemsSource = process.env.NEWS_CHYRON_ITEMS || NEWS_CHYRON_ITEMS_DEFAULT

  try {
    const parsed = parseNewsChyronItemsSource(itemsSource)
    const items = Array.isArray(parsed) ? parsed.map(normalizeNewsChyronItem).filter(Boolean) : []
    return items.length ? items : readDefaultNewsChyronItems()
  } catch (error) {
    console.warn('NEWS_CHYRON_ITEMS must be a JSON array or a path to a JSON file with h1, h2, and h3 strings. Using default news chyron items.')
    return readDefaultNewsChyronItems()
  }
}

function readDefaultNewsChyronItems() {
  try {
    const parsed = parseNewsChyronItemsSource(NEWS_CHYRON_ITEMS_DEFAULT)
    const items = Array.isArray(parsed) ? parsed.map(normalizeNewsChyronItem).filter(Boolean) : []
    if (items.length) return items
  } catch (error) {
    console.warn('NEWS_CHYRON_ITEMS_DEFAULT must be a JSON array or a path to a JSON file with h1, h2, and h3 strings.')
  }

  return [
    {
      h3: 'VipOS MARK V SYSTEM ONLINE',
      h1: 'SIGNAL STRENGTH IMPROVING',
      h2: 'Broadcasting from somewhere beyond the end of the dial'
    }
  ]
}

function parseNewsChyronItemsSource(source) {
  const trimmedSource = source.trim()
  if (trimmedSource.startsWith('[')) return JSON.parse(trimmedSource)

  const filePath = path.isAbsolute(trimmedSource) ? trimmedSource : path.join(__dirname, trimmedSource)
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function normalizeNewsChyronItem(item) {
  if (!item || typeof item !== 'object') return null

  const h1 = normalizeChyronText(item.h1)
  const h2 = normalizeChyronText(item.h2)
  const h3 = normalizeChyronText(item.h3)
  if (!h1 || !h2 || !h3) return null

  return { h1, h2, h3 }
}

function normalizeChyronText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function readTvGuideItems() {
  const itemsSource = process.env.TV_GUIDE_ITEMS || 'config/tv-guide.json'

  try {
    const items = buildTvGuideItems(parseJsonConfigSource(itemsSource))
    return items.length ? items : readDefaultTvGuideItems()
  } catch (error) {
    console.warn('TV_GUIDE_ITEMS must be a JSON object with channels and optional banners. Using default TV guide items.')
    return readDefaultTvGuideItems()
  }
}

function readDefaultTvGuideItems() {
  try {
    const items = buildTvGuideItems(parseJsonConfigSource(TV_GUIDE_ITEMS_DEFAULT))
    if (items.length) return items
  } catch (error) {
    console.warn('TV_GUIDE_ITEMS_DEFAULT must be a JSON object with channels and optional banners.')
  }

  return [
    {
      type: 'channel',
      name: 'VIPER',
      titleLines: ['1', 'VIPER'],
      programs: [
        { titleLines: ['VIPERVERSE STUDIOS'], colspan: 4 }
      ]
    }
  ]
}

function buildTvGuideItems(config) {
  if (!config || typeof config !== 'object') return []

  const channelStartNumber = normalizePositiveInteger(config.channelStartNumber, 2)
  const channels = Array.isArray(config.channels)
    ? config.channels.map(normalizeTvGuideChannel).filter(Boolean)
    : []
  const channelSampleSize = normalizePositiveInteger(config.channelSampleSize, channels.length)
  const sampledChannels = sampleTvGuideChannels(channels, channelSampleSize)
  const banners = Array.isArray(config.banners)
    ? config.banners.map(normalizeTvGuideBanner).filter(Boolean)
    : []

  return numberTvGuideChannels(sampledChannels, channelStartNumber).concat(banners)
}

function normalizeTvGuideChannel(channel) {
  if (!channel || typeof channel !== 'object') return null

  const name = normalizeTvGuideText(channel.name)
  const programs = Array.isArray(channel.programs)
    ? channel.programs.map(normalizeTvGuideProgram).filter(Boolean)
    : []

  if (!name || !programs.length) return null

  return {
    type: 'channel',
    name,
    programs
  }
}

function normalizeTvGuideProgram(program) {
  if (!program || typeof program !== 'object') return null

  const title = normalizeTvGuideText(program.title)
  const colspan = Math.max(1, Math.min(4, Math.round(Number(program.colspan) || 1)))
  if (!title) return null

  return {
    titleLines: title.split('\n'),
    colspan
  }
}

function normalizeTvGuideBanner(banner) {
  const title = normalizeTvGuideText(banner)
  if (!title) return null

  return {
    type: 'banner',
    titleLines: title.split('\n')
  }
}

function sampleTvGuideChannels(channels, sampleSize) {
  return shuffleArray(channels).slice(0, Math.min(sampleSize, channels.length))
}

function numberTvGuideChannels(channels, startNumber) {
  return channels.map((channel, index) => {
    const number = String(startNumber + index)

    return {
      ...channel,
      number,
      titleLines: [number, channel.name],
      programs: selectTvGuidePrograms(channel.programs)
    }
  })
}

function selectTvGuidePrograms(programs) {
  const exactPrograms = findTvGuideProgramCombination(shuffleArray(programs), 4)
  return exactPrograms || fitTvGuidePrograms(shuffleArray(programs))
}

function findTvGuideProgramCombination(programs, targetColspan) {
  if (targetColspan === 0) return []
  if (targetColspan < 0 || !programs.length) return null

  for (let index = 0; index < programs.length; index++) {
    const program = programs[index]
    const remainingPrograms = programs.slice(index + 1)
    const nextPrograms = findTvGuideProgramCombination(remainingPrograms, targetColspan - program.colspan)
    if (nextPrograms) return [program, ...nextPrograms]
  }

  return null
}

function fitTvGuidePrograms(programs) {
  const fitted = []
  let remainingColspan = 4

  programs.forEach(program => {
    if (remainingColspan <= 0) return
    if (program.colspan > remainingColspan) return

    fitted.push(program)
    remainingColspan -= program.colspan
  })

  if (remainingColspan > 0) {
    fitted.push({ titleLines: [''], colspan: remainingColspan })
  }

  return fitted
}

function normalizePositiveInteger(value, defaultValue) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.round(number) : defaultValue
}

function normalizeTvGuideText(value) {
  return typeof value === 'string' ? value.trim().replace(/\r\n/g, '\n').replace(/\r/g, '\n') : ''
}

function parseJsonConfigSource(source) {
  const trimmedSource = source.trim()
  if (trimmedSource.startsWith('{') || trimmedSource.startsWith('[')) return JSON.parse(trimmedSource)

  const filePath = path.isAbsolute(trimmedSource) ? trimmedSource : path.join(__dirname, trimmedSource)
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function shuffleArray(items) {
  const shuffled = items.slice()

  for (let index = shuffled.length - 1; index > 0; index--) {
    const randomIndex = Math.floor(Math.random() * (index + 1))
    const item = shuffled[index]
    shuffled[index] = shuffled[randomIndex]
    shuffled[randomIndex] = item
  }

  return shuffled
}

function renderTvGuideLines(lines) {
  return lines.map(escapeHtml).join('<br />')
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[character]))
}

function safeJsonForScript(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

function cssLengthOrDefault(value, defaultValue) {
  const normalized = String(value || '').trim()
  return /^-?\d+(?:\.\d+)?(?:px|%|vh|vw|rem|em)$/.test(normalized) ? normalized : defaultValue
}

function cssTimeOrDefault(value, defaultValue) {
  const normalized = String(value || '').trim()
  return /^\d+(?:\.\d+)?(?:ms|s)$/.test(normalized) ? normalized : defaultValue
}


/**
 * Tracks the port used by the HTTP, Socket.IO, CORS, and status surfaces.
 *
 */
function createPortContext(port = PORT) {
  let currentPort = port

  function getAllowedOrigins() {
    return new Set([
      `http://localhost:${currentPort}`,
      `http://127.0.0.1:${currentPort}`
    ])
  }

  return {
    getPort() {
      return currentPort
    },
    isAllowedOrigin(origin) {
      return !origin || getAllowedOrigins().has(origin)
    },
    isAllowedReferer(referer) {
      try {
        return getAllowedOrigins().has(new URL(referer).origin)
      } catch (error) {
        return false
      }
    },
    setPort(port) {
      currentPort = port
    }
  }
}


/**
 * Require local JSON mutation for API endpoints
 *
 */
function requireLocalJsonMutation(portContext) {
  return (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next()

    const origin = req.get('origin')
    if (!portContext.isAllowedOrigin(origin)) {
      return res.status(403).json({ error: 'Origin is not allowed' })
    }

    const referer = req.get('referer')
    if (!origin && referer && !portContext.isAllowedReferer(referer)) {
      return res.status(403).json({ error: 'Origin is not allowed' })
    }

    if (!req.is('application/json')) {
      return res.status(415).json({ error: 'API mutations require application/json' })
    }

    next()
  }
}


function createApp(services, { port = PORT, portContext = createPortContext(port) } = {}) {
  const app = express()
  const {
    actions,
    actionQueue,
    chat,
    greetings,
    io,
    lowerThirdSync,
    macros,
    obs,
    quietMode,
    raffle
  } = services

  /**
   * Application Middleware initialization
   * - static directory and rendering engine
   * - CORS for API endpoints
   * - JSON body parsing for API endpoints
   * - favicon
   * - local JSON mutation requirement for API endpoints
   * - app.locals for app name and description
   *
   */
  app.use(express.static(path.join(__dirname, 'public')))
  app.set("view engine", "ejs")
  app.use(cors({
    methods: ['GET', 'POST', 'OPTIONS'],
    origin(origin, callback) {
      if (portContext.isAllowedOrigin(origin)) return callback(null, true)
      return callback(null, false)
    }
  }))
  app.use('/api/v1', requireLocalJsonMutation(portContext))
  app.use(express.json({ limit: '1mb' }))
  app.use(express.urlencoded({ extended: true }))
  app.use(favicon(path.join(__dirname, '/public/assets/img/favicon.ico')))
  app.locals.appName = APP_NAME
  app.locals.appDescription = APP_DESCRIPTION

  /**
   * Async Handler for Express Routes
   * Get body message from request (body.message, body.msg, or query.message)
   *
   */
  const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
  const getBodyMessage = req => req.body.message || req.body.msg || req.query.message || ''

  function enqueueTextAlert(res, req, name) {
    const message = getBodyMessage(req)
    if (!message) return res.status(400).json({ error: 'message or msg is required' })

    enqueueApiActions(res, name, [
      { type: 'overlay.alert', message },
      { type: 'sound.play', src: DEFAULT_ALERT_SOUND, volume: 1 }
    ], {
      completionDelayMs: getRequestCompletionDelay(req),
      fallbackCompletionDelayMs: DEFAULT_SOUND_COMPLETION_DELAY_MS
    })
  }

  function enqueueApiActions(res, name, actionList, options = {}) {
    const delayValue = options.completionDelayMs ?? options.delayMs
    const completionDelayMs = delayValue === undefined ? undefined : normalizeCompletionDelay(delayValue)
    const queue = actionQueue.enqueue({
      name,
      actions: actionList,
      completionDelayMs,
      fallbackCompletionDelayMs: options.fallbackCompletionDelayMs,
      context: { source: 'api', ...(options.context || {}) },
      source: 'api'
    })
    res.json({ ok: true, queued: true, completionDelayMs, fallbackCompletionDelayMs: options.fallbackCompletionDelayMs, queue })
  }

  function getRequestCompletionDelay(req) {
    const value = req.body.completionDelayMs ?? req.body.delayMs ?? req.body.queueDelayMs
    return value === undefined ? undefined : normalizeCompletionDelay(value)
  }

  /**
   * Home Page
   *
   */
  app.get('/', (req, res) => {
    res.render('index.ejs', {
      customClass: 'index-page'
    })
  })


  /**
   * Control Panel
   *
   */
  app.get('/control', (req, res) => {
    res.render('control.ejs', {
      customClass: 'control-page',
      loadSocket: true,
      extraStyles: ['/assets/css/control.css']
    })
  })


  /**
   * Overlays
   *
   */
  app.get('/overlay/alerts', (req, res) => {
    res.render('overlays/alerts.ejs', { loadSocket: true })
  })

  app.get('/overlay/news-chyron', (req, res) => {
    res.render('overlays/news-chyron.ejs', {
      loadSocket: true,
      chyronItems: NEWS_CHYRON_ITEMS,
      chyronItemsJson: safeJsonForScript(NEWS_CHYRON_ITEMS),
      chyronRotateIntervalMs: NEWS_CHYRON_ROTATE_INTERVAL_MS,
      lowerThirdSlideDistance: NEWS_CHYRON_LOWER_THIRD_SLIDE_DISTANCE,
      lowerThirdSlideDuration: NEWS_CHYRON_LOWER_THIRD_SLIDE_DURATION
    })
  })

  app.get('/overlay/stream-border', (req, res) => {
    res.render('overlays/stream-border.ejs', { loadSocket: true })
  })

  app.get('/overlay/tv-guide', (req, res) => {
    res.render('overlays/tv-guide.ejs', {
      renderTvGuideLines,
      tvGuideItems: TV_GUIDE_ITEMS
    })
  })

  app.get('/overlay/venom-coin', (req, res) => {
    res.render('overlays/venom-coin.ejs', {
      loadSocket: true,
      lowerThirdSlideDistance: VENOM_COIN_LOWER_THIRD_SLIDE_DISTANCE,
      lowerThirdSlideDuration: VENOM_COIN_LOWER_THIRD_SLIDE_DURATION
    })
  })


  /**
   * API Endpoints
   *
   */
  app.get('/api/v1/status', (req, res) => {
    res.json({
      app: {
        name: APP_NAME,
        description: APP_DESCRIPTION,
        port: portContext.getPort()
      },
      obs: obs.getStatus(),
      chat: chat.getStatus(),
      greetings: greetings.getStatus(),
      quietMode: quietMode.getStatus(),
      lowerThird: lowerThirdSync.getStatus(),
      queue: actionQueue.getStatus(),
      raffle: raffle.getStatus(),
      sockets: {
        clients: io.engine.clientsCount
      }
    })
  })

  app.get('/api/v1/macros', (req, res) => {
    res.json({ ok: true, macros: macros.list() })
  })

  app.get('/api/v1/queue', (req, res) => {
    res.json({ ok: true, queue: actionQueue.getStatus() })
  })

  app.post('/api/v1/quiet-mode/on', (req, res) => {
    res.json({ ok: true, quietMode: quietMode.enable() })
  })

  app.post('/api/v1/quiet-mode/off', (req, res) => {
    res.json({ ok: true, quietMode: quietMode.disable() })
  })

  app.post('/api/v1/quiet-mode/toggle', (req, res) => {
    res.json({ ok: true, quietMode: quietMode.toggle() })
  })

  app.get('/api/v1/raffle', (req, res) => {
    res.json({ ok: true, raffle: raffle.getStatus() })
  })

  app.post('/api/v1/raffle/on', (req, res) => {
    res.json({ ok: true, raffle: raffle.enable({ requirePersistence: true }) })
  })

  app.post('/api/v1/raffle/off', (req, res) => {
    res.json({ ok: true, raffle: raffle.disable({ requirePersistence: true }) })
  })

  app.post('/api/v1/raffle/toggle', (req, res) => {
    res.json({ ok: true, raffle: raffle.toggle({ requirePersistence: true }) })
  })

  app.post('/api/v1/raffle/start', (req, res) => {
    res.json({ ok: true, raffle: raffle.start({ requirePersistence: true }), queue: actionQueue.getStatus() })
  })

  app.post('/api/v1/raffle/close', (req, res) => {
    res.json({ ok: true, raffle: raffle.close({ requirePersistence: true }), queue: actionQueue.getStatus() })
  })

  app.get('/api/v1/sounds', (req, res) => {
    const refresh = parseBool(req.query.refresh, false)
    res.json({ ok: true, sounds: listSoundFiles({ cacheTtlMs: refresh ? 0 : undefined }) })
  })

  app.post('/api/v1/twitch/simulate/:type', asyncHandler(async (req, res) => {
    const event = req.body.event && typeof req.body.event === 'object' ? req.body.event : req.body
    await chat.simulateEvent(req.params.type, event)
    res.json({ ok: true, event: req.params.type, queue: actionQueue.getStatus() })
  }))

  app.get('/api/v1/greetings', (req, res) => {
    res.json({ ok: true, greetings: greetings.getStatus() })
  })

  app.get('/api/v1/obs/discovery', asyncHandler(async (req, res) => {
    res.json({ ok: true, obs: await obs.getDiscovery() })
  }))

  app.post('/api/v1/greetings/pool', asyncHandler(async (req, res) => {
    const pool = req.body.pool || req.body.theme || req.body.activePool
    if (!pool) return res.status(400).json({ error: 'pool is required' })
    res.json({ ok: true, greetings: greetings.setActivePool(pool) })
  }))

  app.post('/api/v1/bg-alert', asyncHandler(async (req, res) => {
    enqueueApiActions(res, 'Border Alert', [
      { type: 'overlay.emit', event: 'bg-alert' },
      { type: 'sound.play', src: DEFAULT_ALERT_SOUND, volume: 1 }
    ], {
      completionDelayMs: getRequestCompletionDelay(req),
      fallbackCompletionDelayMs: DEFAULT_SOUND_COMPLETION_DELAY_MS
    })
  }))

  app.post('/api/v1/bg-random', asyncHandler(async (req, res) => {
    enqueueApiActions(res, 'Random Border', [
      { type: 'overlay.emit', event: 'bg-random' },
      { type: 'sound.play', src: DEFAULT_ALERT_SOUND, volume: 1 }
    ], {
      completionDelayMs: getRequestCompletionDelay(req),
      fallbackCompletionDelayMs: DEFAULT_SOUND_COMPLETION_DELAY_MS
    })
  }))

  app.post('/api/v1/bg-reset', asyncHandler(async (req, res) => {
    enqueueApiActions(res, 'Reset Border', [
      { type: 'overlay.emit', event: 'bg-reset' },
      { type: 'sound.play', src: DEFAULT_ALERT_SOUND, volume: 1 }
    ], {
      completionDelayMs: getRequestCompletionDelay(req),
      fallbackCompletionDelayMs: DEFAULT_SOUND_COMPLETION_DELAY_MS
    })
  }))

  app.post('/api/v1/lower-third/hide', asyncHandler(async (req, res) => {
    res.json({ ok: true, lowerThird: lowerThirdSync.hide() })
  }))

  app.post('/api/v1/lower-third/show', asyncHandler(async (req, res) => {
    res.json({ ok: true, lowerThird: lowerThirdSync.show() })
  }))

  app.post('/api/v1/lower-third/toggle', asyncHandler(async (req, res) => {
    res.json({ ok: true, lowerThird: lowerThirdSync.toggle() })
  }))

  app.post('/api/v1/text', asyncHandler(async (req, res) => {
    enqueueTextAlert(res, req, 'Text Alert')
  }))

  app.post('/api/v1/alert', asyncHandler(async (req, res) => {
    enqueueTextAlert(res, req, 'Overlay Alert')
  }))

  app.post('/api/v1/sound', asyncHandler(async (req, res) => {
    const { src, volume } = req.body
    const soundSrc = validateSoundSrc(src)
    if (!soundSrc) {
      return res.status(400).json({
        error: 'src must be a local sound path ending in .mp3, .ogg, or .wav'
      })
    }
    assertSoundFileExists(soundSrc)

    enqueueApiActions(res, 'Sound Alert', [
      { type: 'sound.play', src: soundSrc, volume },
      { type: 'overlay.emit', event: 'bg-alert' }
    ], {
      completionDelayMs: getRequestCompletionDelay(req),
      fallbackCompletionDelayMs: DEFAULT_SOUND_COMPLETION_DELAY_MS
    })
  }))

  app.post('/api/v1/sound-random', asyncHandler(async (req, res) => {
    enqueueApiActions(res, 'Random SFX Alert', [
      { type: 'sound.pickRandom', contextKey: 'sfx' },
      { type: 'overlay.alert', message: '{sfx.text}' },
      { type: 'sound.play', src: '{sfx.src}', volume: 0.8 }
    ], {
      completionDelayMs: getRequestCompletionDelay(req),
      fallbackCompletionDelayMs: DEFAULT_SOUND_COMPLETION_DELAY_MS
    })
  }))

  app.post('/api/v1/chat/say', asyncHandler(async (req, res) => {
    const message = getBodyMessage(req)
    if (!message) return res.status(400).json({ error: 'message or msg is required' })

    enqueueApiActions(res, 'Chat Message', { type: 'chat.say', message })
  }))

  app.post('/api/v1/queue/pause', (req, res) => {
    res.json({ ok: true, queue: actionQueue.pause() })
  })

  app.post('/api/v1/queue/resume', (req, res) => {
    res.json({ ok: true, queue: actionQueue.resume() })
  })

  app.post('/api/v1/queue/skip', (req, res) => {
    res.json({ ok: true, queue: actionQueue.skipNext() })
  })

  app.post('/api/v1/queue/clear', (req, res) => {
    res.json({ ok: true, queue: actionQueue.clear() })
  })

  app.post('/api/v1/obs/scene', asyncHandler(async (req, res) => {
    const { scene } = req.body
    enqueueApiActions(res, 'OBS Scene', { type: 'obs.scene', scene })
  }))

  app.post('/api/v1/obs/source', asyncHandler(async (req, res) => {
    const { scene, source, visible, status } = req.body
    enqueueApiActions(res, 'OBS Source', { type: 'obs.source', scene, source, visible: visible ?? status })
  }))

  app.post('/api/v1/obs/mute', asyncHandler(async (req, res) => {
    const { input, source, muted, status } = req.body
    enqueueApiActions(res, 'OBS Mute', { type: 'obs.mute', input: input || source, muted: muted ?? status })
  }))

  app.post('/api/v1/actions/run', asyncHandler(async (req, res) => {
    const submittedActions = req.body.actions || req.body.action || req.body
    const results = await actions.run(submittedActions, { source: 'api' })
    res.json({ ok: true, results })
  }))

  app.post('/api/v1/actions/enqueue', asyncHandler(async (req, res) => {
    const submittedActions = req.body.actions || req.body.action || req.body
    enqueueApiActions(res, req.body.name || 'Control action', submittedActions, {
      completionDelayMs: getRequestCompletionDelay(req)
    })
  }))

  app.post('/api/v1/macros/:id/run', asyncHandler(async (req, res) => {
    const macro = macros.find(req.params.id)
    if (!macro) return res.status(404).json({ error: 'Macro not found' })
    const macroDelay = macro.completionDelayMs ?? macro.delayMs

    const queue = actionQueue.enqueue({
      name: macro.name,
      actions: macro.actions,
      completionDelayMs: macroDelay === undefined ? undefined : normalizeCompletionDelay(macroDelay),
      fallbackCompletionDelayMs: DEFAULT_SOUND_COMPLETION_DELAY_MS,
      context: { macro: macro.id, source: 'macro' },
      source: 'macro'
    })
    res.json({ ok: true, macro, queue })
  }))

  app.post('/api/v1/test', asyncHandler(async (req, res) => {
    enqueueApiActions(res, 'Test Alert', [
      { type: 'overlay.alert', message: 'VipOS MK V test alert' },
      { type: 'sound.play', src: DEFAULT_ALERT_SOUND, volume: 1 }
    ], {
      completionDelayMs: getRequestCompletionDelay(req),
      fallbackCompletionDelayMs: DEFAULT_SOUND_COMPLETION_DELAY_MS
    })
  }))


  /**
   * 404 / All
   *
   */
  app.all('*', (req, res) => {
    res.status(404).render('404.ejs')
  })

  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err)
    const statusCode = err.statusCode || 500
    if (statusCode >= 500) console.error(err)
    res.status(statusCode).json({
      error: err.message || 'Unexpected server error'
    })
  })

  return app
}

function attachAppRequestHandler(server, app) {
  server.on('request', (req, res) => {
    if (req.url && req.url.startsWith('/socket.io/')) return
    app(req, res)
  })
}

/**
 * Listen on port
 *
 */
function startServer({ port = PORT, createServices = createRuntimeServices } = {}) {
  const server = http.createServer()
  const portContext = createPortContext(port)
  const io = createSocketServer(server, { portContext })
  const services = createServices({ io })
  const app = createApp(services, { portContext })
  attachAppRequestHandler(server, app)

  server.listen(port, '127.0.0.1', async () => {
    const address = server.address()
    if (address && typeof address === 'object') portContext.setPort(address.port)
    console.log(`server is listening on port ${portContext.getPort()}....`)
    await startRuntimeServices(services)
  })

  return { app, server, services }
}

if (require.main === module) {
  startServer()
}

module.exports = {
  attachAppRequestHandler,
  createApp,
  createRuntimeServices,
  createSocketServer,
  startRuntimeServices,
  startServer
}
