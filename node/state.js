// Stores peers, seenMessages
// ...implementation goes here...

const state = {
    peers: new Map(),        // peerId → websocket
    seenMessages: new Set(), // message IDs already processed
};

export default state;
