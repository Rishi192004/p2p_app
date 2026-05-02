# P2P System Metrics Documentation

This document describes all metrics tracked by the system, their types, and how to interpret them.

## Counters
*Metric Name* | *Description* | *When to Alert*
--- | --- | ---
`messages_received_total` | Total gossip messages received by this node. | N/A
`messages_forwarded_total` | Total messages forwarded to peers. | N/A
`messages_dropped_duplicate` | Messages dropped because they were already seen. | High value is normal; indicates healthy gossip mesh redundancy.
`messages_dropped_ttl` | Messages dropped because TTL reached 0. | High value might indicate the network is too large for the current TTL.
`messages_dropped_ratelimit` | Messages dropped due to sender exceeding rate limits. | **Alert** if spiking; indicates a spam attack or misbehaving peer.
`delivery_confirmed_total` | Messages for which an ACK was received. | N/A
`delivery_failed_total` | Messages that timed out before being ACKed. | **Alert** if > 10% of total traffic; indicates network congestion or partition.
`invalid_signature_count` | Messages that failed cryptographic verification. | **CRITICAL Alert**. Indicates a malicious peer attempting to forge messages.

## Gauges
*Metric Name* | *Description* | *Target Value*
--- | --- | ---
`active_peers` | Number of currently active outbound connections. | > 1 (ideally 3-8 depending on fanout). 0 means isolation.

## Histograms (Percentiles: p50, p95, p99)
*Metric Name* | *Description* | *Interpretation*
--- | --- | ---
`message_latency_ms` | Time from message origination to ACK receipt. | Tracks "End-to-End" delivery speed. p99 > 5000ms indicates a very laggy/unstable network.
`storage_write_ms` | Time taken to write message batches to LevelDB. | Measures disk I/O performance. p99 > 100ms indicates disk contention.

---

### Interpretation Note: The p99 Principle
We prioritize **p99 (99th percentile)** over averages. An average can hide catastrophic failures that only affect a small percentage of users. At scale, "1 in 100" failing means thousands of users are impacted. We optimize for the worst-case scenario.
