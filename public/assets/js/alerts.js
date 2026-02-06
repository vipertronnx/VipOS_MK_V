var textAlertTimeout;

socket.on('text-alert', function (message) {
  var text = message.message;
  var header = document.querySelector('#text-alert-header-content h1');

  header.innerHTML = text.replace(/'/gi,"").replace(/ /gi,"&nbsp;&nbsp;");

  if(!header.classList.contains('fade')) {

    document.querySelector('.left').classList.toggle('slide');
    document.querySelector('.right').classList.toggle('slide');

    setTimeout(() => {
      header.innerHTML = text.replace(/'/gi,"");

      header.classList.toggle('fade');
      textAlertTimeout = setTimeout(() => {
        header.classList.toggle('fade');
        document.querySelector('.left').classList.toggle('slide');
        document.querySelector('.right').classList.toggle('slide');
      }, "3000");

    }, "200");


  } else {
    clearTimeout( textAlertTimeout );

    header.innerHTML = text.replace(/'/gi,"").replace(/ /gi,"&nbsp;&nbsp;");

    textAlertTimeout = setTimeout(() => {
      header.classList.toggle('fade');
      document.querySelector('.left').classList.toggle('slide');
      document.querySelector('.right').classList.toggle('slide');
    }, "3000");
  }
});