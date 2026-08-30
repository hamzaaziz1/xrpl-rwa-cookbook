import 'dotenv/config'
import { Wallet } from 'xrpl'
import { connect, TESTNET, DEVNET } from './client.js'

const toHex = (s: string) =>
  Buffer.from(s, 'utf8').toString('hex').toUpperCase()

function need(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`missing ${name} in .env`)
  return v
}

const CURRENCY   = 'PRP'
const CRED_TYPE  = toHex('KYC')
const tfSetfAuth = 0x00010000

const NETWORK = process.env.XRPL_NETWORK ?? 'testnet'
const client = await connect(NETWORK === 'devnet' ? DEVNET : TESTNET)

const issuer = Wallet.fromSeed(need('ISSUER_SEED'))   // issues PRP
const kyc    = Wallet.fromSeed(need('DOMAIN_OWNER_SEED')) // issues credentials, owns domain

console.log(`\nnetwork: ${NETWORK}`)
console.log(`issuer:  ${issuer.address}`)
console.log(`kyc/dom: ${kyc.address}\n`)

async function send(label: string, tx: any, wallet: Wallet, allowFail = false) {
  process.stdout.write(`> ${label} ... `)
  try {
    const res: any = await client.submitAndWait(tx, { wallet })
    const code = res.result.meta.TransactionResult
    console.log(code)
    if (code !== 'tesSUCCESS' && !allowFail) throw new Error(`${label}: ${code}`)
    return { code, res }
  } catch (e: any) {
    if (allowFail) { console.log(`FAILED: ${e.message}`); return { code: 'error', res: null } }
    throw e
  }
}

// give an account a KYC credential and PRP tokens
async function onboard(name: string, withCredential: boolean, prp: string) {
  const { wallet } = await client.fundWallet()
  console.log(`\n=== ${name}: ${wallet.address} ===`)

  await send(`${name} opens PRP trust line`, {
    TransactionType: 'TrustSet',
    Account: wallet.address,
    LimitAmount: { currency: CURRENCY, issuer: issuer.address, value: '1000000' },
  }, wallet)

  await send(`issuer authorizes ${name}`, {
    TransactionType: 'TrustSet',
    Account: issuer.address,
    LimitAmount: { currency: CURRENCY, issuer: wallet.address, value: '0' },
    Flags: tfSetfAuth,
  }, issuer)

  if (prp !== '0') {
    await send(`issuer sends ${prp} PRP to ${name}`, {
      TransactionType: 'Payment',
      Account: issuer.address,
      Destination: wallet.address,
      Amount: { currency: CURRENCY, issuer: issuer.address, value: prp },
    }, issuer)
  }

  if (withCredential) {
    await send(`KYC credential -> ${name}`, {
      TransactionType: 'CredentialCreate',
      Account: kyc.address,
      Subject: wallet.address,
      CredentialType: CRED_TYPE,
    }, kyc)

    await send(`${name} accepts credential`, {
      TransactionType: 'CredentialAccept',
      Account: wallet.address,
      Issuer: kyc.address,
      CredentialType: CRED_TYPE,
    }, wallet)
  } else {
    console.log(`  (${name} gets NO credential — deliberately)`)
  }

  return wallet
}

// ---------- domain ----------

const { res: domRes } = await send('create permissioned domain', {
  TransactionType: 'PermissionedDomainSet',
  Account: kyc.address,
  AcceptedCredentials: [
    { Credential: { Issuer: kyc.address, CredentialType: CRED_TYPE } },
  ],
}, kyc)

const domainId = (domRes.result.meta.AffectedNodes as any[])
  .map((n: any) => n.CreatedNode)
  .find((n: any) => n?.LedgerEntryType === 'PermissionedDomain')
  ?.LedgerIndex

if (!domainId) throw new Error('no domain created')
console.log(`  domainId: ${domainId}`)

// ---------- participants ----------

const alice = await onboard('alice', true,  '500')  // member, holds PRP
const bob   = await onboard('bob',   true,  '0')    // member, buying
const carol = await onboard('carol', false, '100')  // NOT a member

// ---------- alice sells PRP inside the domain ----------

console.log('\n--- alice places a permissioned offer (sell 100 PRP for 10 XRP) ---')
await send('alice OfferCreate (domain)', {
  TransactionType: 'OfferCreate',
  Account: alice.address,
  TakerGets: { currency: CURRENCY, issuer: issuer.address, value: '100' },
  TakerPays: '10000000',
  DomainID: domainId,
}, alice)

// ---------- carol, no credential, tries the same domain ----------

console.log('\n--- carol (no credential) tries to place an offer in the domain ---')
await send('carol OfferCreate (domain)', {
  TransactionType: 'OfferCreate',
  Account: carol.address,
  TakerGets: '10000000',
  TakerPays: { currency: CURRENCY, issuer: issuer.address, value: '100' },
  DomainID: domainId,
}, carol, true)

// ---------- bob, a member, crosses alice's offer ----------

console.log('\n--- bob (member) takes the other side ---')
await send('bob OfferCreate (domain)', {
  TransactionType: 'OfferCreate',
  Account: bob.address,
  TakerGets: '10000000',
  TakerPays: { currency: CURRENCY, issuer: issuer.address, value: '100' },
  DomainID: domainId,
}, bob)

// ---------- result ----------

async function bal(w: Wallet, name: string) {
  const r: any = await client.request({
    command: 'account_lines', account: w.address, ledger_index: 'validated',
  })
  const l = (r.result.lines ?? []).find((x: any) => x.currency === CURRENCY)
  const info: any = await client.request({
    command: 'account_info', account: w.address, ledger_index: 'validated',
  })
  const xrp = Number(info.result.account_data.Balance) / 1_000_000
  console.log(`  ${name.padEnd(6)} ${(l?.balance ?? '0').padStart(6)} PRP   ${xrp.toFixed(2)} XRP`)
}

console.log('\n--- final balances ---')
await bal(alice, 'alice')
await bal(bob,   'bob')
await bal(carol, 'carol')

await client.disconnect()
console.log('\ndone.\n')
