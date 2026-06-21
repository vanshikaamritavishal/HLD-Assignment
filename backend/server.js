/**
 * Node.js + Express backend for the HLD Search Typeahead assignment.
 *
 * This file wires together every HLD component:
 *   - Trie  (in-memory prefix index for O(L + k) lookups)
 *   - Distributed cache (3 simulated nodes + LRU + TTL)
 *   - Consistent hashing ring (decides which cache node owns a prefix)
 *   - Batch writer (coalesces search submissions into bulk Mongo writes)
 *   - Trending service (count + time-decay recency score)
 *   - Metrics (cache hit rate, p50/p95 latency, db writes saved)
 *
 * It listens on PORT (defaults to 8002). The Python gateway in server.py
 * proxies all /api/* traffic to this server.
 */

const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const { MongoClient } = require("mongodb");

const Trie = require("./src/services/trie");
const ConsistentHashRing = require("./src/services/consistentHash");
const CacheCluster = require("./src/services/cacheCluster");
const BatchWriter = require("./src/services/batchWriter");
const TrendingService = require("./src/services/trendingService");
const Metrics = require("./src/services/metrics");
const buildRoutes = require("./src/routes");
const { loadOrGenerate } = require("./src/services/queryStore");

const PORT = parseInt(process.env.PORT || "8002", 10);
const MONGO_URL = process.env.MONGO_URL || "mongodb://localhost:27017";
const DB_NAME = process.env.DB_NAME || "test_database";

async function bootstrap() {
  const app = express();
  app.use(cors());
  app.use(bodyParser.json());

  // -------- Mongo (primary store) --------
  const mongo = new MongoClient(MONGO_URL);
  await mongo.connect();
  const db = mongo.db(DB_NAME);
  const queries = db.collection("queries");
  await queries.createIndex({ query: 1 }, { unique: true });

  // -------- Bootstrap dataset (>=100k unique queries) --------
  // Loads from disk if present, otherwise generates a synthetic dataset and
  // bulk-inserts it into Mongo so the primary store is non-empty.
  const dataset = await loadOrGenerate(queries);
  console.log(`[boot] dataset ready: ${dataset.length} unique queries`);

  // -------- Trie (in-memory suggestion index) --------
  const trie = new Trie();
  for (const row of dataset) trie.insert(row.query, row.count);
  console.log(`[boot] trie built (${dataset.length} keys)`);

  // -------- Distributed cache (simulated) --------
  // 3 in-process cache "nodes" — they could just as well live on 3 different
  // machines. They are addressed via a consistent-hash ring.
  const NODE_IDS = ["cache-node-A", "cache-node-B", "cache-node-C"];
  const ring = new ConsistentHashRing(NODE_IDS, /*virtualNodes*/ 64);
  const cacheCluster = new CacheCluster(NODE_IDS, ring, {
    ttlMs: 60_000,   // 60s freshness window
    capacity: 500,   // LRU cap per node
  });

  // -------- Trending service --------
  // Tracks recent submissions in a sliding-window decay structure so that
  // newly hot queries surface quickly without permanently overriding history.
  const trending = new TrendingService({
    halfLifeMs: 5 * 60_000, // recency boost decays with a 5-minute half-life
    historicalWeight: 0.6,  // 60% historical count + 40% recency
    recentWeight: 0.4,
  });

  // -------- Batch writer --------
  // Buffers POST /search submissions and flushes to Mongo periodically. This
  // is the "batch writes" HLD requirement: we trade real-time durability for
  // a massive reduction in DB writes.
  const metrics = new Metrics();
  const batch = new BatchWriter({
    flushIntervalMs: 2000, // flush every 2s
    maxBatchSize: 500,
    onFlush: async (aggregated) => {
      if (aggregated.size === 0) return;
      const ops = [];
      for (const [query, delta] of aggregated) {
        ops.push({
          updateOne: {
            filter: { query },
            update: { $inc: { count: delta }, $setOnInsert: { query } },
            upsert: true,
          },
        });
      }
      await queries.bulkWrite(ops, { ordered: false });
      metrics.recordBatchFlush(ops.length, aggregated.size);
      // After persistence, also update in-memory trie + invalidate caches.
      for (const [query, delta] of aggregated) {
        trie.insert(query, delta); // adds delta to existing count
        cacheCluster.invalidatePrefixes(query); // wipe any prefix caches that contained this query
      }
    },
  });
  batch.start();

  // -------- Routes --------
  app.use("/api", buildRoutes({
    trie,
    cacheCluster,
    ring,
    trending,
    batch,
    metrics,
    db,
  }));

  // Graceful shutdown
  const stop = async () => {
    console.log("[shutdown] flushing batch + closing mongo");
    await batch.stopAndFlush();
    await mongo.close();
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);

  app.listen(PORT, "127.0.0.1", () => {
    console.log(`[ready] Express listening on 127.0.0.1:${PORT}`);
  });
}

bootstrap().catch((e) => {
  console.error("[fatal]", e);
  process.exit(1);
});
