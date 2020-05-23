#!/usr/bin/nodejs
// Dahua HTTP API Module
var events    = require('events');

const NetKeepAlive = require('net-keepalive')
const rp = require('request-promise');
const request = require('request');
const debug = require('debug')('http')

class DahuaCam extends events.EventEmitter {
  constructor(options) {
    super();
    
    this.username = options.username;
    this.password = options.password;

    this.baseUri = `http://${options.hostname}:${options.port || 80}`;
  };

  // set up persistent connection to receive alarm events from camera
  listenForEvents(eventNames) {
    eventNames = eventNames || [
      'VideoMotion', 
      'VideoLoss', 
      'VideoBlind', 
      'AlarmLocal', 
      'CrossLineDetection',
      'CrossRegionDetection', 
      'LeftDetection', 
      'TakenAwayDetection', 
      'VideoAbnormalDetection', 
      'FaceDetection', 
      'AudioMutation', 
      'AudioAnomaly', 
      'VideoUnFocus',
      'WanderDetection',
      'RioterDetection' ];

    let client = request({ 
      url : `${this.baseUri}/cgi-bin/eventManager.cgi?action=attach&codes=[${eventNames.join(",")}]`,
      forever : true,
      headers: {'Accept':'multipart/x-mixed-replace'},
      auth: {
        user: this.username,
        password: this.password,
        sendImmediately: false
      }
    });

    client.on('socket', (socket) => {
      NetKeepAlive.setKeepAliveInterval(socket, 1000);
      NetKeepAlive.setKeepAliveProbes(socket, 1);      
    });

    client.on('response', () => {
      debug(`Connected to ${this.baseUri}`);
      this.emit("connect")
    });
    client.on('error', err => this.emit("error", err));
    client.on('data', this.handleDahuaEventData.bind(this));
    client.on('close', () => {   // Try to reconnect after 30s
      () => setTimeout(() => this.listenForEvents(eventNames), 30000);
      this.emit("end");
    });
  };

  _req(path) {
    return rp({
      uri: `${this.baseUri}/cgi-bin/${path}`,
      auth: {
        user: this.username,
        password: this.password,
        sendImmediately: false
      }
    });
  }

  name() {
    return this._req('magicBox.cgi?action=getMachineName').then(d => d.split('=')[1]);
  }

  snapshot(channel) {
    return new Promise((resolve, reject) => {
      let chunks = [];
      request({'uri' : this.baseUri + '/cgi-bin/snapshot.cgi?' + channel})
      .auth(this.camUser, this.camPass, false)
      .on('data', chunk => chunks.push(chunk))
      .on('end', () => resolve(Buffer.concat(chunks)))
      .on('error', reject)
    })
  }

  handleDahuaEventData(data) {
    data.toString()
      .split('\r\n')
      .filter(s => s.startsWith('Code=')) //Code=VideoMotion;action=Start;index=0
      .map(s => s.split(';'))
      .forEach(segments => {
        let [code, action, index] = segments.map(s => s.split('=')[1]);
        this.emit("alarm", code, action, index);
      })
  }
}

class KeepAliveAgent extends require('http').Agent {
  constructor() {
      super({
          keepAlive: true
      })
  }

  createSocket(req, options, cb) {
      super.createSocket(req, options, (err, socket) => {
      
          if(!err) {
              socket.on('connect', () => {
                  NetKeepAlive.setKeepAliveInterval(socket, 1000);
                  NetKeepAlive.setKeepAliveProbes(socket, 1);
              });
          }

          cb(err, socket);
      });
  }
}

exports.DahuaCam = DahuaCam;