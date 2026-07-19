const { normalizeCompletionDelay } = require('../utils/completion-delay')
const { userInputError } = require('../utils/errors')

/**
 * Creates a serial action queue that records execution history and waits for sound completion when needed.
 *
 * @param {object} options Queue dependencies and timing settings.
 * @param {object} options.actions Action runner exposing `run` and optionally `validateStructure`.
 * @param {number} [options.soundCompletionBufferMs=250] Extra milliseconds added after a known sound duration.
 * @param {number} [options.soundCompletionFallbackMs=4000] Delay used when a sound duration cannot be determined.
 * @returns {object} Queue controls and a snapshot-based status accessor.
 */
function createActionQueue({
  actions,
  logger = console,
  soundCompletionBufferMs = 250,
  soundCompletionFallbackMs = 4000
} = {}) {
  if (!actions) throw new Error('Action queue requires an action runner')

  const pending = []
  const history = []
  const activity = []
  const maxHistory = 30
  const maxActivity = 80
  let nextId = 1
  let paused = false
  let running = null
  let processing = false

  /**
   * Adds actions to the queue and initiates background processing unless it is paused.
   *
   * @param {object} item Queued action definition.
   * @param {object|Array<object>} item.actions Action or action list; validated first when the runner exposes `validateStructure`.
   * @param {number} [item.completionDelayMs] Explicit post-run delay in milliseconds; `delayMs` is accepted as an alias.
   * @returns {object} Immediate queue snapshot; action completion is reported later through queue status and history.
   * @throws {Error} Throws when actions are missing or fail runner validation.
   */
  function enqueue({
    name,
    actions: actionList,
    context = {},
    source = 'queue',
    completionDelayMs,
    delayMs,
    fallbackCompletionDelayMs
  }) {
    if (!actionList) throw userInputError('Queue item requires actions')
    if (typeof actions.validateStructure === 'function') actions.validateStructure(actionList)

    const manualCompletionDelayMs = completionDelayMs ?? delayMs
    const item = {
      id: nextId++,
      name: String(name || 'Queued action').trim(),
      actions: actionList,
      completionDelayMs: manualCompletionDelayMs === undefined ? null : normalizeCompletionDelay(manualCompletionDelayMs),
      fallbackCompletionDelayMs: normalizeCompletionDelay(
        fallbackCompletionDelayMs === undefined ? soundCompletionFallbackMs : fallbackCompletionDelayMs
      ),
      context: { ...context, source },
      source,
      status: 'queued',
      queuedAt: new Date().toISOString()
    }

    pending.push(item)
    recordActivity('queued', item)
    processQueue()
    return snapshot()
  }

  function pause() {
    paused = true
    recordActivity('paused')
    return snapshot()
  }

  function resume() {
    paused = false
    recordActivity('resumed')
    processQueue()
    return snapshot()
  }

  function clear() {
    const cleared = pending.splice(0)
    for (const item of cleared) {
      finish(item, 'cleared')
    }
    if (cleared.length) recordActivity('clear', null, { count: cleared.length })
    return snapshot()
  }

  function skipNext() {
    const item = pending.shift()
    if (item) finish(item, 'skipped')
    return snapshot()
  }

  function getStatus() {
    return snapshot()
  }

  async function processQueue() {
    if (processing || paused || running || !pending.length) return

    processing = true
    running = pending.shift()
    running.status = 'running'
    running.startedAt = new Date().toISOString()
    recordActivity('started', running)

    try {
      const results = await actions.run(running.actions, running.context)
      const completionDelayMs = resolveCompletionDelayMs(running, results, soundCompletionBufferMs)
      running.completionDelayMs = completionDelayMs
      if (completionDelayMs > 0) {
        await wait(completionDelayMs)
      }
      finish(running, 'completed', { results })
    } catch (error) {
      if (logger && typeof logger.error === 'function') {
        logger.error(`Queued action failed: ${error.message}`)
      }
      finish(running, 'failed', { error: error.message })
    } finally {
      running = null
      processing = false
      processQueue()
    }
  }

  function finish(item, status, extra = {}) {
    item.status = status
    item.finishedAt = new Date().toISOString()
    Object.assign(item, extra)
    history.unshift(summarize(item))
    history.splice(maxHistory)
    recordActivity(status, item, extra)
  }

  function recordActivity(event, item = null, extra = {}) {
    activity.unshift({
      event,
      ...summarizeActivityItem(item),
      count: extra.count || null,
      error: extra.error || (item && item.error) || null,
      timestamp: new Date().toISOString()
    })
    activity.splice(maxActivity)
  }

  function snapshot() {
    return {
      activity: [...activity],
      paused,
      running: running ? summarize(running) : null,
      pending: pending.map(summarize),
      history: [...history]
    }
  }

  return {
    clear,
    enqueue,
    getStatus,
    pause,
    resume,
    skipNext
  }
}

function summarize(item) {
  return {
    id: item.id,
    name: item.name,
    source: item.source,
    status: item.status,
    actionCount: getActionCount(item.actions),
    completionDelayMs: item.completionDelayMs,
    fallbackCompletionDelayMs: item.fallbackCompletionDelayMs,
    queuedAt: item.queuedAt,
    startedAt: item.startedAt || null,
    finishedAt: item.finishedAt || null,
    error: item.error || null
  }
}

function summarizeActivityItem(item) {
  if (!item) {
    return {
      actionCount: 0,
      id: null,
      name: '',
      source: 'queue',
      status: ''
    }
  }

  return {
    actionCount: getActionCount(item.actions),
    id: item.id,
    name: item.name,
    source: item.source,
    status: item.status
  }
}

function getActionCount(actions) {
  if (!actions) return 0
  return Array.isArray(actions) ? actions.length : 1
}

/**
 * Selects the wait time after an item, preferring its explicit delay and otherwise deriving one from sound results.
 *
 * @param {object} item Queue item with normalized delay settings.
 * @param {*} results Values returned by the action runner, including nested result arrays.
 * @param {number} soundCompletionBufferMs Extra milliseconds after the longest detected sound.
 * @returns {number} Completion delay in milliseconds.
 */
function resolveCompletionDelayMs(item, results, soundCompletionBufferMs) {
  if (item.completionDelayMs !== null) return item.completionDelayMs

  const soundResults = getSoundResults(results)
  if (!soundResults.length) return 0

  const soundDurationMs = getLongestSoundDurationMs(soundResults)
  if (soundDurationMs > 0) {
    return normalizeCompletionDelay(soundDurationMs + soundCompletionBufferMs)
  }

  return item.fallbackCompletionDelayMs
}

function getSoundResults(results) {
  return flattenResults(results)
    .flatMap(expandResultSounds)
    .filter(result => result && result.type === 'sound.play' && !result.suppressed)
}

function expandResultSounds(result) {
  if (!result) return []
  return result.sound ? [result, result.sound] : [result]
}

function getLongestSoundDurationMs(soundResults) {
  return soundResults
    .map(result => Number(result.durationMs || 0))
    .filter(durationMs => Number.isFinite(durationMs) && durationMs > 0)
    .reduce((max, durationMs) => Math.max(max, durationMs), 0)
}

function flattenResults(value) {
  if (!Array.isArray(value)) return [value]
  return value.flatMap(flattenResults)
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

module.exports = {
  createActionQueue
}
