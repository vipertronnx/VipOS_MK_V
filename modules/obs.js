const { default: OBSWebSocket } = require('obs-websocket-js')
const { userInputError } = require('./utils/errors')

/** @typedef {import('../types/obs').ObsDiscovery} ObsDiscovery */
/** @typedef {import('../types/obs').ObsService} ObsService */
/** @typedef {import('../types/obs').ObsStatus} ObsStatus */

/**
 * Creates an environment-configured OBS WebSocket service that serializes requested lifecycle transitions and schedules reconnects after connection-closed events while running.
 *
 * @param {object} [options] Client and timer dependencies, primarily for runtime integration and testing.
 * @param {object} [options.obsClient] OBS WebSocket-compatible client.
 * @returns {ObsService} Connection lifecycle, OBS request, scene, source, input, and discovery operations.
 */
function createObsService({
  clearTimer = clearTimeout,
  logger = console,
  obsClient = new OBSWebSocket(),
  setTimer = setTimeout
} = {}) {
  const obs = obsClient
  const address = process.env.OBS_ADDRESS
  const password = process.env.OBS_PASSWORD || undefined
  const reconnectMs = normalizeReconnectMs(process.env.OBS_RECONNECT_RETRY_INTERVAL)
  let lifecyclePromise = Promise.resolve()
  let lifecycleVersion = 0
  let shouldRun = false
  const sceneListeners = new Set()

  const state = {
    enabled: process.env.OBS_ENABLED !== 'false' && Boolean(address),
    connected: false,
    identified: false,
    connecting: false,
    currentScene: null,
    lastError: null,
    reconnectTimer: null
  }

  obs.on('ConnectionOpened', () => {
    state.connected = true
    logger.log('OBS connection opened')
  })

  obs.on('Identified', async () => {
    state.identified = true
    state.lastError = null

    try {
      const currentScene = await getCurrentScene()
      logger.log(`OBS identified, current scene: ${currentScene}`)
    } catch (error) {
      logger.warn(`OBS identified, but current scene could not be read: ${error.message}`)
    }
  })

  obs.on('ConnectionClosed', () => {
    state.connected = false
    state.identified = false
    logger.warn('OBS connection closed')
    scheduleReconnect()
  })

  obs.on('CurrentProgramSceneChanged', data => {
    updateCurrentScene(data.sceneName)
  })

  /**
   * Subscribes to distinct OBS program-scene changes.
   *
   * @param {(sceneName: string) => void} listener Callback invoked after the cached current scene changes.
   * @returns {() => void} Removes the listener.
   */
  function onCurrentSceneChanged(listener) {
    if (typeof listener !== 'function') throw new TypeError('OBS scene listener must be a function')
    sceneListeners.add(listener)
    if (state.currentScene) notifySceneListener(listener, state.currentScene)
    return () => sceneListeners.delete(listener)
  }

  function updateCurrentScene(sceneName) {
    if (typeof sceneName !== 'string' || !sceneName || state.currentScene === sceneName) return
    state.currentScene = sceneName
    for (const listener of sceneListeners) {
      notifySceneListener(listener, sceneName)
    }
  }

  function notifySceneListener(listener, sceneName) {
    try {
      listener(sceneName)
    } catch (error) {
      logger.error(`OBS scene listener failed: ${error.message}`)
    }
  }

  /**
   * Queues a connection attempt and enables reconnects after unexpected connection loss.
   *
   * @returns {Promise<void>} Resolves after the serialized connection transition completes; failures are recorded in service status.
   */
  function connect() {
    const version = ++lifecycleVersion
    shouldRun = true
    return scheduleLifecycleTransition(() => connectNow(version))
  }

  async function connectNow(version) {
    if (!shouldRun || version !== lifecycleVersion) return
    if (!state.enabled) {
      logger.warn('OBS is disabled because OBS_ADDRESS is not configured')
      return
    }

    if (state.connecting || state.identified) return

    state.connecting = true
    clearReconnectTimer()

    try {
      const info = await obs.connect(address, password)
      if (!shouldRun || version !== lifecycleVersion) {
        await obs.disconnect()
        return
      }
      state.connected = true
      state.identified = true
      state.lastError = null
      logger.log('OBS connected and identified', info)
    } catch (error) {
      if (!shouldRun || version !== lifecycleVersion) return
      state.connected = false
      state.identified = false
      state.lastError = error.message
      logger.error(`Error connecting to OBS: ${error.message}`)
      scheduleReconnect()
    } finally {
      state.connecting = false
    }
  }

  /**
   * Queues disconnection and prevents pending or future reconnect attempts.
   *
   * @returns {Promise<void>} Resolves after the serialized disconnect transition completes.
   * @throws {Error} Rejects when the OBS client cannot disconnect.
   */
  function disconnect() {
    lifecycleVersion += 1
    shouldRun = false
    clearReconnectTimer()
    return scheduleLifecycleTransition(disconnectNow)
  }

  async function disconnectNow() {
    try {
      await obs.disconnect()
    } finally {
      state.connected = false
      state.identified = false
      state.connecting = false
    }
  }

  function scheduleLifecycleTransition(operation) {
    const next = lifecyclePromise.then(operation, operation)
    lifecyclePromise = next.catch(() => {})
    return next
  }

  function scheduleReconnect() {
    if (!shouldRun || !state.enabled || state.reconnectTimer) return
    state.reconnectTimer = setTimer(() => {
      state.reconnectTimer = null
      void connect()
    }, reconnectMs)
  }

  function clearReconnectTimer() {
    if (state.reconnectTimer) clearTimer(state.reconnectTimer)
    state.reconnectTimer = null
  }

  /**
   * Sends a raw OBS WebSocket request through the service's configured client.
   *
   * @param {string} requestType OBS request type accepted by the connected server.
   * @param {object} [requestData={}] Request-specific payload.
   * @returns {Promise<unknown>} Response returned by OBS.
   * @throws {Error} Rejects when OBS is not configured or the request fails.
   */
  async function call(requestType, requestData = {}) {
    if (!state.enabled) throw new Error('OBS is not configured')

    try {
      return await obs.call(requestType, requestData)
    } catch (error) {
      state.lastError = error.message
      throw new Error(`OBS ${requestType} failed: ${error.message}`)
    }
  }

  /**
   * Reads the current program scene and updates the cached scene name.
   *
   * @returns {Promise<string>} Current program scene name.
   * @throws {Error} Rejects when OBS cannot complete the scene request.
   */
  async function getCurrentScene() {
    const data = await call('GetCurrentProgramScene')
    updateCurrentScene(data.currentProgramSceneName)
    return data.currentProgramSceneName
  }

  /**
   * Retrieves scenes, their sources, and available inputs for control-surface selection.
   *
   * @returns {Promise<ObsDiscovery>} Current scene plus scene sources, inputs, and media-capable inputs; a failed scene-item request is returned on that scene with an empty source list.
   * @throws {Error} Rejects when the required top-level OBS list requests fail.
   */
  async function getDiscovery() {
    const [
      sceneData,
      inputData
    ] = await Promise.all([
      call('GetSceneList'),
      call('GetInputList')
    ])
    const inputs = (inputData.inputs || []).map(input => ({
      name: input.inputName,
      kind: input.inputKind
    }))

    const sceneItems = await Promise.all((sceneData.scenes || []).map(async scene => {
      try {
        const data = await call('GetSceneItemList', { sceneName: scene.sceneName })
        return {
          name: scene.sceneName,
          sources: (data.sceneItems || []).map(item => ({
            id: item.sceneItemId,
            name: item.sourceName,
            type: item.sourceType,
            enabled: item.sceneItemEnabled
          }))
        }
      } catch (error) {
        return {
          name: scene.sceneName,
          sources: [],
          error: error.message
        }
      }
    }))

    const currentScene = sceneData.currentProgramSceneName || state.currentScene
    updateCurrentScene(currentScene)

    return {
      currentScene,
      scenes: sceneItems,
      inputs,
      mediaInputs: inputs.filter(input => ['ffmpeg_source', 'vlc_source'].includes(input.kind))
    }
  }

  /**
   * Switches OBS to the named program scene and updates the cached scene name after success.
   *
   * @param {string} sceneName Existing OBS scene name to make active.
   * @returns {Promise<void>} Resolves after OBS accepts the scene change.
   * @throws {Error} Rejects when the scene request fails.
   */
  async function switchScene(sceneName) {
    await call('SetCurrentProgramScene', { sceneName })
    updateCurrentScene(sceneName)
  }

  async function getSceneItemId(sceneName, sourceName) {
    const scene = sceneName || await getCurrentScene()
    const data = await call('GetSceneItemId', { sceneName: scene, sourceName })
    return { sceneName: scene, sceneItemId: data.sceneItemId }
  }

  /**
   * Sets visibility for a source in a scene, resolving the source's scene-item identifier first.
   *
   * @param {string|undefined} sceneName Scene containing the source; `undefined` uses the current program scene.
   * @param {string} sourceName Source name within the selected scene.
   * @param {boolean} sceneItemEnabled Whether OBS should render the source.
   * @returns {Promise<void>} Resolves after OBS accepts the visibility update.
   * @throws {Error} Rejects when the scene-item lookup or visibility request fails.
   */
  async function setSourceVisibility(sceneName, sourceName, sceneItemEnabled) {
    const item = await getSceneItemId(sceneName, sourceName)
    await call('SetSceneItemEnabled', {
      sceneName: item.sceneName,
      sceneItemId: item.sceneItemId,
      sceneItemEnabled
    })
  }

  /**
   * Inverts visibility for a source and returns the enabled state sent to OBS.
   *
   * @param {string|undefined} sceneName Scene containing the source; `undefined` uses the current program scene.
   * @param {string} sourceName Source name within the selected scene.
   * @returns {Promise<boolean>} New source visibility state.
   * @throws {Error} Rejects when the scene-item lookup or visibility request fails.
   */
  async function toggleSourceVisibility(sceneName, sourceName) {
    const item = await getSceneItemId(sceneName, sourceName)
    const data = await call('GetSceneItemEnabled', {
      sceneName: item.sceneName,
      sceneItemId: item.sceneItemId
    })
    const nextVisible = !data.sceneItemEnabled
    await setSourceVisibility(item.sceneName, sourceName, nextVisible)
    return nextVisible
  }

  /**
   * Sets the mute state for an OBS input.
   *
   * @param {string} inputName Existing OBS input name.
   * @param {boolean} inputMuted Whether the input should be muted.
   * @returns {Promise<void>} Resolves after OBS accepts the mute update.
   * @throws {Error} Rejects when the mute request fails.
   */
  async function setInputMute(inputName, inputMuted) {
    await call('SetInputMute', { inputName, inputMuted })
  }

  /**
   * Inverts an OBS input's mute state and returns the state sent to OBS.
   *
   * @param {string} inputName Existing OBS input name.
   * @returns {Promise<boolean>} New mute state.
   * @throws {Error} Rejects when the mute lookup or update fails.
   */
  async function toggleInputMute(inputName) {
    const data = await call('GetInputMute', { inputName })
    const nextMuted = !data.inputMuted
    await setInputMute(inputName, nextMuted)
    return nextMuted
  }

  /**
   * Triggers a normalized media action for an OBS media input.
   *
   * @param {string} inputName Existing OBS media input name.
   * @param {string} action User-facing media action accepted by `normalizeMediaAction`.
   * @returns {Promise<void>} Resolves after OBS accepts the media command.
   * @throws {Error} Rejects for unsupported actions or failed OBS requests.
   */
  async function mediaAction(inputName, action) {
    const mediaAction = normalizeMediaAction(action)
    await call('TriggerMediaInputAction', { inputName, mediaAction })
  }

  /**
   * Returns the current serializable OBS connection status.
   *
   * @returns {ObsStatus} Enabled, connection, identification, scene, and last-error state.
   */
  function getStatus() {
    return {
      enabled: state.enabled,
      connected: state.connected,
      identified: state.identified,
      currentScene: state.currentScene,
      lastError: state.lastError
    }
  }

  return {
    connect,
    call,
    disconnect,
    getCurrentScene,
    getDiscovery,
    getStatus,
    mediaAction,
    onCurrentSceneChanged,
    setInputMute,
    setSourceVisibility,
    switchScene,
    toggleInputMute,
    toggleSourceVisibility
  }
}

/**
 * Maps a user-facing media command to its OBS WebSocket action constant.
 *
 * @param {string} action One of `play`, `pause`, `restart`, or `stop`, case-insensitively.
 * @returns {string} OBS WebSocket media-input action constant.
 * @throws {Error} Throws a client input error for unsupported actions.
 */
function normalizeMediaAction(action) {
  const normalized = String(action).trim().toLowerCase()
  const actions = {
    pause: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PAUSE',
    play: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PLAY',
    restart: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART',
    stop: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_STOP'
  }

  if (actions[normalized]) return actions[normalized]
  throw userInputError('obs.media requires one of: play, pause, restart, stop')
}

/**
 * Normalizes an OBS reconnect interval, using the default for sub-second or non-numeric values.
 *
 * @param {*} value Value to coerce to milliseconds.
 * @param {number} [defaultValue=5000] Interval returned for invalid input.
 * @returns {number} Rounded reconnect interval in milliseconds.
 */
function normalizeReconnectMs(value, defaultValue = 5000) {
  const interval = Number(value)
  return Number.isFinite(interval) && interval >= 1000 ? Math.round(interval) : defaultValue
}

module.exports = {
  createObsService,
  normalizeMediaAction,
  normalizeReconnectMs
}
