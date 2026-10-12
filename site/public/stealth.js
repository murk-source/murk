// Stealth payments core (ERC-5564 scheme 1, secp256k1 with view tags), shared by the page scripts.
//
// Keys: the wallet signs one fixed message; the signature is hashed into two private keys (spending, viewing).
// They are derived in this browser every time and never sent anywhere. The public halves form the meta-address.
//
// Paying: a random ephemeral key r. shared = r * P_view, h = keccak(shared), stealth = P_spend + h*G.
// The view tag is h[0], so the receiver skips 255 of 256 announcements with one multiplication.
// Receiving: shared = v * R, same h, stealth private key = (s + h) mod n.
import { secp256k1 } from "https://esm.sh/@noble/curves@1.6.0/secp256k1";
import { keccak_256 } from "https://esm.sh/@noble/hashes@1.5.0/sha3";
import { createPublicClient, createWalletClient, custom, http, parseAbi, encodeFunctionData, formatUnits, parseUnits, toHex, hexToBytes, bytesToHex, getAddress } from "https://esm.sh/viem@2.21.45";
import { privateKeyToAccount } from "https://esm.sh/viem@2.21.45/accounts";

const N = secp256k1.CURVE.n;
const G = secp256k1.ProjectivePoint.BASE;
const big = (b) => BigInt(bytesToHex(b));
const mod = (x) => ((x % N) + N) % N;
const addrOf = (point) => getAddress("0x" + bytesToHex(keccak_256(point.toRawBytes(false).slice(1))).slice(-40));

export const KEY_MESSAGE = (app) => `${app} stealth keys v1\n\nSigning this creates your private receiving keys in this browser. It costs nothing and sends nothing.`;

/** spending + viewing keys from a wallet signature (65 bytes) */
export function keysFromSignature(sig) {
  const b = hexToBytes(sig);
  const s = mod(big(keccak_256(b.slice(0, 32)))), v = mod(big(keccak_256(b.slice(32, 64))));
  if (!s || !v) throw new Error("bad signature");
  const S = G.multiply(s), V = G.multiply(v);
  return { spend: s, view: v, spendPub: S, viewPub: V, meta: bytesToHex(new Uint8Array([...S.toRawBytes(true), ...V.toRawBytes(true)])) };
}

export function parseMeta(meta) {
  const h = String(meta).replace(/^st:[a-z]+:/, "");
  const b = hexToBytes(h.startsWith("0x") ? h : "0x" + h);
  if (b.length !== 66) throw new Error("not a stealth meta-address");
  return { spendPub: secp256k1.ProjectivePoint.fromHex(b.slice(0, 33)), viewPub: secp256k1.ProjectivePoint.fromHex(b.slice(33)) };
}

/** a fresh one-time address for a meta-address */
export function newStealth(meta) {
  const { spendPub, viewPub } = parseMeta(meta);
  const r = mod(big(secp256k1.utils.randomPrivateKey()));
  const R = G.multiply(r);
  const h = keccak_256(viewPub.multiply(r).toRawBytes(true));
  const P = spendPub.add(G.multiply(mod(big(h))));
  return { address: addrOf(P), ephemeral: bytesToHex(R.toRawBytes(true)), viewTag: bytesToHex(h.slice(0, 1)) };
}

/** is this announcement ours? returns the stealth private key if so */
export function claimKey(keys, ephemeral, viewTag, stealth) {
  let R;
  try { R = secp256k1.ProjectivePoint.fromHex(hexToBytes(ephemeral)); } catch { return null; }
  const h = keccak_256(R.multiply(keys.view).toRawBytes(true));
  if (bytesToHex(h.slice(0, 1)) !== viewTag.toLowerCase()) return null;
  const k = mod(keys.spend + mod(big(h)));
  if (addrOf(G.multiply(k)).toLowerCase() !== stealth.toLowerCase()) return null;
  return toHex(k, { size: 32 });
}

// ---------- chain ----------
export const ABI = parseAbi([
  "function setName(string name, bytes meta)",
  "function lookup(string name) view returns (address owner, bytes meta)",
  "function payNative(address stealth, bytes ephemeralPubKey, bytes1 viewTag) payable",
  "function payToken(address token, uint256 amount, address stealth, bytes ephemeralPubKey, bytes1 viewTag) payable",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);

export function makeChain(cfg) {
  const chain = { id: cfg.chainId, name: cfg.chainName, nativeCurrency: { name: cfg.native, symbol: cfg.native, decimals: 18 }, rpcUrls: { default: { http: [cfg.rpc] } }, blockExplorers: { default: { name: "Explorer", url: cfg.explorer } } };
  const pub = createPublicClient({ chain, transport: http(cfg.rpc) });
  let provider = null, address = "";
  const W = {
    chain, pub,
    get address() { return address; },
    wallets() {
      const found = [...(window.__eip6963 || new Map()).values()];
      if (!found.length && window.ethereum) found.push({ info: { name: "Browser wallet", icon: "", rdns: "injected" }, provider: window.ethereum });
      return found;
    },
    async connect(rdns) {
      const w = W.wallets().find((x) => x.info.rdns === rdns) || W.wallets()[0];
      if (!w) throw new Error("No EVM wallet in this browser (MetaMask, Rabby, OKX, Binance Wallet)");
      const [a] = await w.provider.request({ method: "eth_requestAccounts" });
      provider = w.provider; address = getAddress(a);
      try { localStorage.setItem(cfg.app + ":w", w.info.rdns); } catch {}
      provider.on?.("accountsChanged", (acc) => { address = acc?.[0] ? getAddress(acc[0]) : ""; window.dispatchEvent(new Event("wallet")); });
      window.dispatchEvent(new Event("wallet"));
      return address;
    },
    async reconnect() {
      let r = ""; try { r = localStorage.getItem(cfg.app + ":w") || ""; } catch {}
      if (!r) return;
      await new Promise((ok) => setTimeout(ok, 300));
      const w = W.wallets().find((x) => x.info.rdns === r);
      const acc = w ? await w.provider.request({ method: "eth_accounts" }).catch(() => []) : [];
      if (acc?.[0]) { provider = w.provider; address = getAddress(acc[0]); window.dispatchEvent(new Event("wallet")); }
    },
    disconnect() { provider = null; address = ""; try { localStorage.removeItem(cfg.app + ":w"); } catch {} window.dispatchEvent(new Event("wallet")); },
    async onChain() {
      if (!provider) throw new Error("Connect a wallet first");
      const want = toHex(cfg.chainId);
      if ((await provider.request({ method: "eth_chainId" })) !== want) {
        try { await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: want }] }); }
        catch (e) {
          if (e?.code !== 4902 && e?.data?.originalError?.code !== 4902) throw e;
          await provider.request({ method: "wallet_addEthereumChain", params: [{ chainId: want, chainName: cfg.chainName, nativeCurrency: chain.nativeCurrency, rpcUrls: [cfg.rpc], blockExplorerUrls: [cfg.explorer] }] });
        }
      }
      return createWalletClient({ account: address, chain, transport: custom(provider) });
    },
    async sign(msg) { const wc = await W.onChain(); return wc.signMessage({ account: address, message: msg }); },
  };
  return W;
}
window.__eip6963 = new Map();
window.addEventListener("eip6963:announceProvider", (e) => { if (e.detail?.info?.rdns) window.__eip6963.set(e.detail.info.rdns, e.detail); });
window.dispatchEvent(new Event("eip6963:requestProvider"));

/** pays a meta-address: native coin, or a token with a little native coin along for the receiver's gas */
export async function pay(W, cfg, contract, meta, token, amountText, onStep = () => {}) {
  const s = newStealth(meta);
  const wc = await W.onChain();
  let hash;
  if (!token.address) {
    const value = parseUnits(String(amountText), 18);
    onStep("Confirm the payment in your wallet");
    hash = await wc.writeContract({ address: contract, abi: ABI, functionName: "payNative", args: [s.address, s.ephemeral, s.viewTag], value });
  } else {
    const amount = parseUnits(String(amountText), token.decimals);
    const have = await W.pub.readContract({ address: token.address, abi: ABI, functionName: "allowance", args: [W.address, contract] });
    if (have < amount) {
      onStep("Approve " + token.symbol + " in your wallet");
      const ah = await wc.writeContract({ address: token.address, abi: ABI, functionName: "approve", args: [contract, amount] });
      await W.pub.waitForTransactionReceipt({ hash: ah });
    }
    onStep("Confirm the payment in your wallet");
    hash = await wc.writeContract({ address: contract, abi: ABI, functionName: "payToken", args: [token.address, amount, s.address, s.ephemeral, s.viewTag], value: parseUnits(cfg.gasTip, 18) });
  }
  onStep("Waiting for the block");
  const rc = await W.pub.waitForTransactionReceipt({ hash });
  if (rc.status !== "success") throw new Error("The payment reverted");
  return { hash, stealth: s.address };
}

/** announcements that belong to these keys, with what each one-time address still holds */
export async function inbox(W, cfg, keys, anns) {
  const mine = [];
  for (const a of anns) {
    const k = claimKey(keys, a.eph, a.tag, a.stealth);
    if (k) mine.push({ ...a, key: k });
  }
  await Promise.all(mine.map(async (m) => {
    m.native = await W.pub.getBalance({ address: m.stealth }).catch(() => 0n);
    m.held = m.token === cfg.nativeMarker ? m.native : await W.pub.readContract({ address: m.token, abi: ABI, functionName: "balanceOf", args: [m.stealth] }).catch(() => 0n);
  }));
  return mine;
}

/** moves what a one-time address holds to `to`, signed with its own key (gas comes from its own native balance) */
export async function collect(W, cfg, m, to) {
  const acct = privateKeyToAccount(m.key);
  const wc = createWalletClient({ account: acct, chain: W.chain, transport: http(cfg.rpc) });
  const gasPrice = (await W.pub.getGasPrice()) * 12n / 10n;
  const hashes = [];
  if (m.token !== cfg.nativeMarker && m.held > 0n) {
    const data = encodeFunctionData({ abi: ABI, functionName: "transfer", args: [to, m.held] });
    const gas = await W.pub.estimateGas({ account: acct.address, to: m.token, data }).catch(() => 70000n);
    if (m.native < gas * gasPrice) throw new Error("This payment has no " + cfg.native + " for gas. Top it up with " + cfg.gasTip + " " + cfg.native + " first.");
    const h = await wc.sendTransaction({ to: m.token, data, gas: gas + 5000n, gasPrice });
    await W.pub.waitForTransactionReceipt({ hash: h });
    hashes.push(h);
  }
  const left = await W.pub.getBalance({ address: acct.address });
  const fee = 21000n * gasPrice;
  if (left > fee * 2n) {
    const h = await wc.sendTransaction({ to, value: left - fee, gas: 21000n, gasPrice });
    await W.pub.waitForTransactionReceipt({ hash: h });
    hashes.push(h);
  }
  return hashes;
}

export { formatUnits, parseUnits, getAddress };

// ---------- announcements straight from the chain (fallback when the site's worker cannot reach the RPC) ----------
const ANN_TOPIC = "0x5f0eab8057630ba7676c49b4f21a0231414e79474595be8e4c432fbf6bf0f4e7";
const NAME_TOPIC = "0xd4a786fe2a7ba31dcb748100a41e8a3da1d560beb0f54aa7d1a2e0d91e6524d9";
const twoBytes = (data) => { const at = (off) => { const o = 2 + Number(BigInt("0x" + data.slice(2 + off * 2, 2 + off * 2 + 64))) * 2; const len = Number(BigInt("0x" + data.slice(o, o + 64))); return "0x" + data.slice(o + 64, o + 64 + len * 2); }; return [at(0), at(32)]; };
export async function scanChain(W, cfg, dep) {
  const head = Number(await W.pub.getBlockNumber());
  const chunk = cfg.logChunk || 5_000_000, anns = [];
  let names = 0;
  for (let from = dep.block; from <= head; from += chunk) {
    const to = Math.min(head, from + chunk - 1);
    const q = (topic) => W.pub.request({ method: "eth_getLogs", params: [{ address: dep.stealthPay, fromBlock: toHex(from), toBlock: toHex(to), topics: [topic] }] });
    const [a, n] = await Promise.all([q(ANN_TOPIC), q(NAME_TOPIC)]);
    for (const l of a) {
      const [eph, md] = twoBytes(l.data);
      if (md.length < 2 + 57 * 2) continue;
      anns.push({ stealth: "0x" + l.topics[2].slice(26), eph, tag: "0x" + md.slice(2, 4), token: "0x" + md.slice(12, 52), amount: BigInt("0x" + md.slice(52, 116)).toString(), block: Number(l.blockNumber), tx: l.transactionHash });
    }
    names += n.length;
  }
  return { live: true, anns, names };
}
