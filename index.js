var spawn = require('child_process').spawn
  , EventEmitter = require('events').EventEmitter
  , inherits = require('util').inherits

function AudioReader(options) {
  options = options || []
  this.inStream = options.inStream || null
  if (this.inStream) {
    this.inStream.on('data', this.parse.bind(this))
    this.inStream.on('close', this.emit.bind(this, 'end'))
  }
  this.ready = false
  this.header = new Buffer(0)
}
inherits(AudioReader, EventEmitter)
exports.AudioReader = AudioReader

AudioReader.prototype.parse = function(chunk) {
  var self = this

  if (this.ready) {
    // works because we assume 8bit audio, TODO: make it work with moar
    this.emit('data', chunk)
  } else {
    var oldheader = this.header
    this.header = new Buffer(oldheader.length + chunk.length)
    oldheader.copy(this.header)
    chunk.copy(this.header, oldheader.length)
    if (this.header.length >= 44) {
      var firstData = this.header.slice(44)
      this.header = this.header.slice(0, 44)

      function assertHeaderBytes(index, value) {
        for (var i=0; i<value.length; i++) {
          if (value[i] !== self.header[index+i]) {
            self.emit('error', 'header bytes assertion failed')
          }
        }
      }

      assertHeaderBytes(0, new Buffer('RIFF'))
      // ignore size
      assertHeaderBytes(8, new Buffer('WAVE'))
      assertHeaderBytes(12, new Buffer('fmt '))
      assertHeaderBytes(16, [16, 0, 0, 0]) // TODO just assumes a certain header size
      // ignore format
      // ignore channel count
      // ignore sample rate
      // ignore needed bandwidth
      assertHeaderBytes(32, [1, 0]) // TODO assumes one byte per block
      // ignore sample rate
      assertHeaderBytes(36, new Buffer('data'))
      // ignore data block length

      this.ready = true
      this.emit('ready', this.header)
      if (firstData.length > 0) {
        this.emit('data', firstData)
      }
    }
  }
}

function AudioLeecher(options) {
  var self = this

  this.audioReader = options.audioReader
  if (this.audioReader == null) throw new Error('audioReader required')
  this.socket = options.socket
  if (this.socket == null) throw new Error('socket required')

  function ondata(chunk) {
    self.socket.write(chunk)
    if (self.socket.bufferSize > 100000) {
      console.log('kicked a client with 100kB sendq')
      self.socket.destroy()
    }
  }
  function shutdown() {
    self.audioReader.removeListener('data', ondata)
    self.audioReader.removeListener('end', shutdown)
    self.socket.destroy()
  }
  this.audioReader.on('data', ondata)
  this.audioReader.on('end', shutdown)
  this.socket.on('close', shutdown)

  this.socket.write(this.audioReader.header)
}
exports.AudioLeecher = AudioLeecher
