# Setup

This guide starts VipOS MK V locally, then adds OBS and Twitch only when those integrations are needed.

## Prerequisites

Install Node.js 22 or newer and npm. The required Node.js version is declared in `package.json`.

OBS and Twitch are optional. The web application, control panel, overlays, macros that do not call OBS or chat, and dry-run Twitch simulator can operate without live integrations.

## Install and start

If the repository is not already local, clone the configured origin:

```powershell
git clone https://github.com/vipertronnx/VipOS_MK_V.git
Set-Location VipOS_MK_V
```

From the repository root, run:

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
npm install
npm start
```

The server listens on <http://127.0.0.1:5000> by default. Open the control panel at <http://localhost:5000/control>.

The copied environment file has `OBS_ENABLED=false` and `CHAT_ENABLED=false`. Keep those values until the corresponding setup below is complete.

## Create local configuration

Files directly under `config/` are ignored by Git. For a new installation, copy only the examples you intend to customize:

```powershell
Copy-Item config/examples/commands.example.json config/commands.json
Copy-Item config/examples/greetings.example.json config/greetings.json
Copy-Item config/examples/greetings-settings.example.json config/greetings-settings.json
Copy-Item config/examples/macros.example.json config/macros.json
Copy-Item config/examples/news-chyron.example.json config/news-chyron.json
Copy-Item config/examples/raffle.example.json config/raffle.json
Copy-Item config/examples/sfx-text.example.json config/sfx-text.json
Copy-Item config/examples/tv-guide.example.json config/tv-guide.json
Copy-Item config/examples/welcome-followers.example.json config/welcome-followers.json
```

See [Configuration](configuration.md) before editing these files. The application has tracked example fallbacks for macros, greetings, sound labels, follower welcome text, the news chyron, and the TV Guide. Twitch commands do not use the tracked example as a runtime fallback; copy `commands.example.json` when Twitch automation is needed.

Do not overwrite existing local configuration. In particular, `config/raffle.json` can contain live raffle state, user points, and history.

## Configure OBS

Enable the WebSocket server in OBS, then set these values in `.env`:

```env
OBS_ENABLED=true
OBS_ADDRESS=ws://localhost:4455
OBS_PASSWORD=replace_with_your_obs_websocket_password
```

Restart VipOS MK V after changing `.env`. When the connection succeeds, the control panel obtains the current scene, scenes, sources, and audio inputs from OBS. The status endpoint reports connection failures under `obs.lastError`.

## Configure Twitch chat

VipOS MK V uses Twitch user access tokens. The authorization-code flow below produces both the access token and refresh token needed by the application's refreshing authentication mode.

### Register a Twitch application

1. Sign in to the [Twitch developer console](https://dev.twitch.tv/console/apps), open **Applications**, and register an application.
2. Add `http://localhost:8080` as an OAuth redirect URL. Use that same registered value unchanged during authorization and token exchange.
3. Open the application's management page and copy its client ID.
4. Create and securely store a client secret.

Twitch requires 2FA on the developer account. Creating a new secret invalidates the prior secret. See Twitch's [application registration](https://dev.twitch.tv/docs/authentication/register-app/) and [authorization-code flow](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#authorization-code-grant-flow) documentation for the upstream requirements.

Treat the client secret, access tokens, and refresh tokens like passwords. Do not commit them, paste them into issues or chat, or put them in screenshots.

### Obtain an access and refresh token

Run this procedure once while signed in as the bot account. Run it a second time while signed in as the broadcaster account if the enabled handlers require broadcaster authentication. `force_verify=true` makes Twitch show the authorization step again; verify the account shown before approving it.

Choose the smallest scope set needed by that account:

| Token owner | Scopes |
| --- | --- |
| Bot account | `user:read:chat user:write:chat` |
| Broadcaster with redemptions or reward events | `channel:read:redemptions` |
| Broadcaster with follow events | `moderator:read:followers` |
| Broadcaster with subscription events | `channel:read:subscriptions` |

Combine the applicable broadcaster scopes with spaces. A chat-only or chat-and-raids setup does not need a broadcaster token. Twitch's [scope reference](https://dev.twitch.tv/docs/authentication/scopes/) is authoritative if its requirements change.

In a PowerShell session, set `$scopes` for the account being authorized and run:

```powershell
$clientId = Read-Host "Twitch client ID"
$clientSecretSecure = Read-Host "Twitch client secret" -AsSecureString
$clientSecret = [System.Net.NetworkCredential]::new('', $clientSecretSecure).Password
$redirectUri = "http://localhost:8080"
$scopes = "user:read:chat user:write:chat"
$state = [guid]::NewGuid().ToString("N")

$authUrl = "https://id.twitch.tv/oauth2/authorize" +
  "?response_type=code" +
  "&client_id=$([Uri]::EscapeDataString($clientId))" +
  "&redirect_uri=$([Uri]::EscapeDataString($redirectUri))" +
  "&scope=$([Uri]::EscapeDataString($scopes))" +
  "&state=$state" +
  "&force_verify=true"

$authUrl
```

Keep that PowerShell session open and paste the printed URL into a browser. After authorization, Twitch redirects to a URL shaped like:

```text
http://localhost:8080/?code=returned_code&scope=returned_scopes&state=returned_state
```

VipOS MK V does not run a callback server on port `8080`, so the browser may report that it cannot connect. Copy the complete redirect URL from the address bar, return to the same PowerShell session, and run:

```powershell
$callbackUrl = Read-Host "Complete Twitch redirect URL"
$callbackUri = [Uri]$callbackUrl
$query = @{}

$callbackUri.Query.TrimStart('?').Split('&') | ForEach-Object {
  $parts = $_ -split '=', 2
  $name = [Uri]::UnescapeDataString($parts[0])
  $value = if ($parts.Count -eq 2) {
    [Uri]::UnescapeDataString(($parts[1] -replace '\+', ' '))
  } else {
    ''
  }
  $query[$name] = $value
}

if ($query.error) {
  throw "Twitch authorization failed: $($query.error) - $($query.error_description)"
}
if ($query.state -ne $state) {
  throw "The returned OAuth state does not match; discard this authorization response."
}
if (-not $query.code) {
  throw "The redirect URL does not contain an authorization code."
}

$response = Invoke-RestMethod `
  -Method Post `
  -Uri "https://id.twitch.tv/oauth2/token" `
  -ContentType "application/x-www-form-urlencoded" `
  -Body @{
    client_id = $clientId
    client_secret = $clientSecret
    code = $query.code
    grant_type = "authorization_code"
    redirect_uri = $redirectUri
  }

$response | Format-List access_token, refresh_token, expires_in, scope, token_type
```

The response contains live secrets. Copy the token values and the exact returned `scope` list directly into `.env` as follows:

| Authorization run | Access token variable | Refresh token variable | Scope variable |
| --- | --- | --- | --- |
| Bot account | `TWITCH_BOT_ACCESS_TOKEN` | `TWITCH_BOT_REFRESH_TOKEN` | `TWITCH_BOT_SCOPES` |
| Broadcaster account | `TWITCH_BROADCASTER_ACCESS_TOKEN` | `TWITCH_BROADCASTER_REFRESH_TOKEN` | `TWITCH_BROADCASTER_SCOPES` |

Both runs use the same `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET`. Restart the authorization flow if Twitch rejects the returned code during exchange.

### Enable chat

The bot account needs these scopes:

- `user:read:chat`
- `user:write:chat`

Configure chat with:

```env
CHAT_ENABLED=true
TWITCH_CLIENT_ID=replace_with_your_twitch_client_id
TWITCH_CLIENT_SECRET=replace_with_your_twitch_client_secret
TWITCH_BOT_ACCESS_TOKEN=replace_with_your_bot_access_token
TWITCH_BOT_REFRESH_TOKEN=replace_with_your_bot_refresh_token
TWITCH_BOT_SCOPES=user:read:chat user:write:chat
TWITCH_CHANNEL=replace_with_your_channel_login
```

`TWITCH_CHANNEL_ID` can replace `TWITCH_CHANNEL`. `TWITCH_BOT_USER_ID` and `TWITCH_BOT_USERNAME` are optional; the service looks them up when they are absent.

A bot access token can be used without a refresh token. In that static mode, `TWITCH_CLIENT_SECRET` is not required, but the application cannot refresh an expired token. Refreshing mode requires both `TWITCH_CLIENT_SECRET` and `TWITCH_BOT_REFRESH_TOKEN`.

In refreshing mode, Twurple refreshes expired tokens and VipOS MK V atomically persists the replacements to `config/twitch-token.json`. Broadcaster replacements are written to `config/twitch-broadcaster-token.json`. Keep both files untracked; the persisted values take precedence over `.env` on later starts.

Copy `config/examples/commands.example.json` to `config/commands.json`, then restart the application. For a chat-only setup, remove the example's `follows` and `subscriptions` groups first; either group requires broadcaster authentication. Reward and redemption groups remain inactive while `CHAT_ENABLE_REDEMPTIONS=false`.

The commands file is watched after chat starts, but adding a handler group that needs a new EventSub subscription requires a restart.

## Configure broadcaster events

Channel-point redemptions, follow handlers, and subscription handlers require a broadcaster refresh token. The bot must also use a refresh token when broadcaster EventSub authentication is needed.

Set:

```env
CHAT_ENABLE_REDEMPTIONS=true
TWITCH_BROADCASTER_ACCESS_TOKEN=replace_with_your_broadcaster_access_token
TWITCH_BROADCASTER_REFRESH_TOKEN=replace_with_your_broadcaster_refresh_token
```

Authorize the broadcaster account for the configured handlers:

| Handler | Required broadcaster scope |
| --- | --- |
| Redemption and reward handlers | `channel:read:redemptions` or `channel:manage:redemptions` |
| Follow handlers | `moderator:read:followers` |
| Subscription handlers | `channel:read:subscriptions` |
| Raid handlers | No additional broadcaster scope |

The broadcaster refresh token must belong to the account identified by `TWITCH_CHANNEL` or `TWITCH_CHANNEL_ID`.

## Add overlays to OBS

Create OBS browser sources with the local URLs you need:

| Overlay | URL |
| --- | --- |
| Alerts and sounds | `http://localhost:5000/overlay/alerts` |
| News chyron | `http://localhost:5000/overlay/news-chyron` |
| Stream border | `http://localhost:5000/overlay/stream-border` |
| TV Guide | `http://localhost:5000/overlay/tv-guide` |
| Venom Coin | `http://localhost:5000/overlay/venom-coin` |

Use the configured `PORT` instead of `5000` when it has been changed.

## Verify the setup

1. Open <http://localhost:5000/api/v1/status> and inspect the `obs` and `chat` sections.
2. Open the control panel and confirm the expected macros and sounds are listed.
3. Open each configured overlay in a browser or OBS.
4. Run a dry Twitch event simulation as described in [Operation](operation.md#simulate-twitch-events).

Do not commit `.env`, `config/twitch-token.json`, `config/twitch-broadcaster-token.json`, or other files directly under `config/`. The repository's `.gitignore` excludes them.
