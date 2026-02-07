var bgAlertTimeout;
var animatedBG = document.querySelector('#animated-bg');

socket.on('bg-alert', function () {
  if(!animatedBG.classList.contains('alert')) {
    animatedBG.classList.toggle('alert');
    bgAlertTimeout = setTimeout(() => {
      animatedBG.classList.toggle('alert');
    }, "3000");
  } else {
    clearTimeout( bgAlertTimeout );
    textAlertTimeout = setTimeout(() => {
      animatedBG.classList.toggle('alert');
    }, "3000");
  }
});

socket.on('bg-random', function() {
  var num = getRandomInt(1,6)
  while(true) {
    if(!animatedBG.classList.contains('random'+num)) {
      break;
    } else {
      num = getRandomInt(1,6);
    }
  }
  animatedBG.classList.remove("random1", "random2", "random3", "random4", "random5", "random6");
  animatedBG.classList.add("random"+num);
});

function getRandomInt(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min) + min); // The maximum is exclusive and the minimum is inclusive
}