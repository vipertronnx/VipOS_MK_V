# Operation

VipOS MK V is operated through its local control panel, browser-source overlays, and JSON API. Start it with `npm start`, then open <http://localhost:5000/control>.

## Check service status

`GET /api/v1/status` reports:

- application name, description, and active port;
- OBS enabled, connected, identified, current-scene, and error state;
- Twitch chat, authentication, handlers, retries, and recent event state;
- greeting, quiet-mode, lower-third, queue, and raffle state;
- connected Socket.IO client count.

Open <http://localhost:5000/api/v1/status> or run:

```powershell
Invoke-RestMethod http://localhost:5000/api/v1/status
```

The control panel's System and Status Details sections render the same operational state.

## Use the control panel

The control panel supports:

- refreshing and running configured macros;
- pausing, resuming, skipping, and clearing queued work;
- enabling Quiet Mode;
- enabling, disabling, opening, and closing raffles;
- sending overlay alerts and changing stream-border states;
- hiding, showing, and toggling the synchronized lower thirds;
- browsing and playing local sounds;
- sending Twitch chat messages and changing the greeting pool;
- discovering and controlling OBS scenes, sources, audio inputs, and media inputs;
- running or queueing raw action JSON.

Responses and validation failures appear in the Response Log at the bottom of the page.

## Action queue

Macros, raffle announcements, configured Twitch handlers, and the control panel's queued actions run sequentially. Queue state is available from `GET /api/v1/queue`.

Queue controls are also available as JSON `POST` requests:

- `/api/v1/queue/pause`
- `/api/v1/queue/resume`
- `/api/v1/queue/skip`
- `/api/v1/queue/clear`

`skip` removes the next pending item; it does not cancel the action already running. `clear` removes pending items and also leaves the running item unchanged.

For sound actions, the queue waits for the longest detected sound duration plus `QUEUE_SOUND_COMPLETION_BUFFER_MS`. If duration detection fails, it uses `QUEUE_SOUND_COMPLETION_DELAY_MS`. Queue submissions and macros can override that timing with `completionDelayMs`, `delayMs`, or `queueDelayMs`.

Use `POST /api/v1/actions/enqueue` for normal custom sequences. `POST /api/v1/actions/run` bypasses queue ordering and should be reserved for actions that intentionally need to run immediately.

## Quiet Mode

Quiet Mode suppresses viewer-triggered `chyron.alert`, `overlay.alert`, `overlay.emit`, `sound.pickRandom`, and `sound.play` actions. It applies to chat, chat entries, Twitch events, redemptions, and reward events. Manual API and macro actions remain available.

Use the control panel or:

- `POST /api/v1/quiet-mode/on`
- `POST /api/v1/quiet-mode/off`
- `POST /api/v1/quiet-mode/toggle`

Quiet Mode is in-memory state and starts disabled each time the application starts.

## Raffle

When the raffle service is enabled, the first raffle opens immediately. Viewers enter with `settings.entryCommand` and check accumulated points with `settings.pointsCommand`. Duplicate entries in the current round are ignored.

Each round chooses a prize from `settings.pointAmounts`. It announces through chat and the alert overlay, optionally plays `settings.alertSound`, and posts countdown updates at `settings.countdownIntervalMs`. Closing a round selects a winner when at least one viewer entered, then schedules the next round between `settings.minDelayMs` and `settings.maxDelayMs`.

Raffle settings, current state, users, points, totals, winners, and history are persisted in `config/raffle.json`.

Use the control panel or these endpoints:

- `GET /api/v1/raffle`
- `POST /api/v1/raffle/on`
- `POST /api/v1/raffle/off`
- `POST /api/v1/raffle/toggle`
- `POST /api/v1/raffle/start`
- `POST /api/v1/raffle/close`

Changes made by these mutation endpoints require persistence. If `config/raffle.json` cannot be written, the request fails and the previous durable state is retained.

## Lower thirds

The news chyron and Venom Coin overlays share synchronized hide/show state. The server toggles that state every `LOWER_THIRD_TOGGLE_INTERVAL_MS` milliseconds unless the interval is `0`.

Set `LOWER_THIRD_ALWAYS_VISIBLE_OBS_SCENES` to a JSON array of exact OBS program-scene names to force both overlays visible while one of those scenes is active. The shared timer pauses in those scenes and restarts from its full interval when OBS leaves them. Only OBS program-scene changes apply; Studio Mode preview changes do not.

Use the control panel or:

- `POST /api/v1/lower-third/hide`
- `POST /api/v1/lower-third/show`
- `POST /api/v1/lower-third/toggle`

Newly connected overlays request the current state from the server.

## Sounds

Place local `.mp3`, `.ogg`, and `.wav` files under `public/assets/sounds/`. The control panel and `GET /api/v1/sounds` scan subdirectories, sort the results by path, and include detected durations.

Sound listings are cached for five seconds. Refresh the Sound panel or request `GET /api/v1/sounds?refresh=1` after adding or replacing a file.

Random SFX selection has a narrower pool: only top-level files listed by name in `config/sfx-text.json` are eligible. See [Sound labels and random selection](configuration.md#sound-labels-and-random-selection).

## Simulate Twitch events

The simulator supports follows, raids, subscriptions, and gift subscriptions. A dry run does not connect to Twitch or the running application:

```powershell
npm run simulate:twitch-event -- follow
npm run simulate:twitch-event -- raid
npm run simulate:twitch-event -- sub
npm run simulate:twitch-event -- gift-sub --count 5
```

Dry runs use `CHAT_COMMANDS_FILE` when it is set, then `config/commands.json` when that file exists, and otherwise `config/examples/commands.example.json`. They print simulated overlay, chat, and OBS actions to the terminal.

To send the event to a running VipOS MK V instance and connected browser sources, add `--live`:

```powershell
npm run simulate:twitch-event -- follow --live
npm run simulate:twitch-event -- raid --live
npm run simulate:twitch-event -- sub --live
npm run simulate:twitch-event -- gift-sub --count 5 --live
```

The simulator accepts a fixture path immediately after the event type. It also supports `--tier VALUE` and `--url http://127.0.0.1:PORT`. Tracked default fixtures live under `fixtures/twitch/`.

## Local API requirements

The server binds to `127.0.0.1`. Browser origins are limited to `http://localhost:PORT` and `http://127.0.0.1:PORT`. Every non-read-only `/api/v1` request must use `Content-Type: application/json`.

For example:

```powershell
curl.exe -X POST "http://localhost:5000/api/v1/quiet-mode/on" `
  -H "Content-Type: application/json" `
  -d "{}"
```

The API does not implement user authentication. Do not expose it through another network interface, proxy, or tunnel without adding an appropriate security boundary.

## Troubleshooting

### The application does not start

- Confirm `node --version` reports Node.js 22 or newer.
- Run `npm install` after pulling dependency changes.
- Check `.env` values for an invalid `PORT`.

### OBS controls are disabled

- Check `obs.enabled`, `obs.connected`, and `obs.lastError` in `/api/v1/status`.
- Confirm `OBS_ENABLED=true` and that `OBS_ADDRESS` and `OBS_PASSWORD` match the OBS WebSocket server.
- Use Refresh OBS in the control panel after OBS connects.

The OBS service retries unexpected disconnects using `OBS_RECONNECT_RETRY_INTERVAL`.

### Twitch chat does not start

- Check `chat.lastError`, `chat.authMode`, and `chat.nextRetryAt` in `/api/v1/status`.
- Confirm `CHAT_ENABLED=true`, `TWITCH_CLIENT_ID` is set, and either `TWITCH_CHANNEL` or `TWITCH_CHANNEL_ID` identifies the broadcaster.
- For static authentication, provide `TWITCH_BOT_ACCESS_TOKEN`.
- For refreshing authentication, also provide `TWITCH_CLIENT_SECRET` and `TWITCH_BOT_REFRESH_TOKEN`.
- If a persisted token file is malformed, correct or replace it; malformed token configuration is not retried automatically.

### Twitch handlers do not run

- Confirm `config/commands.json` exists. The running service does not fall back to the tracked command example.
- Check `chat.commandsLastError`, handler counts, and `chat.commandsRestartRequiredMessage` in `/api/v1/status`.
- Set `CHAT_ENABLE_REDEMPTIONS=true` for reward and redemption handlers.
- Confirm the broadcaster token has the scopes listed in [Configure broadcaster events](setup.md#configure-broadcaster-events).
- Restart after adding a new EventSub handler group.

### Sounds are missing or do not play

- Confirm the file is under `public/assets/sounds/` and uses `.mp3`, `.ogg`, or `.wav`.
- Refresh the sound list after adding or replacing files.
- For `sound.pickRandom`, add the top-level filename to `config/sfx-text.json`.
- Check that `DEFAULT_ALERT_SOUND` names an existing local file when implicit alert sounds are enabled.

### Configuration changes are not visible

- Restart after changing `.env`, news-chyron configuration, TV Guide configuration, or newly required EventSub handler groups. Those values or subscriptions are established at startup.
- Macros and greetings are loaded when used. Twitch command files are watched after chat starts.
