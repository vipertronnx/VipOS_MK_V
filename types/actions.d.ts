/** A user-configured action object accepted by the action runner. */
export interface Action {
  action?: string
  type?: string
  [property: string]: unknown
}

/** One action or an ordered list of actions. */
export type ActionInput = Action | Action[]

/** Values made available while hydrating and executing actions. */
export type ActionContext = Record<string, unknown>

/** Serializable result produced by an action executor. */
export type ActionResult = Record<string, unknown>

/** Minimal chat operation used by chat-related action executors. */
export interface ChatMessageSender {
  say(message: string, options?: { replyParentMessageId?: string, replyTo?: string, simulated?: boolean }): Promise<unknown>
}

/** Public API returned by the action runner factory. */
export interface ActionRunner {
  run(actions: ActionInput, context?: ActionContext): Promise<ActionResult[]>
  setChatService(service: ChatMessageSender): void
  validateStructure(actions: ActionInput): Action[]
}
