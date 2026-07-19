// Handler regular-expression validation and bounded matching.
const MAX_HANDLER_REGEX_INPUT_LENGTH = 500
const MAX_HANDLER_REGEX_PATTERN_LENGTH = 200

/**
 * Returns an existing regular expression unchanged, or compiles a string after bounded-pattern safety checks.
 *
 * @param {string|RegExp} value Literal `/pattern/flags` notation, bare pattern, or existing expression.
 * @returns {RegExp|null} Compiled expression, or `null` for an empty value.
 * @throws {Error} Throws when a string pattern has invalid syntax or flags, exceeds the length limit, or contains nested quantifiers.
 */
function normalizeRegex(value) {
  if (value instanceof RegExp) return value

  const text = String(value || '').trim()
  if (!text) return null

  try {
    const match = text.match(/^\/(.+)\/([dgimsuvy]*)$/)
    const source = match ? match[1] : text
    const flags = match ? match[2] : 'i'

    validateHandlerRegexSource(source)
    return new RegExp(source, flags)
  } catch (error) {
    throw new Error(`Invalid handler input pattern "${text}": ${error.message}`)
  }
}

/**
 * Tests a handler expression against a bounded prefix of user-provided input.
 *
 * @param {RegExp} pattern Compiled handler expression; its `lastIndex` is reset before testing.
 * @param {*} value Input value to test.
 * @returns {boolean} Whether the pattern matches the first 500 characters of the normalized input.
 */
function testRegex(pattern, value) {
  pattern.lastIndex = 0
  return pattern.test(String(value || '').slice(0, MAX_HANDLER_REGEX_INPUT_LENGTH))
}

function validateHandlerRegexSource(source) {
  if (source.length > MAX_HANDLER_REGEX_PATTERN_LENGTH) {
    throw new Error(`pattern must be ${MAX_HANDLER_REGEX_PATTERN_LENGTH} characters or fewer`)
  }

  if (hasNestedQuantifier(source)) {
    throw new Error('pattern cannot use nested quantifiers')
  }
}

function hasNestedQuantifier(source) {
  const groups = []

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]

    if (char === '\\') {
      index += 1
      continue
    }

    if (char === '[') {
      index = skipCharacterClass(source, index)
      if (isQuantifierAt(source, index + 1) && groups.length) {
        groups[groups.length - 1].hasQuantifiedAtom = true
      }
      continue
    }

    if (char === '(') {
      groups.push({ hasQuantifiedAtom: false })
      continue
    }

    if (char === ')') {
      const group = groups.pop()
      if (!group) continue

      const quantifierIndex = nextRegexTokenIndex(source, index + 1)
      if (isQuantifierAt(source, quantifierIndex)) {
        if (group.hasQuantifiedAtom) return true
        if (groups.length) groups[groups.length - 1].hasQuantifiedAtom = true
      } else if (group.hasQuantifiedAtom && groups.length) {
        groups[groups.length - 1].hasQuantifiedAtom = true
      }
      continue
    }

    if (isQuantifierAt(source, index)) {
      index = skipQuantifier(source, index)
      continue
    }

    if (isQuantifierAt(source, index + 1) && groups.length) {
      groups[groups.length - 1].hasQuantifiedAtom = true
    }
  }

  return false
}

function skipCharacterClass(source, startIndex) {
  for (let index = startIndex + 1; index < source.length; index += 1) {
    if (source[index] === '\\') {
      index += 1
    } else if (source[index] === ']') {
      return index
    }
  }
  return source.length - 1
}

function nextRegexTokenIndex(source, startIndex) {
  let index = startIndex
  while (/\s/.test(source[index] || '')) index += 1
  return index
}

function isQuantifierAt(source, index) {
  const char = source[index]
  return char === '+' || char === '*' || char === '?' || isBraceQuantifierAt(source, index)
}

function isBraceQuantifierAt(source, index) {
  const match = source.slice(index).match(/^\{\d+(?:,\d*)?\}/)
  return Boolean(match)
}

function skipQuantifier(source, index) {
  if (source[index] === '{') {
    const match = source.slice(index).match(/^\{\d+(?:,\d*)?\}\??/)
    if (match) return index + match[0].length - 1
  }
  if (source[index + 1] === '?') return index + 1
  return index
}

module.exports = {
  normalizeRegex,
  testRegex
}
