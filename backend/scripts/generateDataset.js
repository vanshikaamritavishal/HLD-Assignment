/**
 * Standalone dataset generator — produces a JSON file the server can load.
 *
 * Usage:
 *   node scripts/generateDataset.js [count]
 *
 * Default count is 150_000 (assignment minimum: 100k).
 * The server also auto-generates on first boot, so this script is mainly
 * useful when you want to regenerate or inspect the data.
 */

const fs = require("fs");
const path = require("path");
const { generateSyntheticDataset } = require("../src/services/queryStore");

const target = parseInt(process.argv[2] || "150000", 10);
const out = path.join(__dirname, "..", "src", "data", "dataset.json");

console.log(`Generating ~${target} synthetic queries...`);
const rows = generateSyntheticDataset(target);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(rows));
console.log(`Wrote ${rows.length} rows to ${out}`);
console.log(`Sample:`);
for (const r of rows.slice(0, 8)) console.log("  ", r);
