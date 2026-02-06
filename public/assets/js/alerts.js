const SHOW_DELAY = 200;
const VISIBLE_DURATION = 3000;

let textAlertTimeout = null;
const header = document.querySelector('#text-alert-header-content h1');
const left = document.querySelector('#text-alert-bg .left');
const right = document.querySelector('#text-alert-bg .right');

const sanitize = t => (t || '').replace(/'/gi, '');
const setText = t => { if (header && header.innerHTML !== t) header.innerHTML = t; };

function showAlert(text) {
  if (!header || !left || !right) return;
  const sanitized = sanitize(text);
  clearTimeout(textAlertTimeout);

  left.classList.add('slide');
  right.classList.add('slide');
  setText(sanitized);

  textAlertTimeout = setTimeout(() => {
    header.classList.add('fade');
    textAlertTimeout = setTimeout(() => {
      header.classList.remove('fade');
      left.classList.remove('slide');
      right.classList.remove('slide');
    }, VISIBLE_DURATION);
  }, SHOW_DELAY);
}

socket.on('text-alert', ({ message }) => showAlert(message));