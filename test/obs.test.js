const assert = require('node:assert/strict')
const test = require('node:test')

const { createObsService, normalizeMediaAction, normalizeReconnectMs } = require('../modules/obs')

function createObsClient() {
  const handlers = new Map()

  return {
    connectCalls: 0,
    disconnectCalls: 0,
    async connect() {
      this.connectCalls += 1
      return {}
    },
    async disconnect() {
      this.disconnectCalls += 1
      this.emit('ConnectionClosed')
    },
    emit(event, ...args) {
      const handler = handlers.get(event)
      if (handler) handler(...args)
    },
    on(event, handler) {
      handlers.set(event, handler)
    }
  }
}

async function withObsEnvironment(fn) {
  const keys = ['OBS_ADDRESS', 'OBS_ENABLED', 'OBS_RECONNECT_RETRY_INTERVAL']
  const previous = new Map(keys.map(key => [key, process.env[key]]))

  process.env.OBS_ADDRESS = 'ws://127.0.0.1:4455'
  process.env.OBS_ENABLED = 'true'
  delete process.env.OBS_RECONNECT_RETRY_INTERVAL

  try {
    return await fn()
  } finally {
    for (const key of keys) {
      const value = previous.get(key)
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

function createTimerStub() {
  const cleared = []
  const scheduled = []

  return {
    clearTimer(timer) {
      cleared.push(timer)
    },
    cleared,
    scheduled,
    setTimer(callback, delay) {
      const timer = { callback, delay }
      scheduled.push(timer)
      return timer
    }
  }
}

test('OBS reconnect interval falls back for unsafe values', () => {
  for (const value of ['-1', '0', '999', 'Infinity', 'NaN', '']) {
    assert.equal(normalizeReconnectMs(value), 5000, `${value} should use the default interval`)
  }
})

test('OBS reconnect interval accepts values at or above one second', () => {
  assert.equal(normalizeReconnectMs('1000'), 1000)
  assert.equal(normalizeReconnectMs('2500.6'), 2501)
})

test('OBS media actions reject unknown commands', () => {
  assert.equal(normalizeMediaAction('restart'), 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART')

  assert.throws(
    () => normalizeMediaAction('resart'),
    error => error.statusCode === 400 && /play, pause, restart, stop/.test(error.message)
  )
})

test('intentional OBS disconnect clears reconnect state without scheduling a retry', async () => {
  await withObsEnvironment(async () => {
    const client = createObsClient()
    const timers = createTimerStub()
    const obs = createObsService({
      clearTimer: timers.clearTimer,
      logger: { error() {}, log() {}, warn() {} },
      obsClient: client,
      setTimer: timers.setTimer
    })

    await obs.connect()
    await obs.disconnect()
    await obs.connect()
    await obs.disconnect()

    assert.equal(client.connectCalls, 2)
    assert.equal(client.disconnectCalls, 2)
    assert.deepEqual(timers.scheduled, [])
    assert.deepEqual(obs.getStatus(), {
      enabled: true,
      connected: false,
      identified: false,
      currentScene: null,
      lastError: null
    })
  })
})

test('OBS disconnect wins when startup completes after teardown', async () => {
  await withObsEnvironment(async () => {
    const client = createObsClient()
    const timers = createTimerStub()
    let resolveConnect
    client.connect = async function () {
      this.connectCalls += 1
      return new Promise(resolve => {
        resolveConnect = resolve
      })
    }
    const obs = createObsService({
      clearTimer: timers.clearTimer,
      logger: { error() {}, log() {}, warn() {} },
      obsClient: client,
      setTimer: timers.setTimer
    })

    const connecting = obs.connect()
    await new Promise(resolve => setImmediate(resolve))
    const disconnecting = obs.disconnect()
    resolveConnect({})
    await Promise.all([connecting, disconnecting])

    assert.equal(client.disconnectCalls, 2)
    assert.deepEqual(timers.scheduled, [])
    assert.equal(obs.getStatus().connected, false)
    assert.equal(obs.getStatus().identified, false)
  })
})

test('OBS reconnect waits for a pending disconnect before opening another connection', async () => {
  await withObsEnvironment(async () => {
    const client = createObsClient()
    const timers = createTimerStub()
    let resolveFirstConnection
    client.connect = async function () {
      this.connectCalls += 1
      if (this.connectCalls > 1) return {}
      return new Promise(resolve => {
        resolveFirstConnection = resolve
      })
    }
    client.disconnect = async function () {
      this.disconnectCalls += 1
    }
    const obs = createObsService({
      clearTimer: timers.clearTimer,
      logger: { error() {}, log() {}, warn() {} },
      obsClient: client,
      setTimer: timers.setTimer
    })

    const firstConnect = obs.connect()
    await new Promise(resolve => setImmediate(resolve))
    const disconnecting = obs.disconnect()
    const reconnecting = obs.connect()
    resolveFirstConnection({})
    await Promise.all([firstConnect, disconnecting, reconnecting])

    assert.equal(client.connectCalls, 2)
    assert.equal(client.disconnectCalls, 2)
    assert.equal(obs.getStatus().connected, true)
    assert.equal(obs.getStatus().identified, true)
  })
})

test('unexpected OBS disconnects continue to schedule reconnects', async () => {
  await withObsEnvironment(async () => {
    const client = createObsClient()
    const timers = createTimerStub()
    const obs = createObsService({
      clearTimer: timers.clearTimer,
      logger: { error() {}, log() {}, warn() {} },
      obsClient: client,
      setTimer: timers.setTimer
    })

    await obs.connect()
    client.emit('ConnectionClosed')

    assert.deepEqual(timers.scheduled.map(timer => timer.delay), [5000])

    await obs.disconnect()
    assert.deepEqual(timers.cleared, [timers.scheduled[0]])
    assert.equal(timers.scheduled.length, 1)
  })
})
