function createRetryScheduler({
  initialMs,
  maxMs,
  onRetry,
  onSchedule = () => {},
  onReset = () => {},
  setTimer = setTimeout,
  clearTimer = clearTimeout
} = {}) {
  let attempt = 0
  let timer = null

  function schedule() {
    if (timer !== null) return false

    attempt += 1
    const delay = Math.min(initialMs * Math.pow(2, attempt - 1), maxMs)
    onSchedule({ attempt, delay })

    timer = setTimer(() => {
      timer = null
      onRetry()
    }, delay)
    return true
  }

  function reset() {
    if (timer !== null) clearTimer(timer)
    timer = null
    attempt = 0
    onReset()
  }

  function isScheduled() {
    return timer !== null
  }

  return {
    isScheduled,
    reset,
    schedule
  }
}

module.exports = {
  createRetryScheduler
}
