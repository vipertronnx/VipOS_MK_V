const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

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
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vipos-raffle-'))
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

test('expired persisted raffles close after chat is attached', async () => {
  await withTempRaffleState(async stateFile => {
    const sentMessages = []
    const actions = createActionRunner({
      io: { emit() {} },
      logger: { error() {}, log() {}, warn() {} },
      obs: {}
    })
    const actionQueue = createActionQueue({
      actions,
      logger: { error() {} },
      soundCompletionBufferMs: 0,
      soundCompletionFallbackMs: 0
    })
    const raffle = createRaffleService({
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

    assert.equal(actionQueue.getStatus().history.length, 0)

    actions.setChatService({
      async say(message) {
        sentMessages.push(message)
        return { id: 'sent', isSent: true }
      }
    })
    raffle.startTimers()

    const historyItem = await waitForQueueHistory(
      actionQueue,
      item => item.name === 'Raffle'
    )
    assert.equal(historyItem.status, 'completed')
    assert.deepEqual(sentMessages, ['Raffle closed with no entries.'])
  })
})
