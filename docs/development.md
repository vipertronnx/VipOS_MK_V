# Development

VipOS MK V is a CommonJS Node.js application. `app.js` is both the executable entry point and the composition root for the HTTP server, Socket.IO server, and runtime services.

## Repository layout

| Path | Responsibility |
| --- | --- |
| `app.js` | Loads environment configuration, composes services, defines HTTP routes, enforces local API policy, and owns startup and shutdown. |
| `modules/actions/` | Action execution, validation, queueing, macros, and greeting pools. |
| `modules/chat/` | Twitch authentication, command configuration, EventSub lifecycle and planning, context normalization, automation, retries, and raffle behavior. |
| `modules/obs.js` | OBS WebSocket connection lifecycle, discovery, and operations. |
| `modules/overlays/` | Shared overlay-state services, including lower-third visibility policy. |
| `modules/utils/` | Shared path, JSON persistence, error, value, completion-delay, and audio-duration utilities. |
| `views/` | EJS pages and overlay templates. |
| `public/assets/js/` | Browser-side control-panel and overlay event handlers. |
| `public/assets/sass/` | Maintained style sources. |
| `public/assets/css/` | Generated, committed CSS and source maps. |
| `config/examples/` | Tracked, distributable JSON configuration examples. |
| `fixtures/twitch/` | Tracked simulator payloads. |
| `scripts/` | Development, documentation-validation, and simulation utilities. |
| `test/` | Automated tests using Node's built-in test runner. |
| `.github/workflows/` | GitHub Actions continuous-integration workflows. |

Local files directly under `config/`, `.env`, `temp/`, dependencies, `.mp3` and `.wav` sound files other than `example.mp3`, and font binaries are excluded from Git.

## Runtime architecture

`startServer()` creates one HTTP server, a Socket.IO server, the runtime services, and the Express application. It returns `{ app, server, services, stop }`; tests and programmatic callers use `stop()` for coordinated teardown.

The runtime service graph is:

```text
HTTP routes / control panel / Twitch handlers / raffle
                         |
                         v
                   action queue
                         |
                         v
                   action runner
                 /    /   \       \
              chat  OBS  Socket.IO  greetings
```

Key boundaries are:

- `actions.js` owns the canonical action registry, structural validation, template hydration, and execution.
- `action-queue.js` owns serialization, completion timing, history, and queue activity.
- `chat.js` coordinates Twitch startup and normalized automation but delegates authentication, EventSub lifecycle, planning, configuration loading, context construction, and matching to focused modules.
- `obs.js` owns the raw OBS WebSocket client and serialized connect/disconnect/reconnect lifecycle.
- `json-file.js` owns atomic JSON writes used by persisted state.
- `app.js` translates HTTP requests into domain service calls and centralizes HTTP error responses.

External Twitch and OBS clients are injected or replaced with fakes in tests. The automated suite does not require live services or credentials.

## Local security model

HTTP and Socket.IO use the same active port and local-origin policy. The server binds to `127.0.0.1`. Browser origins are accepted only from `localhost` or `127.0.0.1` on that port, and API mutations require JSON.

This is one local-service security model, not an internet-facing authentication system. A change that adds another bind address, reverse proxy, or tunnel must also define and test authentication and authorization.

## Development commands

Install dependencies:

```powershell
npm install
```

Start with automatic restarts:

```powershell
npm run dev
```

`nodemon.json` watches JavaScript, JSON, EJS, and CSS extensions while ignoring files directly under `config/`. Twitch commands have their own runtime file watcher.

Run the complete test suite:

```powershell
npm test
```

Check internal documentation links, Markdown fences, and environment-variable coverage:

```powershell
npm run check:docs
```

Run a Twitch fixture without live services:

```powershell
npm run simulate:twitch-event -- follow
```

See [Simulate Twitch events](operation.md#simulate-twitch-events) for every simulator option.

## Testing expectations

The test suite uses `node:test` and `node:assert`. Add tests under `test/` at the narrowest useful boundary.

The current suite covers:

- HTTP routes, validation, local-origin behavior, and server lifecycle;
- every registered action type, quiet-mode metadata, sounds, and queue behavior;
- Twitch authentication, token persistence, context mapping, command reloads, EventSub planning and lifecycle, handlers, scopes, simulations, and retry behavior;
- OBS operations and overlapping lifecycle transitions;
- raffle timing and required persistence;
- shared path, error, JSON persistence, normalization, and completion-delay utilities.

Follow the detailed test and change rules in [Engineering standards](../ENGINEERING_STANDARDS.md).

## Styles and fonts

SCSS under `public/assets/sass/` is the maintained source. Build the committed compressed CSS and source maps with:

```powershell
npm run build:css
```

Watch and rebuild while editing styles:

```powershell
npm run watch:css
```

Commit changes under `public/assets/css/` with the corresponding SCSS change.

Font binaries are intentionally untracked. Install them under `public/assets/fonts/` as follows:

1. Download or clone [the League of Moveable Type's Orbitron repository](https://github.com/theleagueof/orbitron). Copy the contents of its `webfonts/` directory into `public/assets/fonts/`. That kit supplies the exact medium, light, bold, and black `.eot`, `.woff`, `.ttf`, and `.svg` filenames referenced by `public/assets/sass/imports/fonts.scss`. Orbitron is distributed under the SIL Open Font License included in that repository.
2. Obtain Neo-Noire from the [Signalnoise store](https://store.signalnoise.com/products/neo-noire-font), confirm that its license covers the intended use, and copy the supplied TTF to `public/assets/fonts/SNNeoNoire-Regular.ttf`. Signalnoise explicitly prohibits redistributing the font and directs commercial users to contact the studio.

Do not commit the font binaries. `public/assets/fonts/.gitignore` intentionally excludes them. After installing the files, open the control panel and overlays to verify that headings render in Neo-Noire and other display text renders in Orbitron rather than the fallback fonts.

## Configuration changes

When adding user-facing configuration:

1. Add the runtime reader and normalization in the owning module.
2. Add a safe value or commented entry to `.env.example`, or update the owning file under `config/examples/`.
3. Update [Configuration](configuration.md).
4. Add tests for defaults, accepted values, invalid values, and reload behavior where applicable.

Do not put real credentials, generated tokens, machine-specific paths, or personalized stream configuration into tracked examples.

## Documentation ownership

Keep one authoritative location per topic:

| Change | Update |
| --- | --- |
| First-run requirements or integration setup | `docs/setup.md` |
| Environment variables, JSON schemas, actions, handlers, or templates | `docs/configuration.md` and the applicable example file |
| Control-panel, status, simulation, API, or troubleshooting behavior | `docs/operation.md` |
| Architecture, repository layout, scripts, tests, or asset workflow | `docs/development.md` |
| Contributor invariants and code policy | `ENGINEERING_STANDARDS.md` |
| Project summary or primary navigation | `README.md` |

Link to the authoritative section instead of copying detailed guidance into another document.

## Continuous integration and deployment status

`.github/workflows/ci.yml` installs locked dependencies, runs the documentation checks, and runs the automated suite on the minimum declared Node.js version and a current LTS version for pushes and pull requests.

The repository contains no container definition, process manager configuration, infrastructure-as-code, or deployment script. Deployment behavior and requirements are therefore unverified. Do not describe a production topology until its implementation is added to the repository.
