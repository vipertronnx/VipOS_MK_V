// Connect to OBS
const { default: OBSWebSocket } = require('obs-websocket-js');
const obs = new OBSWebSocket();

// Declare some events to listen for.
obs.on('ConnectionOpened', () => {
  console.log('Connection Opened');
});

obs.on('Identified', () => {
	console.log('Identified, good to go!')

  // Send some requests.
  obs.call('GetSceneList').then((data) => {
    // console.log('Scenes:', data);
  });
});

obs.on('CurrentProgramSceneChanged', onCurrentSceneChanged);

// obs.once('ExitStarted', () => {
//   console.log('OBS started shutdown');

//   // Just for example, not necessary should you want to reuse this instance by re-connect()
//   obs.off('CurrentSceneChanged', onCurrentSceneChanged);
// });

obs.on('SwitchScenes', data => {
  console.log('SwitchScenes', data);
});

obs.connect(process.env.OBS_ADDRESS, process.env.OBS_PASSWORD).then((info) => {
	console.log('Connected and identified', info)
}, () => {
	console.error('Error Connecting')
});

function onCurrentSceneChanged(event) {
  console.log('Current scene changed to', event.sceneName)
}