# Configuration

VipOS MK V loads environment variables from `.env` and user configuration from JSON files under `config/`. Environment variables hold secrets and deployment-level overrides. JSON files define stream-specific behavior and persisted state.

Start with `.env.example`. Files directly under `config/` are intentionally ignored by Git; tracked defaults live under `config/examples/`.

## Environment variables

### Server

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `5000` | HTTP and Socket.IO port. |
| `APP_NAME` | `VipOS MK V` | Name rendered by the web application and status response. |
| `APP_DESCRIPTION` | `Chat Bot + Overlay Platform` | Description rendered by the web application and status response. |

The server always binds to `127.0.0.1`. There is no host-binding environment variable.

### OBS

| Variable | Default | Purpose |
| --- | --- | --- |
| `OBS_ENABLED` | Enabled when `OBS_ADDRESS` is set | Set to `false` to disable the OBS service. |
| `OBS_ADDRESS` | None | OBS WebSocket address, such as `ws://localhost:4455`. |
| `OBS_PASSWORD` | None | OBS WebSocket password. |
| `OBS_RECONNECT_RETRY_INTERVAL` | `5000` | Delay in milliseconds before reconnecting. Values below `1000` use the default. |

### Twitch chat and authentication

| Variable | Default | Purpose |
| --- | --- | --- |
| `CHAT_ENABLED` | `false` | Enables the Twitch chat and EventSub service. |
| `TWITCH_CLIENT_ID` | None | Twitch application client ID; required when chat is enabled. |
| `TWITCH_CLIENT_SECRET` | None | Required for refresh-token authentication and broadcaster EventSub authentication. |
| `TWITCH_BOT_ACCESS_TOKEN` | None | Bot user access token. `TWITCH_BOT_TOKEN` is a compatibility alias. |
| `TWITCH_BOT_REFRESH_TOKEN` | None | Enables durable bot token refresh; required when broadcaster EventSub authentication is needed. |
| `TWITCH_BOT_SCOPES` | None | Space- or comma-separated scopes stored with refreshing authentication. |
| `TWITCH_TOKEN_FILE` | `config/twitch-token.json` | Persisted refreshed bot token. |
| `TWITCH_BOT_USER_ID` | Looked up | Optional bot user ID. |
| `TWITCH_BOT_USERNAME` | Looked up | Optional bot login. |
| `TWITCH_CHANNEL` | None | Broadcaster login. Required unless `TWITCH_CHANNEL_ID` is set. `TWITCH_BROADCASTER_LOGIN` is a compatibility alias. |
| `TWITCH_CHANNEL_ID` | None | Broadcaster user ID. `TWITCH_BROADCASTER_ID` is a compatibility alias. |
| `CHAT_COMMAND_PREFIX` | `!` | Prefix added to configured commands that omit it. |
| `CHAT_COMMANDS_FILE` | `config/commands.json` | Chat and EventSub automation configuration. |
| `CHAT_IGNORE_SELF` | `true` | Ignores messages sent by the bot account. |
| `CHAT_RECONNECT_INITIAL_MS` | `5000` | Initial Twitch startup retry delay. |
| `CHAT_RECONNECT_MAX_MS` | `60000` | Maximum Twitch startup retry delay. |
| `CHAT_ENABLE_HIGHLIGHT_ALERTS` | `false` | Turns highlighted Twitch messages into queued alert and sound actions. |
| `TWITCH_HIGHLIGHT_REWARD_ID` | None | Treats messages with this reward ID as highlighted messages. |

Bot chat uses `user:read:chat` and `user:write:chat`. Refreshed tokens are written atomically to `TWITCH_TOKEN_FILE`.

The authentication reader also accepts `TWITCH_BOT_EXPIRES_IN` and `TWITCH_BOT_OBTAINMENT_TIMESTAMP`. These values describe an existing access token; refreshed token files store them automatically.

### Broadcaster events

| Variable | Default | Purpose |
| --- | --- | --- |
| `CHAT_ENABLE_REDEMPTIONS` | Enabled when a broadcaster refresh token is set; otherwise disabled | Enables channel-point redemption and reward EventSub registrations. An explicit value takes precedence. |
| `TWITCH_BROADCASTER_ACCESS_TOKEN` | None | Broadcaster user access token. |
| `TWITCH_BROADCASTER_REFRESH_TOKEN` | None | Broadcaster refresh token. |
| `TWITCH_BROADCASTER_SCOPES` | None | Space- or comma-separated scopes actually granted to the broadcaster token. Do not list scopes that were not returned by Twitch. |
| `TWITCH_BROADCASTER_TOKEN_FILE` | `config/twitch-broadcaster-token.json` | Persisted refreshed broadcaster token. |

The authentication reader also accepts `TWITCH_BROADCASTER_EXPIRES_IN` and `TWITCH_BROADCASTER_OBTAINMENT_TIMESTAMP`. The broadcaster token must belong to the configured Twitch channel.

### Sounds and queue timing

| Variable | Default | Purpose |
| --- | --- | --- |
| `DEFAULT_ALERT_SOUND` | `example.mp3` | Local sound used by alerts that do not select another sound. Disable an implicit sound with `sound: false` on the action. |
| `QUEUE_SOUND_COMPLETION_BUFFER_MS` | `250` | Time added to a detected sound duration before the next queue item starts. |
| `QUEUE_SOUND_COMPLETION_DELAY_MS` | `4000` | Queue delay used when a sound duration cannot be detected. |

Sound paths are relative to `public/assets/sounds/` and may point into subdirectories. Supported extensions are `.mp3`, `.ogg`, and `.wav`.

### Overlays

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEWS_CHYRON_ROTATE_INTERVAL_MS` | `30000` | Time between random news-chyron items. |
| `NEWS_CHYRON_ITEMS_DEFAULT` | `config/examples/news-chyron.example.json` | Fallback news-chyron JSON source. |
| `NEWS_CHYRON_ITEMS` | `NEWS_CHYRON_ITEMS_DEFAULT` | Custom JSON file path or inline JSON array. |
| `NEWS_CHYRON_LOWER_THIRD_SLIDE_DISTANCE` | `140px` | News-chyron slide distance. |
| `NEWS_CHYRON_LOWER_THIRD_SLIDE_DURATION` | `600ms` | News-chyron slide duration. |
| `TV_GUIDE_ITEMS_DEFAULT` | `config/examples/tv-guide.example.json` | Fallback TV Guide JSON source. |
| `TV_GUIDE_ITEMS` | `config/tv-guide.json` | Custom TV Guide JSON file path or inline JSON object. |
| `VENOM_COIN_LOWER_THIRD_SLIDE_DISTANCE` | `100%` | Venom Coin slide distance. |
| `VENOM_COIN_LOWER_THIRD_SLIDE_DURATION` | `300ms` | Venom Coin slide duration. |
| `LOWER_THIRD_VISIBLE_DURATION_MS` | `180000` | Time the shared news chyron and Venom Coin remain visible before automatically hiding. Set to `0` to keep them visible. |
| `LOWER_THIRD_HIDDEN_DURATION_MS` | `180000` | Time the shared news chyron and Venom Coin remain hidden before automatically showing. Set to `0` to keep them hidden. |
| `LOWER_THIRD_ALWAYS_VISIBLE_OBS_SCENES` | Empty | JSON array of exact OBS program-scene names that force both the news chyron and Venom Coin visible. |

Slide distances accept numeric `px`, `%`, `vh`, `vw`, `rem`, or `em` values. Slide durations accept numeric `ms` or `s` values. Invalid values use their defaults.

Set both lower-third duration variables to `0` to disable automatic changes completely. `LOWER_THIRD_ALWAYS_VISIBLE_OBS_SCENES` must be a JSON array such as `["Gameplay","Just Chatting"]`. While OBS is on one of those program scenes, the shared lower-third timer is paused and both overlays remain visible. Leaving the configured scenes restarts the full visible duration. Scene names match exactly, and changes require an application restart.

### Raffle overrides

`config/raffle.json` is the primary raffle configuration and state file. The following environment variables override matching settings when present:

| Variable | JSON setting | Default |
| --- | --- | --- |
| `RAFFLE_ENABLED` | `enabled` | `false` |
| `RAFFLE_ENTRY_COMMAND` | `settings.entryCommand` | `!join` |
| `RAFFLE_POINTS_COMMAND` | `settings.pointsCommand` | `!points` |
| `RAFFLE_COUNTDOWN_INTERVAL_MS` | `settings.countdownIntervalMs` | `30000` |
| `RAFFLE_ENTRY_WINDOW_MS` | `settings.entryWindowMs` | `120000` |
| `RAFFLE_MIN_DELAY_MS` | `settings.minDelayMs` | `300000` |
| `RAFFLE_MAX_DELAY_MS` | `settings.maxDelayMs` | `600000` |
| `RAFFLE_MAX_HISTORY` | `settings.maxHistory` | `50` |
| `RAFFLE_POINT_AMOUNTS` | `settings.pointAmounts` | `[100,150,200,250,300,350,400,450,500]` |
| `RAFFLE_POINT_NAME` | `settings.pointName` | `raffle points` |
| `RAFFLE_POINT_TWITCH_EMOJI` | `settings.pointTwitchEmoji` | Empty |
| `RAFFLE_ALERT_SOUND` | `settings.alertSound` | `DEFAULT_ALERT_SOUND`, then `example.mp3` |

`RAFFLE_WIN_POINTS` is a compatibility override that creates a one-value prize list when `RAFFLE_POINT_AMOUNTS` is absent.

## JSON configuration files

| Local file | Tracked example | Behavior when local file is absent |
| --- | --- | --- |
| `config/commands.json` | `config/examples/commands.example.json` | The running Twitch service has no commands or event handlers. The dry-run simulator uses the example. |
| `config/emotes.json` | `config/examples/emotes.example.json` | File-backed text used by actions that select a random emote. |
| `config/macros.json` | `config/examples/macros.example.json` | The macro service uses the tracked example. |
| `config/greetings.json` | `config/examples/greetings.example.json` | The greeting service uses the tracked example. |
| `config/greetings-settings.json` | `config/examples/greetings-settings.example.json` | The greeting catalog's default pool is active. |
| `config/sfx-text.json` | `config/examples/sfx-text.example.json` | Random sound selection uses the tracked example. |
| `config/news-chyron.json` | `config/examples/news-chyron.example.json` | Used only when `NEWS_CHYRON_ITEMS` points to it; otherwise the configured default is used. |
| `config/tv-guide.json` | `config/examples/tv-guide.example.json` | The TV Guide uses `TV_GUIDE_ITEMS_DEFAULT`. |
| `config/welcome-followers.json` | `config/examples/welcome-followers.example.json` | File-backed text used by the configured follower welcome picker. |
| `config/raffle.json` | `config/examples/raffle.example.json` | The raffle service starts with built-in defaults and creates state when a durable change is saved. |

Refreshed Twitch tokens are stored separately in `config/twitch-token.json` and `config/twitch-broadcaster-token.json`. Do not edit or commit token files while the application is running.

## Macros

`config/macros.json` contains either an array or a `macros` array. Each enabled macro needs:

- `actions` or `action`: one action or an array of actions;
- at least one of `id`, `name`, or `label`; the service derives the missing identifier or display name from the value provided.

Use an explicit `id` when another system calls the macro API. `description` is optional. `completionDelayMs`, `delayMs`, or `queueDelayMs` can override automatic queue completion timing. The service loads macros when they are listed or executed, so edits do not require a server restart.

## Greetings

`config/greetings.json` can be a string array or an object with `defaultPool` and `pools`. The control panel writes the selected pool to `config/greetings-settings.json`.

`context.pickRandom` uses the active greeting pool unless the action supplies an inline `items` list, a `pool` or `theme`, or a JSON `file` within `config/`.

`config/emotes.json` is a string array of chat-emote text. Use it in a chat entry (or any other action sequence) without changing the active greeting pool:

```json
{
  "chatEntries": [{
    "name": "mod-or-vip-entry",
    "match": { "roles": ["moderator", "vip"] },
    "actions": [
      { "type": "context.pickRandom", "contextKey": "greeting" },
      { "type": "context.pickRandom", "contextKey": "emote", "file": "emotes.json" },
      { "type": "overlay.alert", "message": "Yo {displayName}! HEY {greeting} {emote}" }
    ]
  }]
}
```

The selected value is available at `{emote}` to every later action in the same sequence. A missing local catalog uses `config/examples/emotes.example.json`.

`config/welcome-followers.json` is a dedicated string-array catalog for follower welcome messages. The default `new-follower` handler stores a selected entry at `{welcomeFollower}` before sending its chyron alert. A missing local catalog uses `config/examples/welcome-followers.example.json`.

## Sound labels and random selection

`config/sfx-text.json` maps top-level sound filenames to overlay text:

```json
{
  "example.mp3": "VipOS MK V example sound"
}
```

`sound.pickRandom` selects only top-level `.mp3`, `.ogg`, and `.wav` files whose filenames appear in that map. Subdirectories are included in the control panel's full sound list and can be used by `sound.play`, but are not part of `sound.pickRandom`.

## Actions

Actions are used by macros, Twitch automation, the raffle, and the action API.

| Type | Required fields | Behavior |
| --- | --- | --- |
| `border.alert` | None | Triggers the animated stream border without alert text. |
| `chat.say` | `message` or `text` | Sends a Twitch chat message; `reply: true` replies to the triggering message when an ID is available. |
| `chyron.alert` | `h1`, `h2`, and `h3` | Makes both shared lower thirds visible, restarts their shared timer, then replaces all news-chyron text. |
| `context.pickRandom` | `contextKey` or `key` | Stores an inline or configured random text value in the action context. |
| `delay` | None | Waits for `ms` or `duration`, capped at ten minutes. |
| `log` | None | Writes the hydrated `message` to the application logger. |
| `obs.media` | `input` or `source`; `mediaAction`, `media`, or `command` | Runs `play`, `pause`, `restart`, or `stop` on an OBS media input. |
| `obs.mute` | `input` or `source` | Mutes, unmutes, or toggles an OBS input using `muted` or `status`. |
| `obs.scene` | `scene` | Switches the OBS program scene. |
| `obs.source` | `source` or `input` | Shows, hides, or toggles an OBS scene source using `visible` or `status`. |
| `overlay.alert` | `message` | Emits the alert background and text. Set `background: false` to omit the background. |
| `overlay.emit` | `event` | Emits a Socket.IO event with an optional `payload`. |
| `sound.pickRandom` | None | Chooses an eligible sound and stores its metadata at `contextKey`, defaulting to `sfx`. |
| `sound.play` | `src` or `path` | Plays a local sound at an optional `volume` from `0` to `1`. |

`border.alert` and `overlay.alert` use `DEFAULT_ALERT_SOUND` unless `sound: false` is set, a custom sound is supplied, or the same action list already contains `sound.play` or `sound.pickRandom`.

## Twitch automation

`config/commands.json` may be a command array or an object with these handler groups:

- `commands`
- `chatEntries`
- `follows`
- `raids`
- `subscriptions`
- `redemptions`
- `redemptionUpdates`
- `automaticRedemptions`
- `rewardEvents`

The service watches the file once Twitch chat starts. Reloading changes existing handlers immediately. If a newly added group needs an EventSub subscription that was not created at startup, the service reports `commandsRestartRequiredMessage` and requires a restart.

### Commands

Each command needs `actions` and at least one name in `command`, `commands`, or `aliases`. Optional fields include:

- `aliases`: additional names;
- `roles`: `everyone`, `broadcaster`, `moderator`, `vip`, `subscriber`, or `founder`;
- `cooldownSeconds`: nonnegative cooldown duration;
- `cooldownScope`: `global` by default or `user`.

Command actions can use `{command}`, `{commandName}`, `{message}`, `{messageId}`, `{displayName}`, `{username}`, `{after}`, and command arguments through the hydrated context.

### Event handlers and matching

An event handler needs `actions` and can include `name`, `cooldownSeconds`, `cooldownScope`, and `match`.

Supported matching fields are `event`, `rewardId`, `rewardTitle`, `rewardType`, `status`, `userId`, `username`, `displayName`, `roles`, `inputContains`, and `inputMatches`. Raid handlers also support `minViewers` and `maxViewers`.

`inputMatches` values are JavaScript regular-expression source strings. Patterns longer than 200 characters and patterns with nested quantifiers are rejected. Matching examines at most the first 500 characters of viewer input.

For normal channel-point redemption creation, use `redemptions`; its default event is `redemption.add`. Use `redemptionUpdates`, `automaticRedemptions`, and `rewardEvents` only for their separate EventSub event types.

Chat-entry handlers run once per bot session when the first message from a moderator or VIP is observed. Twitch chat messages do not provide silent join events.

### Template context

All actions can hydrate strings with `{path.to.value}` placeholders. Common top-level values include `{displayName}`, `{username}`, `{userId}`, `{message}`, `{event}`, and broadcaster identity fields.

Event-specific examples include:

| Event | Context examples |
| --- | --- |
| Chat entry | `{entry.role}`, `{entry.roles}`, `{entry.firstSeenAt}` |
| Redemption | `{reward.id}`, `{reward.title}`, `{reward.cost}`, `{redemption.id}`, `{redemption.input}`, `{redemption.status}` |
| Automatic redemption | `{automaticReward.type}`, `{automaticReward.channelPoints}`, `{automaticReward.emote}` |
| Follow | `{follow.followedAt}` |
| Raid | `{raid.viewers}`, `{raid.fromBroadcasterName}`, `{raid.toBroadcasterName}` |
| Subscription | `{subscription.tier}`, `{subscription.isGift}` |
| Gift subscription | `{subscription.amount}`, `{subscription.cumulativeAmount}`, `{subscription.isAnonymous}` |

`sound.pickRandom` with `contextKey: "sfx"` adds `{sfx.src}`, `{sfx.filename}`, `{sfx.name}`, and `{sfx.text}`. `context.pickRandom` adds the selected value at its configured context key.

Use `config/examples/commands.example.json` as the authoritative working example for command and handler shapes.
