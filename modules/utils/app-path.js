const path = require('path')

const APP_ROOT = path.join(__dirname, '..', '..')

function resolveAppPath(value, fallback) {
  if (!value) return fallback
  return path.isAbsolute(value) ? value : path.join(APP_ROOT, value)
}

function relativeAppPath(filePath) {
  return path.relative(APP_ROOT, filePath).replace(/\\/g, '/')
}

module.exports = {
  relativeAppPath,
  resolveAppPath
}
