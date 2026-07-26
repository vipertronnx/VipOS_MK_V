const assert = require('node:assert/strict')
const test = require('node:test')

const {
  normalizeActionHandler,
  normalizeAutomationConfig,
  normalizeCommand,
  normalizeEventName
} = require('../modules/chat/chat-normalization')

test('automation configuration normalizes array and alias forms', () => {
  assert.deepEqual(normalizeAutomationConfig([{ command: 'hello' }]), {
    automaticRedemptions: [],
    chatEntries: [],
    commands: [{ command: 'hello' }],
    follows: [],
    raids: [],
    redemptions: [],
    redemptionUpdates: [],
    rewardEvents: [],
    subscriptions: []
  })

  const config = normalizeAutomationConfig({ followers: { actions: [] }, subs: { actions: [] } })
  assert.equal(config.follows.length, 1)
  assert.equal(config.subscriptions.length, 1)
})

test('commands and handlers normalize aliases, roles, and match criteria', () => {
  assert.deepEqual(normalizeCommand({
    actions: [{ type: 'overlay.alert' }],
    aliases: ['Wave'],
    command: 'hello',
    cooldownScope: 'user',
    cooldownSeconds: '5',
    roles: ['mod', 'vips']
  }, '!'), {
    actions: [{ type: 'overlay.alert' }],
    cooldownScope: 'user',
    cooldownSeconds: 5,
    key: '!hello',
    names: ['!hello', '!wave'],
    roles: ['moderator', 'vip']
  })

  const handler = normalizeActionHandler({
    actions: [{ type: 'overlay.alert' }],
    match: {
      event: 'gift-sub',
      inputMatches: '/hydrate/i',
      role: 'mod',
      rewardId: 'Reward-1'
    }
  })

  assert.deepEqual(handler.events, ['subscription.gift'])
  assert.deepEqual(handler.rewardIds, ['reward-1'])
  assert.deepEqual(handler.roles, ['moderator'])
  assert.equal(handler.inputPatterns[0].source, 'hydrate')
  assert.equal(normalizeEventName('chat_entry'), 'chat.entry')
  assert.equal(normalizeEventName('chat-entry'), 'chat.entry')
})
