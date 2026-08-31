# xrpl-rwa-cookbook

Runnable scripts for the XRP Ledger's compliance primitives — the pieces you'd
need to issue a regulated real-world asset and let it trade under transfer
restrictions.

Every script is standalone, runs against testnet, and prints what changed on
the ledger at each step.

## Scripts

| Command | What it does |
|---|---|
| `npm run fund` | Creates three funded testnet accounts (issuer, credential issuer, holder) |
| `npm run amendments` | Reports which amendments are enabled; compares testnet and devnet |
| `npm run credentials` | Credential lifecycle: issue, accept, delete |
| `npm run domains` | Permissioned domain membership, and what revocation does to it |
| `npm run issuer` | Configures issuer controls: RequireAuth, Clawback, DefaultRipple |
| `npm run issue` | Trust line, authorization, first tokens issued |
| `npm run powers` | Freeze, blocked transfer, unfreeze, clawback |
| `npm run dex` | Permissioned DEX: member trade settles, non-member refused |

## Setup
npm install
npm run fund # copy the output into .env
npm run issuer # run once, before issuing anything
npm run all   # runs everything end to end

## Notes from building this

**Amendment IDs are derived, not looked up.** An amendment's ID is the first
half of the SHA-512 of its name, so `amendments.ts` computes them rather than
carrying a lookup table that goes stale.

**Domain membership isn't stored anywhere.** It's derived from the credentials
an account currently holds. Revoking a credential removes access immediately,
with no transaction touching the domain and no allowlist to synchronise.

**Credentials are two-sided.** The issuer creates one and the subject must
accept it, so there are three states — absent, issued-but-unaccepted, and
active. The middle one is easy to mistake for rejection.

**`tecPATH_DRY` means at least four different things.** Missing trust line,
unauthorized line, frozen line, or genuinely no path. The payment engine reports
"no liquidity" regardless of cause, so anything user-facing has to disambiguate
before showing an error.

**`AllowTrustLineClawback` cannot be enabled once tokens exist.** Set it before
the first issuance or recreate the issuer account.

**Trust line fields have a direction.** Querying `account_lines` on a holder,
`authorized` means the holder authorized the issuer. The field you usually want
is `peer_authorized`.

**MPTs can't trade on the DEX yet.** That's `MPTokensV2` (XLS-82), still in
development, which is why the asset here is a trust line token. `BatchV1_1` is
live on devnet but not testnet, so atomic delivery-versus-payment is testable
on one network and not the other.

Testnet only.
