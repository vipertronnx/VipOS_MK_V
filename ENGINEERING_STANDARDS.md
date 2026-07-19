# Engineering Standards

These standards define how VipOS MK V code is written and extended. New work must preserve the service boundaries, lifecycle guarantees, validation rules, and local-service security model described here.

The terms **must**, **should**, and **may** indicate required, recommended, and optional practices.

## Platform and module conventions

- Production code must support the Node.js version declared in `package.json` (`>=18.0.0`).
- Server-side code must use CommonJS modules (`require` and `module.exports`).
- Dependencies must be declared in `package.json`; runtime packages belong in `dependencies` and development-only tools belong in `devDependencies`.
- A package must not be added when the same result is straightforward with the platform or an existing dependency.
- Module exports should be narrow. Export service factories and pure functions that are part of a tested contract, not mutable internal state.

## Architectural boundaries

### Composition root

`app.js` is the application composition root and HTTP/Socket.IO transport layer. It owns:

- constructing services;
- injecting service dependencies;
- connecting routes and sockets to service operations;
- coordinating application startup and shutdown;
- translating service results and errors into transport responses.

Domain modules must not import `app.js` or reach through it to locate another service. Dependencies must be passed to their factory by the composition root.

### Domain modules

- Action execution, queueing, macros, and greetings belong under `modules/actions`.
- Twitch chat, EventSub, automation, command configuration, contexts, normalization, retry behavior, and raffles belong under `modules/chat`.
- OBS integration belongs in `modules/obs.js`.
- A helper belongs under `modules/utils` only when it is domain-neutral and reused, or when centralizing it establishes one application-wide policy such as JSON persistence or user-input errors.

A new file boundary should represent a cohesive responsibility with a clear contract. File length alone is not a reason to split a module. Pure planning, normalization, and context-mapping logic should remain separate from transport clients and mutable lifecycle state when that separation makes the behavior independently testable.

### Service construction

Stateful services should expose a `create...Service` factory that closes over private state and returns the smallest useful API. External collaborators such as clients, queues, timers, file-system adapters, loggers, and callbacks should be injectable, with production defaults where appropriate.

Services must not expose directly mutable state. Status methods must return summaries, copies, or otherwise safe snapshots. Observable status fields should use stable names and serializable values; timestamps should be ISO 8601 strings and absent values should be represented consistently as `null`.

## Runtime lifecycle

- Resources must not start as a side effect of service construction.
- The composition root must control when runtime services start and stop.
- A service that owns timers, watchers, sockets, listeners, or retry scheduling must expose cleanup that releases those resources.
- Startup and shutdown must be safe when called close together. Shutdown must prevent delayed startup work from activating resources after teardown begins.
- Concurrent connect, disconnect, start, stop, and retry transitions must be serialized when they operate on the same external client.
- Lifecycle methods should be idempotent or return the existing in-progress transition when repeated.
- Retry callbacks must check that the service is still intended to run before reconnecting.
- Application shutdown must attempt every registered cleanup operation and report combined failures after cleanup has been attempted.

The established server lifecycle is `startServer()` returning `{ app, server, services, stop }`. Code that starts the server programmatically must use `stop()` for teardown rather than closing individual adapters directly.

An action already executing in the action queue is not a cancellable unit. New code must not assume that server shutdown cancels in-flight action work.

## HTTP and Socket.IO transport

- HTTP, Socket.IO, CORS, local-origin checks, and status reporting must share the same runtime port context.
- The server must bind to `127.0.0.1` unless an explicitly approved deployment design introduces an external security boundary.
- Mutating `/api/v1` routes must require JSON and pass the local origin/referer policy.
- Route handlers should delegate domain behavior to services rather than implementing a second copy of domain rules.
- Promise-returning route handlers must forward rejections to the central Express error handler.
- Successful response shapes and existing route semantics are public behavior and must remain backward compatible unless a change is intentionally approved and documented.

The loopback bind and local-origin checks are one security model. Any change that exposes the service through another interface, host, proxy, or tunnel must define and test an appropriate authentication and authorization model as part of that change.

## Validation and errors

Validation must occur at system boundaries and have one authoritative implementation.

- Invalid caller-controlled structure must use `userInputError(...)` and produce HTTP 400.
- Persistence failures for operations that require durability must use `createPersistenceError(...)` and produce HTTP 503.
- Unexpected programming, adapter, or execution failures must remain server errors and must be logged by the central error path.
- Error messages returned to callers should identify the invalid field or operation without exposing credentials or secret configuration.
- Values loaded from environment variables, JSON files, Twitch payloads, and HTTP requests must be normalized before domain logic consumes them.
- Dynamic templates must be structurally validated before execution and validated again after hydration wherever the resolved value has runtime requirements.
- Paths created from caller or configuration input must be resolved through the established application-path and domain-specific path-validation helpers.

Do not create parallel validation rules in routes, queues, and executors. Reuse the domain validator.

## Action execution and queueing

`ACTION_DEFINITIONS` is the canonical registry for action types. Each action type must declare its executor, unconditional required-field alternatives, and relevant metadata such as `quietable` or `sound` in that registry.

When adding or changing an action:

1. Update the registry and implement its executor.
2. Keep static structural validation in the shared action validator.
3. Preserve runtime validation after template hydration.
4. Derive sound detection and quiet-mode behavior from registry metadata.
5. Add tests for direct execution, queued validation, hydration, and applicable quiet/sound behavior.
6. Document the action and its accepted configuration when it is user configurable.

Normal macro, Twitch, raffle, alert, and border workflows must use the action queue so effects do not overlap unexpectedly. The direct action runner is reserved for workflows that intentionally bypass queue ordering.

Queue acceptance means the item has passed structural validation and entered the queue. Runtime failures must be recorded in queue history and activity without preventing later items from running. Queue status methods must return summaries rather than the mutable internal items.

## Configuration

- Environment variables are deployment overrides and secrets; checked-in JSON files are application configuration; `config/examples` contains distributable defaults.
- Secrets and generated token files must remain untracked. `.env.example` must contain names and safe example values only.
- User configuration formats are compatibility contracts. Normalizers must accept documented forms and produce one internal representation.
- Configuration-dependent planning should be pure. For example, EventSub subscription and authorization requirements must be derived from the normalized command snapshot before transport registration.
- Reloadable configuration must be parsed and normalized into a complete snapshot before replacing the active snapshot. A failed reload must leave the last valid snapshot usable and expose/log the error.
- Application-relative paths must use the shared app-path helpers rather than depending on the process working directory.
- New user-facing configuration must include an example and documentation in the authoritative guide identified below.

## Persistence

JSON state must be written with `writeJsonFile(...)`, which writes a temporary file and replaces the target. Domain modules must not implement separate JSON replacement logic.

Every persisted workflow must explicitly choose one of these policies:

- **Required persistence:** User-triggered state changes must report failure when the new state cannot be written. In-memory state must not claim a durable update that failed; apply the mutation only after persistence succeeds or restore the prior snapshot.
- **Best-effort persistence:** Background maintenance, including refreshed Twitch token storage, may continue after a write failure. The failure must be logged and reflected in service status where the service exposes persistence health.

Do not silently change a workflow from one policy to the other. Never log access tokens, refresh tokens, client secrets, or OBS credentials.

## Twitch and EventSub integration

- Authentication and token persistence belong in `chat-auth`.
- EventSub client ownership, subscription callbacks, and subscription retries belong in `chat-eventsub`.
- Subscription selection and authentication requirements belong in the pure `chat-eventsub-plan` module.
- Twitch payloads must be converted into normalized application contexts before matching handlers or hydrating actions.
- Handler normalization and matching must remain transport-independent.
- Subscribe only to EventSub groups required by the active normalized configuration.
- Retry scheduling must be bounded, observable through status, and cancelled during intentional shutdown.
- Required Twitch scopes must be derived from configured features and reported clearly when absent.

## OBS integration

- All OBS operations must go through the OBS service.
- Connect, disconnect, and reconnect operations must use the service's serialized lifecycle transition path.
- Intentional disconnection must clear pending reconnect work and prevent late connection attempts from winning after teardown.
- Unexpected connection loss may schedule a reconnect only while the service remains enabled and intended to run.
- OBS request failures must update service status and preserve the request type in the reported error.
- Routes and actions must not call the raw OBS WebSocket client.

## Logging and status

- Injectable services should accept a logger compatible with the `console` methods they use.
- Expected disabled or fallback states should use warnings; successful lifecycle transitions should use informational logging; failed operations should use errors.
- Logs should name the affected integration or operation and include the error message.
- Recoverable background failures must be visible through logs and, when operationally relevant, the service's status response.
- Status responses must not expose secrets, raw external clients, timers, or mutable internal collections.

## Testing

Tests must use Node's built-in `node:test` runner and `node:assert` APIs and live under `test`.

- Every behavior change must include tests at the narrowest useful boundary.
- Every bug fix must include a regression test that fails without the fix.
- Lifecycle changes must test immediate or overlapping transitions, not only the steady state.
- Validation changes must cover direct and queued entry points when both use the rule.
- Persistence changes must cover successful writes, failed writes, and the selected required/best-effort policy.
- Configuration changes must cover normalization, missing files, invalid reloads, and retention of the last valid snapshot where applicable.
- External systems must be represented by injected fakes or stubs in automated tests. The unit and integration suite must not require live Twitch, OBS, or network credentials.
- Timer-dependent behavior should use injected timer functions or controlled short durations rather than unbounded waits.
- Tests that modify environment variables, global functions, file-system methods, or console methods must restore them in `finally` cleanup.
- Temporary files must be isolated per test and removed after use.

Run the complete suite before committing:

```bash
npm test
npm run check:docs
```

When changing a live integration, also perform the applicable documented smoke test after the automated suite passes.

## Front-end assets

- SCSS under `public/assets/sass` is the maintained style source.
- Run `npm run build:css` after SCSS changes and commit the generated compressed CSS and source maps with the source change.
- Use `npm run watch:css` during iterative style development.
- Font binaries that cannot be distributed must remain untracked; code and documentation must retain the expected filenames and acquisition instructions.
- Existing Socket.IO event names, DOM contracts used by overlay scripts, and overlay URLs are observable integration contracts.

## Documentation

Documentation must be updated in the same change when work modifies:

- setup or runtime requirements;
- environment variables or configuration formats;
- public API routes or response behavior;
- action types or template context fields;
- Twitch scopes or supported events;
- OBS, overlay, asset, or simulation workflows.

Examples must contain safe, distributable values and must not include secrets or machine-specific paths.

## Change checklist

Before considering a change complete, verify that:

- the behavior belongs to the module being changed;
- dependencies are injected rather than discovered through global application state;
- lifecycle resources have coordinated cleanup;
- validation and metadata have one authoritative source;
- persistence semantics are explicit;
- local-only security assumptions remain true;
- public routes, events, configuration, and status shapes remain compatible;
- focused tests prove the behavior and relevant failure paths;
- `npm test` passes;
- generated assets and documentation are updated when applicable;
- `git status` contains only the intended change set.
