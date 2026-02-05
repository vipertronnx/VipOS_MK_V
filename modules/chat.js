let io;

// Chat Client init
const chatInit = async function() {
  console.log('chat service initialized')
}

chatInit();

module.exports = function(importIO) {
  io = importIO;
}