/**
 * Parses a JSON environment value into distinct, exact OBS program-scene names.
 *
 * @param {*} value JSON array of scene-name strings.
 * @param {object} [options] Parsing dependencies.
 * @param {object} [options.logger=console] Logger used to report malformed configuration.
 * @param {string} [options.variableName='LOWER_THIRD_ALWAYS_VISIBLE_OBS_SCENES'] Configuration variable named in warnings.
 * @returns {string[]} Configured scene names in their first-seen order.
 */
function parseAlwaysVisibleObsScenes(value, {
  logger = console,
  variableName = 'LOWER_THIRD_ALWAYS_VISIBLE_OBS_SCENES'
} = {}) {
  if (value === undefined || value === null || String(value).trim() === '') return []

  try {
    const parsed = JSON.parse(String(value))
    if (!Array.isArray(parsed) || parsed.some(scene => typeof scene !== 'string')) {
      throw new Error('must be a JSON array of strings')
    }

    return normalizeSceneNames(parsed)
  } catch (error) {
    logger.warn(`${variableName} must be a JSON array of OBS program-scene names. Ignoring the configured override: ${error.message}`)
    return []
  }
}

/**
 * Creates the shared hide/show state used by the News Chyron and Venom Coin overlays.
 * Configured OBS program scenes force both overlays visible and suspend their shared timer.
 *
 * @param {object} options Service dependencies and configuration.
 * @param {object} options.io Socket.IO server used to emit overlay events.
 * @param {number} options.visibleDurationMs Time the shared lower third remains visible before automatically hiding.
 * @param {number} options.hiddenDurationMs Time the shared lower third remains hidden before automatically showing.
 * @param {string[]} [options.alwaysVisibleObsScenes=[]] OBS scenes that force the shared lower third visible.
 * @param {Function} [options.setTimer=setTimeout] Timeout scheduler, injected for tests.
 * @param {Function} [options.clearTimer=clearTimeout] Timeout cleanup function, injected for tests.
 * @returns {object} Shared lower-third state and controls.
 */
function createLowerThirdSync({
  io,
  visibleDurationMs,
  hiddenDurationMs,
  alwaysVisibleObsScenes = [],
  setTimer = setTimeout,
  clearTimer = clearTimeout
}) {
  const configuredScenes = normalizeSceneNames(alwaysVisibleObsScenes)
  const alwaysVisibleSceneSet = new Set(configuredScenes)
  let currentObsScene = null
  let forcedVisible = false
  let hidden = false
  let timer = null

  function emitState(event = 'lower-third-toggle') {
    io.emit(event, { hidden })
  }

  function stopTimer() {
    if (timer !== null) clearTimer(timer)
    timer = null
  }

  function startTimer() {
    if (timer !== null || forcedVisible) return

    const durationMs = hidden ? hiddenDurationMs : visibleDurationMs
    if (durationMs <= 0) return

    timer = setTimer(() => {
      timer = null
      toggle()
    }, durationMs)
  }

  function restartTimer() {
    stopTimer()
    startTimer()
  }

  function setHidden(nextHidden, event) {
    if (forcedVisible && nextHidden) return getStatus()

    hidden = Boolean(nextHidden)
    emitState(event)
    restartTimer()
    return getStatus()
  }

  function toggle() {
    if (forcedVisible) return getStatus()

    return setHidden(!hidden, 'lower-third-toggle')
  }

  function show() {
    return setHidden(false, 'lower-third-show')
  }

  /**
   * Applies the program-scene policy to the shared lower-third state.
   * Entering a configured scene makes both overlays visible and pauses the timer.
   * Leaving one makes both visible and restarts the full visible duration.
   *
   * @param {string|null|undefined} sceneName Active OBS program-scene name.
   * @returns {object} Current lower-third status.
   */
  function setCurrentObsScene(sceneName) {
    currentObsScene = normalizeSceneName(sceneName)
    const nextForcedVisible = Boolean(currentObsScene && alwaysVisibleSceneSet.has(currentObsScene))

    if (nextForcedVisible === forcedVisible) return getStatus()

    forcedVisible = nextForcedVisible
    return show()
  }

  function emitOverlayEvent(event, payload = {}) {
    if (event === 'lower-third-hide') return setHidden(true, event)
    if (event === 'lower-third-show') return show()
    if (event === 'lower-third-toggle') {
      if (payload && typeof payload.hidden === 'boolean') return setHidden(payload.hidden, event)
      return toggle()
    }

    io.emit(event, payload)
  }

  function getStatus() {
    return {
      alwaysVisibleObsScenes: configuredScenes,
      currentObsScene,
      forcedVisible,
      hidden,
      timerRunning: timer !== null,
      hiddenDurationMs,
      visibleDurationMs
    }
  }

  io.on('connection', socket => {
    socket.emit('lower-third-sync', { hidden })
    socket.on('lower-third-sync-request', () => {
      socket.emit('lower-third-sync', { hidden })
    })
  })

  startTimer()

  return {
    emitOverlayEvent,
    getStatus,
    hide: () => setHidden(true, 'lower-third-hide'),
    setCurrentObsScene,
    show,
    stop: stopTimer,
    toggle
  }
}

function normalizeSceneNames(values) {
  const seen = new Set()
  const names = []

  for (const value of Array.isArray(values) ? values : []) {
    const name = normalizeSceneName(value)
    if (!name || seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }

  return names
}

function normalizeSceneName(value) {
  if (typeof value !== 'string') return null
  const name = value.trim()
  return name || null
}

module.exports = {
  createLowerThirdSync,
  normalizeSceneNames,
  parseAlwaysVisibleObsScenes
}
