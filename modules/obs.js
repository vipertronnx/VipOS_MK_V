const { default: OBSWebSocket } = require('obs-websocket-js')
const { userInputError } = require('./utils/errors')

function createObsService({ logger = console } = {}) {
  const obs = new OBSWebSocket()
  const address = process.env.OBS_ADDRESS
  const password = process.env.OBS_PASSWORD || undefined
  const reconnectMs = normalizeReconnectMs(process.env.OBS_RECONNECT_RETRY_INTERVAL)

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
    state.currentScene = data.sceneName
  })

  async function connect() {
    if (!state.enabled) {
      logger.warn('OBS is disabled because OBS_ADDRESS is not configured')
      return
    }

    if (state.connecting || state.identified) return

    state.connecting = true
    clearTimeout(state.reconnectTimer)
    state.reconnectTimer = null

    try {
      const info = await obs.connect(address, password)
      state.connected = true
      state.identified = true
      state.lastError = null
      logger.log('OBS connected and identified', info)
    } catch (error) {
      state.connected = false
      state.identified = false
      state.lastError = error.message
      logger.error(`Error connecting to OBS: ${error.message}`)
      scheduleReconnect()
    } finally {
      state.connecting = false
    }
  }

  function scheduleReconnect() {
    if (!state.enabled || state.reconnectTimer) return
    state.reconnectTimer = setTimeout(() => {
      state.reconnectTimer = null
      connect()
    }, reconnectMs)
  }

  async function call(requestType, requestData = {}) {
    if (!state.enabled) throw new Error('OBS is not configured')

    try {
      return await obs.call(requestType, requestData)
    } catch (error) {
      state.lastError = error.message
      throw new Error(`OBS ${requestType} failed: ${error.message}`)
    }
  }

  async function getCurrentScene() {
    const data = await call('GetCurrentProgramScene')
    state.currentScene = data.currentProgramSceneName
    return data.currentProgramSceneName
  }

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

    return {
      currentScene: sceneData.currentProgramSceneName || state.currentScene,
      scenes: sceneItems,
      inputs,
      mediaInputs: inputs.filter(input => ['ffmpeg_source', 'vlc_source'].includes(input.kind))
    }
  }

  async function switchScene(sceneName) {
    await call('SetCurrentProgramScene', { sceneName })
    state.currentScene = sceneName
  }

  async function getSceneItemId(sceneName, sourceName) {
    const scene = sceneName || await getCurrentScene()
    const data = await call('GetSceneItemId', { sceneName: scene, sourceName })
    return { sceneName: scene, sceneItemId: data.sceneItemId }
  }

  async function setSourceVisibility(sceneName, sourceName, sceneItemEnabled) {
    const item = await getSceneItemId(sceneName, sourceName)
    await call('SetSceneItemEnabled', {
      sceneName: item.sceneName,
      sceneItemId: item.sceneItemId,
      sceneItemEnabled
    })
  }

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

  async function setInputMute(inputName, inputMuted) {
    await call('SetInputMute', { inputName, inputMuted })
  }

  async function toggleInputMute(inputName) {
    const data = await call('GetInputMute', { inputName })
    const nextMuted = !data.inputMuted
    await setInputMute(inputName, nextMuted)
    return nextMuted
  }

  async function mediaAction(inputName, action) {
    const mediaAction = normalizeMediaAction(action)
    await call('TriggerMediaInputAction', { inputName, mediaAction })
  }

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
    getCurrentScene,
    getDiscovery,
    getStatus,
    mediaAction,
    obs,
    setInputMute,
    setSourceVisibility,
    switchScene,
    toggleInputMute,
    toggleSourceVisibility
  }
}

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

function normalizeReconnectMs(value, defaultValue = 5000) {
  const interval = Number(value)
  return Number.isFinite(interval) && interval >= 1000 ? Math.round(interval) : defaultValue
}

module.exports = {
  createObsService,
  normalizeMediaAction,
  normalizeReconnectMs
}
