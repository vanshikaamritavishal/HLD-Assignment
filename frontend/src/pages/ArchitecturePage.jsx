import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * The "architecture" page summarises every HLD concept covered by the project.
 * Diagrams are inline ASCII inside <pre> blocks so they're crisp, copy-able,
 * and easy to paste into a viva slide deck.
 */
export default function ArchitecturePage() {
  return (
    <main className="max-w-5xl mx-auto px-6 py-10 space-y-8">
      <header className="fade-up">
        <Badge variant="outline" className="mb-3">Design Document</Badge>
        <h1 className="font-display text-4xl sm:text-5xl tracking-tight">High-Level Design</h1>
        <p className="mt-2 text-zinc-600 max-w-2xl">
          Every component you see in the live demo is mapped to a system-design
          concept below. Diagrams are intentionally simple so they can be
          re-drawn from memory in a viva.
        </p>
      </header>

      <Section title="1 · System architecture">
        <pre className="mono text-[12px] leading-5 overflow-x-auto bg-zinc-50 border border-zinc-200 rounded-lg p-4">
{`                       ┌─────────────────┐
       ┌──── debounced ─┤  React frontend │
       │   /suggest     │  (search box,   │
       │   /search      │   debug panels) │
       │                └──────┬──────────┘
       │                       │ HTTPS  (REACT_APP_BACKEND_URL)
       ▼                       ▼
 ┌──────────────────────────────────────┐
 │  Python FastAPI gateway  (port 8001) │  ← only forwards /api/* to Node
 └────────────────┬─────────────────────┘
                  │  HTTP  127.0.0.1:8002
                  ▼
 ┌──────────────────────────────────────┐
 │       Node.js + Express server       │
 │  ┌─────────┐  ┌────────────────────┐ │
 │  │  Trie   │  │  Trending service  │ │
 │  │ (in-mem)│  │  (decay + blend)   │ │
 │  └────┬────┘  └────────┬───────────┘ │
 │       │                │             │
 │  ┌────▼─────────────── ▼──────────┐  │
 │  │   Distributed cache cluster   │  │
 │  │   3 LRU+TTL nodes  on  RING   │  │ ← consistent hashing
 │  └────┬──────────────────────────┘  │
 │       │ miss                        │
 │  ┌────▼──────────────────────────┐  │
 │  │  Batch writer (in-mem buffer) │  │ ← flushes every 2s
 │  └────┬──────────────────────────┘  │
 └───────┼──────────────────────────────┘
         │  bulkWrite
         ▼
 ┌──────────────────────────────────────┐
 │             MongoDB                  │
 │  collection: queries  { query, cnt } │
 └──────────────────────────────────────┘`}
        </pre>
      </Section>

      <Section title="2 · Suggestion request flow (cache hit / miss)">
        <pre className="mono text-[12px] leading-5 overflow-x-auto bg-zinc-50 border border-zinc-200 rounded-lg p-4">
{`User types "iph"
   │
   ▼  (debounced 150 ms)
GET /api/suggest?q=iph
   │
   ▼
Express router → cache.route("basic:iph")
                            │
                            ▼   consistent hash
                  cache-node-B owns "basic:iph"
                            │
                ┌───────────┴────────────┐
                ▼                        ▼
            HIT (TTL valid)          MISS
                │                        │
                ▼                        ▼
        return cached top-10     Trie.suggest("iph", 10)
                                         │
                                         ▼
                                 cache.set("basic:iph", top10)
                                         │
                                         ▼
                                 return top-10
`}
        </pre>
      </Section>

      <Section title="3 · Cache strategy">
        <ul className="list-disc pl-5 space-y-1 text-sm text-zinc-700">
          <li><b>Key</b>: <span className="mono">{`<mode>:<prefix>`}</span> (e.g. <span className="mono">trending:iph</span>) — basic and trending lists never collide.</li>
          <li><b>Value</b>: pre-computed top-10 suggestions list. Pre-computation means a cache hit returns instantly.</li>
          <li><b>TTL</b>: 60s — keeps the cache fresh after popularity changes without us having to invalidate every prefix.</li>
          <li><b>Per-node LRU</b>: cap of 500 entries/node prevents unbounded memory on hot tails.</li>
          <li><b>Invalidation</b>: on batch-flush, we drop every prefix of an updated query (e.g. for "iphone" we drop "i", "ip", "iph", …). This guarantees the next request sees fresh ranking.</li>
        </ul>
      </Section>

      <Section title="4 · Consistent hashing">
        <p className="text-sm text-zinc-700 mb-2">
          We place each physical cache node on a 2^32 ring at <b>64 virtual positions</b> using
          <span className="mono"> MD5(nodeId#vIndex)</span>. To find which node owns a key, we hash the key, then walk clockwise on the ring
          (binary search) and pick the first virtual node we hit.
        </p>
        <p className="text-sm text-zinc-700">
          Why virtual nodes? With only 3 nodes on a bare ring you get terrible load skew —
          one node would carry 70% of the keys by accident. With 64 vnodes per node, the
          distribution becomes ~33% / 33% / 33%. Adding/removing a node only re-shuffles
          ~1/N of the keys, instead of all of them.
        </p>
      </Section>

      <Section title="5 · Trending logic (count + recency)">
        <p className="text-sm text-zinc-700 mb-2">
          Trending score blends historical popularity with recent activity:
        </p>
        <pre className="mono text-[13px] bg-zinc-50 border border-zinc-200 rounded-lg p-3">
{`trending(q) = α · normHist(q) + β · normRec(q)

normHist(q)  = count(q) / max_count_in_topK
normRec(q)   = decayed_event_count(q) / max_decay_in_topK
decay(t)     = exp( -ln(2) · age / halfLife )   ; halfLife = 5 min
α = 0.6 ,  β = 0.4`}
        </pre>
        <ul className="list-disc pl-5 mt-3 space-y-1 text-sm text-zinc-700">
          <li>Each submission updates a per-query "decayed counter" lazily, so memory stays O(Q) regardless of event volume.</li>
          <li>The 5-minute half-life means recently popular queries surge, but their boost halves every 5 minutes — preventing permanent over-ranking.</li>
          <li>The basic mode (sorted purely by count) is preserved at <span className="mono">/suggest?mode=basic</span> so the difference is easy to demo.</li>
        </ul>
      </Section>

      <Section title="6 · Batch writes">
        <pre className="mono text-[12px] leading-5 overflow-x-auto bg-zinc-50 border border-zinc-200 rounded-lg p-4">
{`POST /api/search { q: "iphone" }
   │
   ▼
batch.submit("iphone", +1)   ─►   buffer = Map{ iphone:1, ... }
                                  trending.record("iphone")
                                  (no DB write yet)

Every 2s OR buffer.size >= 500:
   │
   ▼
flush(snapshot)
   │
   ▼
mongo.bulkWrite([
   { updateOne: { filter:{query:'iphone'}, update:{$inc:{count:1}}, upsert:true } },
   ...
])
   │
   ▼
trie.insert(q, delta)          (in-mem index now matches DB)
cache.invalidatePrefixes(q)    (next /suggest is forced re-rank)`}
        </pre>
        <p className="text-sm text-zinc-700 mt-3">
          <b>Write-reduction:</b> if 1000 users search "iphone" in a 2-second window, that
          is <b>one</b> upsert to Mongo instead of 1000.
          <br />
          <b>Failure trade-off:</b> a crash between flushes loses at most ~2 s of counts.
          For a typeahead workload that under-counting is harmless; for stricter durability
          we'd persist the buffer to a WAL or Kafka topic before acking the client.
        </p>
      </Section>

      <Section title="7 · Time complexity">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-zinc-500 text-xs uppercase tracking-wider">
                <th className="py-2">Operation</th><th>Path</th><th>Complexity</th>
              </tr>
            </thead>
            <tbody className="text-zinc-800">
              <Row op="/suggest cache hit"    path="ring lookup + Map get" cx="O(log V) + O(1)" />
              <Row op="/suggest cache miss"   path="Trie walk + pre-stored topK" cx="O(L + K) where L=prefix length, K=10" />
              <Row op="/search submit"        path="buffer.set + trending.record" cx="O(1) amortised" />
              <Row op="Batch flush"           path="bulkWrite + trie.insert" cx="O(B · L) where B=batch size" />
              <Row op="Cache invalidation"    path="walk each prefix on ring" cx="O(L · log V)" />
              <Row op="Consistent-hash route" path="binary search on ring"   cx="O(log V), V = nodes · vnodes" />
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="8 · Scaling strategy">
        <ul className="list-disc pl-5 space-y-1 text-sm text-zinc-700">
          <li><b>Read scale</b>: add more cache nodes; the consistent-hash ring re-balances ~1/N of keys, so warm-up cost stays small.</li>
          <li><b>Write scale</b>: shard the primary store on a hash of <span className="mono">query</span>; batch writer becomes per-shard. With Kafka/SQS in front, the buffer is durable across crashes.</li>
          <li><b>Compute scale</b>: stateless Express servers behind a load balancer. Trie can be rebuilt from Mongo on startup; for huge datasets we'd partition the Trie by first 2 characters and shard it across N suggestion servers.</li>
          <li><b>Trending scale</b>: per-server decayed counters are eventually consistent — for a globally accurate trending list, periodically merge counters via gossip or aggregate them in a stream processor (Flink / Kinesis).</li>
        </ul>
      </Section>

      <Section title="9 · API reference">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-zinc-500 text-xs uppercase tracking-wider">
              <th className="py-2">Method</th><th>Path</th><th>Purpose</th>
            </tr>
          </thead>
          <tbody className="mono text-[13px]">
            <Row op="GET"  path="/api/suggest?q=&mode=basic|trending" cx="top-10 suggestions" />
            <Row op="POST" path="/api/search   { q }"                 cx="record submission (batched)" />
            <Row op="GET"  path="/api/trending?limit=10"              cx="globally trending queries" />
            <Row op="GET"  path="/api/cache/debug?q="                 cx="owner node + hit/miss for prefix" />
            <Row op="GET"  path="/api/metrics"                         cx="cache/latency/batch stats" />
            <Row op="GET"  path="/api/ring"                            cx="hash-ring snapshot" />
            <Row op="POST" path="/api/admin/flush"                     cx="force-flush batch buffer" />
            <Row op="POST" path="/api/admin/clear-cache"               cx="wipe all cache nodes" />
            <Row op="POST" path="/api/admin/reset-metrics"             cx="zero out counters" />
          </tbody>
        </table>
      </Section>
    </main>
  );
}

function Section({ title, children }) {
  return (
    <Card data-testid={`section-${title.split(" ")[0]}`} className="border-zinc-200">
      <CardHeader><CardTitle className="text-lg">{title}</CardTitle></CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Row({ op, path, cx }) {
  return (
    <tr className="border-b border-zinc-100 last:border-0">
      <td className="py-1.5 pr-3">{op}</td>
      <td className="py-1.5 pr-3 text-zinc-600">{path}</td>
      <td className="py-1.5 text-zinc-600">{cx}</td>
    </tr>
  );
}
