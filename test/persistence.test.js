const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { createGreetingService } = require('../modules/chat/chat-greetings')
const { createRaffleService } = require('../modules/chat/chat-raffles')

function withTempDirectory(fn) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vipos-persistence-'))
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

test('greeting pool changes fail when their settings cannot be persisted', () => {
  withTempDirectory(directory => {
    const greetingsFile = path.join(directory, 'greetings.json')
    const settingsFile = path.join(directory, 'greetings-settings')
    fs.writeFileSync(greetingsFile, JSON.stringify({
      defaultPool: 'default',
      pools: { default: ['Hello'], alternate: ['Hi'] }
    }))
    fs.mkdirSync(settingsFile)

    const greetings = createGreetingService({
      greetingsFile,
      logger: { warn() {} },
      settingsFile
    })

    assert.throws(
      () => greetings.setActivePool('alternate'),
      error => error.statusCode === 503 && /Failed to save greeting settings/.test(error.message)
    )
    assert.equal(greetings.getStatus().activePool, 'default')
  })
})

test('greeting pool changes persist settings atomically', () => {
  withTempDirectory(directory => {
    const greetingsFile = path.join(directory, 'greetings.json')
    const settingsFile = path.join(directory, 'greetings-settings.json')
    fs.writeFileSync(greetingsFile, JSON.stringify({
      defaultPool: 'default',
      pools: { default: ['Hello'], alternate: ['Hi'] }
    }))
    fs.writeFileSync(settingsFile, JSON.stringify({ activePool: 'default' }))

    const greetings = createGreetingService({ greetingsFile, settingsFile })
    const status = greetings.setActivePool('alternate')

    assert.equal(status.activePool, 'alternate')
    assert.deepEqual(JSON.parse(fs.readFileSync(settingsFile, 'utf8')), { activePool: 'alternate' })
  })
})

test('durable raffle updates roll back when their state cannot be persisted', () => {
  withTempDirectory(directory => {
    const stateFile = path.join(directory, 'raffle-state')
    fs.mkdirSync(stateFile)
    const raffle = createRaffleService({
      logger: { error() {}, warn() {} },
      settings: {
        countdownIntervalMs: 0,
        enabled: false,
        entryWindowMs: 1000,
        maxDelayMs: 1000,
        minDelayMs: 1000,
        pointAmounts: [100]
      },
      stateFile
    })

    assert.throws(
      () => raffle.start({ requirePersistence: true }),
      error => error.statusCode === 503 && /Failed to persist raffle state/.test(error.message)
    )

    const status = raffle.getStatus()
    assert.equal(status.current, null)
    assert.equal(status.totals.roundsStarted, 0)
    assert.match(status.lastPersistenceError, /EISDIR|EPERM|EACCES/)
    raffle.stopTimers()
  })
})

test('durable raffle close keeps the open state when scheduling cannot be persisted', () => {
  withTempDirectory(directory => {
    const stateFile = path.join(directory, 'raffle-state')
    fs.mkdirSync(stateFile)
    const raffle = createRaffleService({
      logger: { error() {}, warn() {} },
      settings: {
        countdownIntervalMs: 0,
        enabled: false,
        entryWindowMs: 60 * 1000,
        maxDelayMs: 1000,
        minDelayMs: 1000,
        pointAmounts: [100]
      },
      stateFile
    })

    raffle.start()
    assert.equal(raffle.getStatus().current.status, 'open')

    assert.throws(
      () => raffle.close({ requirePersistence: true }),
      error => error.statusCode === 503 && /Failed to persist raffle state/.test(error.message)
    )

    const status = raffle.getStatus()
    assert.equal(status.current.status, 'open')
    assert.equal(status.totals.roundsClosed, 0)
    raffle.stopTimers()
  })
})
