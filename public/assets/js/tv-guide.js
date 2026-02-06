var currentInterval = 0;

// Get the element
var elem = document.querySelector('#tv-guide-body');

// Create a copy of it
var clone = elem.cloneNode(true);

// Remove the ID and add a class
clone.removeAttribute('id');
clone.classList.add('scroll-copy');

// Inject it into the DOM
elem.after(clone);

function renderCurrentTime(){
  var date = new Date();
  var day = date.toLocaleString('en-US', { hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: true })
  var currentTime = document.getElementById('current-time');
  currentTime.innerHTML = day.replace("AM","").replace("PM","");
  if((date.getMinutes() == 0 || date.getMinutes() == 30) && date.getSeconds() == 0 ) { renderFutureTimeSlots(); }
  setTimeout(renderCurrentTime,1000);
}

function renderFutureTimeSlots() {
  var intervals = [0,30,60,90];

  for(i=0;i<4;i++) {
    var now = new Date();
    if(now.getMinutes() == 0 || now.getMinutes() == 30) {
      now.setMinutes(now.getMinutes()+1);
    }

    var slotID = i+1;
    var slotHeader = document.getElementById('slot-'+slotID);

    now.setMinutes(now.getMinutes() + intervals[i]);
    var nextInterval = Math.ceil(now.getMinutes() / 30) * 30;

    if(nextInterval == 30) {
      now.setMinutes(30);
    } else if (nextInterval == 60) {
      now.setMinutes(0);
      now.setHours(now.getHours()+1);
    }

    slotHeader.innerHTML = now.toLocaleString('en-US', { hour: 'numeric', minute: 'numeric', hour12: true });
  }
}

renderCurrentTime();
renderFutureTimeSlots();