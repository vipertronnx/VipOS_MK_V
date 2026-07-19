const assert = require('node:assert/strict')
const test = require('node:test')

const { asArray, parseBool } = require('../modules/utils/value-normalization')

test('parseBool preserves default, token, and false-value handling', () => {
  for (const value of [undefined, null, '']) {
    assert.equal(parseBool(value, true), true)
    assert.equal(parseBool(value, false), false)
  }

  for (const value of [1, true, '1', ' true ', 'YES', 'on']) {
    assert.equal(parseBool(value, false), true)
  }

  for (const value of [0, false, 'false', 'no', 'off', 'unknown', '   ']) {
    assert.equal(parseBool(value, true), false)
  }
})

test('asArray preserves empty, scalar, and array identity behavior', () => {
  for (const value of [undefined, null, '']) {
    assert.deepEqual(asArray(value), [])
  }

  const existing = ['already', 'an', 'array']
  assert.equal(asArray(existing), existing)

  for (const value of [0, false, '   ', { value: 'object' }]) {
    assert.deepEqual(asArray(value), [value])
  }
})
