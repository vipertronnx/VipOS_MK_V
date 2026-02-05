const { default: OBSWebSocket } = require('obs-websocket-js');
const obs = new OBSWebSocket();

const obsInit = async function() {

  // Declare some events to listen for.
  obs.on('ConnectionOpened', () => {
    console.log('Connection Opened');
  });

  obs.on('Identified', () => {
    console.log('Identified, good to go!')
    // Send some requests.
    // obs.call('GetSceneList').then((data) => {
    //   console.log('Scenes:', data);
    // });
  });

  obs.connect(process.env.OBS_ADDRESS, process.env.OBS_PASSWORD).then((info) => {
    console.log('Connected and identified', info)
  }, () => {
    console.error('Error Connecting')
  });

}

obsInit();

module.exports = {
  obs: obs
}