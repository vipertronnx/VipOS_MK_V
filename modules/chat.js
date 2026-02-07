var io;

const chatTest = function() {
  console.log(io);
  console.log('chatTest called');
}

// Chat Client init
const chatInit = async function() {
  console.log('chat service initialized')
}

chatInit();

module.exports = function(socket) {
  io = socket;
  return { chatTest }
}