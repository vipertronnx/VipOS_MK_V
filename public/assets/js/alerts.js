var textAlertTimeout;

socket.on('text-alert', function (message) {
  var text = message.message;

  document.querySelector('h1').innerHTML = text.replace(/'/gi,"").replace(/ /gi,"&nbsp;&nbsp;");

  // if(!document.querySelector('h1').classList.contains('fade')) {

  //   document.querySelector('.left').classList.toggle('slide');
  //   document.querySelector('.right').classList.toggle('slide');

  //   setTimeout(() => {
  //     document.querySelector('h1').innerHTML = text.replace(/'/gi,"").replace(/ /gi,"&nbsp;&nbsp;");

  //     document.querySelector('h1').classList.toggle('fade');
  //     textAlertTimeout = setTimeout(() => {
  //       document.querySelector('h1').classList.toggle('fade');
  //       document.querySelector('.left').classList.toggle('slide');
  //       document.querySelector('.right').classList.toggle('slide');
  //     }, "3000");

  //   }, "200");


  // } else {
  //   clearTimeout( textAlertTimeout );

  //   document.querySelector('h1').innerHTML = text.replace(/'/gi,"").replace(/ /gi,"&nbsp;&nbsp;");

  //   textAlertTimeout = setTimeout(() => {
  //     document.querySelector('h1').classList.toggle('fade');
  //     document.querySelector('.left').classList.toggle('slide');
  //     document.querySelector('.right').classList.toggle('slide');
  //   }, "3000");
  // }
});