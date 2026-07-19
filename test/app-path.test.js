const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const { relativeAppPath, resolveAppPath } = require('../modules/utils/app-path')

const appRoot = path.join(__dirname, '..')

test('application path helpers preserve repository-relative display and resolution', () => {
  const fallback = path.join(appRoot, 'config', 'fallback.json')
  const relativeFile = path.join(appRoot, 'config', 'twitch-token.json')
  const absoluteFile = path.join(appRoot, 'config', 'absolute.json')

  assert.equal(relativeAppPath(relativeFile), 'config/twitch-token.json')
  assert.equal(resolveAppPath('', fallback), fallback)
  assert.equal(resolveAppPath('config/twitch-token.json', fallback), relativeFile)
  assert.equal(resolveAppPath(absoluteFile, fallback), absoluteFile)
})
