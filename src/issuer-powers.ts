import 'dotenv/config'
import { Wallet } from 'xrpl'
import { connect, TESTNET, DEVNET } from './client.js'

function need(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`missing ${name} in .env`)
  return v
}

const CURRENCY = 'PRP'
const tfSetfAuth   = 0x00010000
const tfSetFreeze  = 0x00100000
const tfClearFreeze= 0x00200000

const NETWORK = process.env.XRPL_NETWORK ?? 'testnet'
const client = await connect(NETWORK === 'devnet' ? DEVNET : TESTNET)

const issuer = Wallet.fromSeed(need('ISSUER_SEED'))
const alice  = Wallet.fromSeed(need('HOLDER_SEED'))     // has 250 PRP

console.log(`\nnetwork: ${NETWORK}`)
console.log(`issuer:  ${issuer.address}`)
console.log(`alice:   ${alice.address}`)

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

async function line(account: string) {
  const res: any = await client.request({
    command: 'account_lines', account, ledger_index: 'validated',
  })
  return (res.result.lines ?? []).find((l: any) => l.currency === CURRENCY)
}

async function report(label: string) {
  const a = await line(alice.address)
  const b = await line(bob.address)
  console.log(`\n--- ${label} ---`)
  console.log(`  alice: ${a?.balance ?? '-'} PRP   frozen: ${a?.freeze_peer ? 'YES' : 'no'}`)
  console.log(`  bob:   ${b?.balance ?? '-'} PRP\n`)
}

// second holder, authorized, so we have somewhere to send
const { wallet: bob } = await client.fundWallet()
console.log(`bob:     ${bob.address}  (fresh)\n`)

await send('bob opens trust line', {
  TransactionType: 'TrustSet',
  Account: bob.address,
  LimitAmount: { currency: CURRENCY, issuer: issuer.address, value: '1000000' },
}, bob)

await send('issuer authorizes bob', {
  TransactionType: 'TrustSet',
  Account: issuer.address,
  LimitAmount: { currency: CURRENCY, issuer: bob.address, value: '0' },
  Flags: tfSetfAuth,
}, issuer)

await report('starting state')

// 1. freeze alice
await send('FREEZE alice', {
  TransactionType: 'TrustSet',
  Account: issuer.address,
  LimitAmount: { currency: CURRENCY, issuer: alice.address, value: '0' },
  Flags: tfSetFreeze,
}, issuer)

await report('alice frozen')

console.log('(alice tries to send 50 PRP to bob — should fail)')
await send('alice -> bob', {
  TransactionType: 'Payment',
  Account: alice.address,
  Destination: bob.address,
  Amount: { currency: CURRENCY, issuer: issuer.address, value: '50' },
}, alice, true)

// 2. unfreeze
await send('UNFREEZE alice', {
  TransactionType: 'TrustSet',
  Account: issuer.address,
  LimitAmount: { currency: CURRENCY, issuer: alice.address, value: '0' },
  Flags: tfClearFreeze,
}, issuer)

console.log('(same payment, now unfrozen)')
await send('alice -> bob', {
  TransactionType: 'Payment',
  Account: alice.address,
  Destination: bob.address,
  Amount: { currency: CURRENCY, issuer: issuer.address, value: '50' },
}, alice)

await report('unfrozen, transfer succeeded')

// 3. clawback — no consent from alice
console.log('(issuer claws back 100 PRP from alice — alice does not sign)')
await send('CLAWBACK', {
  TransactionType: 'Clawback',
  Account: issuer.address,
  Amount: { currency: CURRENCY, issuer: alice.address, value: '100' },
}, issuer)

await report('after clawback')

await client.disconnect()
console.log('done.\n')
