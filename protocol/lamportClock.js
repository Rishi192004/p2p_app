/**
 * Lamport Clock implementation for logical time ordering.
 * 
 * System Design Reason: 
 * Lamport timestamps do not give wall-clock time (they don't reflect the physical time 
 * interval between events). However, they DO give causal ordering. In a distributed P2P 
 * system where physical clocks drift and network latency varies, wall-clock time cannot 
 * be trusted to order events. Lamport clocks guarantee that if event A causal-precedes 
 * event B, then Time(A) < Time(B). This allows the network to establish a consistent 
 * partial order of messages.
 */
export class LamportClock {
    constructor() {
        this._value = 0;
    }

    /**
     * Increments the local clock and returns the new time.
     * Called before a local event or sending a message.
     * @returns {number}
     */
    tick() {
        this._value += 1;
        return this._value;
    }

    /**
     * Updates the local clock based on a received timestamp.
     * Called when receiving a message.
     * @param {number} receivedTime 
     * @returns {number} The new clock value
     */
    update(receivedTime) {
        this._value = Math.max(this._value, receivedTime) + 1;
        return this._value;
    }

    /**
     * Getter for the current logical time.
     * @returns {number}
     */
    get value() {
        return this._value;
    }
}
