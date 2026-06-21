import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getRing, getCacheDebug } from "@/lib/api";
import { Network } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/**
 * Visual representation of the consistent-hash ring.
 *
 * Each cache node gets a unique color. Dots on the ring are the virtual nodes.
 * When the user types a prefix, we draw a "needle" pointing at the slot
 * clockwise of that prefix's hash and highlight which node owns it.
 */
const COLORS = {
  "cache-node-A": "#0ea5e9", // sky
  "cache-node-B": "#10b981", // emerald
  "cache-node-C": "#f59e0b", // amber
};

export default function HashRingVisualizer() {
  const [ring, setRing] = useState(null);
  const [probe, setProbe] = useState("iphone");
  const [debug, setDebug] = useState(null);

  useEffect(() => { getRing().then(setRing).catch(() => {}); }, []);
  useEffect(() => {
    if (!probe) { setDebug(null); return; }
    getCacheDebug(probe).then(setDebug).catch(() => {});
  }, [probe]);

  if (!ring) return null;

  const size = 260, cx = size / 2, cy = size / 2, R = 100;
  const samples = ring.sample || [];
  // The hash is a 32-bit integer; map to angle.
  const angle = (h) => (h / 0xFFFFFFFF) * 2 * Math.PI - Math.PI / 2; // start from top

  // Compute needle angle from the debug call (we approximate via probe hash on client).
  // To keep frontend simple, we just pick the angle of the owning node's first virtual.
  let needleAngle = null;
  if (debug?.ownerNode) {
    const first = samples.find((s) => s.nodeId === debug.ownerNode);
    if (first) needleAngle = angle(first.hash);
  }

  return (
    <Card data-testid="hash-ring-card" className="border-zinc-200">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Network className="w-4 h-4 text-zinc-700" />
          Consistent-Hash Ring
          <span className="ml-auto text-xs font-normal text-zinc-400">
            {ring.virtualNodes} vnodes × {ring.nodes.length} nodes
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex flex-col items-center">
          <svg width={size} height={size} className="my-1">
            <circle cx={cx} cy={cy} r={R} fill="none" stroke="#e4e4e7" strokeWidth="1.5" strokeDasharray="3 3" />
            {samples.map((s, i) => {
              const a = angle(s.hash);
              const x = cx + R * Math.cos(a);
              const y = cy + R * Math.sin(a);
              return (
                <circle key={i} cx={x} cy={y} r="4.5" fill={COLORS[s.nodeId] || "#71717a"}>
                  <title>{s.nodeId} · hash={s.hash}</title>
                </circle>
              );
            })}
            {needleAngle !== null && (
              <>
                <line x1={cx} y1={cy}
                  x2={cx + (R - 18) * Math.cos(needleAngle)}
                  y2={cy + (R - 18) * Math.sin(needleAngle)}
                  stroke="#18181b" strokeWidth="2" strokeLinecap="round" />
                <circle cx={cx} cy={cy} r="3.5" fill="#18181b" />
              </>
            )}
          </svg>
          <div className="flex items-center gap-2 mt-1 w-full">
            <Input
              data-testid="ring-probe-input"
              value={probe}
              onChange={(e) => setProbe(e.target.value)}
              placeholder="probe a prefix…"
              className="flex-1"
            />
            <Button size="sm" variant="outline" onClick={() => setProbe("")}>clear</Button>
          </div>
          {debug && (
            <div data-testid="ring-debug-result" className="mt-3 text-xs w-full mono bg-zinc-50 border border-zinc-200 rounded-lg p-2 space-y-0.5">
              <div>prefix: <b>"{debug.prefix}"</b></div>
              <div>owner: <span style={{ color: COLORS[debug.ownerNode] }}><b>{debug.ownerNode}</b></span></div>
              <div>cache: {debug.hit ? <span className="text-emerald-600">HIT (TTL {Math.round((debug.expiresInMs||0)/1000)}s)</span> : <span className="text-amber-600">MISS</span>}</div>
            </div>
          )}
          <div className="flex gap-3 mt-3 text-xs">
            {ring.nodes.map((n) => (
              <span key={n} className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: COLORS[n] || "#71717a" }} />
                <span className="mono">{n}</span>
              </span>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
