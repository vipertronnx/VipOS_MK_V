const assert = require('node:assert/strict')
const test = require('node:test')

const { createRetryScheduler } = require('../modules/chat/chat-retry')

function createFakeTimers() {
  const timers = new Map()
  let nextId = 1

  return {
    clearTimer(id) {
      timers.delete(id)
    },
    run(id) {
      const callback = timers.get(id)
      timers.delete(id)
      if (callback) callback()
    },
    setTimer(callback, delay) {
      const id = nextId
      nextId += 1
      timers.set(id, callback)
      return id
    },
    delays: [],
    schedule(callback, delay) {
      this.delays.push(delay)
      return this.setTimer(callback, delay)
    }
  }
}

test('retry scheduler applies capped exponential backoff and suppresses duplicate timers', () => {
  const timers = createFakeTimers()
  const scheduled = []
  let retries = 0
  const scheduler = createRetryScheduler({
    initialMs: 100,
    maxMs: 250,
    onRetry() {
      retries += 1
    },
    onSchedule(details) {
      scheduled.push(details)
    },
    setTimer: timers.schedule.bind(timers),
    clearTimer: timers.clearTimer
  })

  assert.equal(scheduler.schedule(), true)
  assert.equal(scheduler.schedule(), false)
  assert.equal(scheduler.isScheduled(), true)
  assert.deepEqual(scheduled, [{ attempt: 1, delay: 100 }])
  assert.deepEqual(timers.delays, [100])

  timers.run(1)
  assert.equal(retries, 1)
  assert.equal(scheduler.isScheduled(), false)

  assert.equal(scheduler.schedule(), true)
  timers.run(2)
  assert.equal(scheduler.schedule(), true)

  assert.deepEqual(scheduled, [
    { attempt: 1, delay: 100 },
    { attempt: 2, delay: 200 },
    { attempt: 3, delay: 250 }
  ])
  assert.deepEqual(timers.delays, [100, 200, 250])
})

test('retry scheduler reset cancels a pending timer and restarts attempts', () => {
  const timers = createFakeTimers()
  const scheduled = []
  let resets = 0
  let retries = 0
  const scheduler = createRetryScheduler({
    initialMs: 100,
    maxMs: 1000,
    onRetry() {
      retries += 1
    },
    onSchedule(details) {
      scheduled.push(details)
    },
    onReset() {
      resets += 1
    },
    setTimer: timers.schedule.bind(timers),
    clearTimer: timers.clearTimer
  })

  scheduler.schedule()
  scheduler.reset()

  assert.equal(scheduler.isScheduled(), false)
  assert.equal(resets, 1)
  timers.run(1)
  assert.equal(retries, 0)
  assert.equal(scheduled.length, 1)

  scheduler.schedule()
  assert.deepEqual(scheduled, [
    { attempt: 1, delay: 100 },
    { attempt: 1, delay: 100 }
  ])
})
