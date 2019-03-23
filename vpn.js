const mqtt = require('mqtt');
const childProcess = require('child_process');
const client  = mqtt.connect('mqtt://user:pass@host');

var vpnStatus = getStatus();

client.on('connect', function () {
  publishStatus(vpnStatus);
  client.subscribe('vpn/connect', function (err) {
    startWatching();
  })
})

client.on('message', function (topic, message) {
  if (topic === 'vpn/connect') {
    const serverToConnect = message.toString();
    publishStatus('Disconnecting...');
    try {
      childProcess.execSync('expressvpn disconnect');
    } catch (e) {
      // allowed to fail
    }
    publishStatus('Connecting...');
    childProcess.execSync('expressvpn connect ' + serverToConnect);
  }
})

function startWatching() {
  setInterval(() => {
    const newStatus = getStatus();
    if (vpnStatus !== newStatus) {
      vpnStatus = newStatus;
      publishStatus(newStatus);
    }
  }, 300);
}

function publishStatus(status) {
  client.publish('vpn/status', status);
}

function getStatus() {
  const status = childProcess.execSync('expressvpn status').toString();
  const notConnected = status.includes('Not connected');
  const connected = status.match(/Connected\sto\s(.*)/);
  if (notConnected) {
    return 'Not connected';
  } else if (connected && connected[1]) {
    return connected[1];
  }
}