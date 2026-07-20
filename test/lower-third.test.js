const assert = require('node:assert/strict')
const test = require('node:test')

const {
  createLowerThirdSync,
  normalizeSceneNames,
  parseAlwaysVisibleObsScenes
} = require('../modules/overlays/lower-third')

function createIo() {
  const emitted = []
  let connectionHandler = null

  return {
    emitted,
    connect(socket) {
      connectionHandler(socket)
    },
    emit(event, payload) {
      emitted.push({ event, payload })
    },
    on(event, handler) {
      assert.equal(event, 'connection')
      connectionHandler = handler
    }
  }
}

function createSocket() {
  const emitted = []
  const handlers = new Map()

  return {
    emitted,
    emit(event, payload) {
      emitted.push({ event, payload })
    },
    on(event, handler) {
      handlers.set(event, handler)
    },
    requestSync() {
      handlers.get('lower-third-sync-request')()
    }
  }
}

function createTimers() {
  const cleared = []
  const scheduled = []

  return {
    cleared,
    scheduled,
    clearTimer(timer) {
      cleared.push(timer)
    },
    setTimer(callback, delay) {
      const timer = { callback, delay }
      scheduled.push(timer)
      return timer
    }
  }
}

test('scene configuration accepts distinct trimmed OBS scene names', () => {
  assert.deepEqual(
    parseAlwaysVisibleObsScenes('[" Gameplay ", "Just Chatting", "Gameplay", ""]'),
    ['Gameplay', 'Just Chatting']
  )
  assert.deepEqual(normalizeSceneNames(['  A  ', 'A', null, 'B']), ['A', 'B'])
})

test('invalid scene configuration is ignored with a warning', () => {
  const warnings = []

  const scenes = parseAlwaysVisibleObsScenes('["Gameplay", 42]', {
    logger: { warn(message) { warnings.push(message) } }
  })

  assert.deepEqual(scenes, [])
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /LOWER_THIRD_ALWAYS_VISIBLE_OBS_SCENES/)
})

test('configured scenes force both shared lower thirds visible and pause the timer', () => {
  const io = createIo()
  const timers = createTimers()
  const lowerThird = createLowerThirdSync({
    alwaysVisibleObsScenes: ['Gameplay', 'Just Chatting'],
    clearTimer: timers.clearTimer,
    io,
    setTimer: timers.setTimer,
    toggleIntervalMs: 60000
  })

  assert.equal(timers.scheduled.length, 1)
  lowerThird.hide()
  assert.equal(lowerThird.getStatus().hidden, true)

  lowerThird.setCurrentObsScene('Gameplay')
  assert.deepEqual(lowerThird.getStatus(), {
    alwaysVisibleObsScenes: ['Gameplay', 'Just Chatting'],
    currentObsScene: 'Gameplay',
    forcedVisible: true,
    hidden: false,
    timerRunning: false,
    toggleIntervalMs: 60000
  })
  assert.deepEqual(timers.cleared, [timers.scheduled[0]])
  assert.deepEqual(io.emitted.at(-1), {
    event: 'lower-third-show',
    payload: { hidden: false }
  })

  const eventCount = io.emitted.length
  lowerThird.hide()
  lowerThird.toggle()
  assert.equal(io.emitted.length, eventCount)
  assert.equal(lowerThird.getStatus().hidden, false)

  lowerThird.setCurrentObsScene('Just Chatting')
  assert.equal(timers.scheduled.length, 1)
  assert.equal(lowerThird.getStatus().currentObsScene, 'Just Chatting')
})

test('leaving configured scenes restarts the shared timer from a visible state', () => {
  const io = createIo()
  const timers = createTimers()
  const lowerThird = createLowerThirdSync({
    alwaysVisibleObsScenes: ['Gameplay'],
    clearTimer: timers.clearTimer,
    io,
    setTimer: timers.setTimer,
    toggleIntervalMs: 1000
  })

  lowerThird.setCurrentObsScene('Gameplay')
  lowerThird.setCurrentObsScene('Intermission')

  assert.equal(lowerThird.getStatus().forcedVisible, false)
  assert.equal(lowerThird.getStatus().hidden, false)
  assert.equal(lowerThird.getStatus().timerRunning, true)
  assert.equal(timers.scheduled.length, 2)
  assert.equal(timers.scheduled[1].delay, 1000)
  assert.deepEqual(io.emitted.at(-1), {
    event: 'lower-third-show',
    payload: { hidden: false }
  })

  timers.scheduled[1].callback()
  assert.equal(lowerThird.getStatus().hidden, true)
})

test('showing the shared lower thirds restarts a full visibility interval', () => {
  const io = createIo()
  const timers = createTimers()
  const lowerThird = createLowerThirdSync({
    clearTimer: timers.clearTimer,
    io,
    setTimer: timers.setTimer,
    toggleIntervalMs: 1000
  })
  const initialTimer = timers.scheduled[0]

  lowerThird.emitOverlayEvent('lower-third-show')

  assert.equal(lowerThird.getStatus().hidden, false)
  assert.deepEqual(timers.cleared, [initialTimer])
  assert.equal(timers.scheduled.length, 2)
  assert.equal(timers.scheduled[1].delay, 1000)
  assert.deepEqual(io.emitted.at(-1), {
    event: 'lower-third-show',
    payload: { hidden: false }
  })

  timers.scheduled[1].callback()
  assert.equal(lowerThird.getStatus().hidden, true)
})

test('new overlay sockets synchronize the currently forced shared state', () => {
  const io = createIo()
  const timers = createTimers()
  const lowerThird = createLowerThirdSync({
    alwaysVisibleObsScenes: ['Gameplay'],
    clearTimer: timers.clearTimer,
    io,
    setTimer: timers.setTimer,
    toggleIntervalMs: 1000
  })

  lowerThird.setCurrentObsScene('Gameplay')
  const socket = createSocket()
  io.connect(socket)
  socket.requestSync()

  assert.deepEqual(socket.emitted, [
    { event: 'lower-third-sync', payload: { hidden: false } },
    { event: 'lower-third-sync', payload: { hidden: false } }
  ])
})

test('a disabled shared timer still respects forced-visible scenes', () => {
  const io = createIo()
  const timers = createTimers()
  const lowerThird = createLowerThirdSync({
    alwaysVisibleObsScenes: ['Gameplay'],
    clearTimer: timers.clearTimer,
    io,
    setTimer: timers.setTimer,
    toggleIntervalMs: 0
  })

  lowerThird.setCurrentObsScene('Gameplay')
  lowerThird.setCurrentObsScene('Intermission')

  assert.equal(timers.scheduled.length, 0)
  assert.equal(lowerThird.getStatus().timerRunning, false)
  assert.equal(lowerThird.getStatus().hidden, false)
})
