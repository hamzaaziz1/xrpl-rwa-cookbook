import { createHash } from 'node:crypto'
import { connect, TESTNET, DEVNET } from './client.js'

function amendmentId(name: string): string {
  return createHash('sha512').update(name).digest('hex').slice(0, 64).toUpperCase()
}

const AMENDMENTS_INDEX =
  '7DB0788C020F02780A673DC74757F23823FA3014C1866E72CC4CD8B226CD6EF4'

const WATCHING = [
  'Credentials',
  'MPTokensV1',
  'MPTokensV2',
  'PermissionedDomains',
  'PermissionedDEX',
  'TokenEscrow',
  'Clawback',
  'DeepFreeze',
  'Batch',
  'BatchV1_1',
]

const NETWORK = process.env.XRPL_NETWORK ?? 'testnet'
const client = await connect(NETWORK === 'devnet' ? DEVNET : TESTNET)

const res: any = await client.request({
  command: 'ledger_entry',
  index: AMENDMENTS_INDEX,
})

const live: string[] = res.result.node.Amendments ?? []

console.log(`\nnetwork: ${NETWORK}`)
console.log(`${live.length} amendments enabled\n`)
console.log('| Amendment | Enabled |')
console.log('|---|---|')
for (const name of WATCHING) {
  console.log(`| ${name} | ${live.includes(amendmentId(name)) ? 'yes' : 'no'} |`)
}

await client.disconnect()
