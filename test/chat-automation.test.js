const assert = require('node:assert/strict')
const test = require('node:test')

const { createChatAutomation } = require('../modules/chat/chat-automation')

function createCommand(overrides = {}) {
  return {
    actions: [{ type: 'overlay.alert', message: 'Hello' }],
    cooldownScope: 'global',
    cooldownSeconds: 0,
    key: '!announce',
    roles: [],
    ...overrides
  }
}

function createHandler(overrides = {}) {
  return {
    actions: [{ type: 'overlay.alert', message: 'Hello' }],
    cooldownScope: 'global',
    cooldownSeconds: 0,
    events: [],
    inputContains: [],
    inputPatterns: [],
    maxViewers: null,
    minViewers: null,
    name: '',
    rewardIds: [],
    rewardTitles: [],
    rewardTypes: [],
    roles: [],
    statuses: [],
    userIds: [],
    usernames: [],
    ...overrides
  }
}

function createContext(overrides = {}) {
  return {
    chat: {},
    displayName: 'Viewer',
    event: 'chat.message',
    message: '!announce hello',
    roles: ['everyone'],
    source: 'chat',
    userId: 'viewer-1',
    ...overrides
  }
}

test('automation parses commands and sends accepted commands directly to the action runner', async () => {
  const dispatched = []
  const accepted = []
  const command = createCommand({ roles: ['moderator'] })
  const automation = createChatAutomation({
    actions: {
      async run(actions, context) {
        dispatched.push({ actions, context })
      }
    },
    onCommandAccepted(context) {
      assert.equal(dispatched.length, 0)
      accepted.push(context)
    }
  })
  const commandMap = new Map([
    ['!announce', command],
    ['!say', command]
  ])

  const commandMatch = automation.findCommand('!SAY  hello   world', commandMap)

  assert.deepEqual(commandMatch, {
    after: 'hello   world',
    args: ['hello', 'world'],
    command,
    commandName: '!say'
  })
  await automation.runCommand(commandMatch, createContext({
    chat: { roles: ['everyone', 'moderator'] },
    roles: ['everyone', 'moderator']
  }))

  assert.equal(accepted.length, 1)
  assert.equal(dispatched.length, 1)
  assert.deepEqual(dispatched[0], {
    actions: command.actions,
    context: {
      ...createContext({
        chat: {
          after: 'hello   world',
          args: ['hello', 'world'],
          command: '!say',
          roles: ['everyone', 'moderator']
        },
        roles: ['everyone', 'moderator']
      }),
      after: 'hello   world',
      args: ['hello', 'world'],
      command: '!say',
      commandName: '!say'
    }
  })
})

test('automation executes matching handlers in order and marks queued simulations', async () => {
  const queued = []
  let releaseFirst
  let firstStarted
  const firstStartedPromise = new Promise(resolve => {
    firstStarted = resolve
  })
  const automation = createChatAutomation({
    actionQueue: {
      async enqueue(item) {
        queued.push(item)
        if (item.name === 'Twitch raid.add first') {
          firstStarted()
          await new Promise(resolve => {
            releaseFirst = resolve
          })
        }
      }
    },
    actions: {},
    isSimulating: () => true
  })
  const handlers = [
    createHandler({ name: 'first' }),
    createHandler({ name: 'second' })
  ]
  const context = createContext({
    event: 'raid.add',
    source: 'raid'
  })

  const execution = automation.runConfiguredHandlers(handlers, context)
  await firstStartedPromise
  assert.equal(queued.length, 1)

  releaseFirst()
  assert.equal(await execution, 2)
  assert.deepEqual(queued.map(item => ({
    name: item.name,
    simulated: item.context.simulated,
    source: item.source
  })), [
    { name: 'Twitch raid.add first', simulated: true, source: 'raid' },
    { name: 'Twitch raid.add second', simulated: true, source: 'raid' }
  ])
})

test('automation queues highlight alerts with the configured default sound', async () => {
  const queued = []
  const automation = createChatAutomation({
    actionQueue: {
      enqueue(item) {
        queued.push(item)
      }
    },
    actions: {},
    defaultAlertSound: 'highlight.ogg'
  })
  const context = createContext()

  await automation.runHighlightAlert(context)

  assert.deepEqual(queued, [{
    actions: [
      { type: 'overlay.alert', message: '{displayName}: {message}' },
      { type: 'sound.play', src: 'highlight.ogg', volume: 1 }
    ],
    context,
    name: 'Twitch Highlight Alert',
    source: 'chat'
  }])
})
