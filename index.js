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

function AudioMixer(firstReader) {
  var self = this
  
  this.readers = []
  this.queues = []
  this.ready = false
  this.header = null
  
  this.addReader(firstReader)
}
inherits(AudioMixer, EventEmitter)
exports.AudioMixer = AudioMixer

AudioMixer.prototype.addReader = function(reader) {
  if (reader.ready) return this._addReader(reader)
  
  var self = this
  
  reader.on('ready', onReady)
  reader.on('end', onReadyOrEnd)
  
  function onReadyOrEnd() {
    reader.removeListener('ready', onReady)
    reader.removeListener('end', onReadyOrEnd)
  }
  
  function onReady() {
    self._addReader(reader)
    onReadyOrEnd()
  }
}

AudioMixer.prototype._addReader = function(reader) {
  var self = this
  
  if (!this.ready) {
    this.ready = true
    this.header = reader.header
  }

  if (this.readers.indexOf(reader) !== -1) {
    throw new Error('duplicate reader in the mixer')
  }
  this.readers.push(reader)
  var ownQueue = []
  this.queues.push(ownQueue)
  console.log('addReader (ready now), '+this.readers.length+' readers in the mixer now')
  
  reader.on('end', function() {
    self.readers.splice(self.readers.indexOf(reader), 1)
    self.queues.splice(self.queues.indexOf(ownQueue), 1)
  })
  
  //var __i__ = 0
  
  reader.on('data', function(chunk) {
    ownQueue.push(chunk)
    var queueLengths = self.queues.map(function(queue) {
      return queue.map(function(chunk) {
        return chunk.length
      }).reduce(function(sum, value) {
        return sum + value
      }, 0)
    })
    /*__i__ = (__i__ + 1)%100
    if (__i__ === 0) console.log('queue lengths: '+queueLengths.join(','))*/
    
    var minChunkSize = queueLengths.reduce(function(minimum, value) {
      return Math.min(minimum, value)
    }, Infinity)
    if (minChunkSize === 0) return
    
    // from all queues, get chunks of equal size (minChunkSize)
    var chunksToMix = self.queues.map(function(queue) {
      var neededChunkSize = minChunkSize
      var result = null
      while (neededChunkSize > 0) {
        var buf = queue.shift()
        var oldResult = result
        if (buf.length < neededChunkSize) {
          // everything is right :)
        } else if (buf.length > neededChunkSize) {
          queue.unshift(buf.slice(buf.length - neededChunkSize))
          buf = buf.slice(0, neededChunkSize)
        } else {
          // everything is right :)
        }
        if (result === null) {
          result = buf
        } else {
          result = new Buffer(oldResult.length + buf.length)
          oldResult.copy(result)
          buf.copy(result, oldResult.length)
        }
        neededChunkSize -= buf.length
      }
      return result
    })
    
    /*var fillerChunk = new Buffer(minChunkSize)
    fillerChunk.fill(127)
    var targetInputCount = Math.pow(2, Math.ceil(Math.log(chunksToMix.length)*Math.LOG2E))
    while (chunksToMix.length < targetInputCount) {
      chunksToMix.push()
    }*/
    
    // mix them
    var mixMaster = new Array(minChunkSize)
    for (var i=0; i<minChunkSize; i++) {
      mixMaster[i] = 127
    }
    while (chunksToMix.length) {
      mix(mixMaster, chunksToMix.pop())
    }
    self.emit('data', new Buffer(mixMaster))
  })
}

// thanks to appinsanity-mike for this code :)
// https://gist.github.com/1435459
function mix(chA, chB) {
  var length = chA.length,		// A & B must be the same length
 	  out = chA 	  // faster if you just overwrite one mix channel

  for (i=0; i<length; i++) {
    if (chA[i] < 128 && chB[i] < 128) {
      out[i] = chA[i] * chB[i] / 128;
    } else {
      out[i] = 2 * (chA[i]+chB[i]) - chA[i] * chB[i] / 128 - 256;
    }
  }
}
