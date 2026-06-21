/**
 * Consistent Hash Ring.
 *
 * Why consistent hashing?
 *   In a distributed cache, naive `hash(key) % N` re-shuffles almost every key
 *   when N changes. Consistent hashing places nodes (and the keys) on a 2^32
 *   ring and walks clockwise from the key to find its owning node. Adding or
 *   removing a node only re-shuffles a small slice of keys (~1/N).
 *
 * Virtual nodes:
 *   We place `virtualNodes` copies of each physical node on the ring to
 *   smooth out distribution skew. Without them, a 3-node ring is often very
 *   unbalanced.
 */

const crypto = require("crypto");

/** Stable 32-bit hash for any string key. Same hash for same input → ring stays consistent. */
function hash32(str) {
  const h = crypto.createHash("md5").update(String(str)).digest();
  // Take the first 4 bytes as an unsigned int.
  return h.readUInt32BE(0);
}

class ConsistentHashRing {
  constructor(nodeIds, virtualNodes = 64) {
    this.virtualNodes = virtualNodes;
    this.ring = []; // sorted array of {hash, nodeId}
    for (const id of nodeIds) this.addNode(id);
  }

  addNode(nodeId) {
    for (let v = 0; v < this.virtualNodes; v++) {
      this.ring.push({ hash: hash32(`${nodeId}#${v}`), nodeId });
    }
    this.ring.sort((a, b) => a.hash - b.hash);
  }

  removeNode(nodeId) {
    this.ring = this.ring.filter((r) => r.nodeId !== nodeId);
  }

  /** Return the nodeId responsible for a given key. */
  getNode(key) {
    if (this.ring.length === 0) return null;
    const h = hash32(key);
    // Binary search for the first ring slot whose hash >= h. Wrap around if none.
    let lo = 0, hi = this.ring.length - 1, ans = 0;
    if (h > this.ring[hi].hash) return this.ring[0].nodeId;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.ring[mid].hash >= h) { ans = mid; hi = mid - 1; }
      else lo = mid + 1;
    }
    return this.ring[ans].nodeId;
  }

  /** Debug snapshot of the ring (sampled). */
  snapshot(maxSamples = 24) {
    const step = Math.max(1, Math.floor(this.ring.length / maxSamples));
    const sample = [];
    for (let i = 0; i < this.ring.length; i += step) sample.push(this.ring[i]);
    return sample;
  }
}

module.exports = ConsistentHashRing;
module.exports.hash32 = hash32;
