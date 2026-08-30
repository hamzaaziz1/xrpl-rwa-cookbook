import 'dotenv/config'
import { Wallet } from 'xrpl'
import { connect, TESTNET, DEVNET } from './client.js'

function need(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`missing ${name} in .env`)
  return v
}

const CURRENCY = 'PRP'
const LIMIT    = '1000000'
const ISSUE    = '250'

const tfSetfAuth = 0x00010000

const NETWORK = process.env.XRPL_NETWORK ?? 'testnet'
const client = await connect(NETWORK === 'devnet' ? DEVNET : TESTNET)

const issuer = Wallet.fromSeed(need('ISSUER_SEED'))
const { wallet: holder } = await client.fundWallet()

console.log(`\nnetwork:  ${NETWORK}`)
console.log(`issuer:   ${issuer.address}`)
console.log(`holder:   ${holder.address}  (fresh)`)
console.log(`currency: ${CURRENCY}\n`)

async function send(label: string, tx: any, wallet: Wallet, allowFail = false) {
  process.stdout.write(`> ${label} ... `)
  try {
    const res: any = await client.submitAndWait(tx, { wallet })
    const code = res.result.meta.TransactionResult
    console.log(code)
    if (code !== 'tesSUCCESS' && !allowFail) throw new Error(`${label}: ${code}`)
    return code
  } catch (e: any) {
    if (allowFail) { console.log(`FAILED: ${e.message}`); return 'error' }
    throw e
  }
}

async function showLines(label: string) {
  const res: any = await client.request({
    command: 'account_lines',
    account: holder.address,
    ledger_index: 'validated',
  })
  const lines = (res.result.lines ?? []).filter((l: any) => l.currency === CURRENCY)
  console.log(`\n--- ${label} ---`)
  if (lines.length === 0) { console.log('  (no trust line)\n'); return }
  for (const l of lines) {
    console.log(`  balance:    ${l.balance} ${l.currency}`)
    console.log(`  limit:      ${l.limit}`)
    console.log(`  authorized: ${l.peer_authorized ? 'YES' : 'NO'}`)
    console.log(`  frozen:     ${l.freeze_peer ? 'YES' : 'no'}\n`)
  }
}

// 1. holder opts in
await send('TrustSet (holder opens line)', {
  TransactionType: 'TrustSet',
  Account: holder.address,
  LimitAmount: { currency: CURRENCY, issuer: issuer.address, value: LIMIT },
}, holder)

await showLines('line open, NOT authorized')

// 2. deliberately try to pay before authorizing -> tecNO_AUTH
console.log('(deliberate failure — sending before authorization)')
await send('Payment (should fail)', {
  TransactionType: 'Payment',
  Account: issuer.address,
  Destination: holder.address,
  Amount: { currency: CURRENCY, issuer: issuer.address, value: ISSUE },
}, issuer, true)

// 3. issuer authorizes the line
await send('TrustSet (issuer authorizes)', {
  TransactionType: 'TrustSet',
  Account: issuer.address,
  LimitAmount: { currency: CURRENCY, issuer: holder.address, value: '0' },
  Flags: tfSetfAuth,
}, issuer)

await showLines('authorized, no balance')

// 4. now the payment works
await send('Payment (issue tokens)', {
  TransactionType: 'Payment',
  Account: issuer.address,
  Destination: holder.address,
  Amount: { currency: CURRENCY, issuer: issuer.address, value: ISSUE },
}, issuer)

await showLines('tokens issued')

console.log(`\nHOLDER_SEED=${holder.seed}`)
console.log(`HOLDER_ADDRESS=${holder.address}`)


await client.disconnect()
console.log('done.\n')
