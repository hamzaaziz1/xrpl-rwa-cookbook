import { connect } from './client'

const client = await connect()

for (const role of ['ISSUER', 'DOMAIN_OWNER', 'HOLDER']) {
  const { wallet } = await client.fundWallet()
  console.log(`${role}_SEED=${wallet.seed}`)
  console.log(`${role}_ADDRESS=${wallet.address}`)
}

await client.disconnect()