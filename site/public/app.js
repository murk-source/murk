// The app page: pay a name or meta-address, create your receiving link, and collect what was paid to you.
// Everything secret (your two receiving keys, each one-time address key) lives in this tab's memory only.
import { KEY_MESSAGE, keysFromSignature, parseMeta, makeChain, pay, inbox, collect, formatUnits, getAddress, ABI, scanChain } from "./stealth.js";

const CFG = window.CFG;
const $ = (s) => document.querySelector(s);
const W = makeChain(CFG);
const S = { dep: null, keys: null, tok: CFG.tokens[0], who: null, anns: null, mine: [], busy: false, bal: {} };
const short = (a) => a.slice(0, 6) + "…" + a.slice(-4);
const fmt = (v, d = 4) => (Number(v) || 0).toLocaleString("en-US", { maximumFractionDigits: d });
const toast = (m, bad) => { const t = $("#toast"); t.textContent = m; t.className = "toast show" + (bad ? " bad" : ""); clearTimeout(t._h); t._h = setTimeout(() => (t.className = "toast"), 4500); };
const errText = (e) => { const m = e?.shortMessage || e?.message || String(e); return /reject|denied|cancel/i.test(m) ? "Cancelled in the wallet" : m.slice(0, 180); };
const tokenOf = (addr) => CFG.tokens.find((t) => (t.address || CFG.nativeMarker).toLowerCase() === addr.toLowerCase()) || { symbol: short(addr), decimals: 18 };
const icon = (t) => (t.logo ? '<img class="tk-ic" src="' + t.logo + '" alt="">' : '<span class="tk-ic" style="--c:' + (t.color || "#8892a6") + '">' + t.symbol.slice(0, 1) + "</span>");

// ---------- wallet ----------
function drawWallet() {
  const b = $("#walletBtn");
  if (!W.address) { b.textContent = "Connect wallet"; b.className = "btn btn-acc"; b.onclick = pickWallet; }
  else { b.innerHTML = '<span class="dot"></span>' + short(W.address); b.className = "btn btn-ghost mono"; b.onclick = () => { W.disconnect(); S.keys = null; S.mine = []; drawAll(); }; }
}
function pickWallet() {
  const list = W.wallets();
  $("#wlist").innerHTML = list.length ? list.map((w, i) => '<button class="wopt" data-i="' + i + '">' + (w.info.icon ? '<img src="' + w.info.icon + '" alt="">' : "") + w.info.name + "</button>").join("") : '<p class="muted">No EVM wallet in this browser. Install MetaMask, Rabby or OKX Wallet.</p>';
  $("#wmodal").classList.add("open");
  $("#wlist").querySelectorAll(".wopt").forEach((b) => (b.onclick = () => { $("#wmodal").classList.remove("open"); W.connect(list[+b.dataset.i].info.rdns).catch((e) => toast(errText(e), true)); }));
}
window.addEventListener("wallet", () => { S.keys = null; S.mine = []; balances(); drawAll(); });

async function balances() {
  if (!W.address) return;
  const t = S.tok;
  const v = t.address ? await W.pub.readContract({ address: t.address, abi: ABI, functionName: "balanceOf", args: [W.address] }).catch(() => null) : await W.pub.getBalance({ address: W.address }).catch(() => null);
  if (v != null) S.bal[t.symbol] = Number(formatUnits(v, t.decimals));
  drawPay();
}

async function unlock() {
  if (S.keys) return S.keys;
  if (!W.address) { pickWallet(); throw new Error("Connect a wallet first"); }
  const sig = await W.sign(KEY_MESSAGE(CFG.title));
  S.keys = keysFromSignature(sig);
  return S.keys;
}

/** name -> { owner, meta }: the worker first, the contract itself when the worker is unavailable */
async function lookupName(name) {
  const r = await fetch("/api/name?n=" + name).then((x) => x.json()).catch(() => null);
  if (r && !r.error) return r;
  if (!S.dep) return null;
  const [owner, meta] = await W.pub.readContract({ address: S.dep.stealthPay, abi: ABI, functionName: "lookup", args: [name] }).catch(() => [null, "0x"]);
  return { owner: /^0x0{40}$/i.test(owner || "") ? null : owner, meta: meta && meta !== "0x" ? meta : "" };
}

// ---------- tabs ----------
function tab(name) {
  document.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
  document.querySelectorAll("[data-pane]").forEach((p) => (p.hidden = p.dataset.pane !== name));
  if (name === "inbox" && S.keys) scan();
}
document.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => tab(b.dataset.tab)));

// ---------- pay ----------
async function resolveTo() {
  const v = $("#payTo").value.trim().replace(/^@/, "");
  S.who = null;
  if (!v) return drawPay();
  if (/^(st:[a-z]+:)?0x[0-9a-fA-F]{132}$/.test(v)) { try { parseMeta(v); S.who = { meta: v.replace(/^st:[a-z]+:/, ""), label: "meta-address " + short(v.replace(/^st:[a-z]+:/, "")) }; } catch { S.who = { err: "Not a valid meta-address" }; } return drawPay(); }
  if (/^[a-z0-9_]{3,20}$/i.test(v)) {
    $("#payWho").textContent = "Looking up…";
    const r = await lookupName(v.toLowerCase());
    if ($("#payTo").value.trim().replace(/^@/, "") !== v) return;
    S.who = r?.meta ? { meta: r.meta, label: "@" + v.toLowerCase() } : { err: "No one has claimed @" + v.toLowerCase() + " yet" };
  } else S.who = { err: "Type a name (3-20 letters, digits, _) or paste a meta-address" };
  drawPay();
}
let rt; $("#payTo").addEventListener("input", () => { clearTimeout(rt); rt = setTimeout(resolveTo, 350); });
function drawTokens() {
  $("#payTokens").innerHTML = CFG.tokens.map((t, i) => '<button class="chip' + (t === S.tok ? " on" : "") + '" data-i="' + i + '">' + icon(t) + t.symbol + "</button>").join("");
  $("#payTokens").querySelectorAll(".chip").forEach((b) => (b.onclick = () => { S.tok = CFG.tokens[+b.dataset.i]; drawTokens(); balances(); drawPay(); }));
}
function drawPay() {
  const t = S.tok, amt = Number($("#payAmt").value);
  $("#payUnit").textContent = t.symbol;
  $("#payBal").textContent = W.address ? (S.bal[t.symbol] != null ? "Balance " + fmt(S.bal[t.symbol]) + " " + t.symbol : "Balance …") : "";
  $("#payWho").className = "who" + (S.who?.err ? " bad" : S.who ? " ok" : "");
  $("#payWho").textContent = S.who?.err || (S.who ? "Paying " + S.who.label + " · a fresh one-time address is made for this payment" : "");
  $("#payGas").textContent = t.address ? "+ " + CFG.gasTip + " " + CFG.native + " goes along so the receiver can move it later" : "";
  const b = $("#payBtn");
  b.disabled = S.busy || !S.dep || (W.address && (!S.who?.meta || !(amt > 0)));
  b.textContent = !S.dep ? "Opens at launch" : !W.address ? "Connect wallet" : !S.who?.meta ? "Who are you paying?" : !(amt > 0) ? "Enter an amount" : "Pay " + fmt(amt) + " " + t.symbol + " privately";
}
$("#payAmt").addEventListener("input", drawPay);
$("#payMax").onclick = () => { const b = S.bal[S.tok.symbol]; if (b) { $("#payAmt").value = String(S.tok.address ? b : Math.max(0, b - 0.0005)); drawPay(); } };
$("#payBtn").onclick = async () => {
  if (!W.address) return pickWallet();
  S.busy = true; drawPay();
  const log = (m) => ($("#payLog").innerHTML = '<div class="step run">' + m + "</div>");
  try {
    const r = await pay(W, CFG, S.dep.stealthPay, S.who.meta, S.tok, $("#payAmt").value, log);
    $("#payLog").innerHTML = '<div class="step ok">Paid to a one-time address · <a href="' + CFG.explorer + "/tx/" + r.hash + '" target="_blank" rel="noopener">view the transaction</a></div>';
    toast("Paid privately");
    $("#payAmt").value = ""; balances();
  } catch (e) { $("#payLog").innerHTML = '<div class="step bad">' + errText(e) + "</div>"; toast(errText(e), true); }
  S.busy = false; drawPay();
};

// ---------- receive ----------
function drawReceive() {
  const k = S.keys;
  $("#rcvKeys").hidden = !!k; $("#rcvReady").hidden = !k;
  if (!k) return;
  $("#rcvMeta").textContent = "st:" + CFG.metaPrefix + ":" + k.meta;
  const n = S.myName;
  $("#rcvLink").textContent = n ? CFG.site + "/pay/" + n : "claim a name to get a short link";
  $("#rcvCopyLink").disabled = !n;
}
$("#rcvMake").onclick = async () => { try { await unlock(); drawReceive(); } catch (e) { toast(errText(e), true); } };
$("#rcvCopyMeta").onclick = () => { navigator.clipboard.writeText($("#rcvMeta").textContent); toast("Meta-address copied"); };
$("#rcvCopyLink").onclick = () => { navigator.clipboard.writeText("https://" + $("#rcvLink").textContent); toast("Link copied"); };
$("#rcvClaim").onclick = async () => {
  const name = $("#rcvName").value.trim().toLowerCase().replace(/^@/, "");
  if (!/^[a-z0-9_]{3,20}$/.test(name)) return toast("Names are 3-20 characters: a-z, 0-9, _", true);
  if (!S.dep) return toast("Opens at launch", true);
  const b = $("#rcvClaim"); b.disabled = true; b.textContent = "Confirm in wallet…";
  try {
    const k = await unlock();
    const r = await lookupName(name);
    if (!r) throw new Error("Could not check the name, try again");
    if (r.owner && r.owner.toLowerCase() !== W.address.toLowerCase()) throw new Error("@" + name + " is taken");
    const wc = await W.onChain();
    const h = await wc.writeContract({ address: S.dep.stealthPay, abi: ABI, functionName: "setName", args: [name, k.meta] });
    b.textContent = "Waiting for the block…";
    await W.pub.waitForTransactionReceipt({ hash: h });
    S.myName = name; try { localStorage.setItem(CFG.app + ":name:" + W.address.toLowerCase(), name); } catch {}
    toast("@" + name + " is yours"); drawReceive();
  } catch (e) { toast(errText(e), true); }
  b.disabled = false; b.textContent = "Claim name";
};

// ---------- inbox ----------
async function scan() {
  const k = S.keys; if (!k || !S.dep) return;
  $("#inState").textContent = "Checking every payment against your keys in this browser…";
  let r = await fetch("/api/ann").then((x) => x.json()).catch(() => null);
  // the worker could not reach the RPC: read the announcements from this browser instead
  if (!r || r.error || !r.live) r = await scanChain(W, CFG, S.dep).catch(() => null);
  if (!r) { $("#inState").textContent = "Could not load payments, try again"; return; }
  S.mine = await inbox(W, CFG, k, r.anns || []);
  $("#inState").textContent = (r.anns?.length || 0) + " payments on chain checked · " + S.mine.length + " are yours";
  drawInbox();
}
function drawInbox() {
  $("#inLocked").hidden = !!S.keys; $("#inOpen").hidden = !S.keys;
  if (!S.keys) return;
  if (!$("#inTo").value && W.address) $("#inTo").value = W.address;
  const rows = S.mine.slice().reverse();
  $("#inList").innerHTML = rows.length ? rows.map((m, i) => {
    const t = tokenOf(m.token), paid = Number(formatUnits(BigInt(m.amount), t.decimals)), held = Number(formatUnits(m.held, t.decimals));
    return '<div class="in-row' + (held > 0 ? "" : " done") + '">' + icon(t) + '<div class="in-main"><b>' + fmt(paid) + " " + t.symbol + '</b><small class="mono">' + short(m.stealth) + " · block " + m.block + '</small></div><span class="in-st">' + (held > 0 ? "ready" : "collected") + "</span></div>";
  }).join("") : '<div class="empty">Nothing paid to you yet. Share your link.</div>';
  const ready = S.mine.filter((m) => m.held > 0n);
  $("#inCollect").disabled = !ready.length || S.busy;
  $("#inCollect").textContent = ready.length ? "Collect " + ready.length + " payment" + (ready.length > 1 ? "s" : "") : "Nothing to collect";
}
$("#inUnlock").onclick = async () => { try { await unlock(); drawInbox(); scan(); } catch (e) { toast(errText(e), true); } };
$("#inRefresh").onclick = scan;
$("#inCollect").onclick = async () => {
  let to; try { to = getAddress($("#inTo").value.trim()); } catch { return toast("Enter the address to collect to", true); }
  S.busy = true; drawInbox();
  let n = 0;
  for (const m of S.mine.filter((x) => x.held > 0n)) {
    $("#inState").textContent = "Collecting " + short(m.stealth) + "…";
    try { await collect(W, CFG, m, to); n++; } catch (e) { toast(errText(e), true); }
  }
  S.busy = false;
  toast(n ? "Collected " + n + " payment" + (n > 1 ? "s" : "") : "Nothing collected", !n);
  scan();
};

function drawAll() { drawWallet(); drawPay(); drawReceive(); drawInbox(); }

// ---------- start ----------
(async () => {
  S.dep = await fetch("/deployment.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!S.dep?.stealthPay) { S.dep = null; $("#prelaunch").hidden = false; }
  drawTokens(); drawAll();
  await W.reconnect();
  try { S.myName = localStorage.getItem(CFG.app + ":name:" + (W.address || "").toLowerCase()) || ""; } catch {}
  const m = location.pathname.match(/^\/pay\/([a-z0-9_]{3,20})/);
  if (m) { $("#payTo").value = m[1]; resolveTo(); tab("pay"); }
  else tab(location.hash === "#inbox" ? "inbox" : location.hash === "#receive" ? "receive" : "pay");
  balances();
})();
