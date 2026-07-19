<p align="center">
<img src="https://viperverse.tv/assets/img/viper_os_mk5_v2.png" />
</p>

# // VipOS MK V | Chat Bot + Overlay Platform
- Run `npm start` for production
- Run `npm run dev` for development

## Styles and fonts

SCSS under `public/assets/sass` is the maintained source. Regenerate the committed, compressed CSS and source maps with:

```bash
npm run build:css
```

Use `npm run watch:css` while editing `styles.scss` or `control.scss`. Review and commit the generated files in
`public/assets/css` with the SCSS change.

Font binaries remain intentionally untracked. Obtain the Orbitron webfonts from [theleagueof/orbitron](https://github.com/theleagueof/orbitron), which distributes them under the [SIL Open Font License](https://github.com/theleagueof/orbitron/blob/master/Open%20Font%20License.markdown), and place them in `public/assets/fonts` with the filenames referenced by `public/assets/sass/imports/fonts.scss`. `SNNeoNoire-Regular.ttf` is not redistributable; obtain and place it at `public/assets/fonts/SNNeoNoire-Regular.ttf` on each development or deployment machine.

## Local URLs
- Control panel: `http://localhost:5000/control`
- Alerts overlay, including sound alerts: `http://localhost:5000/overlay/alerts`
- News chyron overlay: `http://localhost:5000/overlay/news-chyron`
- Stream border overlay: `http://localhost:5000/overlay/stream-border`

## News Chyron
The news chyron rotates its `h1`, `h2`, and `h3` text at random. Set `NEWS_CHYRON_ROTATE_INTERVAL_MS=30000` in `.env` to change the timer.

By default, the text pool is loaded from `NEWS_CHYRON_ITEMS_DEFAULT`, which points to `config/examples/news-chyron.example.json` unless overridden.

To replace the default text pool, copy `config/examples/news-chyron.example.json` to `config/news-chyron.json`, edit the entries, and uncomment `NEWS_CHYRON_ITEMS`:

```env
NEWS_CHYRON_ITEMS_DEFAULT=config/examples/news-chyron.example.json
# NEWS_CHYRON_ITEMS=config/news-chyron.json
```

## Lower Third Slide
The news chyron and Venom Coin overlays share the same hide/show events and a server-synced automatic toggle timer. Each overlay has independent slide tuning in `.env`:

```env
NEWS_CHYRON_LOWER_THIRD_SLIDE_DISTANCE=140px
NEWS_CHYRON_LOWER_THIRD_SLIDE_DURATION=600ms
VENOM_COIN_LOWER_THIRD_SLIDE_DISTANCE=100%
VENOM_COIN_LOWER_THIRD_SLIDE_DURATION=300ms
LOWER_THIRD_TOGGLE_INTERVAL_MS=180000
```

## Control Panel
The control panel includes configured macro buttons, action queue controls, OBS scene/source/input discovery, manual overlay controls, chat messages, and the raw action runner.

Copy `config/examples/macros.example.json` to `config/macros.json` and edit the production macros for your stream. Each macro has an `id`, `name`, optional `description`, and `actions`.

The Sound control searches local `.mp3`, `.ogg`, and `.wav` files under `public/assets/sounds`, including subdirectories, and shows detected duration labels from `GET /api/v1/sounds`. Sound listings are cached briefly; use the Sound panel refresh button or `GET /api/v1/sounds?refresh=1` to force a fresh directory scan.

Macros, alert/border control-panel actions, and Twitch-triggered actions run through the action queue so common stream moments do not stack alerts or OBS actions on top of each other. The synced lower-third controls emit immediately. The queue can be paused, resumed, skipped, or cleared from the control panel, and the queue activity log shows recent queued, started, completed, failed, skipped, cleared, paused, and resumed events.

Quiet Mode can be toggled from the control panel or with `POST /api/v1/quiet-mode/on`, `POST /api/v1/quiet-mode/off`, and `POST /api/v1/quiet-mode/toggle`. When enabled, viewer-triggered Twitch/chat alert and sound actions are suppressed while manual API actions and OBS controls remain available.

## Raffle
The raffle system can be turned on or off from the control panel, or with:

- `POST /api/v1/raffle/on`
- `POST /api/v1/raffle/off`
- `POST /api/v1/raffle/toggle`
- `POST /api/v1/raffle/start`
- `POST /api/v1/raffle/close`

When turned on, the raffle system opens the first raffle immediately. After a raffle closes, the next raffle opens at a random time between `settings.minDelayMs` and `settings.maxDelayMs`, defaulting to 5-10 minutes. Each raffle randomly picks its prize from `settings.pointAmounts`, defaulting to `[100,150,200,250,300,350,400,450,500]`, and announces the amount with `settings.pointName`, such as `cassette tapes` or `viperbucks`. Set `settings.pointTwitchEmoji` to append a Twitch emoji code to raffle chat messages. An open raffle announces in chat and on the alert overlay, plays `settings.alertSound` when configured, then posts the remaining seconds to chat every `settings.countdownIntervalMs`, defaulting to 30 seconds. Set it to `20000` for 20-second updates. Viewers enter with `settings.entryCommand`; duplicate entries are ignored for the active round. Viewers can check their accumulated raffle points with `settings.pointsCommand`.

Raffle state and detailed raffle settings are persisted in `config/raffle.json`, including users who entered raffles, winners, total wins, total entries, and accumulated points. Copy `config/examples/raffle.example.json` to `config/raffle.json` to customize raffle behavior. `.env` only needs `RAFFLE_ENABLED` for the default startup toggle; advanced `RAFFLE_*` environment values are still supported as deployment overrides and take precedence over matching JSON settings when present.

Use `POST /api/v1/actions/enqueue` to queue custom actions. Use `POST /api/v1/actions/run` only when you intentionally need to bypass the queue and run actions immediately.

Queued sound actions use the local audio file duration to keep the item running until the effect should be finished. `sound.play` returns the detected `durationMs`, and the queue waits for the longest sound in the action results plus `QUEUE_SOUND_COMPLETION_BUFFER_MS`, defaulting to `250`. If a duration cannot be read, the queue falls back to `QUEUE_SOUND_COMPLETION_DELAY_MS`, defaulting to `4000`. Request bodies or macros may override automatic timing with `completionDelayMs`, `delayMs`, or `queueDelayMs`.

OBS dropdowns are populated from the live OBS WebSocket connection. If OBS is not connected, the controls stay disabled until OBS discovery succeeds.

## Chat Commands
Copy `config/examples/commands.example.json` to `config/commands.json` and edit the commands/actions for your stream.
The commands file is watched and reloaded while the app is running.

Chat uses Twitch EventSub WebSockets for inbound messages and the Twitch Send Chat Message API for bot replies. Authorize the bot account with:

- `user:read:chat`
- `user:write:chat`

Set `TWITCH_BOT_ACCESS_TOKEN` and `TWITCH_BOT_REFRESH_TOKEN` in `.env`. Refreshed token data is written to `config/twitch-token.json`, which should stay out of git.

## Channel Point Rewards
Channel point custom rewards and automatic reward redemptions require the broadcaster account to authorize one of:

- `channel:read:redemptions`
- `channel:manage:redemptions`

Set `TWITCH_BROADCASTER_ACCESS_TOKEN` and `TWITCH_BROADCASTER_REFRESH_TOKEN` in `.env`, or leave `CHAT_ENABLE_REDEMPTIONS=false` for chat-only mode. Refreshed broadcaster token data is written to `config/twitch-broadcaster-token.json`.

Suggested future-friendly broadcaster scopes:

```text
bits:read channel:read:redemptions channel:manage:redemptions channel:read:polls channel:manage:polls channel:read:predictions channel:manage:predictions channel:read:goals channel:read:hype_train channel:read:subscriptions channel:read:vips channel:read:ads channel:read:charity moderator:read:followers moderator:read:chatters
```

`config/commands.json` may be either the original command array or an object with:

- `commands`
- `redemptions`
- `redemptionUpdates`
- `automaticRedemptions`
- `rewardEvents`
- `chatEntries`
- `follows`
- `raids`
- `subscriptions`

Reward action templates can use values like `{displayName}`, `{message}`, `{reward.title}`, `{reward.id}`, `{reward.cost}`, `{redemption.input}`, and `{automaticReward.type}`.
`sound.pickRandom` adds the picked file to the action context, so later actions can use `{sfx.src}`, `{sfx.filename}`, `{sfx.name}`, and `{sfx.text}` when the `contextKey` is `sfx`.
`context.pickRandom` picks one item from the active pool in `config/greetings.json` by default and stores it at `contextKey`, so a later action can use it in templates like `{greeting}`. It can also pick from an inline `items` list, a custom `file`, or a fixed `pool`/`theme`.

For normal channel point usage, use `redemptions`; Twitch calls this event `redemption.add` because a viewer has added a new redemption. `redemptionUpdates`, `automaticRedemptions`, and `rewardEvents` are optional advanced handler groups, and the service only subscribes to those extra EventSub topics when handlers are configured for them at startup.

Chat entry, follow, raid, and subscription interactions are configured with `chatEntries`, `follows`, `raids`, and `subscriptions`. Chat entry handlers fire once per bot session when the first chat message seen from a moderator or VIP arrives; Twitch chat messages do not expose silent joins. Follow handlers require the broadcaster token to include `moderator:read:followers`; subscription handlers require `channel:read:subscriptions`; raid handlers do not require an extra Twitch scope. The service only subscribes to follow, raid, and subscription EventSub topics when handlers are configured at startup.

Chat entry templates can use `{displayName}`, `{username}`, `{entry.role}`, and `{entry.roles}`. Follow templates can use `{displayName}`, `{username}`, `{follow.followedAt}`, and broadcaster fields like `{broadcasterDisplayName}`. Raid templates can use `{displayName}`, `{username}`, `{raid.viewers}`, `{raid.fromBroadcasterName}`, and `{raid.toBroadcasterName}`. Subscription templates can use `{displayName}`, `{username}`, `{subscription.tier}`, `{subscription.isGift}`, `{subscription.amount}`, `{subscription.cumulativeAmount}`, and `{subscription.isAnonymous}`.

Test follow, raid, and subscription handlers without connecting to Twitch:

```bash
npm run simulate:twitch-event -- follow
npm run simulate:twitch-event -- raid
npm run simulate:twitch-event -- sub
npm run simulate:twitch-event -- gift-sub --count 5
```

The default simulator is a dry run that prints overlay/chat actions in the terminal. To fire the running app and any OBS browser sources pointed at its overlays, start the app first and add `--live`:

```bash
npm run simulate:twitch-event -- follow --live
npm run simulate:twitch-event -- raid --live
npm run simulate:twitch-event -- sub --live
npm run simulate:twitch-event -- gift-sub --count 5 --live
```

The simulator uses `config/commands.json` when present, otherwise `config/examples/commands.example.json`. Pass a custom fixture path after the event type to override the default payload. Use `--url http://127.0.0.1:5000` if the app is running on a different local URL.

Redemption handlers can be catch-all, or they can include a `match` object:

```json
{
  "redemptions": [
    {
      "name": "hydrate",
      "match": {
        "rewardTitle": "Hydrate"
      },
      "actions": [
        { "type": "overlay.alert", "message": "{displayName} redeemed {reward.title}" }
      ]
    },
    {
      "name": "song-request",
      "match": {
        "rewardId": "replace_with_twitch_reward_id",
        "inputContains": "http"
      },
      "actions": [
        { "type": "overlay.alert", "message": "{displayName} requested: {redemption.input}" }
      ]
    }
  ]
}
```

Supported `match` fields include `event`, `rewardId`, `rewardTitle`, `rewardType`, `status`, `userId`, `username`, `displayName`, `roles`, `inputContains`, and `inputMatches`.
`inputMatches` values are JavaScript regular expressions and are intentionally limited: patterns must be 200 characters or fewer, nested quantifiers are rejected, and matching only evaluates the first 500 characters of viewer input.
Raid handlers also support `minViewers` and `maxViewers`.

Use `status` only when you intentionally want to separate queued/manual reward states like `unfulfilled`, `fulfilled`, or `canceled`.

Action types currently supported:
- `overlay.alert`
- `overlay.emit`
- `context.pickRandom`
- `sound.play`
- `sound.pickRandom`
- `obs.scene`
- `obs.source`
- `obs.mute`
- `obs.media`
- `chat.say`
- `delay`
- `log`

`overlay.alert` plays `DEFAULT_ALERT_SOUND` by default unless the action includes `sound: false`, a custom `sound`/`soundSrc`, or the same action list already includes a separate `sound.play` or `sound.pickRandom` action.
`sound.pickRandom` chooses from top-level `.mp3`, `.ogg`, and `.wav` files in `public/assets/sounds` only when their filenames are listed in `config/sfx-text.json`; if that file is absent, it falls back to `config/examples/sfx-text.example.json`. Subdirectories are ignored. Edit `config/sfx-text.json` to control both the random SFX pool and the overlay text for each filename.
Edit `config/greetings.json` to control the themed text pools used by `context.pickRandom`. The control panel can switch the active greeting theme, which is saved in `config/greetings-settings.json`.
