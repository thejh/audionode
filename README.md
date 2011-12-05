This is a 8-bit mono WAV audio streaming server. Supports multiple rooms. Starting the deamon:

    > ./server.js

Creating a room (the room will vanish and all clients will disconnect when you disconnect):

    > (echo 'provide <roomname>'; arecord) | nc <server> 1289

Listening to a room:

    > nc <server> 1289
    listen <roomname>

Important: Room names can't contain spaces!
