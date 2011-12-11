#! /usr/bin/env node
var audionode = require('./')
  , AudioReader = audionode.AudioReader
  , AudioLeecher = audionode.AudioLeecher
  , net = require('net')
  , http = require('http')
  , url = require('url')

var rooms = {}
var webserver = http.createServer(function(req, res) {
  var requrl = url.parse(req.url)
  var urlparts = requrl.pathname.split('/')
  if (urlparts[0] !== '' || urlparts[1] !== 'listen' || !urlparts[2]) {
    res.writeHead(404, {'Content-Type': 'text/plain'});
    return res.end('invalid url')
  }
  var roomName = urlparts[2]
  if (!rooms.hasOwnProperty(roomName) || !rooms[roomName].ready) {
    res.writeHead(404, {'Content-Type': 'text/plain'});
    return res.end('room name is unused\n')
  }
  res.writeHead(200, {'Content-Type': 'audio/x-wav'})
  new AudioLeecher({socket: res, audioReader: rooms[roomName], attachDelay: 10000})
})
webserver.listen(8001)

var server = net.createServer(function(c) {
  var header = new Buffer(0)
  c.on('data', headerDataListener)
  function headerDataListener(chunk) {
    // concat header
    var newHeader = new Buffer(header.length + chunk.length)
    header.copy(newHeader)
    chunk.copy(newHeader, header.length)
    var oldHeaderLength = header.length
    header = newHeader
    if (header.length > 1000) {
      // anti-flooding
      c.destroy()
    }

    for (var i=oldHeaderLength; i<header.length; i++) {
      if (header[i] !== 0xa) continue
      var headerStr = header.slice(0, i).toString().trim() // trim() for \r and stuff
      var firstChunk = header.slice(i+1)
      var headerParts = headerStr.split(' ')
      header = null
      c.removeListener('data', headerDataListener)
      if (headerParts.length !== 2) {
        c.write('invalid header\n')
        c.end()
        break
      }
      var clientType = headerParts[0]
      var roomName = headerParts[1]
      if (clientType === 'provide') {
        if (rooms.hasOwnProperty(roomName)) {
          c.write('room name is already used\n')
          c.end()
          break
        }
        var audioReader = new AudioReader({inStream: c})
        rooms[roomName] = audioReader
        audioReader.on('end', function() {
          delete rooms[roomName]
        })
        audioReader.on('error', function() {
          c.destroy()
        })
        audioReader.parse(firstChunk)
      } else if (clientType === 'listen') {
        if (!rooms.hasOwnProperty(roomName) || !rooms[roomName].ready) {
          c.write('room name is unused\n')
          c.end()
          break
        }
        new AudioLeecher({socket: c, audioReader: rooms[roomName]})
      } else {
        c.write('invalid client type: needs to be provide/listen\n')
        c.end()
      }
      break
    }
  }
})
server.listen(1289)
