import { state } from '../node/state.js';

export
function handleMessage(message,senderPeerId) {
    const msg=JSON.parse(message);
    if(state.seenMessages.has(msg.id)) {
        return; // Already processed
    }
    state.seenMessages.add(msg.id);
    console.log(`Received message from ${senderPeerId}: ${msg.content}`);
    // Broadcast to other peers
    for (const [peerId,peerSocket] of state.peers.entries()) {
        if(peerId!==senderPeerId && peerSocket.readyState===peerSocket.OPEN) {
            peerSocket.send(JSON.stringify(msg));
        }
    }
}

