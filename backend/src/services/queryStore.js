/**
 * Persistence helpers for the primary query store (MongoDB).
 *
 * On first boot, if the collection is empty we generate a synthetic dataset
 * of ~150,000 queries (assignment minimum: 100k) and bulk-insert it so the
 * primary store is realistic. On subsequent boots we just stream the existing
 * documents into memory to rebuild the Trie.
 */

const path = require("path");
const fs = require("fs");

const DATASET_PATH = path.join(__dirname, "..", "data", "dataset.json");

/**
 * Synthetic dataset generator. Produces realistic-looking e-commerce / tech
 * search queries with Zipf-ish counts so the popularity distribution feels
 * like a real product.
 */
function generateSyntheticDataset(target = 150_000) {
  const adjectives = [
    "best","cheap","new","used","wireless","portable","mini","pro","max","ultra","budget","premium",
    "smart","fast","slim","lightweight","gaming","kids","mens","womens","handmade","organic","vintage",
    "bluetooth","rechargeable","waterproof","fast-charging","noise-cancelling","ergonomic","eco-friendly",
  ];
  const nouns = [
    "iphone","macbook","laptop","headphones","earbuds","keyboard","mouse","monitor","tv","speaker",
    "camera","watch","tablet","router","printer","ssd","hdd","fan","heater","cooler","blender","grinder",
    "kettle","oven","microwave","fridge","sofa","chair","desk","backpack","shoes","sneakers","jeans",
    "shirt","dress","jacket","perfume","sunglasses","book","novel","textbook","course","tutorial",
    "guitar","piano","drum","yoga-mat","dumbbell","treadmill","bicycle","helmet",
    // tech/learning queries — the assignment example explicitly mentions "java tutorial"
    "java","python","react","node","express","mongodb","kubernetes","docker","linux","javascript",
    "spring","django","fastapi","graphql","postgres","redis","kafka","aws","azure","gcp",
    "algorithms","leetcode","system-design","interview","resume","portfolio",
  ];
  const verbs = [
    "buy","review","compare","cheap","near-me","online","price","deals","sale","amazon","flipkart",
    "vs","specs","unboxing","setup","repair","tutorial","guide","tips","2024","2025","2026",
  ];
  const brands = [
    "apple","samsung","sony","lg","dell","hp","asus","lenovo","xiaomi","oneplus","oppo","vivo","realme",
    "boat","jbl","bose","nikon","canon","gopro","fitbit","nike","adidas","puma","reebok","zara","ikea",
  ];

  const seen = new Map();
  const pick = (a) => a[Math.floor(Math.random() * a.length)];

  // First, every single noun/brand/adj as a base query.
  for (const w of [...nouns, ...brands, ...adjectives]) {
    seen.set(w, 1);
  }

  let attempts = 0;
  while (seen.size < target && attempts < target * 8) {
    attempts++;
    const r = Math.random();
    let q;
    if (r < 0.25)      q = `${pick(brands)} ${pick(nouns)}`;
    else if (r < 0.45) q = `${pick(adjectives)} ${pick(nouns)}`;
    else if (r < 0.60) q = `${pick(nouns)} ${pick(verbs)}`;
    else if (r < 0.75) q = `${pick(brands)} ${pick(nouns)} ${pick(verbs)}`;
    else if (r < 0.88) q = `${pick(adjectives)} ${pick(brands)} ${pick(nouns)}`;
    else               q = `${pick(nouns)} ${pick(nouns)} ${pick(verbs)}`;
    if (!seen.has(q)) seen.set(q, 1);
  }

  // Assign Zipf-ish counts: rank-based 1/(rank+5)*scale + jitter.
  const queries = [...seen.keys()];
  // Shuffle so popularity isn't correlated with insertion order.
  for (let i = queries.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [queries[i], queries[j]] = [queries[j], queries[i]];
  }
  const rows = queries.map((q, rank) => {
    const base = Math.floor(200_000 / (rank + 5));
    const jitter = Math.floor(Math.random() * Math.max(1, base * 0.3));
    return { query: q, count: Math.max(1, base + jitter) };
  });

  return rows;
}

async function loadOrGenerate(collection) {
  const count = await collection.estimatedDocumentCount();
  if (count >= 100_000) {
    // Already populated — stream into memory.
    return await collection.find({}, { projection: { _id: 0, query: 1, count: 1 } }).toArray();
  }

  // Try local cached dataset file first.
  let rows;
  if (fs.existsSync(DATASET_PATH)) {
    console.log("[dataset] loading cached dataset.json");
    rows = JSON.parse(fs.readFileSync(DATASET_PATH, "utf8"));
  } else {
    console.log("[dataset] generating synthetic dataset (~150k queries)...");
    rows = generateSyntheticDataset(150_000);
    fs.mkdirSync(path.dirname(DATASET_PATH), { recursive: true });
    fs.writeFileSync(DATASET_PATH, JSON.stringify(rows));
    console.log(`[dataset] wrote ${rows.length} rows to ${DATASET_PATH}`);
  }

  // Bulk insert in chunks.
  console.log(`[dataset] inserting ${rows.length} rows into Mongo...`);
  const CHUNK = 5000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    await collection.insertMany(slice, { ordered: false }).catch((e) => {
      // ignore duplicate-key errors from re-runs
      if (e.code !== 11000) throw e;
    });
  }
  return rows;
}

module.exports = { loadOrGenerate, generateSyntheticDataset };
