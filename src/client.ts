import { Client } from 'xrpl'

export const TESTNET = 'wss://s.altnet.rippletest.net:51233'
export const DEVNET = 'wss://s.devnet.rippletest.net:51233'

export async function connect(url = TESTNET) {
  const client = new Client(url)
  await client.connect()
  return client
}