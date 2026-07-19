<p align="center">
<img src="https://viperverse.tv/assets/img/viper_os_mk5_v2.png" />
</p>

# VipOS MK V

VipOS MK V is a local Node.js application for Twitch stream automation. It combines Twitch chat and EventSub handlers, OBS WebSocket controls, browser-source overlays, configurable macros, sound effects, an action queue, and a raffle service.

The server listens on `127.0.0.1`. It is designed to run on the same machine as the browser and OBS instance that use it.

## Capabilities

- Receive Twitch chat and configured EventSub events.
- Turn commands, rewards, follows, raids, subscriptions, and chat entries into action sequences.
- Control OBS scenes, source visibility, input mute state, and media inputs.
- Serve alerts, a news chyron, a stream border, a TV Guide, and a Venom Coin browser overlay.
- Run macros and manage queued stream actions from a local control panel.
- Run timed chat raffles with persisted points and history.

## Requirements

- Node.js 22 or newer
- npm
- OBS with its WebSocket server enabled, if OBS actions are needed
- Twitch application credentials and user tokens, if Twitch integration is enabled

## Start locally

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
npm install
npm start
```

The example environment keeps OBS and Twitch disabled, so the application can start before either integration is configured. Open <http://localhost:5000/control> after the server starts.

Use `npm run dev` to restart the server automatically while editing supported source files.

## Local pages

| Page | URL |
| --- | --- |
| Control panel | <http://localhost:5000/control> |
| Alerts and sounds | <http://localhost:5000/overlay/alerts> |
| News chyron | <http://localhost:5000/overlay/news-chyron> |
| Stream border | <http://localhost:5000/overlay/stream-border> |
| TV Guide | <http://localhost:5000/overlay/tv-guide> |
| Venom Coin | <http://localhost:5000/overlay/venom-coin> |
| Service status | <http://localhost:5000/api/v1/status> |

If `PORT` changes, replace `5000` in these URLs with the configured port.

## Documentation

- [Setup](docs/setup.md) - install the application and configure optional OBS and Twitch integrations.
- [Configuration](docs/configuration.md) - environment variables, JSON configuration, actions, and Twitch automation.
- [Operation](docs/operation.md) - use the control panel, queue, raffle, simulator, status endpoint, and local API.
- [Development](docs/development.md) - architecture, repository layout, scripts, tests, and documentation ownership.
- [Engineering standards](ENGINEERING_STANDARDS.md) - requirements for code changes and contributions.

No deployment configuration is included in this repository. Exposing the application outside the local machine requires a separate authentication, authorization, and network-security design.

## License

VipOS MK V is available under the [MIT License](LICENSE).
