// Landing: a terminal of announcements (live ones once payments exist, a demo stream before), totals, assets, token.
const $ = (s) => document.querySelector(s);
const CFG = window.CFG;
const term = $("#term");
const hex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");
const sym = (addr) => (CFG.tokens.find((t) => (t.address || CFG.nativeMarker).toLowerCase() === addr.toLowerCase()) || { symbol: "TOKEN", decimals: 18 });
function line(html) {
  const d = document.createElement("div"); d.className = "ln"; d.innerHTML = html; term.appendChild(d);
  while (term.children.length > 14) term.firstChild.remove();
}
let live = [];
function demoLine() {
  const t = CFG.tokens[Math.floor(Math.random() * 5)], amt = t.symbol === "BNB" ? (Math.random() * 2).toFixed(3) : (Math.random() * 900 + 20).toFixed(2);
  return "<b>announce</b> 0x" + hex(4) + "…" + hex(2) + " <em>" + amt + " " + t.symbol + "</em> tag 0x" + hex(1) + " eph 02" + hex(5) + "…";
}
function tick() {
  if (live.length) { const a = live.shift(); live.push(a); const t = sym(a.token); line("<b>announce</b> " + a.tx.slice(0, 10) + "… <em>" + (Number(a.amount) / 10 ** t.decimals).toLocaleString("en-US", { maximumFractionDigits: 4 }) + " " + t.symbol + "</em> block " + a.block); }
  else line(demoLine());
  if (Math.random() < 0.3) line('<span style="color:#6b6152">scan, view tag mismatch, skipped</span>');
}
for (let i = 0; i < 8; i++) tick();
setInterval(tick, 1300);

$("#assetGrid").innerHTML = CFG.tokens.map((t) => '<span class="as"><img src="' + t.logo + '" alt="">' + t.symbol + "</span>").join("");

fetch("/api/stats").then((r) => r.json()).then((s) => {
  $("#stPay").textContent = (s.payments || 0).toLocaleString("en-US");
  $("#stNames").textContent = (s.names || 0).toLocaleString("en-US");
  if (s.last?.length) { live = s.last.slice(); $("#termState").textContent = "live · " + s.payments + " total"; }
  else $("#termState").textContent = "demo stream";
}).catch(() => {});

fetch("/token.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((t) => {
  if (!t?.ca) return;
  $("#caBox").innerHTML = '<div class="ca" id="ca"><span>$' + t.ticker + " CA</span>" + t.ca + "</div>";
  $("#ca").onclick = () => { navigator.clipboard.writeText(t.ca); $("#ca").querySelector("span").textContent = "Copied"; };
  if (t.url) { $("#tokLink").textContent = "$" + t.ticker; $("#tokLink").href = t.url; }
}).catch(() => {});
