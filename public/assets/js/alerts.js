var textAlertTimeout;
var header = document.querySelector('#text-alert-header-content h1');
var left = document.querySelector('#text-alert-bg .left');
var right = document.querySelector('#text-alert-bg .right');

socket.on('text-alert', function (message) {
  var text = message.message;

  header.innerHTML = text.replace(/'/gi,"");

  if(!header.classList.contains('fade')) {

    left.classList.toggle('slide');
    right.classList.toggle('slide');

    setTimeout(() => {
      header.innerHTML = text.replace(/'/gi,"");

      header.classList.toggle('fade');
      textAlertTimeout = setTimeout(() => {
        header.classList.toggle('fade');
        left.classList.toggle('slide');
        right.classList.toggle('slide');
      }, "3000");

    }, "200");


  } else {
    clearTimeout( textAlertTimeout );

    header.innerHTML = text.replace(/'/gi,"");

    textAlertTimeout = setTimeout(() => {
      header.classList.toggle('fade');
      left.classList.toggle('slide');
      right.classList.toggle('slide');
    }, "3000");
  }
});