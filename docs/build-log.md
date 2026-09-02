# build log: compliant RWA tokenization on the XRP Ledger

a running account of building this thing. written as i go, so the wrong turns
are still in it.

---

## day 1 — the plan changed before i wrote a line of code

the idea was straightforward enough. issue a token representing fractional
ownership of a real asset, gate who can hold and trade it using on-chain
identity, and give the issuer the controls a regulated institution actually
needs. freeze, clawback, an allowlist. build it on the XRP Ledger because
that's where the interesting tokenization work is happening.

my first sketch was: mint a Multi-Purpose Token, wrap it in a permissioned
domain, let members trade it on the permissioned DEX.

that doesn't work. MPTs have a flag called Can Trade, which reads like it
should mean you can trade them, but MPT support on the decentralized exchange
isn't implemented yet. it's a separate amendment, MPTokensV2, still in
development. so a secondary market in MPTs isn't a thing i could build. it's a
thing i could describe.

second casualty: Batch. bundling transactions so they either all succeed or all
fail is the obvious way to do delivery-versus-payment — buyer pays, seller
delivers, no window where one has happened and the other hasn't. Batch was
disabled after a bug in how it validated signatures on the inner transactions,
and replaced by BatchV1_1.

so the architecture became:

- the asset is a **trust line token**, not an MPT, because that's what the
  permissioned DEX can actually trade today
- MPT stays in the project as a second issuance path, with escrow-based
  settlement instead of an order book
- settlement is not atomic, and i say why rather than pretending it is

i'd rather ship something where the compromises are documented than something
that quietly doesn't do what the readme claims.

---

## day 1 — proving it instead of trusting it

everything above came from reading. before building on it i wanted the network
itself to confirm it.

the XRP Ledger keeps a public record of which protocol features are switched
on. amendments, they're called — each one activates only after enough
validators vote for it, so different networks are on different versions.

reading that record was easy. making sense of it wasn't, because the ledger
identifies each amendment by a 64-character hex string, not a name. the obvious
move is to copy the IDs from the docs into a lookup table. i didn't like that.
it goes stale, and one mistyped character sends you debugging code that's fine.

turns out you don't need the table. **an amendment's ID is the first half of
the SHA-512 hash of its name.** hash the string `Credentials` and you get its
ID exactly.

```ts
function amendmentId(name: string): string {
  return createHash('sha512').update(name).digest('hex').slice(0, 64).toUpperCase()
}
```

so the script holds a list of words and derives the rest. adding a new
amendment to watch is one line.

what it told me, on testnet:

| amendment | enabled |
|---|---|
| Credentials | yes |
| MPTokensV1 | yes |
| MPTokensV2 | **no** |
| PermissionedDomains | yes |
| PermissionedDEX | yes |
| TokenEscrow | yes |
| Clawback | yes |
| DeepFreeze | yes |
| Batch | no |
| BatchV1_1 | no |

everything the design needs is on. the two things it doesn't rely on are off.
that's the architecture confirmed by the network rather than by me.

then i ran it against devnet and got something i wasn't expecting. 87
amendments instead of 78, and **BatchV1_1 is live there.** which means atomic
delivery-versus-payment is testable today, just not on the network i'm
building on. that's now a devnet-only branch of the project rather than
something i wrote off.

that finding alone justified the script. i'd have missed it entirely.

---

## day 1 — the boring failures

worth recording because they're most of what actually happens.

`package.json` ended up with two opening braces and two `"type"` keys after i
hand-edited it. node's error was `ERR_INVALID_PACKAGE_CONFIG`, which tells you
nothing about which character is wrong. JSON has no concept of a duplicate key
being an error — the last one silently wins — so even after fixing the brace,
`"type": "commonjs"` further down was quietly overriding the `"module"` i'd
added at the top.

lesson: use `npm pkg set` instead of editing the file by hand.

then a `client` declared twice, then an import i'd forgotten. three failures in
a row, all before anything touched the network.

that's a useful distinction actually. errors that fire during the transform
step are my code failing to parse. errors that come back as `tec` or `tem`
codes are the ledger rejecting something. completely different debugging.
i spent a while sorting failures into those two buckets before i had any
transaction land.

---

## day 2 — credentials, and why they're two-sided

a credential is one account making a signed statement about another. "i certify
this account is KYC-verified." a verified badge with a named issuer.

the part i didn't expect: the issuer creates it, and the subject has to
separately accept it. you can't staple an attribute onto someone's account
without their agreement.

so there are three states, not two. doesn't exist, issued-but-not-accepted, and
active. i watched the flags field go `0x00000000` → `0x00010000` → gone across
the lifecycle.

that middle state is going to matter in the UI. "approved but not yet accepted"
is a real thing a user can be sitting in, and if i'd assumed two states i'd
have built something that shows them as rejected.

one detail worth knowing: the credential object lives on the **subject's**
account, not the issuer's. the person holds the badge; the issuer just signed
it. so you query the holder to find out what they've been granted.

---

## day 2 — the bit that makes this worth building

permissioned domains. a domain is a list of credentials it accepts. hold one,
you're in.

there is no member list. anywhere. i went looking for it and it doesn't exist,
and that's deliberate — membership is computed on the fly from whatever
credentials you're currently holding. so my `isMember` function reads the
domain's accepted-credential list, reads the account's credentials, and
intersects them. it's derived state, not stored state.

which has a consequence i want to spell out, because it's the whole point.

i ran four membership checks:

```
domain created, no credential        NO
credential issued, NOT accepted      NO
credential accepted                  YES
credential revoked                   NO
```

between the third and fourth, i deleted one credential. **the domain was never
touched.** access disappeared anyway.

in a real deployment that's a regulator pulling someone's accreditation and
every venue that trusts that accreditation locking them out simultaneously. no
allowlist to update, no coordination between platforms, no window where one
venue has processed the revocation and another hasn't.

i've built allowlists on EVM. they're arrays you maintain, and every contract
that cares needs its own copy or a call out to a registry. this is the same
outcome with none of the synchronisation problem, because there's nothing to
synchronise.

that's the first thing in this project that made me think the ledger choice
was actually right rather than just topical.

second-order thing i noticed: because it's derived, the check is only as fresh
as the ledger you read. i'm querying `validated`, which is the safe choice.
reading `current` would give you membership based on a ledger that hasn't been
finalised yet, and for a compliance check that's exactly the wrong tradeoff.

---

## day 2 — issuer controls

next: the asset itself. fractional property title, currency code `PRP`.

before issuing anything, the issuer account has to declare what powers it's
keeping. three flags:

- **RequireAuth** — nobody holds this token without individual approval. the
  allowlist.
- **AllowTrustLineClawback** — the issuer can recover tokens. sanctions, court
  orders, fraud.
- **DefaultRipple** — without it, tokens only move between issuer and holder,
  never holder to holder. no secondary market at all.

the clawback flag has a trap in it: **it can't be enabled once any tokens
exist.** set it before you issue, or recreate the issuer account. i set it
first in the script for that reason.

the account flags went `0x00000000` → `0x80840000`, which decomposes cleanly:
`0x80000000` clawback, `0x00800000` default ripple, `0x00040000` require auth.
three settings, one integer.

one wrinkle that cost me a minute. the numbers you use to *set* a flag (2, 8,
16) are not the bits you read back. setting takes an index, the ledger stores a
bit position. two numbering schemes for the same thing.

---

## day 2 — one error code, several meanings

*(i got the count wrong here. see day 3 — the tests caught it.)*

issuing tokens is three transactions. the holder opens a trust line, saying
"i'm willing to hold up to X of this from this issuer" — you opt in, and you
set your own ceiling, so nobody can push tokens at you unsolicited. then the
issuer authorises that line. then the issuer sends a payment.

i deliberately ran the payment before the authorisation, to see what refusal
looks like. i expected `tecNO_AUTH`.

i got **`tecPATH_DRY`**.

what's happening is that the payment engine looks for a route to deliver the
tokens, finds the unauthorised line unusable, and reports "no liquidity"
instead of "not authorised." technically true, diagnostically useless.

then later, testing freeze, an authorised holder with a healthy balance tried
to send tokens on a frozen line. `tecPATH_DRY` again.

so far i've seen that one code mean:

- no trust line exists
- the line exists but isn't authorised
- the line is frozen
- there's genuinely no path

four causes, one error. which means any SDK worth using has to catch
`tecPATH_DRY` and go figure out which one actually applies before showing
anything to a user. telling someone "no liquidity" when the real answer is "you
haven't been KYC'd yet" is a terrible error message, and it's the default.

i've also got the field names wrong once already. querying `account_lines` on
the holder, `authorized` means *the holder authorised the issuer* — the
opposite direction to what i wanted. the field for "did the issuer authorise
this line" is `peer_authorized`. trust lines are two-sided objects and every
field has a side, which i keep forgetting.

---

## day 2 — the run that lied to me

i re-ran the issuance script after fixing that field name and got:

```
--- line open, NOT authorized ---
  balance:    250 PRP
  authorized: YES
```

the label says not authorised. the state says authorised, with a balance. both
printed by the same script, one line apart.

nothing was broken. the script assumes it starts from an empty account, and the
second run didn't — the trust line was already there and already authorised
from the first run. so every step succeeded, the balances climbed 250 → 500 →
750, and the labels described a sequence that hadn't happened.

this is the failure mode i care most about. it didn't error. it produced
confident, well-formatted, completely wrong output. if that had happened in a
demo rather than in front of me, nobody would have caught it.

fix was to create a fresh holder account per run, so the script genuinely
starts from zero every time. costs a few seconds of faucet time.

the cost of that fix: the holder is now disposable, so anything downstream
needs its details handed forward explicitly. small, but it's the same shape as
the problem it solved — state that's implicit is state that will surprise you.

i'm noting this because the same principle governs the registry design later
on. a projection you can rebuild from scratch and get an identical result is
trustworthy. one that only works if you've run the right things in the right
order is not.

---

## day 2 — what the issuer can actually do

the regulator demo. alice holds PRP, and the issuer:

```
FREEZE alice          -> alice tries to send 50 to bob -> tecPATH_DRY
UNFREEZE alice        -> same payment                  -> tesSUCCESS
CLAWBACK 100 from alice
```

balances: alice 750 → 700 after sending bob 50 → **600 after the clawback.**

the clawback is the one to sit with. alice held 700 PRP. she wasn't frozen. she
signed nothing and approved nothing. the issuer submitted one transaction and
her balance became 600.

on EVM that's a function you write into the token contract deliberately, and an
auditor flags it as centralisation risk in the report. here it's a protocol
primitive — off by default, and the issuer has to opt in before issuing a
single token, but native.

i think both reactions to that are correct. it's exactly what a regulated
issuer needs in order to comply with a court order or a sanctions listing. it's
also exactly what people mean when they say a chain isn't credibly neutral. the
honest framing is that this is a deliberate trade, made at the protocol level,
which is at least more visible than the same power buried in a proxy contract's
implementation.

the transfer between alice and bob also quietly proved the DefaultRipple flag
was necessary. without it that payment fails, because tokens can only move
between the issuer and a holder. the entire secondary market depends on a flag
that sounds like an obscure setting.

---


## day 2 — a market that non-members can't enter

the last piece. alice and bob both hold KYC credentials and are in the domain.
carol holds PRP, has an authorised trust line, and no credential.

alice offers 100 PRP for 10 XRP inside the domain. bob takes the other side.

```
alice   500 -> 400 PRP    100 -> 110 XRP
bob       0 -> 100 PRP    100 ->  90 XRP
carol   100 PRP, untouched
```

a hundred tokens moved against ten XRP between two parties, neither of whom is
the issuer. that's a real secondary market trade, settling under transfer
restrictions.

carol got `tecNO_PERMISSION`. a clear error for once.

but the mechanism is the thing i want to record, because it's not what i
assumed. carol isn't blocked by a permission check that runs when she trades.
her offer would go into a **different order book** — permissioned offers carry
a domain ID and only ever match other offers carrying the same one. she can't
place into that book at all.

so it's not compliance by veto. it's compliance by market segregation. the
non-member isn't rejected at the point of trade; they were never in the same
market. which is a stronger guarantee, because there's no code path where a
check gets skipped and a trade slips through.

carol also kept everything. she wasn't frozen, wasn't penalised, wasn't
flagged. she just isn't in that venue. that's a meaningfully different posture
from a blocklist, and it's closer to how permissioned markets actually work
off-chain.

---

## day 2 — the same bug, three times

i tried to wire the six scripts into a single `run-all` so someone could see
the whole arc with one command. it broke twice before it worked, and both
breaks were the same underlying mistake i'd already made once.

`issuer-setup` failed with `tecOWNERS`. that means "this account owns objects
that block this change" — the clawback flag can only be set on an issuer with
no trust lines, and by then mine had several. the script had already printed
`0x80840000` at the top, showing all three flags were on. it went ahead and
tried to set them again anyway.

then `issuer-powers` failed with `tecNO_LINE_REDUNDANT`, because it expected an
account from `.env` to already be holding PRP, and that account had been
replaced by a fresh one.

three failures, one cause: **every script assumed it started from a known
state, and none of them checked.**

that's fine when i'm running them in order, having just run the one before. it
is not fine for the person i actually built this for, who will clone the repo
and run whatever looks interesting. and it's the exact failure i'd already been
bitten by when a script printed confident labels over stale state.

so the rule now is: each script either creates everything it needs, or reads
what exists and adapts. `issuer-setup` checks each flag and skips what's
already set. everything else funds its own accounts.

`issuer-setup` also came out of the run-all loop entirely, because it's
genuinely one-time — clawback can't be enabled after issuance, so the script
can only ever succeed on a virgin account. a setup step that runs once isn't a
step in a repeatable sequence, and pretending otherwise was the actual error.

full run is green now. six scripts, start to finish, one command.

---

## day 3 — the thing worth building

stepping back from the cookbook. i'd planned an SDK wrapping every primitive —
identity, domains, issuance, market, settlement. then i looked at what i'd
actually spent two days on.

it wasn't the transaction wrappers. those are thin, and i wrote six of them in
an afternoon. what cost me time was:

- `tecPATH_DRY` meaning four different things, with no way to tell which
- domain membership being derived, so there's nothing to query
- trust line fields having a direction, and `authorized` being the wrong one
- clawback failing on a flag i should have set two days earlier

none of that is a wrapper problem. it's a **diagnostics problem**. the ledger
tells you a transaction failed and gives you almost nothing about why.

so the library became `xrpl-why`. it answers one question: what actually went
wrong.

first version handles `tecPATH_DRY` by going and looking. does the trust line
exist? does the issuer require auth, and did it authorise this line? frozen,
either side, or globally? does the sender hold enough? if everything checks out,
it's probably DefaultRipple.

tested it against a deliberately unauthorised payment:

```
ledger said: tecPATH_DRY

summary: The issuer requires authorization and has not authorized
         this trust line.

checks run:
  - read trust lines for destination rwHtVas...
  - trust line exists
  - read issuer flags: 0x00040000
```

that gap between what the ledger says and what you needed to know is the whole
product.

one design choice i want to keep: it returns the list of checks it ran, not
just a verdict. a diagnostic that asserts a cause is something you have to
trust. one that shows its working is something you can verify. it also fails
gracefully — when it can't determine the cause, you can see exactly how far it
got before giving up.

not publishing until there are tests. a diagnostic tool that confidently
returns the wrong answer is worse than no tool at all, and i've already had one
script this week produce well-formatted output that was completely wrong
without erroring. that's the failure mode to be paranoid about here.

---



---

## day 3 — the tests falsified something i'd already published

wrote the test suite for `xrpl-why` today. five cases, each one constructing a
real failure on testnet and asserting the library names the right cause. no
mocks — the whole claim of this library is that it knows what the ledger
actually does, and testing it against responses i'd invented would undercut
exactly the thing it's selling.

two of the five failed. both were worth having.

**the bug.** the frozen-line case fell through every check and landed on the
DefaultRipple fallback. cause: `explain()` reads `account_lines` on the
*destination*. when alice is frozen and sends to bob, i was inspecting bob's
line — which is fine — and never looking at alice's. freeze can be on either
side of a transfer and i only checked one.

that would have shipped. the library would have confidently told people
"probably DefaultRipple" every time a frozen holder tried to send, which is
worse than saying nothing.

**the wrong claim.** i had written, in this log and in the cookbook README,
that `tecPATH_DRY` means four things, one of them being insufficient balance.

it doesn't. insufficient balance returns **`tecPATH_PARTIAL`** — a completely
different code, meaning "found a path, couldn't carry the full amount." three
causes for `tecPATH_DRY`, and a fourth situation with its own code.

i'd already pushed that claim to a public repo. it was wrong in public, with my
name on it, and it took a test hitting the real network to find out.

that's the whole argument for integration tests over mocks, in one example. a
mock would have returned whatever i believed. the network returned what's
true.

the correction also improves the library — `tecPATH_PARTIAL` is genuinely more
informative than `tecPATH_DRY`, so it gets its own branch rather than being
lumped in with the others.

five green now. the tests take three minutes because every case funds accounts
and waits for validation, and i think that's the right trade. slow tests i
trust beat fast tests i don't.

one smaller thing worth noting: vitest has separate timeout budgets for tests
and for hooks. i set `--testTimeout` and the whole suite still failed, because
`beforeAll` funds an account and submits two transactions, and hooks default to
ten seconds. anything doing real network work in setup needs `--hookTimeout`
too.

---

*continues.*
