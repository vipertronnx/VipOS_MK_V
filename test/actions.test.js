const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { assertSoundFileExists, createActionRunner, listSoundFiles, validateActionStructure } = require('../modules/actions/actions')

function createNoopActionRunner() {
  return createActionRunner({
    io: { emit() {} },
    logger: { error() {}, log() {}, warn() {} },
    obs: {}
  })
}

function createTinyWav(filePath) {
  const buffer = Buffer.alloc(44)
  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(36, 4)
  buffer.write('WAVE', 8, 'ascii')
  buffer.write('fmt ', 12, 'ascii')
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(8000, 24)
  buffer.writeUInt32LE(8000, 28)
  buffer.writeUInt16LE(1, 32)
  buffer.writeUInt16LE(8, 34)
  buffer.write('data', 36, 'ascii')
  buffer.writeUInt32LE(0, 40)
  fs.writeFileSync(filePath, buffer)
}

function withTempSoundDirectory(fn) {
  const soundDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'vipos-sounds-'))
  const cleanup = () => fs.rmSync(soundDirectory, { recursive: true, force: true })

  try {
    const result = fn(soundDirectory)
    if (result && typeof result.then === 'function') {
      return result.finally(cleanup)
    }
    cleanup()
    return result
  } catch (error) {
    cleanup()
    throw error
  }
}

function withTempDirectory(fn) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vipos-actions-'))
  const cleanup = () => fs.rmSync(directory, { recursive: true, force: true })

  try {
    const result = fn(directory)
    if (result && typeof result.then === 'function') {
      return result.finally(cleanup)
    }
    cleanup()
    return result
  } catch (error) {
    cleanup()
    throw error
  }
}

test('delay actions reject non-finite values', async () => {
  const actions = createNoopActionRunner()

  await assert.rejects(
    () => actions.run({ type: 'delay', ms: 'Infinity' }),
    error => error.statusCode === 400 && /finite millisecond/.test(error.message)
  )
})

test('action structure validation accepts every supported action type', () => {
  const actions = [
    { type: 'chat.say', message: 'Hello' },
    { type: 'context.pickRandom', contextKey: 'greeting' },
    { type: 'delay' },
    { action: 'log' },
    { type: 'obs.media', input: 'Video', mediaAction: 'restart' },
    { type: 'obs.mute', input: 'Music' },
    { type: 'obs.scene', scene: 'Live' },
    { type: 'obs.source', source: 'Camera' },
    { type: 'overlay.alert', message: '{displayName} joined' },
    { type: 'overlay.emit', event: 'bg-alert' },
    { type: 'sound.pickRandom' },
    { type: 'sound.play', src: 'example.mp3' }
  ]

  for (const action of actions) {
    assert.doesNotThrow(() => validateActionStructure(action), action.type || action.action)
  }
})

test('action structure validation preserves required field alternatives', () => {
  const actions = [
    { type: 'chat.say', text: 'Hello' },
    { type: 'context.pickRandom', key: 'greeting' },
    { type: 'obs.media', source: 'Video', media: 'restart' },
    { type: 'obs.media', input: 'Video', command: 'restart' },
    { type: 'obs.mute', source: 'Music' },
    { type: 'obs.source', input: 'Camera' },
    { type: 'sound.play', path: 'example.mp3' }
  ]

  for (const action of actions) {
    assert.doesNotThrow(() => validateActionStructure(action), action.type)
  }
})

test('action structure validation rejects unknown types and missing required fields', () => {
  assert.throws(
    () => validateActionStructure({ type: 'unknown.action' }),
    error => error.statusCode === 400 && /Unknown action type/.test(error.message)
  )

  const requiredFields = [
    ['chat.say', {}, 'chat.say requires message or text'],
    ['context.pickRandom', {}, 'context.pickRandom requires contextKey or key'],
    ['obs.media', { input: 'Video' }, 'obs.media requires mediaAction or media or command'],
    ['obs.media', { mediaAction: 'restart' }, 'obs.media requires input or source'],
    ['obs.mute', {}, 'obs.mute requires input or source'],
    ['obs.scene', {}, 'obs.scene requires scene'],
    ['obs.source', {}, 'obs.source requires source or input'],
    ['overlay.alert', {}, 'overlay.alert requires message'],
    ['overlay.emit', {}, 'overlay.emit requires event'],
    ['sound.play', {}, 'sound.play requires src or path']
  ]

  for (const [type, fields, message] of requiredFields) {
    assert.throws(
      () => validateActionStructure({ type, ...fields }),
      error => error.statusCode === 400 && error.message === message,
      message
    )
  }
})

test('delay actions cap positive waits at ten minutes', async () => {
  let waitedMs = null
  const actions = createActionRunner({
    io: { emit() {} },
    logger: { error() {}, log() {}, warn() {} },
    obs: {},
    waitForDelay(ms) {
      waitedMs = ms
      return Promise.resolve()
    }
  })

  const result = await actions.run({ type: 'delay', ms: 999999999 })

  assert.equal(waitedMs, 600000)
  assert.equal(result[0].ms, 600000)
})

test('sound listing reuses cached results and returns cloned entries', () => {
  withTempSoundDirectory(soundDirectory => {
    createTinyWav(path.join(soundDirectory, 'alert.wav'))

    const first = listSoundFiles({ soundDirectory })
    assert.equal(first.length, 1)
    assert.equal(first[0].src, 'alert.wav')

    fs.unlinkSync(path.join(soundDirectory, 'alert.wav'))
    first[0].src = 'mutated.wav'

    const second = listSoundFiles({ soundDirectory })
    assert.equal(second.length, 1)
    assert.equal(second[0].src, 'alert.wav')
  })
})

test('sound listing skips files that cannot be statted', () => {
  withTempSoundDirectory(soundDirectory => {
    const missingPath = path.join(soundDirectory, 'missing.wav')
    const workingPath = path.join(soundDirectory, 'working.wav')
    const originalStatSync = fs.statSync
    const warnings = []

    createTinyWav(missingPath)
    createTinyWav(workingPath)

    fs.statSync = function statSyncWithMissingFile(filePath, ...args) {
      if (path.resolve(filePath) === path.resolve(missingPath)) {
        const error = new Error('simulated missing file')
        error.code = 'ENOENT'
        throw error
      }
      return originalStatSync.call(this, filePath, ...args)
    }

    try {
      const sounds = listSoundFiles({
        cacheTtlMs: 0,
        logger: {
          error() {},
          log() {},
          warn(message) {
            warnings.push(message)
          }
        },
        soundDirectory
      })

      assert.deepEqual(sounds.map(sound => sound.src), ['working.wav'])
      assert.equal(warnings.length, 1)
      assert.match(warnings[0], /Failed to read sound file missing\.wav/)
    } finally {
      fs.statSync = originalStatSync
    }
  })
})

test('sound playback reuses cached duration for unchanged files', async () => {
  await withTempSoundDirectory(async soundDirectory => {
    const soundPath = path.join(soundDirectory, 'alert.wav')
    const originalReadFileSync = fs.readFileSync
    let durationReadCount = 0

    createTinyWav(soundPath)

    fs.readFileSync = function readFileSyncWithCount(filePath, ...args) {
      if (path.resolve(filePath) === path.resolve(soundPath)) {
        durationReadCount += 1
      }
      return originalReadFileSync.call(this, filePath, ...args)
    }

    try {
      const actions = createActionRunner({
        io: { emit() {} },
        logger: { error() {}, log() {}, warn() {} },
        obs: {},
        soundDirectory
      })

      await actions.run({ type: 'sound.play', src: 'alert.wav' })
      await actions.run({ type: 'sound.play', src: 'alert.wav' })
    } finally {
      fs.readFileSync = originalReadFileSync
    }

    assert.equal(durationReadCount, 1)
  })
})

test('sound playback rejects missing files before emitting overlay events', async () => {
  await withTempSoundDirectory(async soundDirectory => {
    const emitted = []
    const actions = createActionRunner({
      io: {
        emit(event, payload) {
          emitted.push({ event, payload })
        }
      },
      logger: { error() {}, log() {}, warn() {} },
      obs: {},
      soundDirectory
    })

    await assert.rejects(
      () => actions.run({ type: 'sound.play', src: 'missing.wav' }),
      error => error.statusCode === 400 && /file was not found/.test(error.message)
    )
    assert.deepEqual(emitted, [])
  })
})

test('sound file preflight accepts existing files and rejects missing files', () => {
  withTempSoundDirectory(soundDirectory => {
    createTinyWav(path.join(soundDirectory, 'alert.wav'))

    assert.doesNotThrow(() => assertSoundFileExists('alert.wav', soundDirectory))
    assert.throws(
      () => assertSoundFileExists('missing.wav', soundDirectory),
      error => error.statusCode === 400 && /file was not found/.test(error.message)
    )
  })
})

test('sound playback warns once for unchanged files above the warning threshold', async () => {
  await withTempSoundDirectory(async soundDirectory => {
    const warnings = []
    createTinyWav(path.join(soundDirectory, 'alert.wav'))

    const actions = createActionRunner({
      io: { emit() {} },
      largeSoundWarningBytes: 1,
      logger: {
        error() {},
        log() {},
        warn(message) {
          warnings.push(message)
        }
      },
      obs: {},
      soundDirectory
    })

    await actions.run({ type: 'sound.play', src: 'alert.wav' })
    await actions.run({ type: 'sound.play', src: 'alert.wav' })

    assert.equal(warnings.length, 1)
    assert.match(warnings[0], /Sound file alert\.wav is 44 B/)
  })
})

test('random sound falls back to example text config when primary config is missing', async () => {
  await withTempDirectory(async directory => {
    const soundDirectory = path.join(directory, 'sounds')
    const configDirectory = path.join(directory, 'config')
    fs.mkdirSync(soundDirectory)
    fs.mkdirSync(configDirectory)
    createTinyWav(path.join(soundDirectory, 'example.wav'))
    fs.writeFileSync(path.join(configDirectory, 'sfx-text.example.json'), JSON.stringify({
      'example.wav': 'Example fallback'
    }))

    const emitted = []
    const actions = createActionRunner({
      io: {
        emit(event, payload) {
          emitted.push({ event, payload })
        }
      },
      logger: { error() {}, log() {}, warn() {} },
      obs: {},
      soundDirectory,
      soundTextFile: path.join(configDirectory, 'sfx-text.json')
    })
    const context = {}

    const results = await actions.run([
      { type: 'sound.pickRandom', contextKey: 'sfx' },
      { type: 'sound.play', src: '{sfx.src}' }
    ], context)

    assert.equal(context.sfx.src, 'example.wav')
    assert.equal(context.sfx.text, 'Example fallback')
    assert.equal(results[1].src, 'example.wav')
    assert.deepEqual(emitted, [
      { event: 'sound-play', payload: { src: 'example.wav', volume: 1 } }
    ])
  })
})

test('random sound uses primary text config when it exists', async () => {
  await withTempDirectory(async directory => {
    const soundDirectory = path.join(directory, 'sounds')
    const configDirectory = path.join(directory, 'config')
    fs.mkdirSync(soundDirectory)
    fs.mkdirSync(configDirectory)
    createTinyWav(path.join(soundDirectory, 'primary.wav'))
    createTinyWav(path.join(soundDirectory, 'example.wav'))
    fs.writeFileSync(path.join(configDirectory, 'sfx-text.json'), JSON.stringify({
      'primary.wav': 'Primary config'
    }))
    fs.writeFileSync(path.join(configDirectory, 'sfx-text.example.json'), JSON.stringify({
      'example.wav': 'Example fallback'
    }))

    const actions = createActionRunner({
      io: { emit() {} },
      logger: { error() {}, log() {}, warn() {} },
      obs: {},
      soundDirectory,
      soundTextFile: path.join(configDirectory, 'sfx-text.json')
    })
    const context = {}

    await actions.run({ type: 'sound.pickRandom', contextKey: 'sfx' }, context)

    assert.equal(context.sfx.src, 'primary.wav')
    assert.equal(context.sfx.text, 'Primary config')
  })
})

test('random sound falls back to example text config when primary config is malformed', async () => {
  await withTempDirectory(async directory => {
    const soundDirectory = path.join(directory, 'sounds')
    const configDirectory = path.join(directory, 'config')
    fs.mkdirSync(soundDirectory)
    fs.mkdirSync(configDirectory)
    createTinyWav(path.join(soundDirectory, 'example.wav'))
    fs.writeFileSync(path.join(configDirectory, 'sfx-text.json'), '{not json')
    fs.writeFileSync(path.join(configDirectory, 'sfx-text.example.json'), JSON.stringify({
      'example.wav': 'Example fallback'
    }))

    const warnings = []
    const actions = createActionRunner({
      io: { emit() {} },
      logger: {
        error() {},
        log() {},
        warn(message) {
          warnings.push(message)
        }
      },
      obs: {},
      soundDirectory,
      soundTextFile: path.join(configDirectory, 'sfx-text.json')
    })
    const context = {}

    await actions.run({ type: 'sound.pickRandom', contextKey: 'sfx' }, context)

    assert.equal(context.sfx.src, 'example.wav')
    assert.equal(context.sfx.text, 'Example fallback')
    assert.equal(warnings.length, 2)
    assert.match(warnings[0], /Failed to load sound text map/)
    assert.match(warnings[1], /Using fallback sound text map/)
  })
})

test('random sound can use inline text map as the eligible sound pool', async () => {
  await withTempDirectory(async directory => {
    const soundDirectory = path.join(directory, 'sounds')
    fs.mkdirSync(soundDirectory)
    createTinyWav(path.join(soundDirectory, 'inline.wav'))

    const actions = createActionRunner({
      io: { emit() {} },
      logger: { error() {}, log() {}, warn() {} },
      obs: {},
      soundDirectory,
      soundTextFile: path.join(directory, 'missing-sfx-text.json')
    })
    const context = {}

    await actions.run({
      type: 'sound.pickRandom',
      contextKey: 'sfx',
      textMap: {
        'inline.wav': 'Inline map'
      }
    }, context)

    assert.equal(context.sfx.src, 'inline.wav')
    assert.equal(context.sfx.text, 'Inline map')
  })
})

test('random sound empty pool error is not tied to sfx-text.json', async () => {
  await withTempDirectory(async directory => {
    const soundDirectory = path.join(directory, 'sounds')
    fs.mkdirSync(soundDirectory)

    const actions = createActionRunner({
      io: { emit() {} },
      logger: { error() {}, log() {}, warn() {} },
      obs: {},
      soundDirectory,
      soundTextFile: path.join(directory, 'missing-sfx-text.json')
    })

    await assert.rejects(
      () => actions.run({
        type: 'sound.pickRandom',
        contextKey: 'sfx',
        textMap: {
          'missing.wav': 'Inline map'
        }
      }, {}),
      error => error.statusCode === 400 &&
        /no configured sound files in the local sound directory/.test(error.message) &&
        !/sfx-text\.json/.test(error.message)
    )
  })
})

test('random sound inline text map overrides configured labels without excluding configured files', async () => {
  await withTempDirectory(async directory => {
    const soundDirectory = path.join(directory, 'sounds')
    const configDirectory = path.join(directory, 'config')
    fs.mkdirSync(soundDirectory)
    fs.mkdirSync(configDirectory)
    createTinyWav(path.join(soundDirectory, 'shared.wav'))
    fs.writeFileSync(path.join(configDirectory, 'sfx-text.json'), JSON.stringify({
      'shared.wav': 'Configured label'
    }))

    const actions = createActionRunner({
      io: { emit() {} },
      logger: { error() {}, log() {}, warn() {} },
      obs: {},
      soundDirectory,
      soundTextFile: path.join(configDirectory, 'sfx-text.json')
    })
    const context = {}

    await actions.run({
      type: 'sound.pickRandom',
      contextKey: 'sfx',
      labels: {
        'shared.wav': 'Inline label'
      }
    }, context)

    assert.equal(context.sfx.src, 'shared.wav')
    assert.equal(context.sfx.text, 'Inline label')
  })
})
