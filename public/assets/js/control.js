const log = document.querySelector('#control-log');
const statusEl = document.querySelector('[data-status]');
const statusDetailsEl = document.querySelector('[data-status-details]');
const greetingPoolSelect = document.querySelector('[data-greeting-pool]');
const greetingPoolForm = document.querySelector('[data-greeting-pool-form]');
const macroListEl = document.querySelector('[data-macro-list]');
const queueStatusEl = document.querySelector('[data-queue-status]');
const queueActivityEl = document.querySelector('[data-queue-activity]');
const raffleStatusEl = document.querySelector('[data-raffle-status]');
const soundInputEl = document.querySelector('[data-sound-input]');
const soundListEl = document.querySelector('[data-sound-list]');
const obsSceneSelect = document.querySelector('[data-obs-scenes]');
const obsSourceSceneSelect = document.querySelector('[data-obs-source-scenes]');
const obsSourceSelect = document.querySelector('[data-obs-sources]');
const obsInputSelect = document.querySelector('[data-obs-inputs]');
const obsMediaInputSelect = document.querySelector('[data-obs-media-inputs]');

let obsDiscovery = null;

/**
 * Fetches and parses a successful JSON response from a control API endpoint.
 *
 * @param {string} endpoint Relative or absolute API endpoint.
 * @returns {Promise<*>} Parsed JSON response.
 * @throws {Error} Rejects for network failures, invalid JSON, or an unsuccessful response status.
 */
async function getJson(endpoint) {
  const response = await fetch(endpoint);
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || response.statusText);
  }

  return payload;
}

/**
 * Sends a JSON request to a control API endpoint and requires a JSON response when a body is returned.
 *
 * @param {string} endpoint Relative or absolute API endpoint.
 * @param {*} [data={}] JSON-serializable request body.
 * @returns {Promise<*>} Parsed response, or an `{ ok }` object for an empty response body.
 * @throws {Error} Rejects for network failures, serialization failures, invalid JSON responses, or unsuccessful status codes.
 */
async function postJson(endpoint, data = {}) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  const text = await response.text();
  let payload = { ok: response.ok };

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (error) {
      throw new Error(`Expected JSON from ${endpoint}, got ${response.status} ${response.statusText}`);
    }
  }

  if (!response.ok) {
    throw new Error(payload.error || response.statusText);
  }

  return payload;
}

/**
 * Converts a control form into an API payload, honoring raw-JSON and JSON-field opt-ins.
 *
 * @param {HTMLFormElement} form Submitted control form.
 * @returns {*} Parsed raw JSON, or an object built from non-empty form fields.
 * @throws {Error} Throws when required raw JSON or a JSON-designated field cannot be parsed.
 */
function formDataToJson(form) {
  if (form.hasAttribute('data-raw-json')) {
    const field = form.querySelector('textarea, input');
    const value = field ? field.value.trim() : '';
    if (!value) throw new Error('JSON payload is required');
    return JSON.parse(value);
  }

  const data = {};
  new FormData(form).forEach((value, key) => {
    if (value === '') return;

    const field = form.elements[key];
    const shouldParseJson = field && field.hasAttribute && field.hasAttribute('data-json-field');
    data[key] = shouldParseJson ? JSON.parse(value) : coerceFormValue(value);
  });

  return data;
}

function writeLog(value) {
  const formatted = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  log.textContent = formatted;
}

function coerceFormValue(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  return value;
}

function formatStatusValue(value) {
  if (value === undefined || value === null || value === '') return 'n/a';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
}

function formatDateValue(value) {
  if (!value) return 'n/a';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function formatTimeValue(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleTimeString();
}

function formatDurationMs(durationMs) {
  const duration = Number(durationMs || 0);
  if (!Number.isFinite(duration) || duration <= 0) return 'unknown';

  const totalSeconds = Math.round(duration / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function statusBadge(label, online) {
  return `<span class="status-pill ${online ? 'is-online' : 'is-offline'}">${escapeHtml(label)}</span>`;
}

/**
 * Renders the running, pending, and recent action queue state into the control panel.
 *
 * @param {object|null|undefined} queue Queue status snapshot returned by the API; absent values render an unavailable state.
 */
function renderQueue(queue) {
  if (!queueStatusEl) return;

  if (!queue) {
    queueStatusEl.innerHTML = '<div class="status-item"><span>Queue</span><strong>Unavailable</strong></div>';
    renderQueueActivity(null);
    return;
  }

  const running = queue.running;
  const pending = queue.pending || [];
  const history = queue.history || [];
  const recent = history.slice(0, 4);
  const pendingText = pending.length
    ? pending.map(item => `#${item.id} ${item.name}`).join(', ')
    : 'None';
  const historyText = recent.length
    ? recent.map(item => `#${item.id} ${item.name}: ${item.status}`).join('\n')
    : 'None';

  queueStatusEl.innerHTML = [
    ['State', queue.paused ? 'Paused' : (running ? 'Running' : 'Ready')],
    ['Running', running ? `#${running.id} ${running.name}` : 'None'],
    ['Pending', pendingText],
    ['Recent', historyText]
  ].map(([label, value]) => (
    `<div class="status-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`
  )).join('');

  renderQueueActivity(queue.activity || []);
}

function renderQueueActivity(activity) {
  if (!queueActivityEl) return;

  if (!activity) {
    queueActivityEl.innerHTML = '<div class="queue-activity__empty">Queue activity unavailable</div>';
    return;
  }

  if (!activity.length) {
    queueActivityEl.innerHTML = '<div class="queue-activity__empty">No queue activity yet</div>';
    return;
  }

  queueActivityEl.innerHTML = activity.slice(0, 20).map(item => {
    const subject = item.id ? `#${item.id} ${item.name}` : formatQueueEvent(item);
    const details = [
      item.source,
      item.actionCount ? `${item.actionCount} action${item.actionCount === 1 ? '' : 's'}` : '',
      item.count ? `${item.count} item${item.count === 1 ? '' : 's'}` : '',
      item.error ? `Error: ${item.error}` : ''
    ].filter(Boolean).join(' / ');

    return `
      <div class="queue-activity__item is-${escapeHtml(item.event || 'event')}">
        <time>${escapeHtml(formatTimeValue(item.timestamp))}</time>
        <div>
          <strong>${escapeHtml(formatQueueEvent(item))}</strong>
          <span>${escapeHtml(subject)}</span>
          ${details ? `<small>${escapeHtml(details)}</small>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function formatQueueEvent(item) {
  const event = String(item.event || 'event').replace(/-/g, ' ');
  return event.charAt(0).toUpperCase() + event.slice(1);
}

function renderRaffle(raffle) {
  if (!raffleStatusEl) return;

  if (!raffle) {
    raffleStatusEl.innerHTML = '<div class="status-item"><span>Raffle</span><strong>Unavailable</strong></div>';
    return;
  }

  const current = raffle.current || {};
  const winners = raffle.winners || [];
  const leaders = raffle.users || [];
  const pointName = raffle.pointName || 'raffle points';
  const winnerText = winners.length
    ? winners.slice(0, 3).map(item => {
      const winner = item.winner ? item.winner.displayName : 'No winner';
      const prize = item.pointsAwarded ? ` (${item.pointsAwarded} ${item.pointName || pointName})` : '';
      return `#${item.roundNumber} ${winner}${prize}`;
    }).join('\n')
    : 'None';
  const leaderText = leaders.length
    ? leaders.slice(0, 5).map(user => `${user.displayName}: ${user.points} ${pointName} / ${user.wins} wins`).join('\n')
    : 'None';

  const items = [
    ['State', raffle.enabled ? 'On' : 'Off'],
    ['Current', current.status === 'open' ? `Open until ${formatDateValue(current.closesAt)}` : 'No open raffle'],
    ['Prize', current.status === 'open' ? `${current.prizeAmount} ${current.pointName || pointName}` : 'n/a'],
    ['Entrants', current.status === 'open' ? formatStatusValue(current.entrantCount) : 'n/a'],
    ['Next event', formatDateValue(raffle.nextEventAt)],
    ['Commands', `${raffle.entryCommand} / ${raffle.pointsCommand}`],
    ['Prize pool', (raffle.pointAmounts || []).map(amount => `${amount}`).join(', ')],
    ['Totals', `${raffle.totals.roundsStarted || 0} rounds / ${raffle.totals.entries || 0} entries`],
    ['Recent winners', winnerText],
    ['Point leaders', leaderText]
  ];

  raffleStatusEl.innerHTML = items.map(([label, value]) => (
    `<div class="status-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`
  )).join('');
}

function renderStatusDetails(data) {
  if (!statusDetailsEl) return;

  const chat = data.chat || {};
  const greetings = data.greetings || {};
  const obs = data.obs || {};
  const quietMode = data.quietMode || {};
  const raffle = data.raffle || {};
  const sockets = data.sockets || {};
  const items = [
    ['OBS enabled', formatStatusValue(obs.enabled)],
    ['OBS connected', formatStatusValue(obs.connected)],
    ['OBS identified', formatStatusValue(obs.identified)],
    ['Current scene', formatStatusValue(obs.currentScene)],
    ['OBS error', formatStatusValue(obs.lastError)],
    ['Chat enabled', formatStatusValue(chat.enabled)],
    ['Chat started', formatStatusValue(chat.started)],
    ['Chat connected', formatStatusValue(chat.connected)],
    ['Auth mode', formatStatusValue(chat.authMode)],
    ['Channel', formatStatusValue(chat.broadcasterName)],
    ['Bot', formatStatusValue(chat.botUserName)],
    ['Commands', formatStatusValue(chat.commandCount)],
    ['Commands loaded', formatDateValue(chat.commandsLoadedAt)],
    ['Commands error', formatStatusValue(chat.commandsLastError)],
    ['Commands restart', formatStatusValue(chat.commandsRestartRequiredMessage)],
    ['Messages', formatStatusValue(chat.messageCount)],
    ['Last command', formatDateValue(chat.lastCommandAt)],
    ['Greeting theme', formatStatusValue(greetings.activePool)],
    ['Rewards enabled', formatStatusValue(chat.rewardsEnabled)],
    ['Redemptions', formatStatusValue(chat.redemptionCount)],
    ['Redemption handlers', formatStatusValue(chat.redemptionHandlerCount)],
    ['Reward handlers', formatStatusValue(chat.rewardEventHandlerCount)],
    ['Follows', formatStatusValue(chat.followHandlerCount)],
    ['Raids', formatStatusValue(chat.raidHandlerCount)],
    ['Quiet mode', quietMode.enabled ? 'on' : 'off'],
    ['Quiet updated', formatDateValue(quietMode.updatedAt)],
    ['Raffle', raffle.enabled ? 'on' : 'off'],
    ['Raffle next', formatDateValue(raffle.nextEventAt)],
    ['Raffle error', formatStatusValue(raffle.lastError)],
    ['Reward error', formatStatusValue(chat.rewardsLastError)],
    ['Chat error', formatStatusValue(chat.lastError)],
    ['Socket clients', formatStatusValue(sockets.clients)]
  ];

  statusDetailsEl.innerHTML = items.map(([label, value]) => (
    `<div class="status-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`
  )).join('');
}

async function refreshGreetings() {
  if (!greetingPoolSelect) return;

  try {
    const response = await fetch('/api/v1/greetings');
    const data = await response.json();
    const greetings = data.greetings || {};
    const pools = greetings.pools || [];

    greetingPoolSelect.innerHTML = pools.map(pool => (
      `<option value="${escapeHtml(pool.name)}">${escapeHtml(pool.name)} (${escapeHtml(pool.count)})</option>`
    )).join('');
    greetingPoolSelect.value = greetings.activePool || (pools[0] && pools[0].name) || '';
    greetingPoolSelect.disabled = !pools.length;
  } catch (error) {
    greetingPoolSelect.innerHTML = '<option value="">Unavailable</option>';
    greetingPoolSelect.disabled = true;
  }
}

async function refreshStatus() {
  try {
    const response = await fetch('/api/v1/status');
    const data = await response.json();
    const chatLabel = data.chat.connected ? 'Chat online' : (data.chat.enabled ? 'Chat offline' : 'Chat disabled');
    const quietMode = data.quietMode || {};
    const raffle = data.raffle || {};
    const socketCount = data.sockets.clients || 0;

    statusEl.innerHTML = [
      statusBadge(data.obs.identified ? 'OBS online' : 'OBS offline', data.obs.identified),
      statusBadge(chatLabel, data.chat.connected),
      statusBadge(quietMode.enabled ? 'Quiet mode on' : 'Quiet mode off', !quietMode.enabled),
      statusBadge(raffle.enabled ? 'Raffle on' : 'Raffle off', Boolean(raffle.enabled)),
      `<span class="status-pill">${socketCount} socket${socketCount === 1 ? '' : 's'}</span>`
    ].join('');
    renderStatusDetails(data);
    renderQueue(data.queue);
    renderRaffle(data.raffle);
  } catch (error) {
    statusEl.textContent = 'Status unavailable';
    if (statusDetailsEl) {
      statusDetailsEl.innerHTML = '<div class="status-item"><span>Status</span><strong>Unavailable</strong></div>';
    }
    renderRaffle(null);
  }
}

async function refreshQueue() {
  if (!queueStatusEl) return;

  try {
    const data = await getJson('/api/v1/queue');
    renderQueue(data.queue);
  } catch (error) {
    renderQueue(null);
  }
}

async function refreshSounds(options = {}) {
  if (!soundInputEl || !soundListEl) return;

  try {
    const endpoint = options.force ? '/api/v1/sounds?refresh=1' : '/api/v1/sounds';
    const data = await getJson(endpoint);
    const sounds = data.sounds || [];
    soundListEl.innerHTML = sounds.map(sound => (
      `<option value="${escapeHtml(sound.src)}" label="${escapeHtml(formatSoundLabel(sound))}"></option>`
    )).join('');
    soundInputEl.placeholder = sounds.length ? `Search ${sounds.length} sounds...` : 'No sounds found';
  } catch (error) {
    soundInputEl.placeholder = 'Sound browser unavailable';
    soundListEl.innerHTML = '';
  }
}

function formatSoundLabel(sound) {
  const details = [
    formatDurationMs(sound.durationMs),
    sound.directory || '',
    sound.extension ? sound.extension.toUpperCase() : ''
  ].filter(Boolean).join(' / ');
  return details ? `${sound.src} - ${details}` : sound.src;
}

function renderMacros(macros) {
  if (!macroListEl) return;

  if (!macros.length) {
    macroListEl.innerHTML = '<div class="status-item"><span>Macros</span><strong>No macros configured</strong></div>';
    return;
  }

  macroListEl.innerHTML = macros.map(macro => (
    `<button type="button" class="macro-button" data-run-macro="${escapeHtml(macro.id)}">` +
      `<strong>${escapeHtml(macro.name)}</strong>` +
      `<span>${escapeHtml(macro.description || 'Queued production macro')}</span>` +
    '</button>'
  )).join('');

  macroListEl.querySelectorAll('[data-run-macro]').forEach(button => {
    button.addEventListener('click', async () => {
      try {
        const payload = await postJson(`/api/v1/macros/${encodeURIComponent(button.dataset.runMacro)}/run`);
        writeLog(payload);
        renderQueue(payload.queue);
        refreshStatus();
      } catch (error) {
        writeLog(error.message);
      }
    });
  });
}

async function refreshMacros() {
  if (!macroListEl) return;

  try {
    const data = await getJson('/api/v1/macros');
    renderMacros(data.macros || []);
  } catch (error) {
    macroListEl.innerHTML = '<div class="status-item"><span>Macros</span><strong>Unavailable</strong></div>';
  }
}

function option(value, label) {
  return `<option value="${escapeHtml(value)}">${escapeHtml(label || value)}</option>`;
}

function setSelectOptions(select, options, placeholder) {
  if (!select) return;

  select.innerHTML = [
    option('', placeholder),
    ...options.map(item => option(item.value, item.label))
  ].join('');
  select.disabled = !options.length;
}

function getSceneSources(sceneName) {
  if (!obsDiscovery) return [];

  const scene = (obsDiscovery.scenes || []).find(item => item.name === sceneName) ||
    (obsDiscovery.scenes || []).find(item => item.name === obsDiscovery.currentScene) ||
    (obsDiscovery.scenes || [])[0];
  return scene ? (scene.sources || []) : [];
}

function refreshSourceOptions() {
  const sceneName = obsSourceSceneSelect ? obsSourceSceneSelect.value : '';
  const sources = getSceneSources(sceneName).map(source => ({
    value: source.name,
    label: source.enabled === false ? `${source.name} (hidden)` : source.name
  }));
  setSelectOptions(obsSourceSelect, sources, 'Select source');
}

function renderObsDiscovery(data) {
  obsDiscovery = data;

  const scenes = (data.scenes || []).map(scene => ({
    value: scene.name,
    label: scene.name === data.currentScene ? `${scene.name} (current)` : scene.name
  }));
  const inputs = (data.inputs || []).map(input => ({
    value: input.name,
    label: `${input.name} (${input.kind})`
  }));
  const mediaInputs = (data.mediaInputs || []).map(input => ({
    value: input.name,
    label: `${input.name} (${input.kind})`
  }));

  setSelectOptions(obsSceneSelect, scenes, 'Select scene');
  setSelectOptions(obsSourceSceneSelect, scenes, 'Current scene');
  setSelectOptions(obsInputSelect, inputs, 'Select input');
  setSelectOptions(obsMediaInputSelect, mediaInputs, 'Select media input');

  if (obsSceneSelect && data.currentScene) obsSceneSelect.value = data.currentScene;
  if (obsSourceSceneSelect && data.currentScene) obsSourceSceneSelect.value = data.currentScene;
  refreshSourceOptions();
}

function disableObsDiscovery() {
  [obsSceneSelect, obsSourceSceneSelect, obsSourceSelect, obsInputSelect, obsMediaInputSelect].forEach(select => {
    if (!select) return;
    select.innerHTML = option('', 'OBS unavailable');
    select.disabled = true;
  });
}

async function refreshObsDiscovery() {
  if (!obsSceneSelect) return;

  try {
    const data = await getJson('/api/v1/obs/discovery');
    renderObsDiscovery(data.obs || {});
  } catch (error) {
    disableObsDiscovery();
  }
}

document.querySelectorAll('[data-json-form]').forEach(form => {
  form.addEventListener('submit', async event => {
    event.preventDefault();
    try {
      const payload = await postJson(form.dataset.endpoint, formDataToJson(form));
      writeLog(payload);
      refreshStatus();
    } catch (error) {
      writeLog(error.message);
    }
  });
});

document.querySelectorAll('[data-post]').forEach(button => {
  button.addEventListener('click', async () => {
    try {
      const payload = await postJson(button.dataset.post);
      writeLog(payload);
      if (payload.queue) renderQueue(payload.queue);
      refreshStatus();
    } catch (error) {
      writeLog(error.message);
    }
  });
});

document.querySelectorAll('[data-refresh-status]').forEach(button => {
  button.addEventListener('click', refreshStatus);
});

document.querySelectorAll('[data-refresh-macros]').forEach(button => {
  button.addEventListener('click', refreshMacros);
});

document.querySelectorAll('[data-refresh-sounds]').forEach(button => {
  button.addEventListener('click', () => refreshSounds({ force: true }));
});

document.querySelectorAll('[data-refresh-obs]').forEach(button => {
  button.addEventListener('click', refreshObsDiscovery);
});

document.querySelectorAll('[data-enqueue-actions]').forEach(button => {
  button.addEventListener('click', async () => {
    const form = button.closest('form');
    try {
      const payload = await postJson('/api/v1/actions/enqueue', {
        name: 'Action Runner',
        actions: formDataToJson(form)
      });
      writeLog(payload);
      renderQueue(payload.queue);
      refreshStatus();
    } catch (error) {
      writeLog(error.message);
    }
  });
});

if (obsSourceSceneSelect) {
  obsSourceSceneSelect.addEventListener('change', refreshSourceOptions);
}

if (greetingPoolForm) {
  greetingPoolForm.addEventListener('submit', async event => {
    event.preventDefault();
    try {
      const payload = await postJson('/api/v1/greetings/pool', formDataToJson(greetingPoolForm));
      writeLog(payload);
      refreshGreetings();
      refreshStatus();
    } catch (error) {
      writeLog(error.message);
    }
  });
}

document.querySelectorAll('[data-clear-log]').forEach(button => {
  button.addEventListener('click', () => {
    log.textContent = '';
  });
});

socket.on('connect', refreshStatus);
socket.on('disconnect', refreshStatus);

refreshStatus();
refreshGreetings();
refreshMacros();
refreshQueue();
refreshSounds();
refreshObsDiscovery();
setInterval(refreshStatus, 5000);
