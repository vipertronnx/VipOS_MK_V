const MAX_COMPLETION_DELAY_MS = 10 * 60 * 1000

/**
 * Normalizes an action completion delay to a non-negative duration capped at ten minutes.
 *
 * @param {*} value Value coercible to milliseconds; missing, invalid, and non-positive values become `0`.
 * @returns {number} Rounded delay in milliseconds.
 */
function normalizeCompletionDelay(value) {
  const delay = Number(value || 0)
  if (!Number.isFinite(delay) || delay <= 0) return 0
  return Math.min(Math.round(delay), MAX_COMPLETION_DELAY_MS)
}

module.exports = {
  normalizeCompletionDelay
}
