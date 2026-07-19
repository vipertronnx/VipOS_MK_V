const assert = require('node:assert/strict')
const test = require('node:test')
const {
  EVENT_SUB_HANDLER_GROUPS,
  getConfiguredEventSubHandlerGroupsFromSnapshot
} = require('../modules/chat/chat-eventsub-plan')

function createSnapshot(overrides = {}) {
  return {
    automaticRedemptionHandlers: [],
    followHandlers: [],
    raidHandlers: [],
    redemptionHandlers: [],
    redemptionUpdateHandlers: [],
    rewardEventHandlers: [],
    subscriptionHandlers: [],
    ...overrides
  }
}

test('EventSub planning maps command configuration snapshots to handler groups in registration order', () => {
  const groups = getConfiguredEventSubHandlerGroupsFromSnapshot(createSnapshot({
    automaticRedemptionHandlers: [{}],
    followHandlers: [{}],
    raidHandlers: [{}],
    redemptionHandlers: [{}],
    redemptionUpdateHandlers: [{}],
    rewardEventHandlers: [
      { events: ['reward.add'] },
      { events: ['reward.update'] },
      { events: ['reward.remove'] }
    ],
    subscriptionHandlers: [{}]
  }))

  assert.deepEqual([...groups], [
    EVENT_SUB_HANDLER_GROUPS.follows,
    EVENT_SUB_HANDLER_GROUPS.raids,
    EVENT_SUB_HANDLER_GROUPS.subscriptions,
    EVENT_SUB_HANDLER_GROUPS.redemptions,
    EVENT_SUB_HANDLER_GROUPS.redemptionUpdates,
    EVENT_SUB_HANDLER_GROUPS.automaticRedemptions,
    EVENT_SUB_HANDLER_GROUPS.rewardAddEvents,
    EVENT_SUB_HANDLER_GROUPS.rewardUpdateEvents,
    EVENT_SUB_HANDLER_GROUPS.rewardRemoveEvents
  ])
})

test('EventSub planning expands wildcard reward handlers and limits specific reward handlers', () => {
  const wildcardGroups = getConfiguredEventSubHandlerGroupsFromSnapshot(createSnapshot({
    rewardEventHandlers: [{ events: [] }]
  }))
  const specificGroups = getConfiguredEventSubHandlerGroupsFromSnapshot(createSnapshot({
    rewardEventHandlers: [{ events: ['reward.update'] }]
  }))

  assert.deepEqual([...wildcardGroups], [
    EVENT_SUB_HANDLER_GROUPS.rewardAddEvents,
    EVENT_SUB_HANDLER_GROUPS.rewardUpdateEvents,
    EVENT_SUB_HANDLER_GROUPS.rewardRemoveEvents
  ])
  assert.deepEqual([...specificGroups], [EVENT_SUB_HANDLER_GROUPS.rewardUpdateEvents])
})
