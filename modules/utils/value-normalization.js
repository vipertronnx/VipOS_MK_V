/**
 * Converts common truthy configuration strings to a boolean while retaining a default for absent values.
 *
 * @param {*} value Value to parse; `1`, `true`, `yes`, and `on` are truthy case-insensitively.
 * @param {boolean} defaultValue Value returned for `undefined`, `null`, or an empty string.
 * @returns {boolean} Parsed boolean value.
 */
function parseBool(value, defaultValue) {
  if (value === undefined || value === null || value === '') return defaultValue
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase())
}

/**
 * Wraps a present scalar value in an array without copying an existing array.
 *
 * @param {*} value Value to normalize; absent and empty-string values become an empty array.
 * @returns {Array} The original array or an array containing the supplied scalar.
 */
function asArray(value) {
  if (value === undefined || value === null || value === '') return []
  return Array.isArray(value) ? value : [value]
}

module.exports = {
  asArray,
  parseBool
}
