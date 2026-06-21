import { useEffect, useState } from "react";
import { Activity, Database, Layers, Zap, RefreshCw, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getMetrics, forceFlush, resetMetrics, clearCache } from "@/lib/api";
import { toast } from "sonner";

export default function CacheDebugPanel({ refreshKey }) {
  const [m, setM] = useState(null);
  const [auto, setAuto] = useState(true);

  const tick = async () => { try { setM(await getMetrics()); } catch {} };
  useEffect(() => {
    tick();
    if (!auto) return;
    const iv = setInterval(tick, 1500);
    return () => clearInterval(iv);
  }, [auto, refreshKey]);

  if (!m) return (
    <Card><CardContent className="p-6 text-sm text-zinc-500">Loading metrics…</CardContent></Card>
  );

  const cache = m.cache;
  const lat = m.latency;
  const batch = m.batch;

  return (
    <Card data-testid="cache-debug-panel" className="border-zinc-200">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="w-4 h-4 text-zinc-700" />
          Live System Metrics
          <span className="ml-2 inline-block w-2 h-2 rounded-full bg-emerald-500 pulse-dot" />
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="sm" data-testid="btn-force-flush" onClick={async () => {
              const r = await forceFlush(); toast.success(`Flushed batch: ${r.writesIssued} ops to DB`);
            }}>
              <RefreshCw className="w-3.5 h-3.5 mr-1" /> Flush
            </Button>
            <Button variant="ghost" size="sm" data-testid="btn-clear-cache" onClick={async () => {
              await clearCache(); toast.message("All cache nodes cleared");
            }}>
              <Trash2 className="w-3.5 h-3.5 mr-1" /> Clear cache
            </Button>
            <Button variant="ghost" size="sm" data-testid="btn-reset-metrics" onClick={async () => {
              await resetMetrics(); toast.message("Metrics reset");
            }}>
              Reset
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        {/* Top-line numbers */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat label="Cache hit rate" value={`${Math.round(cache.hitRate * 100)}%`} sub={`${cache.totalHits} hits / ${cache.totalHits + cache.totalMisses} reqs`} icon={<Database className="w-4 h-4" />} />
          <Stat label="p95 latency" value={`${lat.p95LatencyMs} ms`} sub={`avg ${lat.avgLatencyMs} ms (n=${lat.samples})`} icon={<Zap className="w-4 h-4" />} />
          <Stat label="Trie keys" value={m.trie.keys.toLocaleString()} sub="in-memory index" icon={<Layers className="w-4 h-4" />} />
          <Stat label="DB writes saved" value={batch.writesSaved.toLocaleString()} sub={`${batch.flushes} flushes, ${batch.writesIssued} ops issued`} icon={<RefreshCw className="w-4 h-4" />} />
        </div>

        {/* Per-node breakdown */}
        <div>
          <div className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Distributed cache nodes</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {Object.entries(cache.nodes).map(([id, s]) => (
              <div key={id} data-testid={`cache-node-${id}`} className="border border-zinc-200 rounded-lg p-3 bg-white">
                <div className="flex items-center justify-between">
                  <span className="mono text-xs font-semibold text-zinc-800">{id}</span>
                  <Badge variant="outline" className="text-xs">{Math.round(s.hitRate * 100)}%</Badge>
                </div>
                <div className="mt-2 text-xs text-zinc-500 grid grid-cols-3 gap-1 mono">
                  <span><span className="text-emerald-600">{s.hits}</span> hits</span>
                  <span><span className="text-amber-600">{s.misses}</span> miss</span>
                  <span><span className="text-zinc-700">{s.size}</span> keys</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Batch buffer */}
        <div>
          <div className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Batch writer buffer</div>
          <div className="border border-zinc-200 rounded-lg p-3 bg-white">
            <div className="flex flex-wrap items-center gap-3 text-xs mono">
              <span>buffer size: <b>{batch.bufferSize}</b></span>
              <span>submissions: <b>{batch.submissions}</b></span>
              <span>flushes: <b>{batch.flushes}</b></span>
              <span>writes issued: <b>{batch.writesIssued}</b></span>
              <span>writes saved: <b className="text-emerald-600">{batch.writesSaved}</b></span>
            </div>
            {batch.pendingSample?.length > 0 && (
              <div className="mt-2 text-xs text-zinc-600">
                pending sample: {batch.pendingSample.map((p) => `"${p.query}"(+${p.pendingDelta})`).join(", ")}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, sub, icon }) {
  return (
    <div className="border border-zinc-200 rounded-lg p-3 bg-white">
      <div className="flex items-center gap-1.5 text-xs text-zinc-500">{icon}{label}</div>
      <div className="text-2xl font-semibold tracking-tight text-zinc-900 mt-1">{value}</div>
      <div className="text-xs text-zinc-400 mt-0.5">{sub}</div>
    </div>
  );
}
