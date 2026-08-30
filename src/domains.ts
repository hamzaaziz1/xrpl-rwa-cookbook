import 'dotenv/config'
import { Wallet } from 'xrpl'
import { connect, TESTNET, DEVNET } from './client.js'

const toHex = (s: string) =>
  Buffer.from(s, 'utf8').toString('hex').toUpperCase()

const LSF_ACCEPTED = 0x00010000

function need(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`missing ${name} in .env`)
  return v
}

const NETWORK = process.env.XRPL_NETWORK ?? 'testnet'
const client = await connect(NETWORK === 'devnet' ? DEVNET : TESTNET)

const owner  = Wallet.fromSeed(need('DOMAIN_OWNER_SEED'))
const holder = Wallet.fromSeed(need('HOLDER_SEED'))

const CRED_TYPE = toHex('KYC')

console.log(`\nnetwork: ${NETWORK}`)
console.log(`owner:   ${owner.address}`)
console.log(`holder:  ${holder.address}\n`)

async function send(label: string, tx: any, wallet: Wallet) {
  process.stdout.write(`> ${label} ... `)
  const res: any = await client.submitAndWait(tx, { wallet })
  const code = res.result.meta.TransactionResult
  console.log(`${code}  (ledger ${res.result.ledger_index})`)
  if (code !== 'tesSUCCESS') throw new Error(`${label} failed: ${code}`)
  return res
}

// membership is DERIVED, not stored. compute it.
async function isMember(account: string, domainId: string): Promise<boolean> {
  const dom: any = await client.request({
    command: 'ledger_entry',
    index: domainId,
    ledger_index: 'validated',
  })

  const accepted = (dom.result.node.AcceptedCredentials ?? []).map((c: any) => ({
    issuer: c.Credential.Issuer,
    type: c.Credential.CredentialType,
  }))

  const held: any = await client.request({
    command: 'account_objects',
    account,
    type: 'credential',
    ledger_index: 'validated',
  })

  for (const c of held.result.account_objects ?? []) {
    if ((c.Flags & LSF_ACCEPTED) === 0) continue        // issued but not accepted
    if (accepted.some((a: any) => a.issuer === c.Issuer && a.type === c.CredentialType)) {
      return true
    }
  }
  return false
}

async function report(label: string, domainId: string) {
  const inDomain = await isMember(holder.address, domainId)
  console.log(`--- ${label} ---`)
  console.log(`  holder in domain: ${inDomain ? 'YES' : 'NO'}\n`)
}

// 1. create the domain, accepting KYC credentials from our issuer
const created = await send('PermissionedDomainSet', {
  TransactionType: 'PermissionedDomainSet',
  Account: owner.address,
  AcceptedCredentials: [
    { Credential: { Issuer: owner.address, CredentialType: CRED_TYPE } },
  ],
}, owner)

const domainId = (created.result.meta.AffectedNodes as any[])
  .map(n => n.CreatedNode)
  .find(n => n?.LedgerEntryType === 'PermissionedDomain')
  ?.LedgerIndex

if (!domainId) throw new Error('could not find created domain in metadata')
console.log(`  domainId: ${domainId}\n`)

// 2. nobody is in it yet
await report('domain created, no credential', domainId)

// 3. issue the credential (not yet accepted)
await send('CredentialCreate', {
  TransactionType: 'CredentialCreate',
  Account: owner.address,
  Subject: holder.address,
  CredentialType: CRED_TYPE,
}, owner)

await report('credential issued, NOT accepted', domainId)

// 4. holder accepts -> now a member
await send('CredentialAccept', {
  TransactionType: 'CredentialAccept',
  Account: holder.address,
  Issuer: owner.address,
  CredentialType: CRED_TYPE,
}, holder)

await report('credential accepted', domainId)

// 5. revoke -> access disappears, domain untouched
await send('CredentialDelete', {
  TransactionType: 'CredentialDelete',
  Account: owner.address,
  Subject: holder.address,
  CredentialType: CRED_TYPE,
}, owner)

await report('credential revoked', domainId)


await client.disconnect()
