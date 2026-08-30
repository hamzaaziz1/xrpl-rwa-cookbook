import 'dotenv/config'
import { Wallet } from 'xrpl'
import { connect, TESTNET, DEVNET } from './client.js'

function need(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`missing ${name} in .env`)
  return v
}

// AccountSet flag numbers
const asfRequireAuth              = 2
const asfDefaultRipple            = 8
const asfAllowTrustLineClawback   = 16

// AccountRoot ledger flags (what we read back)
const lsfRequireAuth   = 0x00040000
const lsfDefaultRipple = 0x00800000
const lsfAllowTrustLineClawback = 0x80000000

const NETWORK = process.env.XRPL_NETWORK ?? 'testnet'
const client = await connect(NETWORK === 'devnet' ? DEVNET : TESTNET)

const issuer = Wallet.fromSeed(need('ISSUER_SEED'))

console.log(`\nnetwork: ${NETWORK}`)
console.log(`issuer:  ${issuer.address}\n`)

async function send(label: string, tx: any, wallet: Wallet) {
  process.stdout.write(`> ${label} ... `)
  const res: any = await client.submitAndWait(tx, { wallet })
  const code = res.result.meta.TransactionResult
  console.log(`${code}`)
  if (code !== 'tesSUCCESS') throw new Error(`${label} failed: ${code}`)
  return res
}

async function showFlags(label: string) {
  const res: any = await client.request({
    command: 'account_info',
    account: issuer.address,
    ledger_index: 'validated',
  })
  const f = res.result.account_data.Flags ?? 0
  console.log(`\n--- ${label} ---`)
  console.log(`  raw flags:   0x${(f >>> 0).toString(16).padStart(8, '0')}`)
  console.log(`  RequireAuth: ${(f & lsfRequireAuth) ? 'on' : 'off'}`)
  console.log(`  DefaultRipple: ${(f & lsfDefaultRipple) ? 'on' : 'off'}`)
  console.log(`  Clawback:    ${(f & lsfAllowTrustLineClawback) ? 'on' : 'off'}\n`)
}

await showFlags('before')

// clawback FIRST — it can never be set once tokens exist
await send('AccountSet: AllowTrustLineClawback', {
  TransactionType: 'AccountSet',
  Account: issuer.address,
  SetFlag: asfAllowTrustLineClawback,
}, issuer)

await send('AccountSet: RequireAuth', {
  TransactionType: 'AccountSet',
  Account: issuer.address,
  SetFlag: asfRequireAuth,
}, issuer)

await send('AccountSet: DefaultRipple', {
  TransactionType: 'AccountSet',
  Account: issuer.address,
  SetFlag: asfDefaultRipple,
}, issuer)

await showFlags('after')

await client.disconnect()
console.log('issuer configured. tokens can now be issued.\n')
