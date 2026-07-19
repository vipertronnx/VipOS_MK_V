const fs = require('fs')
const path = require('path')
const { createPersistenceError, writeJsonFile } = require('./utils/json-file')
const { parseBool } = require('./utils/value-normalization')

const DEFAULT_STATE_FILE = path.join(__dirname, '..', 'config', 'raffle.json')
const DEFAULT_MIN_DELAY_MS = 5 * 60 * 1000
const DEFAULT_MAX_DELAY_MS = 10 * 60 * 1000
const DEFAULT_ENTRY_WINDOW_MS = 2 * 60 * 1000
const DEFAULT_COUNTDOWN_INTERVAL_MS = 30 * 1000
const DEFAULT_POINT_AMOUNTS = [100, 150, 200, 250, 300, 350, 400, 450, 500]
const DEFAULT_POINT_NAME = 'raffle points'
const DEFAULT_POINT_TWITCH_EMOJI = ''
const DEFAULT_ALERT_SOUND = 'example.mp3'
const DEFAULT_ENTRY_COMMAND = '!join'
const DEFAULT_POINTS_COMMAND = '!points'

function createRaffleService({
  logger = console,
  announce = async () => {},
  announceImmediate = announce,
  stateFile = DEFAULT_STATE_FILE,
  settings = readEnvSettings()
} = {}) {
  let eventTimer = null
  let closeTimer = null
  let countdownTimer = null
  const state = loadState(stateFile, settings, logger)

  function enable({ requirePersistence = false } = {}) {
    if (state.enabled) return getStatus()

    const rollbackState = requirePersistence ? cloneState(state) : null
    state.enabled = true
    state.updatedAt = nowIso()

    if (state.current && state.current.status === 'open') {
      save({ requirePersistence, rollbackState })
      return getStatus()
    }

    return start({ requirePersistence, rollbackState })
  }

  function disable({ requirePersistence = false } = {}) {
    const wasEnabled = state.enabled
    const hadOpenRaffle = Boolean(state.current && state.current.status === 'open')
    const rollbackState = requirePersistence ? cloneState(state) : null

    state.enabled = false
    state.updatedAt = nowIso()
    if (hadOpenRaffle) {
      state.current.status = 'canceled'
      state.current.closedAt = nowIso()
    }
    state.nextEventAt = null
    save({ requirePersistence, rollbackState })
    clearEventTimer()
    clearCloseTimer()
    clearCountdownTimer()
    if (wasEnabled || hadOpenRaffle) announceRaffleDisabled(hadOpenRaffle)
    return getStatus()
  }

  function toggle(options = {}) {
    return state.enabled ? disable(options) : enable(options)
  }

  function start({ requirePersistence = false, rollbackState = null } = {}) {
    if (state.current && state.current.status === 'open') return getStatus()

    const rollback = rollbackState || (requirePersistence ? cloneState(state) : null)
    const openedAt = nowIso()
    const closesAt = new Date(Date.now() + state.settings.entryWindowMs).toISOString()
    const roundNumber = Number(state.totals.roundsStarted || 0) + 1
    const prizeAmount = pickRandom(state.settings.pointAmounts)

    state.current = {
      id: `raffle-${Date.now()}`,
      roundNumber,
      status: 'open',
      openedAt,
      closesAt,
      prizeAmount,
      pointName: state.settings.pointName,
      pointTwitchEmoji: state.settings.pointTwitchEmoji,
      entrants: {}
    }
    state.nextEventAt = null
    state.totals.roundsStarted = roundNumber
    state.updatedAt = openedAt
    save({ requirePersistence, rollbackState: rollback })

    clearEventTimer()
    clearCloseTimer()
    scheduleClose()
    scheduleCountdown()
    announceRaffleOpen().catch(handleAnnounceError)
    return getStatus()
  }

  function close({ requirePersistence = false } = {}) {
    if (!state.current || state.current.status !== 'open') return getStatus()

    const rollbackState = requirePersistence ? cloneState(state) : null

    const closedAt = nowIso()
    const entrants = Object.values(state.current.entrants || {})
    const winner = entrants.length ? entrants[Math.floor(Math.random() * entrants.length)] : null
    const prizeAmount = numberOrDefault(state.current.prizeAmount, pickRandom(state.settings.pointAmounts))
    const pointName = state.current.pointName || state.settings.pointName
    const pointTwitchEmoji = state.current.pointTwitchEmoji === undefined
      ? state.settings.pointTwitchEmoji
      : state.current.pointTwitchEmoji

    state.current.status = 'closed'
    state.current.closedAt = closedAt
    state.current.prizeAmount = prizeAmount
    state.current.pointName = pointName
    state.current.pointTwitchEmoji = pointTwitchEmoji
    state.current.winner = winner ? summarizeUser(winner) : null
    state.updatedAt = closedAt
    state.totals.roundsClosed = Number(state.totals.roundsClosed || 0) + 1

    const historyItem = {
      id: state.current.id,
      roundNumber: state.current.roundNumber,
      openedAt: state.current.openedAt,
      closedAt,
      entrantCount: entrants.length,
      prizeAmount,
      pointName,
      pointTwitchEmoji,
      winner: winner ? summarizeUser(winner) : null
    }

    if (winner) {
      const user = ensureUser(winner)
      user.wins += 1
      user.points += prizeAmount
      user.lastWonAt = closedAt
      historyItem.pointsAwarded = prizeAmount
    }

    state.history.unshift(historyItem)
    state.history = state.history.slice(0, state.settings.maxHistory)
    scheduleNextEvent({ requirePersistence, rollbackState })

    clearCloseTimer()
    clearCountdownTimer()
    announceRaffleClosed(historyItem).catch(handleAnnounceError)
    return getStatus()
  }

  async function handleChatMessage(context = {}) {
    if (!state.enabled) return false

    const command = getCommandName(context.message)
    if (!command) return false

    if (command === normalizeCommand(state.settings.entryCommand)) {
      enter(context)
      return true
    }

    if (command === normalizeCommand(state.settings.pointsCommand)) {
      await announcePoints(context)
      return true
    }

    return false
  }

  function enter(context = {}) {
    if (!state.current || state.current.status !== 'open') {
      announceNoOpenRaffle(context).catch(handleAnnounceError)
      return getStatus()
    }

    if (Date.now() >= new Date(state.current.closesAt).getTime()) {
      close()
      return getStatus()
    }

    const user = ensureUser(context)
    const wasEntered = Boolean(state.current.entrants[user.key])

    state.current.entrants[user.key] = summarizeUser(user)
    state.current.entrantCount = Object.keys(state.current.entrants).length

    if (!wasEntered) {
      user.entries += 1
      user.lastEnteredAt = nowIso()
      state.totals.entries = Number(state.totals.entries || 0) + 1
      announceEntered(user, state.current.entrantCount).catch(handleAnnounceError)
    } else {
      announceAlreadyEntered(user).catch(handleAnnounceError)
    }

    state.updatedAt = nowIso()
    save()
    return getStatus()
  }

  function scheduleNextEvent({ requirePersistence = false, rollbackState = null } = {}) {
    if (!state.enabled) {
      state.nextEventAt = null
      save({ requirePersistence, rollbackState })
      clearEventTimer()
      return
    }

    if (state.current && state.current.status === 'open') {
      clearEventTimer()
      scheduleClose()
      scheduleCountdown()
      return
    }

    const delay = randomDelay(state.settings.minDelayMs, state.settings.maxDelayMs)
    state.nextEventAt = new Date(Date.now() + delay).toISOString()
    save({ requirePersistence, rollbackState })

    clearEventTimer()
    eventTimer = setTimeout(() => {
      eventTimer = null
      start()
    }, delay)
  }

  function scheduleCountdown() {
    clearCountdownTimer()
    if (!state.current || state.current.status !== 'open') return
    if (state.settings.countdownIntervalMs <= 0) return

    const closesAt = new Date(state.current.closesAt).getTime()
    const remainingMs = closesAt - Date.now()
    if (remainingMs <= 0) return

    const delay = Math.min(state.settings.countdownIntervalMs, remainingMs)
    countdownTimer = setTimeout(() => {
      countdownTimer = null
      announceCountdown()
      scheduleCountdown()
    }, delay)
  }

  function scheduleClose() {
    clearCloseTimer()
    if (!state.current || state.current.status !== 'open') return

    const delay = Math.max(new Date(state.current.closesAt).getTime() - Date.now(), 0)
    closeTimer = setTimeout(() => {
      closeTimer = null
      close()
    }, delay)
  }

  function startTimers() {
    if (state.current && state.current.status === 'open') {
      if (Date.now() >= new Date(state.current.closesAt).getTime()) close()
      else {
        scheduleClose()
        scheduleCountdown()
      }
    }

    if (state.enabled) scheduleNextEvent()
  }

  function stopTimers() {
    clearEventTimer()
    clearCloseTimer()
    clearCountdownTimer()
  }

  function getStatus() {
    const users = Object.values(state.users || {})
      .map(user => ({ ...user }))
      .sort((a, b) => b.points - a.points || b.wins - a.wins || a.displayName.localeCompare(b.displayName))

    const current = state.current ? {
      ...state.current,
      entrants: undefined,
      entrantCount: Object.keys(state.current.entrants || {}).length
    } : null

    return {
      enabled: state.enabled,
      current,
      countdownIntervalMs: state.settings.countdownIntervalMs,
      entryCommand: state.settings.entryCommand,
      pointsCommand: state.settings.pointsCommand,
      entryWindowMs: state.settings.entryWindowMs,
      pointAmounts: state.settings.pointAmounts.slice(),
      pointName: state.settings.pointName,
      pointTwitchEmoji: state.settings.pointTwitchEmoji,
      lastError: state.lastError || null,
      lastPersistenceError: state.lastPersistenceError || null,
      nextEventAt: state.nextEventAt,
      totals: { ...state.totals },
      updatedAt: state.updatedAt,
      users,
      winners: state.history.slice(0, 10)
    }
  }

  function ensureUser(context = {}) {
    const key = normalizeUserKey(context)
    if (!state.users[key]) {
      state.users[key] = {
        key,
        userId: context.userId || '',
        username: context.username || context.user || '',
        displayName: context.displayName || context.username || context.user || 'Viewer',
        entries: 0,
        wins: 0,
        points: 0,
        lastEnteredAt: null,
        lastWonAt: null
      }
    }

    const user = state.users[key]
    user.userId = context.userId || user.userId || ''
    user.username = context.username || context.user || user.username || ''
    user.displayName = context.displayName || user.displayName || user.username || 'Viewer'
    return user
  }

  function save({ requirePersistence = false, rollbackState = null } = {}) {
    state.lastPersistenceError = null
    const error = persistState(stateFile, state, logger)
    if (!error) return true

    if (rollbackState) restoreState(state, rollbackState)
    state.lastPersistenceError = error.message
    if (requirePersistence) throw createPersistenceError('Failed to persist raffle state', error)
    return false
  }

  async function announceRaffleOpen() {
    const chatPrize = formatPrizeForChat(state.current.prizeAmount, state.current.pointName, state.current.pointTwitchEmoji)
    const overlayPrize = formatPrize(state.current.prizeAmount, state.current.pointName)
    await announce([
      {
        type: 'chat.say',
        message: `/me New Raffle for ${chatPrize}. Winner picked in ${formatDuration(state.settings.entryWindowMs)}. Type "${state.settings.entryCommand}" to enter.`
      },
      {
        type: 'overlay.alert',
        message: `New Raffle started for ${overlayPrize}!`,
        sound: state.settings.alertSound || false
      }
    ], { source: 'raffle', raffle: { event: 'open', id: state.current.id } })
  }

  async function announceRaffleClosed(historyItem) {
    const chatMessage = historyItem.winner
      ? `Raffle winner: ${historyItem.winner.displayName}. +${formatPrizeForChat(historyItem.pointsAwarded, historyItem.pointName, historyItem.pointTwitchEmoji)}.`
      : 'Raffle closed with no entries.'
    const overlayMessage = historyItem.winner
      ? `Raffle winner: ${historyItem.winner.displayName}. +${formatPrize(historyItem.pointsAwarded, historyItem.pointName)}.`
      : 'Raffle closed with no entries.'

    await announce([
      { type: 'chat.say', message: chatMessage },
      { type: 'overlay.alert', message: overlayMessage }
    ], { source: 'raffle', raffle: { event: 'closed', id: historyItem.id } })
  }

  function announceRaffleDisabled(hadOpenRaffle) {
    const message = hadOpenRaffle
      ? 'Any open raffle has been closed. The automated raffle system is now off.'
      : 'The automated raffle system is now off.'

    safeAnnounce({
      type: 'chat.say',
      message
    }, { source: 'raffle', raffle: { event: 'disabled' } }, announceImmediate)
  }

  function announceCountdown() {
    if (!state.current || state.current.status !== 'open') return

    const remainingSeconds = Math.max(Math.ceil((new Date(state.current.closesAt).getTime() - Date.now()) / 1000), 0)
    if (remainingSeconds <= 0) return

    safeAnnounce({
      type: 'chat.say',
      message: `/me Raffle closes in ${remainingSeconds} second${remainingSeconds === 1 ? '' : 's'} for ${formatPrizeForChat(state.current.prizeAmount, state.current.pointName, state.current.pointTwitchEmoji)}. Type "${state.settings.entryCommand}" to enter.`
    }, { source: 'raffle', raffle: { event: 'countdown', id: state.current.id, remainingSeconds } }, announceImmediate)
  }

  async function announceEntered(user, entrantCount) {
    await announce({
      type: 'chat.say',
      message: `${user.displayName} entered the raffle. ${entrantCount} entered.`
    }, { source: 'raffle', raffle: { event: 'entry', userId: user.userId, username: user.username } })
  }

  async function announceAlreadyEntered(user) {
    await announce({
      type: 'chat.say',
      message: `${user.displayName}, you are already entered.`
    }, { source: 'raffle', raffle: { event: 'duplicate-entry', userId: user.userId, username: user.username } })
  }

  async function announceNoOpenRaffle(context) {
    await announce({
      type: 'chat.say',
      message: `No raffle is open right now. Next raffle: ${state.nextEventAt ? formatDate(state.nextEventAt) : 'not scheduled'}.`
    }, { source: 'raffle', messageId: context.messageId })
  }

  async function announcePoints(context) {
    const user = ensureUser(context)
    await announce({
      type: 'chat.say',
      message: `${user.displayName}: ${formatPrizeForChat(user.points, state.settings.pointName, state.settings.pointTwitchEmoji)}, ${user.wins} win${user.wins === 1 ? '' : 's'}, ${user.entries} entr${user.entries === 1 ? 'y' : 'ies'}.`
    }, { source: 'raffle', messageId: context.messageId })
  }

  function handleAnnounceError(error) {
    state.lastError = error.message
    logger.error(`Raffle announcement failed: ${error.message}`)
    save()
  }

  function safeAnnounce(actionList, context, announcer = announce) {
    try {
      Promise.resolve(announcer(actionList, context)).catch(handleAnnounceError)
    } catch (error) {
      handleAnnounceError(error)
    }
  }

  function clearEventTimer() {
    if (eventTimer) clearTimeout(eventTimer)
    eventTimer = null
  }

  function clearCloseTimer() {
    if (closeTimer) clearTimeout(closeTimer)
    closeTimer = null
  }

  function clearCountdownTimer() {
    if (countdownTimer) clearTimeout(countdownTimer)
    countdownTimer = null
  }

  return {
    close,
    disable,
    enable,
    enter,
    getStatus,
    handleChatMessage,
    start,
    startTimers,
    stopTimers,
    toggle
  }
}

function loadState(stateFile, settings, logger = console) {
  const stored = readJson(stateFile, logger)
  const now = nowIso()
  const normalizedSettings = normalizeSettings({ ...(stored.settings || {}), ...settings })

  return {
    enabled: Boolean(stored.enabled ?? settings.enabled),
    current: normalizeCurrent(stored.current, normalizedSettings),
    history: Array.isArray(stored.history) ? stored.history : [],
    lastError: stored.lastError || null,
    lastPersistenceError: null,
    nextEventAt: stored.nextEventAt || null,
    settings: normalizedSettings,
    totals: {
      entries: 0,
      roundsClosed: 0,
      roundsStarted: 0,
      ...(stored.totals || {})
    },
    updatedAt: stored.updatedAt || now,
    users: stored.users && typeof stored.users === 'object' ? stored.users : {}
  }
}

function normalizeCurrent(current, settings) {
  if (!current || typeof current !== 'object') return null
  return {
    ...current,
    prizeAmount: numberOrDefault(current.prizeAmount, pickRandom(settings.pointAmounts)),
    pointName: current.pointName || settings.pointName,
    pointTwitchEmoji: current.pointTwitchEmoji === undefined ? settings.pointTwitchEmoji : current.pointTwitchEmoji,
    entrants: current.entrants && typeof current.entrants === 'object' ? current.entrants : {}
  }
}

function persistState(stateFile, state, logger) {
  try {
    writeJsonFile(stateFile, state)
    return null
  } catch (error) {
    logger.error(`Failed to persist raffle state: ${error.message}`)
    return error
  }
}

function cloneState(state) {
  return JSON.parse(JSON.stringify(state))
}

function restoreState(target, snapshot) {
  for (const key of Object.keys(target)) delete target[key]
  Object.assign(target, snapshot)
}

function readJson(file, logger = console) {
  if (!file || !fs.existsSync(file)) return {}

  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    if (logger && typeof logger.warn === 'function') {
      logger.warn(`Failed to load raffle state ${file}: ${error.message}`)
    }
    return {}
  }
}

function readEnvSettings() {
  const settings = {}

  if (process.env.RAFFLE_ENABLED !== undefined) settings.enabled = parseBool(process.env.RAFFLE_ENABLED, false)
  if (process.env.RAFFLE_ENTRY_COMMAND) settings.entryCommand = process.env.RAFFLE_ENTRY_COMMAND
  if (process.env.RAFFLE_POINTS_COMMAND) settings.pointsCommand = process.env.RAFFLE_POINTS_COMMAND
  if (process.env.RAFFLE_COUNTDOWN_INTERVAL_MS) settings.countdownIntervalMs = numberOrZero(process.env.RAFFLE_COUNTDOWN_INTERVAL_MS, DEFAULT_COUNTDOWN_INTERVAL_MS)
  if (process.env.RAFFLE_ENTRY_WINDOW_MS) settings.entryWindowMs = numberOrDefault(process.env.RAFFLE_ENTRY_WINDOW_MS, DEFAULT_ENTRY_WINDOW_MS)
  if (process.env.RAFFLE_MAX_DELAY_MS) settings.maxDelayMs = numberOrDefault(process.env.RAFFLE_MAX_DELAY_MS, DEFAULT_MAX_DELAY_MS)
  if (process.env.RAFFLE_MAX_HISTORY) settings.maxHistory = numberOrDefault(process.env.RAFFLE_MAX_HISTORY, 50)
  if (process.env.RAFFLE_MIN_DELAY_MS) settings.minDelayMs = numberOrDefault(process.env.RAFFLE_MIN_DELAY_MS, DEFAULT_MIN_DELAY_MS)
  if (process.env.RAFFLE_POINT_AMOUNTS) settings.pointAmounts = parsePointAmounts(process.env.RAFFLE_POINT_AMOUNTS)
  if (process.env.RAFFLE_POINT_NAME) settings.pointName = process.env.RAFFLE_POINT_NAME
  if (process.env.RAFFLE_POINT_TWITCH_EMOJI !== undefined) settings.pointTwitchEmoji = process.env.RAFFLE_POINT_TWITCH_EMOJI
  if (process.env.RAFFLE_ALERT_SOUND !== undefined) settings.alertSound = process.env.RAFFLE_ALERT_SOUND
  if (process.env.RAFFLE_WIN_POINTS && !settings.pointAmounts) {
    settings.pointAmounts = [numberOrDefault(process.env.RAFFLE_WIN_POINTS, DEFAULT_POINT_AMOUNTS[0])]
  }

  return settings
}

function normalizeSettings(settings = {}) {
  const minDelayMs = numberOrDefault(settings.minDelayMs, DEFAULT_MIN_DELAY_MS)
  const maxDelayMs = Math.max(numberOrDefault(settings.maxDelayMs, DEFAULT_MAX_DELAY_MS), minDelayMs)

  return {
    enabled: Boolean(settings.enabled),
    countdownIntervalMs: numberOrZero(settings.countdownIntervalMs, DEFAULT_COUNTDOWN_INTERVAL_MS),
    entryCommand: normalizeChatCommand(settings.entryCommand || DEFAULT_ENTRY_COMMAND),
    pointsCommand: normalizeChatCommand(settings.pointsCommand || DEFAULT_POINTS_COMMAND),
    entryWindowMs: numberOrDefault(settings.entryWindowMs, DEFAULT_ENTRY_WINDOW_MS),
    maxDelayMs,
    maxHistory: numberOrDefault(settings.maxHistory, 50),
    minDelayMs,
    alertSound: normalizeOptionalText(settings.alertSound ?? process.env.DEFAULT_ALERT_SOUND ?? DEFAULT_ALERT_SOUND),
    pointAmounts: normalizePointAmounts(settings.pointAmounts || settings.winPoints),
    pointName: normalizePointName(settings.pointName),
    pointTwitchEmoji: normalizeOptionalText(settings.pointTwitchEmoji ?? DEFAULT_POINT_TWITCH_EMOJI)
  }
}

function normalizeOptionalText(value) {
  return String(value || '').trim()
}

function normalizePointAmounts(value) {
  if (Array.isArray(value)) {
    const amounts = value
      .map(amount => Number(amount))
      .filter(amount => Number.isFinite(amount) && amount > 0)
      .map(amount => Math.round(amount))
    return amounts.length ? amounts : DEFAULT_POINT_AMOUNTS.slice()
  }

  const amount = Number(value)
  if (Number.isFinite(amount) && amount > 0) return [Math.round(amount)]
  return DEFAULT_POINT_AMOUNTS.slice()
}

function parsePointAmounts(value) {
  const text = String(value || '').trim()
  if (!text) return DEFAULT_POINT_AMOUNTS.slice()

  try {
    return normalizePointAmounts(JSON.parse(text))
  } catch (error) {
    return normalizePointAmounts(text.split(','))
  }
}

function normalizePointName(value) {
  const text = String(value || '').trim()
  return text || DEFAULT_POINT_NAME
}

function normalizeChatCommand(value) {
  const text = String(value || '').trim().toLowerCase()
  if (!text) return DEFAULT_ENTRY_COMMAND
  return text.startsWith('!') ? text : `!${text}`
}

function getCommandName(message) {
  const match = String(message || '').trim().match(/^(\S+)/)
  return match ? normalizeCommand(match[1]) : ''
}

function normalizeCommand(value) {
  return String(value || '').trim().toLowerCase()
}

function normalizeUserKey(context = {}) {
  return String(context.userId || context.username || context.user || context.displayName || 'unknown').trim().toLowerCase()
}

function summarizeUser(user) {
  return {
    key: user.key,
    userId: user.userId,
    username: user.username,
    displayName: user.displayName
  }
}

function randomDelay(minDelayMs, maxDelayMs) {
  if (maxDelayMs <= minDelayMs) return minDelayMs
  return Math.floor(minDelayMs + Math.random() * (maxDelayMs - minDelayMs + 1))
}

function pickRandom(items) {
  const list = Array.isArray(items) && items.length ? items : DEFAULT_POINT_AMOUNTS
  return list[Math.floor(Math.random() * list.length)]
}

function numberOrDefault(value, defaultValue) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.round(number) : defaultValue
}

function numberOrZero(value, defaultValue) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : defaultValue
}

function nowIso() {
  return new Date().toISOString()
}

function formatDuration(ms) {
  const seconds = Math.max(Math.round(ms / 1000), 1)
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (!minutes) return `${seconds} second${seconds === 1 ? '' : 's'}`
  if (!remainingSeconds) return `${minutes} minute${minutes === 1 ? '' : 's'}`
  return `${minutes}m ${remainingSeconds}s`
}

function formatDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleTimeString()
}

function formatPrize(amount, pointName) {
  return `${Number(amount) || 0} ${normalizePointName(pointName)}`
}

function formatPrizeForChat(amount, pointName, pointTwitchEmoji) {
  const emoji = normalizeOptionalText(pointTwitchEmoji)
  return emoji ? `${formatPrize(amount, pointName)} ${emoji}` : formatPrize(amount, pointName)
}

module.exports = {
  createRaffleService
}
