const SHOW_DELAY = 200;
const VISIBLE_DURATION = 4000;

let textAlertTimeout = null;
let textAlertFadeTimeout = null;
const header = document.querySelector('#text-alert-header-content h1');
const left = document.querySelector('#text-alert-bg .left');
const right = document.querySelector('#text-alert-bg .right');
const raffleWrapper = document.querySelector('#raffle-wrapper');
const raffleTitle = raffleWrapper?.querySelector('.raffle-title');
const rafflePrefix = raffleWrapper?.querySelector('[data-raffle-prefix]');
const raffleCommand = raffleWrapper?.querySelector('[data-raffle-command]');
const raffleSuffix = raffleWrapper?.querySelector('[data-raffle-suffix]');
const raffleSubtitle = raffleWrapper?.querySelector('.raffle-subtitle');
const raffleSignalBars = raffleWrapper?.querySelector('.signal-bars');
let raffleTimeout = null;

const sanitize = t => (t || '').replace(/'/gi, '');
const setText = t => { if (header && header.textContent !== t) header.textContent = t; };

/**
 * Shows an overlay alert when the required elements exist, replacing pending animation timers from an earlier alert.
 *
 * @param {string} text Alert content; apostrophes are removed before the heading is updated.
 */
function showAlert(text) {
  if (!header || !left || !right) return;
  const sanitized = sanitize(text);
  clearTimeout(textAlertTimeout);
  clearTimeout(textAlertFadeTimeout);

  left.classList.add('slide');
  right.classList.add('slide');
  header.classList.remove('fade');
  setText(sanitized);

  textAlertFadeTimeout = setTimeout(() => {
    header.classList.add('fade');
    textAlertTimeout = setTimeout(() => {
      header.classList.remove('fade');
      left.classList.remove('slide');
      right.classList.remove('slide');
    }, VISIBLE_DURATION);
  }, SHOW_DELAY);
}

socket.on('text-alert', ({ message }) => showAlert(message));

if (raffleSignalBars) {
  for (let index = 0; index < 34; index += 1) {
    const bar = document.createElement('div');
    bar.className = 'signal-bar';
    bar.style.height = `${5 + Math.random() * 13}px`;
    bar.style.animationDelay = `${Math.random() * 600}ms`;
    bar.style.animationDuration = `${450 + Math.random() * 500}ms`;
    raffleSignalBars.appendChild(bar);
  }
}

function showRaffleAlert({
  title = 'RAFFLE ACTIVE',
  prefix = 'TYPE',
  command = '!RAFFLE',
  suffix = 'IN CHAT TO ENTER',
  subtitle = 'ONE ENTRY PER VIEWER • WINNER SELECTED LIVE',
  durationMs = 7000
} = {}) {
  if (!raffleWrapper) return;

  clearTimeout(raffleTimeout);
  raffleTitle.textContent = title;
  rafflePrefix.textContent = prefix;
  raffleCommand.textContent = command;
  raffleSuffix.textContent = suffix;
  raffleSubtitle.textContent = subtitle;

  raffleWrapper.classList.remove('active', 'exit');
  void raffleWrapper.offsetWidth;
  raffleWrapper.classList.add('active');
  raffleWrapper.setAttribute('aria-hidden', 'false');

  raffleTimeout = setTimeout(() => {
    raffleWrapper.classList.remove('active');
    raffleWrapper.classList.add('exit');
    raffleWrapper.setAttribute('aria-hidden', 'true');
  }, Math.max(Number(durationMs) || 0, 1000));
}

socket.on('raffle-alert', showRaffleAlert);
