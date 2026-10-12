// Stealth pay worker: the static site plus
//   /api/ann    every StealthPay announcement so far (public chain data: one-time address, ephemeral key, view tag,
//               token, amount). The page checks each one against the viewer's keys in the browser; nothing about the
//               receiver ever reaches this worker.
//   /api/stats  totals for the landing page
//   /api/name   resolves a name to its meta-address (for /pay/<name> links)
// The contract address and its deploy block come from /deployment.json (written by the deploy script);
// the RPC and the log chunk size come from wrangler vars.

const ANN = "0x5f0eab8057630ba7676c49b4f21a0231414e79474595be8e4c432fbf6bf0f4e7";
const NAMESET = "0xd4a786fe2a7ba31dcb748100a41e8a3da1d560beb0f54aa7d1a2e0d91e6524d9";

const json = (body, maxAge = 0, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": maxAge ? `public, max-age=${maxAge}` : "no-store" } });

// env.RPC may list several endpoints, comma-separated: each is tried in turn
async function rpc(env, method, params) {
  for (let i = 0; i < 3; i++) for (const url of String(env.RPC).split(",")) {
    const r = await fetch(url.trim(), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }).then((x) => x.json()).catch(() => null);
    if (r && !r.error) return r.result;
    if (url === String(env.RPC).split(",").at(-1)) await new Promise((ok) => setTimeout(ok, 400 * (i + 1)));
  }
  throw new Error("rpc unavailable");
}

async function deployment(env, req) {
  const r = await env.ASSETS.fetch(new Request(new URL("/deployment.json", req.url))).catch(() => null);
  if (!r || !r.ok) return null;
  const d = await r.json().catch(() => null);
  return d?.stealthPay ? d : null;
}

const word = (hex, i) => hex.slice(2 + i * 64, 2 + (i + 1) * 64);
/** abi-decodes (bytes, bytes) from event data */
function twoBytes(data) {
  const at = (off) => { const o = 2 + Number(BigInt("0x" + data.slice(2 + off * 2, 2 + off * 2 + 64))) * 2; const len = Number(BigInt("0x" + data.slice(o, o + 64))); return "0x" + data.slice(o + 64, o + 64 + len * 2); };
  return [at(0), at(32)];
}

/** reads new logs since the last scan (a few chunks per call) and keeps them in KV */
async function sync(env, req) {
  const dep = await deployment(env, req);
  if (!dep) return { live: false, anns: [], names: 0 };
  let st = (await env.KV.get("scan", "json")) || { next: dep.block, anns: [], names: 0 };
  if (st.contract !== dep.stealthPay) st = { contract: dep.stealthPay, next: dep.block, anns: [], names: 0 };
  const lock = await env.KV.get("lock");
  if (!lock) {
    await env.KV.put("lock", "1", { expirationTtl: 60 });
    try {
      const head = Number(await rpc(env, "eth_blockNumber", []));
      const chunk = Number(env.CHUNK || 50000);
      for (let k = 0; k < Number(env.CHUNKS || 8) && st.next <= head; k++) {
        const to = Math.min(head, st.next + chunk - 1);
        const [anns, names] = await Promise.all([
          rpc(env, "eth_getLogs", [{ address: st.contract, fromBlock: "0x" + st.next.toString(16), toBlock: "0x" + to.toString(16), topics: [ANN] }]),
          rpc(env, "eth_getLogs", [{ address: st.contract, fromBlock: "0x" + st.next.toString(16), toBlock: "0x" + to.toString(16), topics: [NAMESET] }]),
        ]);
        for (const l of anns) {
          const [eph, md] = twoBytes(l.data);
          if (md.length < 2 + 57 * 2) continue;
          st.anns.push({ stealth: "0x" + l.topics[2].slice(26), eph, tag: "0x" + md.slice(2, 4), token: "0x" + md.slice(12, 52), amount: BigInt("0x" + md.slice(52, 116)).toString(), block: Number(l.blockNumber), tx: l.transactionHash });
        }
        st.names += names.length;
        st.next = to + 1;
      }
      st.head = head;
      await env.KV.put("scan", JSON.stringify(st));
    } finally {
      await env.KV.delete("lock");
    }
  }
  return { live: true, contract: st.contract, anns: st.anns, names: st.names, synced: st.next - 1, head: st.head };
}

export default {
  // optional cron trigger: keeps the scan near the chain head (some public RPCs only serve recent logs)
  async scheduled(_ev, env) { await sync(env, new Request("https://scan.local/")).catch(() => {}); },
  async fetch(req, env) {
    const url = new URL(req.url);
    try {
      if (url.pathname === "/api/ann") { const s = await sync(env, req); return json({ live: s.live, anns: s.anns, synced: s.synced, head: s.head }); }
      if (url.pathname === "/api/stats") {
        const s = await sync(env, req);
        const byToken = {};
        for (const a of s.anns) byToken[a.token] = (byToken[a.token] || 0n) + BigInt(a.amount);
        return json({ live: s.live, payments: s.anns.length, names: s.names, byToken: Object.fromEntries(Object.entries(byToken).map(([k, v]) => [k, v.toString()])), last: s.anns.slice(-12).reverse().map((a) => ({ token: a.token, amount: a.amount, tx: a.tx, block: a.block })) }, 15);
      }
      if (url.pathname === "/api/name") {
        const name = String(url.searchParams.get("n") || "").toLowerCase();
        if (!/^[a-z0-9_]{3,20}$/.test(name)) return json({ error: "bad name" }, 0, 400);
        const dep = await deployment(env, req);
        if (!dep) return json({ error: "not deployed" }, 0, 404);
        // lookup(string) -> (address, bytes)
        const sel = "0xf67187ac";
        const enc = (s) => { const h = [...new TextEncoder().encode(s)].map((b) => b.toString(16).padStart(2, "0")).join(""); return "0000000000000000000000000000000000000000000000000000000000000020" + s.length.toString(16).padStart(64, "0") + h.padEnd(Math.ceil(h.length / 64) * 64 || 64, "0"); };
        const r = await rpc(env, "eth_call", [{ to: dep.stealthPay, data: sel + enc(name) }, "latest"]);
        const owner = "0x" + word(r, 0).slice(24);
        const o = Number(BigInt("0x" + word(r, 1))) * 2, len = Number(BigInt("0x" + r.slice(2 + o, 2 + o + 64)));
        const meta = len ? "0x" + r.slice(2 + o + 64, 2 + o + 64 + len * 2) : "";
        return json({ name, owner: /^0x0{40}$/.test(owner) ? null : owner, meta }, 30);
      }
    } catch (e) {
      return json({ error: String(e?.message || e).slice(0, 200) }, 0, 500);
    }
    if (url.pathname.startsWith("/api/")) return json({ error: "not found" }, 0, 404);
    // /pay/<name> is the app page; the name is read from the path
    if (/^\/pay\/[a-z0-9_]{3,20}\/?$/.test(url.pathname)) return env.ASSETS.fetch(new Request(new URL("/app/", req.url), req));
    return env.ASSETS.fetch(req);
  },
};
