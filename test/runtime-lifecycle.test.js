const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { startRuntimeServices, stopRuntimeServices } = require('../app')
const { createActionQueue } = require('../modules/actions/action-queue')
const { createActionRunner } = require('../modules/actions/actions')
const { createRaffleService } = require('../modules/chat/chat-raffles')

function createExpiredRaffleState(filePath) {
  const now = Date.now()
  fs.writeFileSync(filePath, `${JSON.stringify({
    enabled: false,
    current: {
      id: 'raffle-expired',
      roundNumber: 1,
      status: 'open',
      openedAt: new Date(now - 120000).toISOString(),
      closesAt: new Date(now - 60000).toISOString(),
      prizeAmount: 100,
      pointName: 'points',
      pointTwitchEmoji: '',
      entrants: {}
    },
    history: [],
    settings: {
      countdownIntervalMs: 0,
      entryWindowMs: 1000
    },
    totals: {},
    users: {}
  }, null, 2)}\n`)
}

function withTempRaffleState(fn) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vipos-runtime-'))
  const stateFile = path.join(directory, 'raffle.json')
  createExpiredRaffleState(stateFile)

  const cleanup = () => fs.rmSync(directory, { recursive: true, force: true })

  try {
    const result = fn(stateFile)
    if (result && typeof result.then === 'function') return result.finally(cleanup)
    cleanup()
    return result
  } catch (error) {
    cleanup()
    throw error
  }
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

test('expired persisted raffle announcements wait for chat readiness', async () => {
  await withTempRaffleState(async stateFile => {
    const sentMessages = []
    let chatStarted = false
    let raffle
    const onChatReady = () => raffle.startTimers()
    const chat = {
      getStatus() {
        return { enabled: true }
      },
      async say(message) {
        if (!chatStarted) throw new Error('Twitch chat is not ready')
        sentMessages.push(message)
        return { id: 'sent', isSent: true }
      },
      async start() {
        await new Promise(resolve => setTimeout(resolve, 0))
        chatStarted = true
        onChatReady()
      }
    }
    const actions = createActionRunner({
      io: { emit() {} },
      logger: { error() {}, log() {}, warn() {} },
      obs: {}
    })
    actions.setChatService(chat)
    const actionQueue = createActionQueue({
      actions,
      logger: { error() {} },
      soundCompletionBufferMs: 0,
      soundCompletionFallbackMs: 0
    })
    raffle = createRaffleService({
      announce(actionList, context = {}) {
        return actionQueue.enqueue({
          name: 'Raffle',
          actions: actionList,
          completionDelayMs: 0,
          context,
          source: 'raffle'
        })
      },
      logger: { error() {}, log() {}, warn() {} },
      settings: {
        countdownIntervalMs: 0,
        enabled: false,
        entryWindowMs: 1000
      },
      stateFile
    })

    await startRuntimeServices({
      chat,
      obs: { connect() {} },
      raffle
    })

    const historyItem = await waitForQueueHistory(
      actionQueue,
      item => item.name === 'Raffle'
    )
    assert.equal(historyItem.status, 'completed')
    assert.deepEqual(sentMessages, ['Raffle closed with no entries.'])
  })
})

test('failed enabled chat startup does not activate raffle timers', async () => {
  let startTimersCalls = 0

  await startRuntimeServices({
    chat: {
      getStatus() {
        return { enabled: true }
      },
      async start() {}
    },
    obs: { connect() {} },
    raffle: {
      startTimers() {
        startTimersCalls += 1
      }
    }
  })

  assert.equal(startTimersCalls, 0)
})

test('disabled chat startup activates raffle timers', async () => {
  let startTimersCalls = 0

  await startRuntimeServices({
    chat: {
      getStatus() {
        return { enabled: false }
      },
      async start() {}
    },
    obs: { connect() {} },
    raffle: {
      startTimers() {
        startTimersCalls += 1
      }
    }
  })

  assert.equal(startTimersCalls, 1)
})

test('runtime shutdown attempts every cleanup operation before reporting failures', async () => {
  const calls = []

  await assert.rejects(
    () => stopRuntimeServices({
      chat: {
        stop() {
          calls.push('chat')
          throw new Error('chat stop failed')
        }
      },
      lowerThirdSync: {
        stop() {
          calls.push('lower-third')
        }
      },
      obs: {
        async disconnect() {
          calls.push('obs')
        }
      },
      raffle: {
        stopTimers() {
          calls.push('raffle')
        }
      }
    }),
    error => error instanceof AggregateError && error.errors.length === 1 && error.errors[0].message === 'chat stop failed'
  )

  assert.deepEqual(calls, ['raffle', 'chat', 'lower-third', 'obs'])
})
