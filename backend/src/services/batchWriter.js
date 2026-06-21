/**
 * Batch Writer for search-count updates.
 *
 * Goal (per HLD spec): avoid one DB write per search. Instead we:
 *   1) accept search submissions into an in-memory buffer (a Map aggregating
 *      duplicates: query -> deltaCount).
 *   2) every `flushIntervalMs` (or when the buffer hits `maxBatchSize`),
 *      flush the aggregate to Mongo via `bulkWrite`.
 *
 * Failure trade-off (explained in README too):
 *   If the process crashes between flushes, the latest in-memory delta is
 *   lost. We bound the loss to a small window (default 2s) and accept it for
 *   typeahead-style workloads where occasional under-counting is harmless.
 *   For stricter durability, the buffer could be persisted to a write-ahead
 *   log or Kafka topic.
 */

class BatchWriter {
  constructor({ flushIntervalMs = 2000, maxBatchSize = 500, onFlush }) {
    this.flushIntervalMs = flushIntervalMs;
    this.maxBatchSize = maxBatchSize;
    this.onFlush = onFlush;
    this.buffer = new Map(); // query -> delta
    this.timer = null;
    this.stats = {
      submissions: 0,
      flushes: 0,
      writesIssued: 0,     // bulk ops sent to DB
      writesSaved: 0,      // submissions - writesIssued
      lastFlushAt: null,
    };
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.flush().catch(() => {}), this.flushIntervalMs);
  }

  /** Buffer a search submission. */
  submit(query, delta = 1) {
    if (!query) return;
    const q = String(query).toLowerCase();
    this.buffer.set(q, (this.buffer.get(q) || 0) + delta);
    this.stats.submissions += delta;
    if (this.buffer.size >= this.maxBatchSize) {
      // Fire-and-forget eager flush.
      this.flush().catch(() => {});
    }
  }

  /** Snapshot the buffer and call onFlush with the aggregate. */
  async flush() {
    if (this.buffer.size === 0) return;
    const snapshot = this.buffer;
    this.buffer = new Map();
    try {
      await this.onFlush(snapshot);
      this.stats.flushes += 1;
      this.stats.writesIssued += snapshot.size;
      // writesSaved = total submissions accepted - writesIssued so far
      this.stats.writesSaved = Math.max(0, this.stats.submissions - this.stats.writesIssued);
      this.stats.lastFlushAt = new Date().toISOString();
    } catch (e) {
      // Roll back: merge snapshot back into buffer for retry on next tick.
      for (const [k, v] of snapshot) {
        this.buffer.set(k, (this.buffer.get(k) || 0) + v);
      }
      console.error("[batch] flush failed, will retry:", e.message);
    }
  }

  async stopAndFlush() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    await this.flush();
  }

  snapshot() {
    return {
      bufferSize: this.buffer.size,
      pendingSample: [...this.buffer.entries()].slice(0, 5)
                       .map(([q, d]) => ({ query: q, pendingDelta: d })),
      ...this.stats,
    };
  }
}

module.exports = BatchWriter;
