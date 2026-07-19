const SHOW_DELAY = 200;
const VISIBLE_DURATION = 4000;

let textAlertTimeout = null;
let textAlertFadeTimeout = null;
const header = document.querySelector('#text-alert-header-content h1');
const left = document.querySelector('#text-alert-bg .left');
const right = document.querySelector('#text-alert-bg .right');

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
