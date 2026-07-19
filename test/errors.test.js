const assert = require('node:assert/strict')
const test = require('node:test')

const { userInputError } = require('../modules/utils/errors')

test('user input errors preserve their HTTP 400 contract', () => {
  const error = userInputError('Invalid input')

  assert.equal(error instanceof Error, true)
  assert.equal(error.message, 'Invalid input')
  assert.equal(error.statusCode, 400)
})
