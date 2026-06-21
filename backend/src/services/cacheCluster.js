/**
 * Simulated distributed cache cluster.
 *
 * Each "node" is an in-process LRU map with TTL eviction. In a real system,
 * each entry of `nodes` would be a different Redis/Memcached server. The
 * routing logic — which node owns which prefix — is identical to what a real
 * client library would do.
 */

class LRUCacheNode {
  constructor({ ttlMs, capacity }) {
    this.ttlMs = ttlMs;
    this.capacity = capacity;
    this.map = new Map();        // key -> { value, expiresAt }
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  get(key) {
    const e = this.map.get(key);
    if (!e) { this.misses++; return undefined; }
    if (e.expiresAt < Date.now()) {
      this.map.delete(key);
      this.misses++;
      return undefined;
    }
    // refresh recency (LRU)
    this.map.delete(key);
    this.map.set(key, e);
    this.hits++;
    return e.value;
  }

  set(key, value) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    while (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value;
      this.map.delete(oldest);
      this.evictions++;
    }
  }

  delete(key) { this.map.delete(key); }

  /** Drop every key whose original prefix begins with `prefixRoot`. */
  invalidateByPrefix(prefixRoot) {
    let removed = 0;
    for (const k of [...this.map.keys()]) {
      // We key by the suggestion prefix itself, so simple startsWith works.
      if (k.startsWith(prefixRoot)) { this.map.delete(k); removed++; }
    }
    return removed;
  }

  stats() {
    const total = this.hits + this.misses;
    return {
      size: this.map.size,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      hitRate: total === 0 ? 0 : +(this.hits / total).toFixed(3),
    };
  }
}

class CacheCluster {
  /**
   * @param {string[]} nodeIds
   * @param {ConsistentHashRing} ring
   * @param {{ttlMs:number, capacity:number}} opts
   */
  constructor(nodeIds, ring, opts) {
    this.ring = ring;
    this.nodes = new Map();
    for (const id of nodeIds) this.nodes.set(id, new LRUCacheNode(opts));
  }

  /**
   * Routes the key to its owning node using consistent hashing.
   * Returns { nodeId, node }.
   */
  route(key) {
    const nodeId = this.ring.getNode(key);
    return { nodeId, node: this.nodes.get(nodeId) };
  }

  get(key) {
    const { nodeId, node } = this.route(key);
    const value = node.get(key);
    return { nodeId, hit: value !== undefined, value };
  }

  set(key, value) {
    const { nodeId, node } = this.route(key);
    node.set(key, value);
    return nodeId;
  }

  /**
   * When a query mutates we must invalidate any cached prefix entry that
   * could contain it (i.e. every proper prefix of the query string).
   *
   * In a 3-node cluster, different prefixes map to different nodes, so we
   * iterate per-prefix and route each through the ring.
   */
  invalidatePrefixes(query) {
    const q = query.toLowerCase();
    let removed = 0;
    for (let i = 1; i <= q.length; i++) {
      const pref = q.slice(0, i);
      const { node } = this.route(pref);
      if (node.map.delete(pref)) removed++;
    }
    return removed;
  }

  clear() {
    for (const n of this.nodes.values()) n.map.clear();
  }

  stats() {
    const per = {};
    let hits = 0, misses = 0;
    for (const [id, n] of this.nodes) {
      const s = n.stats();
      per[id] = s;
      hits += s.hits; misses += s.misses;
    }
    const total = hits + misses;
    return {
      nodes: per,
      totalHits: hits,
      totalMisses: misses,
      hitRate: total === 0 ? 0 : +(hits / total).toFixed(3),
    };
  }
}

module.exports = CacheCluster;
