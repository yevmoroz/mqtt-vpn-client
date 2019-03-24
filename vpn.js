const fetch = require('node-fetch');
const childProcess = require('child_process');
const mqtt = require('async-mqtt');

const client = mqtt.connect('mqtt://user:password@host');
const basePath = 'http://host:8123/api';
const NONE_OPTION = 'None';
const RECONNECT_ATTEMPTS = 3;
const favoriteLocations = [
  'Netherlands - The Hague',
  'UK - Docklands',
  'USA - New Jersey - 3',
  'USA - New Jersey - 2',
  'USA - Washington DC - 2',
  'Australia - Sydney - 3',
  'Canada - Toronto - 2'
];

/**
 * Global state to store things.
 */
var state = {
  status: loadStatus(),
  locations: loadLocations(),
  connecting: false
};

/**
 * Selector for status.
 */
function getStatus() {
  return state.status;
}

/**
 * Selector for status.
 */
function getLocations() {
  return state.locations;
}

/**
 * Selector for connecting.
 */
function getConnecting() {
  return state.connecting;
}

/**
 * Selector for location, given the current from status.
 */
function getLocation() {
  return findLocation(getStatus());
}

/**
 * Return valid location for a given query.
 */
function findLocation(query) {
  const location = getLocations().find(item => query === item);
  if (!location) {
    return NONE_OPTION;
  }
  return location;
}

/**
 * Connect To MQTT.
 */
client.on('connect', async () => {
  console.log('Connected to MQTT.');

  await publishStatus();
  await publishList();
  await publishLocation();

  // watch every second for status change
  setInterval(async () => {
    publishWhenChanged();
  }, 1000);

  await client.subscribe('vpn/location');
  console.log('Subscribed to vpn/location.');
});

/**
 * MQTT message arrives.
 */
client.on('message', async (topic, messageBuffer) => {
  if (topic === 'vpn/location') {
    const message = messageBuffer.toString();
    const location = findLocation(message);
    if (!location) {
      return console.warn('Unknown location:', message);
    }
    if (location === getLocation()) {
      return console.warn('Location is already:', location);
    }
    state.connecting = true;
    if (location !== NONE_OPTION) {
      await publishStatus('Connecting...');
    }
    // disconnect first
    console.log('Disconnecting');
    disconnect();
    if (location !== NONE_OPTION) {
      let retryCount = 0;
      while (retryCount < RECONNECT_ATTEMPTS) {
        console.log(retryCount > 0 ? 'Reconnecting to:' : 'Connecting to:', location);
        connect(location);
        // check if we are actually connected
        if (loadStatus() === location) {
          console.log('Connected to:', location);
          retryCount = RECONNECT_ATTEMPTS;
        } else {
          console.warn('Cannot connect to:', location);
          retryCount++;
        }
      }
    }
    state.connecting = false;
  }
});

/**
 * Send MQTT message about new status.
 */
async function publishStatus(status = getStatus()) {
  await client.publish('vpn/status', status);
}

/**
 * Publish location if it has changed.
 * 
 * @param {*} force 
 */
async function publishWhenChanged() {
  const status = loadStatus();
  if (getStatus() !== status) {
    state.status = status;
    if (!getConnecting()) {
      await publishLocation();
    }
    await publishStatus();
  }
}

/**
 * Send REST API POST message to update list of servers
 */
async function publishLocation(option = getLocation()) {
  const body = {
      entity_id: 'input_select.vpn_location',
      option
  };
  await callApi('/services/input_select/select_option', body);
}

/**
 * Send REST API POST message to update list of servers
 * 
 * @param {*} code 
 */
async function publishList() {
  const body = {
      entity_id: 'input_select.vpn_location',
      options: [
        NONE_OPTION,
        ...getLocations()
      ]
  };
  await callApi('/services/input_select/set_options', body);
}

/**
 * Helper function to publish.
 * 
 * @param {*} path 
 * @param {*} body 
 */
async function callApi(path, body) {
  await fetch(basePath + path, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 
      'Content-Type': 'application/json'
    },
  });
}

/**
 * Get status by executing respective shell command.
 */
function loadStatus() {
  const status = childProcess.execSync('expressvpn status').toString();
  const notConnected = status.includes('Not connected');
  const connecting = status.includes('Connecting');
  const connected = status.match(/Connected\sto\s(.*)/);
  if (notConnected) {
    return 'Not connected';
  } else if (connecting) {
    return 'Connecting...';
  } else if (connected && connected[1]) {
    return connected[1];
  }
}

/**
 * Get list of all locations.
 */
function loadLocations() {
  const rawListString = childProcess.execSync('expressvpn list all').toString();
  const rawList = rawListString.split(/\n/);
  // remove first 3 lines as they are just description
  const list = rawList.slice(3, rawList.length)
      .map(source => {
          // targeting words starting with 2 \t
          let line = source.match(/[\t]{2,}(.*)/);
          if (!line) {
              // if nothing found - words starting with \t and ending with 2 \t
              line = source.match(/[\t]{1,}(.*)[\t]{2,}/);
          }
          if (!line) {
              // if nothing found - words starting with \t only
              line = source.match(/[\t]{1,}(.*)/);
          }
          // take first found match, fallback to empty string
          line = line ? line[1] : '';
          const secondTabIndex = line.indexOf('\t');
          let location = line;
          if (secondTabIndex != -1) {
              // trim from the right all the rest taht begins with \t
              location = line.slice(0, secondTabIndex);
          }
          return {
              location,
              source
          }
      })
      .filter(item => item.location)
  const listOfFailed = list.filter(item => !item.location);
  if (listOfFailed.length) {
    console.warn('Cannot parse following locations.', listOfFailed);
  }
  return [
    // put favorite location first
    ...favoriteLocations,
    // but exclude them from list of found
    ...list.map(item => item.location)
      .filter(item => !favoriteLocations.includes(item))
  ];
}

/**
 * Helper function to connect.
 * 
 * @param {*} string 
 */
function connect(string) {
  childProcess.execSync(`expressvpn connect "${string}"`);
}

/**
 * Helper function to disconnect.
 */
function disconnect() {
  try {
    childProcess.execSync('expressvpn disconnect');
  } catch (e) {
    // allowed to fail
  }
}