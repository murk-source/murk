# Murk

Stealth payments on BNB Smart Chain. Every payment goes to a fresh one-time address that only the receiver can link to themselves and spend from.

Live: https://murkfi.xyz

## How it works

Murk implements [ERC-5564](https://eips.ethereum.org/EIPS/eip-5564) scheme 1 (secp256k1 with view tags).

- **Receiving keys.** The receiver's wallet signs one fixed message. The signature is hashed into two private keys, spending and viewing. They are derived in the browser each time and never sent anywhere. Their public halves form the stealth meta-address (`st:bnb:0x…`, 66 bytes).
- **Names.** A meta-address can be registered under a name (3-20 characters, `a-z 0-9 _`), so payers can use `murkfi.xyz/pay/<name>`.
- **Paying.** The payer's browser picks a random key `r`, computes `shared = r·P_view`, `h = keccak256(shared)` and the one-time address `P_spend + h·G`. The contract sends the funds straight to that address and emits an `Announcement` with `R = r·G` and the view tag `h[0]`.
- **Finding payments.** The receiver's browser checks each announcement with the viewing key. The view tag skips 255 of 256 announcements after one multiplication. For a match, the one-time private key is `(s + h) mod n`.
- **Collecting.** Each one-time address signs its own transfer to any address the receiver chooses. Token payments carry a little BNB along so the one-time address can pay its own gas.

Assets in the app: BNB, USDT, USDC, USD1, FDUSD, BTCB, ETH and CAKE. The contract accepts any ERC-20.

## Contract

`StealthPay` ([contracts/src/StealthPay.sol](contracts/src/StealthPay.sol)):

| Function | |
|---|---|
| `setName(name, meta)` | claim or update a name for a meta-address |
| `lookup(name)` | owner and meta-address of a name |
| `payNative(stealth, ephemeralPubKey, viewTag)` | send BNB to a one-time address |
| `payToken(token, amount, stealth, ephemeralPubKey, viewTag)` | send an approved ERC-20; any BNB sent along goes to the same address |

It has no owner, no fee and no admin functions, and it never holds funds after a call.

Deployed on BNB Smart Chain (chain id 56): [`0x61c048e61b6ab40806878a457B7c95f831CFC7C7`](https://bscscan.com/address/0x61c048e61b6ab40806878a457B7c95f831CFC7C7)

## Layout

```
contracts/   Foundry project: StealthPay, tests, deploy script
site/        Cloudflare Worker: static site (public/) and /api/* (announcement index, totals, name lookup)
```

The pages are plain ES modules with no build step. Curve math comes from `@noble/curves` and chain calls from `viem`.

## Run

```bash
cd contracts
forge install foundry-rs/forge-std@v1.16.2 OpenZeppelin/openzeppelin-contracts@v5.1.0 --no-git
forge test
```

```bash
cd site
npx wrangler dev
```

Deploy the contract with `forge script script/Deploy.s.sol --rpc-url <rpc> --broadcast`, put its address and deploy block in `site/public/deployment.json` (`{ "stealthPay": "0x…", "block": 123 }`), then `npx wrangler deploy` in `site/`.

## Notes

- Unaudited. Use at your own risk.
- Privacy covers the link between payer and receiver. Amounts and the payer's address are public, and collecting from many one-time addresses to one address links them again.
- The worker only indexes public chain data. Keys and the receiver's identity never leave the browser.

## License

MIT
