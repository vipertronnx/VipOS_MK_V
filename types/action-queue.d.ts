import type { ActionContext, ActionInput, ActionRunner } from './actions'

/** Execution states recorded for individual queue items. */
export type QueueItemStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cleared' | 'skipped'

/** Serializable summary of a queued or completed action item. */
export interface QueueItemSummary {
  actionCount: number
  completionDelayMs: number | null
  error: string | null
  fallbackCompletionDelayMs: number
  finishedAt: string | null
  id: number
  name: string
  queuedAt: string
  source: string
  startedAt: string | null
  status: QueueItemStatus
}

/** Activity record emitted when queue state changes. */
export interface QueueActivityItem {
  actionCount: number
  count: number | null
  error: string | null
  event: string
  id: number | null
  name: string
  source: string
  status: QueueItemStatus | ''
  timestamp: string
}

/** Status snapshot returned by every queue control operation. */
export interface QueueSnapshot {
  activity: QueueActivityItem[]
  history: QueueItemSummary[]
  paused: boolean
  pending: QueueItemSummary[]
  running: QueueItemSummary | null
}

/** Input accepted when adding an action or action list to the queue. */
export interface QueueRequest {
  /** Action or action list validated before the queue accepts it. */
  actions: ActionInput
  /** Explicit post-run delay in milliseconds; `delayMs` is an alias. */
  completionDelayMs?: number
  /** Event data made available while queued actions execute. */
  context?: ActionContext
  /** Alias for `completionDelayMs`, in milliseconds. */
  delayMs?: number
  /** Delay in milliseconds when sound duration cannot be determined. */
  fallbackCompletionDelayMs?: number
  /** Human-readable label shown in queue snapshots. */
  name?: string
  /** Origin recorded for the queued item. */
  source?: string
}

/** Dependencies accepted by the action queue factory. */
export interface ActionQueueOptions {
  actions?: Pick<ActionRunner, 'run' | 'validateStructure'>
  logger?: Pick<Console, 'error'>
  soundCompletionBufferMs?: number
  soundCompletionFallbackMs?: number
}

/** Public API returned by the serial action queue factory. */
export interface ActionQueue {
  clear(): QueueSnapshot
  enqueue(item: QueueRequest): QueueSnapshot
  getStatus(): QueueSnapshot
  pause(): QueueSnapshot
  resume(): QueueSnapshot
  skipNext(): QueueSnapshot
}
