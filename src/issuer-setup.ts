import 'dotenv/config'
import { Wallet } from 'xrpl'
import { connect, TESTNET, DEVNET } from './client.js'

function need(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`missing ${name} in .env`)
  return v
}

// AccountSet flag numbers (what you SET)
const asfRequireAuth            = 2
const asfDefaultRipple          = 8
const asfAllowTrustLineClawback = 16

// AccountRoot ledger flags (what you READ BACK)
const lsfRequireAuth            = 0x00040000
const lsfDefaultRipple          = 0x00800000
const lsfAllowTrustLineClawback = 0x80000000

const NETWORK = process.env.XRPL_NETWORK ?? 'testnet'
const client = await connect(NETWORK === 'devnet' ? DEVNET : TESTNET)

const issuer = Wallet.fromSeed(need('ISSUER_SEED'))

console.log(`\nnetwork: ${NETWORK}`)
console.log(`issuer:  ${issuer.address}\n`)

async function flags(): Promise<number> {
  const res: any = await client.request({
    command: 'account_info',
    account: issuer.address,
    ledger_index: 'validated',
  })
  return res.result.account_data.Flags ?? 0
}

function show(label: string, f: number) {
  console.log(`\n--- ${label} ---`)
  console.log(`  raw flags:     0x${(f >>> 0).toString(16).padStart(8, '0')}`)
  console.log(`  RequireAuth:   ${(f & lsfRequireAuth) ? 'on' : 'off'}`)
  console.log(`  DefaultRipple: ${(f & lsfDefaultRipple) ? 'on' : 'off'}`)
  console.log(`  Clawback:      ${(f & lsfAllowTrustLineClawback) ? 'on' : 'off'}\n`)
}

// only send if the flag isn't already set — safe to re-run
async function ensure(label: string, setFlag: number, ledgerBit: number) {
  const f = await flags()
  if (f & ledgerBit) {
    console.log(`> ${label} ... already set, skipping`)
    return
  }
  process.stdout.write(`> ${label} ... `)
  const res: any = await client.submitAndWait({
    TransactionType: 'AccountSet',
    Account: issuer.address,
    SetFlag: setFlag,
  }, { wallet: issuer })
  const code = res.result.meta.TransactionResult
  console.log(code)
  if (code !== 'tesSUCCESS') {
    if (code === 'tecOWNERS') {
      console.log(`
  tecOWNERS means this account already owns trust lines.
  AllowTrustLineClawback can only be set on an issuer that has never
  issued anything. If you need clawback, create a fresh issuer account
  and run this script before any issuance.
`)
    }
    throw new Error(`${label} failed: ${code}`)
  }
}

const before = await flags()
show('before', before)

// clawback FIRST — it can never be set once trust lines exist
await ensure('AllowTrustLineClawback', asfAllowTrustLineClawback, lsfAllowTrustLineClawback)
await ensure('RequireAuth',            asfRequireAuth,            lsfRequireAuth)
await ensure('DefaultRipple',          asfDefaultRipple,          lsfDefaultRipple)

show('after', await flags())

await client.disconnect()
console.log('issuer configured.\n')
