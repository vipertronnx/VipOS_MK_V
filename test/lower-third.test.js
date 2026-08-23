const assert = require('node:assert/strict')
const test = require('node:test')

const {
  createLowerThirdSync,
  normalizeSceneNames,
  parseAlwaysVisibleObsScenes
} = require('../modules/overlays/chyron')

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

test('shared lower thirds alternate between their configured visible and hidden durations', () => {
  const io = createIo()
  const timers = createTimers()
  const lowerThird = createLowerThirdSync({
    clearTimer: timers.clearTimer,
    io,
    setTimer: timers.setTimer,
    hiddenDurationMs: 250,
    visibleDurationMs: 1000
  })

  assert.equal(timers.scheduled[0].delay, 1000)

  timers.scheduled[0].callback()
  assert.equal(lowerThird.getStatus().hidden, true)
  assert.equal(timers.scheduled[1].delay, 250)

  timers.scheduled[1].callback()
  assert.equal(lowerThird.getStatus().hidden, false)
  assert.equal(timers.scheduled[2].delay, 1000)
  assert.deepEqual(io.emitted, [
    { event: 'lower-third-toggle', payload: { hidden: true } },
    { event: 'lower-third-toggle', payload: { hidden: false } }
  ])
})

test('explicit lower-third state changes restart the duration for their resulting state', () => {
  const io = createIo()
  const timers = createTimers()
  const lowerThird = createLowerThirdSync({
    clearTimer: timers.clearTimer,
    io,
    setTimer: timers.setTimer,
    hiddenDurationMs: 250,
    visibleDurationMs: 1000
  })

  const initialTimer = timers.scheduled[0]
  lowerThird.hide()
  const hiddenTimer = timers.scheduled[1]
  lowerThird.show()
  const visibleTimer = timers.scheduled[2]
  lowerThird.toggle()
  const toggledHiddenTimer = timers.scheduled[3]
  lowerThird.emitOverlayEvent('lower-third-toggle', { hidden: false })

  assert.deepEqual(timers.cleared, [initialTimer, hiddenTimer, visibleTimer, toggledHiddenTimer])
  assert.equal(timers.scheduled[1].delay, 250)
  assert.equal(timers.scheduled[2].delay, 1000)
  assert.equal(timers.scheduled[3].delay, 250)
  assert.equal(timers.scheduled[4].delay, 1000)
  assert.equal(lowerThird.getStatus().hidden, false)
  assert.deepEqual(io.emitted, [
    { event: 'lower-third-hide', payload: { hidden: true } },
    { event: 'lower-third-show', payload: { hidden: false } },
    { event: 'lower-third-toggle', payload: { hidden: true } },
    { event: 'lower-third-toggle', payload: { hidden: false } }
  ])
})

test('configured scenes force both shared lower thirds visible and pause the timer', () => {
  const io = createIo()
  const timers = createTimers()
  const lowerThird = createLowerThirdSync({
    alwaysVisibleObsScenes: ['Gameplay', 'Just Chatting'],
    clearTimer: timers.clearTimer,
    io,
    setTimer: timers.setTimer,
    hiddenDurationMs: 250,
    visibleDurationMs: 1000
  })

  lowerThird.hide()
  const hiddenTimer = timers.scheduled[1]
  lowerThird.setCurrentObsScene('Gameplay')
  assert.deepEqual(lowerThird.getStatus(), {
    alwaysVisibleObsScenes: ['Gameplay', 'Just Chatting'],
    alwaysHiddenObsScenes: [],
    currentObsScene: 'Gameplay',
    forcedVisible: true,
    forcedHidden: false,
    hidden: false,
    timerRunning: false,
    hiddenDurationMs: 250,
    visibleDurationMs: 1000
  })
  assert.deepEqual(timers.cleared, [timers.scheduled[0], hiddenTimer])

  const eventCount = io.emitted.length
  lowerThird.hide()
  lowerThird.toggle()
  assert.equal(io.emitted.length, eventCount)
  assert.equal(lowerThird.getStatus().hidden, false)

  lowerThird.setCurrentObsScene('Just Chatting')
  assert.equal(timers.scheduled.length, 2)
  assert.equal(lowerThird.getStatus().currentObsScene, 'Just Chatting')
})

test('configured scenes force both shared lower thirds hidden and reject show requests', () => {
  const io = createIo()
  const timers = createTimers()
  const lowerThird = createLowerThirdSync({
    alwaysHiddenObsScenes: ['Starting Soon'],
    clearTimer: timers.clearTimer,
    io,
    setTimer: timers.setTimer,
    hiddenDurationMs: 250,
    visibleDurationMs: 1000
  })

  lowerThird.setCurrentObsScene('Starting Soon')
  assert.equal(lowerThird.getStatus().forcedHidden, true)
  assert.equal(lowerThird.getStatus().hidden, true)
  assert.equal(lowerThird.getStatus().timerRunning, false)

  const eventCount = io.emitted.length
  lowerThird.show()
  lowerThird.toggle()
  assert.equal(io.emitted.length, eventCount)
  assert.equal(lowerThird.getStatus().hidden, true)

  lowerThird.setCurrentObsScene('Gameplay')
  assert.equal(lowerThird.getStatus().forcedHidden, false)
  assert.equal(lowerThird.getStatus().hidden, true)
  assert.equal(timers.scheduled.at(-1).delay, 250)
})

test('always-hidden scenes take precedence over always-visible scenes', () => {
  const lowerThird = createLowerThirdSync({
    alwaysHiddenObsScenes: ['BRB'],
    alwaysVisibleObsScenes: ['BRB'],
    io: createIo(),
    hiddenDurationMs: 250,
    visibleDurationMs: 1000
  })

  lowerThird.setCurrentObsScene('BRB')

  assert.equal(lowerThird.getStatus().forcedHidden, true)
  assert.equal(lowerThird.getStatus().forcedVisible, false)
  assert.equal(lowerThird.getStatus().hidden, true)
  lowerThird.stop()
})

test('leaving configured scenes restarts the shared timer from a visible state', () => {
  const io = createIo()
  const timers = createTimers()
  const lowerThird = createLowerThirdSync({
    alwaysVisibleObsScenes: ['Gameplay'],
    clearTimer: timers.clearTimer,
    io,
    setTimer: timers.setTimer,
    hiddenDurationMs: 250,
    visibleDurationMs: 1000
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
  assert.equal(timers.scheduled[2].delay, 250)
})

test('showing the shared lower thirds restarts a full visibility interval', () => {
  const io = createIo()
  const timers = createTimers()
  const lowerThird = createLowerThirdSync({
    clearTimer: timers.clearTimer,
    io,
    setTimer: timers.setTimer,
    hiddenDurationMs: 250,
    visibleDurationMs: 1000
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
  assert.equal(timers.scheduled[2].delay, 250)
})

test('new overlay sockets synchronize the currently forced shared state', () => {
  const io = createIo()
  const timers = createTimers()
  const lowerThird = createLowerThirdSync({
    alwaysVisibleObsScenes: ['Gameplay'],
    clearTimer: timers.clearTimer,
    io,
    setTimer: timers.setTimer,
    hiddenDurationMs: 250,
    visibleDurationMs: 1000
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

test('zero duration disables only the automatic transition out of its state', () => {
  const io = createIo()
  const timers = createTimers()
  const visibleDurationDisabled = createLowerThirdSync({
    clearTimer: timers.clearTimer,
    io,
    setTimer: timers.setTimer,
    hiddenDurationMs: 250,
    visibleDurationMs: 0
  })

  assert.equal(timers.scheduled.length, 0)
  visibleDurationDisabled.hide()
  timers.scheduled[0].callback()
  assert.equal(visibleDurationDisabled.getStatus().hidden, false)
  assert.equal(timers.scheduled.length, 1)

  const hiddenDurationDisabled = createLowerThirdSync({
    clearTimer: timers.clearTimer,
    io: createIo(),
    setTimer: timers.setTimer,
    hiddenDurationMs: 0,
    visibleDurationMs: 1000
  })

  assert.equal(timers.scheduled[1].delay, 1000)
  timers.scheduled[1].callback()
  assert.equal(hiddenDurationDisabled.getStatus().hidden, true)
  assert.equal(timers.scheduled.length, 2)
})

test('both zero durations disable automatic changes while retaining forced-visible scenes', () => {
  const io = createIo()
  const timers = createTimers()
  const lowerThird = createLowerThirdSync({
    alwaysVisibleObsScenes: ['Gameplay'],
    clearTimer: timers.clearTimer,
    io,
    setTimer: timers.setTimer,
    hiddenDurationMs: 0,
    visibleDurationMs: 0
  })

  lowerThird.setCurrentObsScene('Gameplay')
  lowerThird.setCurrentObsScene('Intermission')

  assert.equal(timers.scheduled.length, 0)
  assert.equal(lowerThird.getStatus().timerRunning, false)
  assert.equal(lowerThird.getStatus().hidden, false)
})

test('stopping clears the currently scheduled timeout', () => {
  const io = createIo()
  const timers = createTimers()
  const lowerThird = createLowerThirdSync({
    clearTimer: timers.clearTimer,
    io,
    setTimer: timers.setTimer,
    hiddenDurationMs: 250,
    visibleDurationMs: 1000
  })

  const initialTimer = timers.scheduled[0]
  lowerThird.stop()

  assert.deepEqual(timers.cleared, [initialTimer])
  assert.equal(lowerThird.getStatus().timerRunning, false)
})
