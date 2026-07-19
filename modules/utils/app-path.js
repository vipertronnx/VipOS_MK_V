const path = require('path')

const APP_ROOT = path.join(__dirname, '..', '..')

/**
 * Resolves a configured path relative to the application root, while preserving absolute paths.
 *
 * @param {string} value Configured path; falsy values use `fallback` unchanged.
 * @param {string} fallback Path to use when no configured path is supplied.
 * @returns {string} Absolute or fallback path for application file access.
 */
function resolveAppPath(value, fallback) {
  if (!value) return fallback
  return path.isAbsolute(value) ? value : path.join(APP_ROOT, value)
}

/**
 * Converts an application path to a forward-slash-relative path for display or configuration.
 *
 * @param {string} filePath Path to express relative to the application root.
 * @returns {string} Path relative to the application root.
 */
function relativeAppPath(filePath) {
  return path.relative(APP_ROOT, filePath).replace(/\\/g, '/')
}

module.exports = {
  relativeAppPath,
  resolveAppPath
}
