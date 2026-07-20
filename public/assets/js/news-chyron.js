(() => {
  const config = window.VIPOS_CHYRON;
  if (!config || !Array.isArray(config.items)) return;

  const target = document.getElementById('chyron');
  const title = document.getElementById('chyron-title-text');
  const headline = document.getElementById('chyron-headline-text');
  const subhead = document.getElementById('chyron-subhead-text');
  const chyronText = document.getElementById('chyron-text');
  const socket = window.VIPOS_SOCKET;
  const fadeDurationMs = 500;
  const items = config.items.filter(isChyronItem);
  const rotateIntervalMs = Number(config.rotateIntervalMs) || 0;
  let currentIndex = Number.isInteger(config.initialIndex) ? config.initialIndex : 0;
  let rotationTimeout = null;
  let transitionTimeout = null;
  let transitionVersion = 0;

  if (!target || !title || !headline || !subhead || !chyronText || !items.length) return;
  currentIndex = Math.min(Math.max(currentIndex, 0), items.length - 1);

  function isChyronItem(item) {
    return item && typeof item.h1 === 'string' && typeof item.h2 === 'string' && typeof item.h3 === 'string';
  }

  function getNextIndex() {
    if (items.length < 2) return currentIndex;
    let nextIndex = Math.floor(Math.random() * items.length);
    if (nextIndex === currentIndex) nextIndex = (currentIndex + 1) % items.length;
    return nextIndex;
  }

  function renderItem(item) {
    title.textContent = item.h3;
    headline.textContent = item.h1;
    subhead.textContent = item.h2;
  }

  function transitionToItem(item) {
    window.clearTimeout(transitionTimeout);
    const version = ++transitionVersion;
    chyronText.classList.add('is-fading');

    transitionTimeout = window.setTimeout(() => {
      if (version !== transitionVersion) return;
      renderItem(item);
      window.requestAnimationFrame(() => {
        if (version === transitionVersion) chyronText.classList.remove('is-fading');
      });
    }, fadeDurationMs);
  }

  function scheduleRotation() {
    window.clearTimeout(rotationTimeout);
    if (rotateIntervalMs <= 0) return;

    rotationTimeout = window.setTimeout(() => {
      currentIndex = getNextIndex();
      transitionToItem(items[currentIndex]);
      scheduleRotation();
    }, rotateIntervalMs);
  }

  function showAlert(item) {
    if (!isChyronItem(item)) return;
    transitionToItem(item);
    scheduleRotation();
  }

  if (socket) socket.on('chyron-alert', showAlert);
  scheduleRotation();
})();
