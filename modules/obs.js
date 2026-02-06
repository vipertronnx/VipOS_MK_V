const { default: OBSWebSocket } = require('obs-websocket-js');
const obs = new OBSWebSocket();

// Retry interval for OBS connection attempts (in milliseconds)
const obsRetryInterval = process.env.OBS_RECONNECT_RETRY_INTERVAL || 5000;

// Function to connect to OBS with retry logic
function obsConnect() {
  obs.connect(process.env.OBS_ADDRESS, process.env.OBS_PASSWORD).then((info) => {
    console.log('Connected and identified', info)
  }, () => {
    console.error('Error Connecting, will attempt to reconnect in', obsRetryInterval / 1000, 'seconds...')
    setTimeout(obsConnect, obsRetryInterval);
  });
}

// Initialize OBS connection and set up event listeners
const obsInit = async function() {
  // Declare some events to listen for.
  obs.on('ConnectionOpened', () => {
    console.log('Connection Opened');
  });

  obs.on('Identified', () => {
    console.log('Identified, good to go!')
    // Get Scene List on successful connection example
    // obs.call('GetSceneList').then((data) => {
    //   console.log('Scenes:', data);
    // });
  });

  // Example of listening to a specific event.
  obs.on('CurrentProgramSceneChanged', data => {
    console.log(`Scene Changed to: ${data.sceneName}`);
  });

  obsConnect();
}

// Start the OBS connection process
obsInit();

// Export the obs instance for use in other modules
module.exports = {
  obs: obs
}