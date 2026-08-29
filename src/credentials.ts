import 'dotenv/config'
import { Wallet } from 'xrpl'
import { connect, TESTNET, DEVNET } from './client.js'

// ---------- helpers ----------

const toHex = (s: string) =>
  Buffer.from(s, 'utf8').toString('hex').toUpperCase()

const LSF_ACCEPTED = 0x00010000

function need(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`missing ${name} in .env`)
  return v
}

// ---------- setup ----------

const NETWORK = process.env.XRPL_NETWORK ?? 'testnet'
const client = await connect(NETWORK === 'devnet' ? DEVNET : TESTNET)

const issuer = Wallet.fromSeed(need('DOMAIN_OWNER_SEED'))
const holder = Wallet.fromSeed(need('HOLDER_SEED'))

const CRED_TYPE = toHex('KYC')

console.log(`\nnetwork:  ${NETWORK}`)
console.log(`issuer:   ${issuer.address}`)
console.log(`holder:   ${holder.address}`)
console.log(`type:     KYC (hex ${CRED_TYPE})\n`)

// ---------- read current credential state ----------

async function readCredentials(label: string) {
  const res: any = await client.request({
    command: 'account_objects',
    account: holder.address,
    type: 'credential',
    ledger_index: 'validated',
  })

  const objs = res.result.account_objects ?? []
  console.log(`--- ${label} ---`)

  if (objs.length === 0) {
    console.log('  (no credentials on this account)\n')
    return
  }

  for (const o of objs) {
    const accepted = (o.Flags & LSF_ACCEPTED) !== 0
    console.log(`  issuer:   ${o.Issuer}`)
    console.log(`  subject:  ${o.Subject}`)
    console.log(`  type:     ${Buffer.from(o.CredentialType, 'hex').toString('utf8')}`)
    console.log(`  accepted: ${accepted ? 'YES' : 'NO'}`)
    console.log(`  flags:    0x${(o.Flags ?? 0).toString(16).padStart(8, '0')}\n`)
  }
}

async function send(label: string, tx: any, wallet: Wallet) {
  process.stdout.write(`> ${label} ... `)
  const res: any = await client.submitAndWait(tx, { wallet })
  const code = res.result.meta.TransactionResult
  console.log(`${code}  (ledger ${res.result.ledger_index})`)
  if (code !== 'tesSUCCESS') throw new Error(`${label} failed: ${code}`)
  return res
}

// ---------- 1. issue ----------

await send('CredentialCreate', {
  TransactionType: 'CredentialCreate',
  Account: issuer.address,
  Subject: holder.address,
  CredentialType: CRED_TYPE,
  URI: toHex('https://example.test/kyc/holder-001'),
}, issuer)

// ---------- 2. read: exists, not accepted ----------

await readCredentials('after issue')

// ---------- 3. accept ----------

await send('CredentialAccept', {
  TransactionType: 'CredentialAccept',
  Account: holder.address,
  Issuer: issuer.address,
  CredentialType: CRED_TYPE,
}, holder)

// ---------- 4. read: accepted ----------

await readCredentials('after accept')

// ---------- 5. delete ----------

await send('CredentialDelete', {
  TransactionType: 'CredentialDelete',
  Account: issuer.address,
  Subject: holder.address,
  CredentialType: CRED_TYPE,
}, issuer)

// ---------- 6. read: gone ----------

await readCredentials('after delete')

await client.disconnect()
console.log('done.\n')
