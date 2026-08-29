import { createHash } from 'node:crypto'
import { connect } from './client.js'

// amendment ID = first half of sha512(name)
function amendmentId(name: string): string {
  return createHash('sha512').update(name).digest('hex').slice(0, 64).toUpperCase()
}

const WATCHING = [
  'Credentials',
  'MPTokensV1',
  'MPTokensV2',          // XLS-82, MPT trading on the DEX
  'PermissionedDomains',
  'PermissionedDEX',
  'TokenEscrow',
  'Clawback',
  'DeepFreeze',
  'Batch',
  'BatchV1_1',
]

const client = await connect()

const res: any = await client.request({
  command: 'ledger_entry',
  index: amendmentId('') && '7DB0788C020F02780A673DC74757F23823FA3014C1866E72CC4CD8B226CD6EF4',
})

const live: string[] = res.result.node.Amendments ?? []

console.log(`\n${live.length} amendments enabled\n`)
console.log('| Amendment | Enabled |')
console.log('|---|---|')
for (const name of WATCHING) {
  console.log(`| ${name} | ${live.includes(amendmentId(name)) ? 'yes' : 'no'} |`)
}

await client.disconnect()