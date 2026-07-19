const assert = require('node:assert/strict')
const test = require('node:test')

const { createCommandConfigLifecycle } = require('../modules/chat/chat-command-config')

function createFileSystem(files = new Map()) {
  const watchCalls = []
  const unwatchCalls = []

  return {
    existsSync(file) {
      return files.has(file)
    },
    files,
    readFileSync(file) {
      return files.get(file)
    },
    unwatchCalls,
    unwatchFile(file) {
      unwatchCalls.push(file)
    },
    watchCalls,
    watchFile(file, options, callback) {
      watchCalls.push({ callback, file, options })
    }
  }
}

test('command configuration loads normalized snapshots and retains the first duplicate command', async () => {
  const fileSystem = createFileSystem(new Map([['commands.json', JSON.stringify({
    commands: [
      { actions: [{ type: 'log', message: 'first' }], aliases: ['duplicate'], command: 'first' },
      { actions: [{ type: 'log', message: 'second' }], command: 'duplicate' }
    ],
    follows: [{ actions: [{ type: 'log', message: 'follow' }] }],
    rewardEvents: [{ actions: [{ type: 'log', message: 'reward' }] }]
  })]]))
  const warnings = []
  const loaded = []
  const lifecycle = createCommandConfigLifecycle({
    commandPrefix: '!',
    commandsFile: 'commands.json',
    fileSystem,
    logger: { warn: message => warnings.push(message) },
    onLoaded: snapshot => loaded.push(snapshot)
  })

  const snapshot = await lifecycle.load()

  assert.equal(loaded.length, 1)
  assert.equal(snapshot.commandMap.size, 2)
  assert.equal(snapshot.commandMap.get('!duplicate').key, '!first')
  assert.equal(snapshot.followHandlers.length, 1)
  assert.equal(snapshot.rewardEventHandlers.length, 1)
  assert.deepEqual(warnings, ['Duplicate Twitch command ignored: !duplicate'])
})

test('command configuration distinguishes malformed and missing files', async () => {
  const fileSystem = createFileSystem(new Map([['commands.json', JSON.stringify({
    commands: [{ actions: [{ type: 'log', message: 'original' }], command: 'original' }]
  })]]))
  const errors = []
  const missing = []
  const lifecycle = createCommandConfigLifecycle({
    commandPrefix: '!',
    commandsFile: 'commands.json',
    fileSystem,
    onError: error => errors.push(error.message),
    onMissing: snapshot => missing.push(snapshot)
  })

  const originalSnapshot = await lifecycle.load()
  fileSystem.files.set('commands.json', '{')

  assert.equal(await lifecycle.load(), originalSnapshot)
  assert.equal(errors.length, 1)
  assert.equal(lifecycle.getSnapshot().commandMap.get('!original').key, '!original')

  fileSystem.files.delete('commands.json')
  const emptySnapshot = await lifecycle.load()

  assert.notEqual(emptySnapshot, originalSnapshot)
  assert.equal(emptySnapshot.commandMap.size, 0)
  assert.equal(missing.length, 1)
})

test('command configuration watches once, reloads, and unwatches once', async () => {
  const fileSystem = createFileSystem(new Map([['commands.json', JSON.stringify({ commands: [] })]]))
  const lifecycle = createCommandConfigLifecycle({
    commandPrefix: '!',
    commandsFile: 'commands.json',
    fileSystem
  })

  await lifecycle.load()
  lifecycle.watch()
  lifecycle.watch()

  assert.equal(fileSystem.watchCalls.length, 1)
  assert.deepEqual(fileSystem.watchCalls[0].options, { interval: 1000 })

  fileSystem.files.set('commands.json', JSON.stringify({
    commands: [{ actions: [{ type: 'log', message: 'reloaded' }], command: 'reloaded' }]
  }))
  fileSystem.watchCalls[0].callback()
  await Promise.resolve()

  assert.equal(lifecycle.getSnapshot().commandMap.get('!reloaded').key, '!reloaded')

  lifecycle.unwatch()
  lifecycle.unwatch()
  assert.deepEqual(fileSystem.unwatchCalls, ['commands.json'])
})
