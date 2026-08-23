const currentTime = document.getElementById('current-time');
const currentTimeFormatter = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
  hour12: true
});
const slotTimeFormatter = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: 'numeric',
  hour12: true
});
const slotHeaders = Array.from({ length: 4 }, (_, index) => (
  document.getElementById(`slot-${index + 1}`)
));
const elem = document.querySelector('#tv-guide-body');
let currentSlotBucket = '';

// Duplicate the guide rows to make the scrolling loop continuous.
const clone = elem.cloneNode(true);
clone.removeAttribute('id');
clone.classList.add('scroll-copy');
elem.after(clone);

function setText(element, value) {
  if (element && element.textContent !== value) element.textContent = value;
}

function syncScrollDistance() {
  const scrollDistance = elem.getBoundingClientRect().height;
  document.documentElement.style.setProperty('--tv-guide-scroll-distance', `-${scrollDistance}px`);
}

function getSlotBucket(date) {
  return [
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    date.getHours(),
    Math.floor(date.getMinutes() / 30)
  ].join('-');
}

function renderCurrentTime() {
  const now = new Date();
  const formattedTime = currentTimeFormatter.format(now).replace(/\s?(AM|PM)$/, '');
  setText(currentTime, formattedTime);

  const slotBucket = getSlotBucket(now);
  if (slotBucket !== currentSlotBucket) {
    currentSlotBucket = slotBucket;
    renderFutureTimeSlots(now);
  }

  setTimeout(renderCurrentTime, 1000);
}

function renderFutureTimeSlots(date = new Date()) {
  const nextSlot = new Date(date);
  nextSlot.setSeconds(0, 0);
  nextSlot.setMinutes(Math.ceil((nextSlot.getMinutes() + 1) / 30) * 30);

  slotHeaders.forEach((slotHeader, index) => {
    const slotTime = new Date(nextSlot);
    slotTime.setMinutes(nextSlot.getMinutes() + (index * 30));
    setText(slotHeader, slotTimeFormatter.format(slotTime));
  });
}

syncScrollDistance();
window.addEventListener('resize', syncScrollDistance);
renderCurrentTime();
