const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const localDefaultAlertSound = process.env.DEFAULT_ALERT_SOUND
process.env.DEFAULT_ALERT_SOUND = ''
const { attachAppRequestHandler, createApp, createSocketServer, startServer } = require('../app')
if (localDefaultAlertSound !== undefined) process.env.DEFAULT_ALERT_SOUND = localDefaultAlertSound
else delete process.env.DEFAULT_ALERT_SOUND

const { createActionQueue } = require('../modules/actions/action-queue')
const { createActionRunner } = require('../modules/actions/actions')

function createFakeServices() {
  const enqueued = []
  const queueControlCalls = []
  const queueSnapshot = {
    activity: [],
    history: [],
    paused: false,
    pending: [],
    running: null
  }

  return {
    enqueued,
    queueControlCalls,
    services: {
      actions: {
        async run() {
          return []
        }
      },
      actionQueue: {
        clear() {
          queueControlCalls.push('clear')
          return queueSnapshot
        },
        enqueue(item) {
          enqueued.push(item)
          return queueSnapshot
        },
        getStatus() {
          return queueSnapshot
        },
        pause() {
          queueControlCalls.push('pause')
          return queueSnapshot
        },
        resume() {
          queueControlCalls.push('resume')
          return queueSnapshot
        },
        skipNext() {
          queueControlCalls.push('skip')
          return queueSnapshot
        }
      },
      chat: {
        getStatus() {
          return {}
        },
        async simulateEvent() {}
      },
      greetings: {
        getStatus() {
          return {}
        },
        setActivePool() {
          return {}
        }
      },
      io: {
        engine: { clientsCount: 0 },
        emit() {}
      },
      lowerThirdSync: {
        getStatus() {
          return {}
        },
        hide() {
          return {}
        },
        show() {
          return {}
        },
        toggle() {
          return {}
        }
      },
      macros: {
        find() {
          return null
        },
        list() {
          return []
        }
      },
      obs: {
        async getDiscovery() {
          return {}
        },
        getStatus() {
          return {}
        }
      },
      quietMode: {
        disable() {
          return {}
        },
        enable() {
          return {}
        },
        getStatus() {
          return {}
        },
        toggle() {
          return {}
        }
      },
      raffle: {
        close() {
          return {}
        },
        disable() {
          return {}
        },
        enable() {
          return {}
        },
        getStatus() {
          return {}
        },
        start() {
          return {}
        },
        toggle() {
          return {}
        }
      }
    }
  }
}

function createStartServerServices({ io }) {
  const { services } = createFakeServices()
  const stopCalls = []

  return {
    ...services,
    chat: {
      ...services.chat,
      async start() {},
      stop() {
        stopCalls.push('chat')
      },
      getStatus() {
        return { enabled: false }
      }
    },
    io,
    obs: {
      ...services.obs,
      connect() {},
      async disconnect() {
        stopCalls.push('obs')
      }
    },
    raffle: {
      ...services.raffle,
      startTimers() {},
      stopTimers() {
        stopCalls.push('raffle')
      }
    },
    lowerThirdSync: {
      ...services.lowerThirdSync,
      stop() {
        stopCalls.push('lower-third')
      }
    },
    stopCalls
  }
}

function createDelayedStartServerServices({ io }) {
  const services = createStartServerServices({ io })
  let markChatStarted
  services.chatStarted = new Promise(resolve => {
    markChatStarted = resolve
  })
  services.runtimeEvents = []
  services.chat.start = async () => {
    services.runtimeEvents.push('chat.start')
    markChatStarted()
    await new Promise(resolve => {
      services.releaseChatStart = resolve
    })
  }
  services.raffle.startTimers = () => {
    services.runtimeEvents.push('raffle.start')
  }
  return services
}

function createRealQueueServices(actionRunnerOptions = {}) {
  const emitted = []
  const io = {
    engine: { clientsCount: 0 },
    emit(event, payload) {
      emitted.push({ event, payload })
    }
  }
  const quietMode = {
    disable() {
      return {}
    },
    enable() {
      return {}
    },
    getStatus() {
      return {}
    },
    isEnabled() {
      return false
    },
    toggle() {
      return {}
    }
  }
  const lowerThirdSync = {
    emitOverlayEvent(event, payload) {
      io.emit(event, payload)
    },
    getStatus() {
      return {}
    },
    hide() {
      return {}
    },
    show() {
      return {}
    },
    toggle() {
      return {}
    }
  }
  const actions = createActionRunner({
    io,
    logger: { error() {}, log() {}, warn() {} },
    obs: {},
    quietMode,
    ...actionRunnerOptions,
    overlayEmit: lowerThirdSync.emitOverlayEvent
  })
  const actionQueue = createActionQueue({
    actions,
    soundCompletionBufferMs: 0,
    soundCompletionFallbackMs: 0
  })

  return {
    emitted,
    services: {
      actions,
      actionQueue,
      chat: {
        getStatus() {
          return {}
        },
        async simulateEvent() {}
      },
      greetings: {
        getStatus() {
          return {}
        },
        setActivePool() {
          return {}
        }
      },
      io,
      lowerThirdSync,
      macros: {
        find() {
          return null
        },
        list() {
          return []
        }
      },
      obs: {
        async getDiscovery() {
          return {}
        },
        getStatus() {
          return {}
        }
      },
      quietMode,
      raffle: {
        close() {
          return {}
        },
        disable() {
          return {}
        },
        enable() {
          return {}
        },
        getStatus() {
          return {}
        },
        start() {
          return {}
        },
        toggle() {
          return {}
        }
      }
    }
  }
}

function withTempDirectory(fn) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vipos-routes-'))
  const cleanup = () => fs.rmSync(directory, { recursive: true, force: true })

  try {
    const result = fn(directory)
    if (result && typeof result.then === 'function') return result.finally(cleanup)
    cleanup()
    return result
  } catch (error) {
    cleanup()
    throw error
  }
}

async function withTestServer(app, fn) {
  const server = http.createServer(app)

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })

  try {
    const { port } = server.address()
    return await fn(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
}

async function withSocketTestServer(fn, { port } = {}) {
  const server = http.createServer()
  const io = createSocketServer(server, { port })
  const { services } = createFakeServices()
  const app = createApp({ ...services, io }, { port })
  attachAppRequestHandler(server, app)

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })

  try {
    const { port } = server.address()
    return await fn(`http://127.0.0.1:${port}`)
  } finally {
    io.close()
    await new Promise(resolve => server.close(resolve))
  }
}

async function postJson(baseUrl, endpoint, body) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
    method: 'POST'
  })
  const payload = await response.json()
  return { payload, response }
}

async function waitForQueueHistory(actionQueue, predicate, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const match = actionQueue.getStatus().history.find(predicate)
    if (match) return match
    await new Promise(resolve => setTimeout(resolve, 10))
  }

  assert.fail('Timed out waiting for queue history')
}

test('/api/v1/sound rejects missing files before enqueueing', async () => {
  const { enqueued, services } = createFakeServices()
  const app = createApp(services)
  const originalConsoleError = console.error
  const loggedErrors = []
  console.error = (...args) => loggedErrors.push(args)

  try {
    await withTestServer(app, async baseUrl => {
      const { payload, response } = await postJson(baseUrl, '/api/v1/sound', { src: 'missing.wav' })

      assert.equal(response.status, 400)
      assert.match(payload.error, /file was not found/)
      assert.equal(enqueued.length, 0)
      assert.equal(loggedErrors.length, 0)
    })
  } finally {
    console.error = originalConsoleError
  }
})

test('/api/v1/sound enqueues existing sound files', async () => {
  const { enqueued, services } = createFakeServices()
  const app = createApp(services)

  await withTestServer(app, async baseUrl => {
    const { payload, response } = await postJson(baseUrl, '/api/v1/sound', { src: 'example.mp3' })

    assert.equal(response.status, 200)
    assert.equal(payload.ok, true)
    assert.equal(payload.queued, true)
    assert.equal(enqueued.length, 1)
    assert.equal(enqueued[0].actions[0].type, 'sound.play')
    assert.equal(enqueued[0].actions[0].src, 'example.mp3')
  })
})

test('/api/v1/text and /api/v1/alert enqueue equivalent alerts with distinct labels', async () => {
  const { enqueued, services } = createFakeServices()
  const app = createApp(services)

  await withTestServer(app, async baseUrl => {
    const text = await postJson(baseUrl, '/api/v1/text', { message: 'Text message' })
    const alert = await postJson(baseUrl, '/api/v1/alert', { msg: 'Alert message' })

    assert.equal(text.response.status, 200)
    assert.equal(alert.response.status, 200)
  })

  assert.deepEqual(enqueued.map(({ actions, context, fallbackCompletionDelayMs, name, source }) => ({
    actions,
    context,
    fallbackCompletionDelayMs,
    name,
    source
  })), [
    {
      actions: [
        { type: 'overlay.alert', message: 'Text message' },
        { type: 'sound.play', src: 'example.mp3', volume: 1 }
      ],
      context: { source: 'api' },
      fallbackCompletionDelayMs: 4000,
      name: 'Text Alert',
      source: 'api'
    },
    {
      actions: [
        { type: 'overlay.alert', message: 'Alert message' },
        { type: 'sound.play', src: 'example.mp3', volume: 1 }
      ],
      context: { source: 'api' },
      fallbackCompletionDelayMs: 4000,
      name: 'Overlay Alert',
      source: 'api'
    }
  ])
})

test('direct and queued actions reject structural errors with HTTP 400', async () => {
  const { services } = createRealQueueServices()
  const app = createApp(services)

  await withTestServer(app, async baseUrl => {
    const direct = await postJson(baseUrl, '/api/v1/actions/run', { type: 'unknown.action' })
    const queued = await postJson(baseUrl, '/api/v1/actions/enqueue', { type: 'overlay.alert' })

    assert.equal(direct.response.status, 400)
    assert.match(direct.payload.error, /Unknown action type/)
    assert.equal(queued.response.status, 400)
    assert.match(queued.payload.error, /overlay.alert requires message/)
  })
})

test('queue status and control routes delegate to the action queue', async () => {
  const { queueControlCalls, services } = createFakeServices()
  const app = createApp(services)

  await withTestServer(app, async baseUrl => {
    const statusResponse = await fetch(`${baseUrl}/api/v1/queue`)
    const status = await statusResponse.json()

    assert.equal(statusResponse.status, 200)
    assert.deepEqual(status, { ok: true, queue: services.actionQueue.getStatus() })

    for (const endpoint of ['pause', 'resume', 'skip', 'clear']) {
      const { payload, response } = await postJson(baseUrl, `/api/v1/queue/${endpoint}`, {})
      assert.equal(response.status, 200)
      assert.equal(payload.ok, true)
      assert.deepEqual(payload.queue, services.actionQueue.getStatus())
    }
  })

  assert.deepEqual(queueControlCalls, ['pause', 'resume', 'skip', 'clear'])
})

test('greeting and raffle API mutations report persistence failures', async () => {
  const { services } = createFakeServices()
  const persistenceError = Object.assign(new Error('Failed to persist local state'), { statusCode: 503 })
  const raffleOptions = []
  services.greetings.setActivePool = () => {
    throw persistenceError
  }
  services.raffle.start = options => {
    raffleOptions.push(options)
    throw persistenceError
  }
  const app = createApp(services)
  const originalConsoleError = console.error
  console.error = () => {}

  try {
    await withTestServer(app, async baseUrl => {
      const greeting = await postJson(baseUrl, '/api/v1/greetings/pool', { pool: 'default' })
      const raffle = await postJson(baseUrl, '/api/v1/raffle/start', {})

      assert.equal(greeting.response.status, 503)
      assert.equal(raffle.response.status, 503)
      assert.equal(greeting.payload.error, 'Failed to persist local state')
      assert.equal(raffle.payload.error, 'Failed to persist local state')
    })
  } finally {
    console.error = originalConsoleError
  }

  assert.deepEqual(raffleOptions, [{ requirePersistence: true }])
})

test('configured application port controls status and local-origin checks', async () => {
  const configuredPort = 54321
  const { enqueued, services } = createFakeServices()
  const app = createApp(services, { port: configuredPort })

  await withTestServer(app, async baseUrl => {
    const statusResponse = await fetch(`${baseUrl}/api/v1/status`)
    const status = await statusResponse.json()
    assert.equal(status.app.port, configuredPort)

    const response = await fetch(`${baseUrl}/api/v1/sound`, {
      body: JSON.stringify({ src: 'example.mp3' }),
      headers: {
        'content-type': 'application/json',
        origin: `http://localhost:${configuredPort}`
      },
      method: 'POST'
    })

    assert.equal(response.status, 200)
    assert.equal(enqueued.length, 1)
  })
})

test('status counts only connected Socket.IO clients and reports their details', async () => {
  const { services } = createFakeServices()
  const connectedAt = Date.UTC(2026, 6, 19, 12, 30, 0)
  // One Engine.IO transport has not joined a Socket.IO namespace yet.
  services.io.engine.clientsCount = 2
  services.io.of = () => ({
    sockets: new Map([['socket-1', {
      conn: {
        remoteAddress: '127.0.0.1',
        transport: { name: 'websocket' }
      },
      handshake: {
        address: '::1',
        headers: {
          referer: 'http://localhost:5000/overlay/news-chyron?preview=1',
          'user-agent': 'Test Browser'
        },
        issued: connectedAt
      },
      id: 'socket-1',
      nsp: { name: '/' }
    }]])
  })
  const app = createApp(services)

  await withTestServer(app, async baseUrl => {
    const response = await fetch(`${baseUrl}/api/v1/status`)
    const status = await response.json()

    assert.equal(response.status, 200)
    assert.equal(status.sockets.clients, 1)
    assert.deepEqual(status.sockets.connections, [{
      address: '::1',
      connectedAt: '2026-07-19T12:30:00.000Z',
      id: 'socket-1',
      namespace: '/',
      page: '/overlay/news-chyron?preview=1',
      transport: 'websocket',
      userAgent: 'Test Browser'
    }])
  })
})

test('startServer reports and authorizes its dynamically assigned port', async () => {
  const { server, services, stop } = startServer({
    createServices: createStartServerServices,
    port: 0
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.once('listening', resolve)
  })

  try {
    const { port } = server.address()
    const baseUrl = `http://127.0.0.1:${port}`
    const statusResponse = await fetch(`${baseUrl}/api/v1/status`)
    const status = await statusResponse.json()
    assert.equal(status.app.port, port)

    const response = await fetch(`${baseUrl}/api/v1/sound`, {
      body: JSON.stringify({ src: 'example.mp3' }),
      headers: {
        'content-type': 'application/json',
        origin: `http://localhost:${port}`
      },
      method: 'POST'
    })

    assert.equal(response.status, 200)

    const socketResponse = await fetch(`${baseUrl}/socket.io/?EIO=4&transport=polling&t=dynamic-origin`, {
      headers: { origin: `http://localhost:${port}` }
    })

    assert.equal(socketResponse.status, 200)

    await stop()
    await stop()
    assert.deepEqual(services.stopCalls, ['raffle', 'chat', 'lower-third', 'obs'])
    assert.equal(server.listening, false)
  } finally {
    await stop()
  }
})

test('startServer teardown prevents a delayed disabled-chat startup from starting raffle timers', async () => {
  const { server, services, stop } = startServer({
    createServices: createDelayedStartServerServices,
    port: 0
  })

  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.once('listening', resolve)
    })

    await services.chatStarted
    const stopping = stop()
    services.releaseChatStart()
    await stopping

    assert.deepEqual(services.runtimeEvents, ['chat.start'])
    assert.deepEqual(services.stopCalls, ['raffle', 'chat', 'lower-third', 'obs'])
    assert.equal(server.listening, false)
  } finally {
    if (services.releaseChatStart) services.releaseChatStart()
    await stop()
  }
})

test('/api/v1/test runs the tracked default alert sound', async () => {
  const { emitted, services } = createRealQueueServices()
  const app = createApp(services)

  await withTestServer(app, async baseUrl => {
    const { payload, response } = await postJson(baseUrl, '/api/v1/test', { completionDelayMs: 0 })

    assert.equal(response.status, 200)
    assert.equal(payload.ok, true)
    assert.equal(payload.queued, true)

    const historyItem = await waitForQueueHistory(
      services.actionQueue,
      item => item.name === 'Test Alert'
    )
    assert.equal(historyItem.status, 'completed')
    assert.deepEqual(
      emitted.find(item => item.event === 'sound-play'),
      { event: 'sound-play', payload: { src: 'example.mp3', volume: 1 } }
    )
  })
})

test('/api/v1/sound-random uses the example text config when primary config is missing', async () => {
  await withTempDirectory(async directory => {
    const configDirectory = path.join(directory, 'config')
    fs.mkdirSync(configDirectory)
    fs.mkdirSync(path.join(configDirectory, 'examples'))
    fs.writeFileSync(path.join(configDirectory, 'examples', 'sfx-text.example.json'), JSON.stringify({
      'example.mp3': 'Example route sound'
    }))

    const { emitted, services } = createRealQueueServices({
      soundTextFile: path.join(configDirectory, 'sfx-text.json')
    })
    const app = createApp(services)

    await withTestServer(app, async baseUrl => {
      const { payload, response } = await postJson(baseUrl, '/api/v1/sound-random', { completionDelayMs: 0 })

      assert.equal(response.status, 200)
      assert.equal(payload.ok, true)
      assert.equal(payload.queued, true)

      const historyItem = await waitForQueueHistory(
        services.actionQueue,
        item => item.name === 'Random SFX Alert'
      )
      assert.equal(historyItem.status, 'completed')
      assert.deepEqual(
        emitted.find(item => item.event === 'sound-play'),
        { event: 'sound-play', payload: { src: 'example.mp3', volume: 0.8 } }
      )
    })
  })
})

test('Socket.IO polling requests are not handled by Express routes', async () => {
  await withSocketTestServer(async baseUrl => {
    const response = await fetch(`${baseUrl}/socket.io/?EIO=4&transport=polling&t=smoke`)
    const body = await response.text()

    assert.equal(response.status, 200)
    assert.match(body, /^0/)
  })
})

test('Socket.IO accepts requests from the configured application port', async () => {
  const configuredPort = 54322

  await withSocketTestServer(async baseUrl => {
    const response = await fetch(`${baseUrl}/socket.io/?EIO=4&transport=polling&t=origin`, {
      headers: { origin: `http://localhost:${configuredPort}` }
    })

    assert.equal(response.status, 200)
  }, { port: configuredPort })
})
