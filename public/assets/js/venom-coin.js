var coin = document.getElementById('venom-coin');

coin.play();
coin.addEventListener('ended',coinHandler,false);
coin.timeout = 25000;

function coinHandler(e) {
  setTimeout(function(){
    coin.play();
  }, e.currentTarget.timeout);
}