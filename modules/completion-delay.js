const MAX_COMPLETION_DELAY_MS = 10 * 60 * 1000

function normalizeCompletionDelay(value) {
  const delay = Number(value || 0)
  if (!Number.isFinite(delay) || delay <= 0) return 0
  return Math.min(Math.round(delay), MAX_COMPLETION_DELAY_MS)
}

module.exports = {
  normalizeCompletionDelay
}
