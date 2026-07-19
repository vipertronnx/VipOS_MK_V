const assert = require('node:assert/strict')
const test = require('node:test')

const { createActionQueue } = require('../modules/actions/action-queue')

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
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

test('action queue processes actions in order and records failures', async () => {
  const firstRun = deferred()
  const calls = []
  const actionQueue = createActionQueue({
    actions: {
      async run(actionList) {
        calls.push(actionList.id)
        if (actionList.id === 'first') return firstRun.promise
        throw new Error('second action failed')
      }
    },
    logger: { error() {} },
    soundCompletionBufferMs: 0,
    soundCompletionFallbackMs: 0
  })

  actionQueue.enqueue({ actions: { id: 'first' }, name: 'First' })
  actionQueue.enqueue({ actions: { id: 'second' }, name: 'Second' })

  assert.equal(actionQueue.getStatus().running.name, 'First')
  assert.deepEqual(actionQueue.getStatus().pending.map(item => item.name), ['Second'])

  firstRun.resolve([])

  const failed = await waitForQueueHistory(actionQueue, item => item.name === 'Second')
  const completed = actionQueue.getStatus().history.find(item => item.name === 'First')

  assert.deepEqual(calls, ['first', 'second'])
  assert.equal(completed.status, 'completed')
  assert.equal(failed.status, 'failed')
  assert.equal(failed.error, 'second action failed')
})

test('action queue pause, skip, clear, and resume update queue state', async () => {
  const calls = []
  const actionQueue = createActionQueue({
    actions: {
      async run(actionList) {
        calls.push(actionList.id)
        return []
      }
    },
    logger: { error() {} },
    soundCompletionBufferMs: 0,
    soundCompletionFallbackMs: 0
  })

  actionQueue.pause()
  actionQueue.enqueue({ actions: { id: 'skip' }, name: 'Skip' })
  actionQueue.enqueue({ actions: { id: 'clear' }, name: 'Clear' })

  assert.equal(actionQueue.getStatus().paused, true)
  assert.equal(actionQueue.getStatus().running, null)
  assert.equal(actionQueue.getStatus().pending.length, 2)

  actionQueue.skipNext()
  actionQueue.clear()

  const afterClear = actionQueue.getStatus()
  assert.equal(afterClear.pending.length, 0)
  assert.equal(afterClear.history.find(item => item.name === 'Skip').status, 'skipped')
  assert.equal(afterClear.history.find(item => item.name === 'Clear').status, 'cleared')
  assert.equal(afterClear.activity[0].event, 'clear')

  actionQueue.enqueue({ actions: { id: 'resume' }, name: 'Resume' })
  actionQueue.resume()

  const completed = await waitForQueueHistory(actionQueue, item => item.name === 'Resume')
  assert.equal(completed.status, 'completed')
  assert.deepEqual(calls, ['resume'])
})

test('action queue rejects structurally invalid actions before adding an item', () => {
  let runCalled = false
  const validationError = Object.assign(new Error('Unknown action type: invalid'), { statusCode: 400 })
  const actionQueue = createActionQueue({
    actions: {
      async run() {
        runCalled = true
      },
      validateStructure() {
        throw validationError
      }
    },
    logger: { error() {} }
  })

  assert.throws(
    () => actionQueue.enqueue({ actions: { type: 'invalid' }, name: 'Invalid' }),
    error => error === validationError
  )

  const status = actionQueue.getStatus()
  assert.equal(runCalled, false)
  assert.equal(status.pending.length, 0)
  assert.equal(status.history.length, 0)
  assert.equal(status.activity.length, 0)
})
