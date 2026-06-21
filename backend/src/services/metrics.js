/**
 * Lightweight metrics collector — feeds the cache debug panel and the
 * performance report mentioned in the assignment rubric.
 */

class Metrics {
  constructor() {
    this.latencies = [];   // ring buffer of suggest() durations (ms)
    this.maxSamples = 500;
    this.batchFlushes = 0;
    this.batchOpsIssued = 0;
    this.batchUniqueQueries = 0;
  }

  recordSuggestLatency(ms) {
    this.latencies.push(ms);
    if (this.latencies.length > this.maxSamples) this.latencies.shift();
  }

  recordBatchFlush(ops, unique) {
    this.batchFlushes += 1;
    this.batchOpsIssued += ops;
    this.batchUniqueQueries += unique;
  }

  reset() {
    this.latencies = [];
    this.batchFlushes = 0;
    this.batchOpsIssued = 0;
    this.batchUniqueQueries = 0;
  }

  _percentile(arr, p) {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return +sorted[idx].toFixed(2);
  }

  snapshot() {
    const lat = this.latencies;
    const avg = lat.length === 0 ? 0 : lat.reduce((a, b) => a + b, 0) / lat.length;
    return {
      samples: lat.length,
      avgLatencyMs: +avg.toFixed(2),
      p50LatencyMs: this._percentile(lat, 50),
      p95LatencyMs: this._percentile(lat, 95),
      p99LatencyMs: this._percentile(lat, 99),
      batchFlushes: this.batchFlushes,
      batchOpsIssued: this.batchOpsIssued,
      batchUniqueQueries: this.batchUniqueQueries,
    };
  }
}

module.exports = Metrics;
