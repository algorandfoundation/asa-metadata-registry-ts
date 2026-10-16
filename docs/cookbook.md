# Cookbook

Tested recipes for the main features of `@algorandfoundation/asa-metadata-registry-sdk`. For every signature, model,
flag and error, see the [SDK reference](../.claude/skills/using-asa-metadata-registry/reference.md).

The recipes use the variables of recipe 1 (`algorand`, `registry` and `manager`, the ASA manager account) and an
`assetId` (`bigint`).

> In Node, named imports of the package from an ES module do not work yet, so run the recipes as CommonJS: for example,
> put them in a `.cts` file and run it with `tsx`, or compile them with `tsc` and `"module": "commonjs"`. CommonJS has
> no top-level `await`, so put the recipes in an `async` function.

## Imports

```ts
import { readFile } from 'node:fs/promises'
import { AlgorandClient, algo, microAlgo } from '@algorandfoundation/algokit-utils'
import {
  ACCOUNT_MBR,
  Arc90Uri,
  AsaMetadataRegistry,
  AsaMetadataRegistryWrite,
  AsaNotFoundError,
  AssetMetadata,
  B64_STD_ENCODING,
  BoxNotFoundError,
  DEFAULT_SIMULATE_OPTIONS,
  IRR_FLG_ARC54,
  IrreversibleFlags,
  MetadataFlags,
  MetadataSource,
  REV_FLG_NTT,
  ReversibleFlags,
  TESTNET_ASA_METADATA_REGISTRY_APP_ID,
  decodeMetadataJson,
  encodeMetadataJson,
  generated,
  migrateLegacyMetadataToRegistry,
  validateArc3Schema,
} from '@algorandfoundation/asa-metadata-registry-sdk'
```

## 1. Set up the registry

BOX reads need only `algod`. Writes, AVM reads and MBR quotes need an app client.

**TestNet** (trusted deployment):

```ts
const algorand = AlgorandClient.testNet()
const algod = algorand.client.algod

// Read-only (BOX reads)
const reader = AsaMetadataRegistry.forNetwork('testnet', { algod })

// Reads and writes: the ASA manager signs the writes and pays MBR and fees
const manager = algorand.account.fromMnemonic(process.env.MANAGER_MNEMONIC!)
const appClient = new generated.AsaMetadataRegistryClient({
  algorand,
  appId: BigInt(TESTNET_ASA_METADATA_REGISTRY_APP_ID),
  defaultSender: manager.addr, // AVM reads simulate a transaction from this account, so it must hold Algos
})
const registry = AsaMetadataRegistry.forNetwork('testnet', { algod, appClient })
```

**LocalNet** (deploy your own registry):

```ts
const algorand = AlgorandClient.defaultLocalNet()
const algod = algorand.client.algod
const dispenser = await algorand.account.localNetDispenser()
const deployer = algorand.account.random()
const manager = algorand.account.random()
for (const account of [deployer, manager]) {
  await algorand.send.payment({ sender: dispenser.addr, receiver: account.addr, amount: algo(100) })
}

const factory = new generated.AsaMetadataRegistryFactory({
  algorand,
  defaultSender: deployer.addr,
  defaultSigner: deployer.signer,
  deployTimeParams: {
    TRUSTED_DEPLOYER: deployer.addr.publicKey,
    ARC90_NETAUTH: new TextEncoder().encode('net:localnet'),
  },
})
const { appClient } = await factory.send.create.bare()
await algorand.send.payment({ sender: deployer.addr, receiver: appClient.appAddress, amount: microAlgo(ACCOUNT_MBR) })
const registry = AsaMetadataRegistry.fromAppClient(appClient, { algod, netauth: 'net:localnet' })
```

## 2. Create an ARC-89 native ASA and its metadata

The ASA URL is the partial ARC-90 URI of the registry, and the metadata gets the ARC-89 native flag. For any other
ASA, leave out `flags`. For ARC-3 metadata, pass `arc3Compliant: true` instead: the SDK then validates the JSON and
sets the ARC-3 flags.

```ts
const url = await registry.read.arc89GetMetadataPartialUri() // algorand://net:localnet/app/<app id>?box=
const { assetId } = await algorand.send.assetCreate({
  sender: manager.addr,
  total: 1_000n,
  decimals: 0,
  assetName: 'Rock #7',
  unitName: 'ROCK',
  manager: manager.addr,
  url,
})

const metadata = AssetMetadata.fromJson({
  assetId,
  jsonObj: {
    name: 'Rock #7',
    description: 'A rare rock',
    supply: 1000,
    properties: { rarity: 'rare' },
    logo_b64: 'iVBORw0KGgo=',
  },
  flags: new MetadataFlags({
    reversible: ReversibleFlags.empty(),
    irreversible: new IrreversibleFlags({ arc89Native: true }),
  }),
})
const paid = await registry.write.createMetadata({ assetManager: manager, metadata })
console.log(paid.amount) // MBR paid in microAlgo: 72900 for these 117 bytes
```

## 3. Read the metadata

With `algod`, `getAssetMetadata` reads the box directly (BOX). `MetadataSource.AVM` simulates the contract getter
instead, and returns what an on-chain caller gets.

```ts
const record = await registry.read.getAssetMetadata({ assetId })
console.log(record.json) // { name: 'Rock #7', description: 'A rare rock', ... }
console.log(record.body.rawBytes) // the exact stored bytes
console.log(record.header.revision) // 1n

const viaAvm = await registry.read.getAssetMetadata({ assetId, source: MetadataSource.AVM })
```

## 4. Read one value by key

The key getters work only on short metadata (up to 4,096 bytes) and on values up to 1,007 bytes.

```ts
const name = await registry.read.arc89GetMetadataStringByKey({ assetId, key: 'name' }) // 'Rock #7'
const supply = await registry.read.arc89GetMetadataUint64ByKey({ assetId, key: 'supply' }) // 1000n
const properties = JSON.parse(await registry.read.arc89GetMetadataObjectByKey({ assetId, key: 'properties' }))
const logo = await registry.read.arc89GetMetadataB64BytesByKey({
  assetId,
  key: 'logo_b64',
  b64Encoding: B64_STD_ENCODING,
}) // Uint8Array, decoded
```

## 5. Check the state before a write

```ts
const { asaExists, metadataExists } = await registry.read.arc89CheckMetadataExists({ assetId })
const immutable = await registry.read.arc89IsMetadataImmutable({ assetId })
const [isShort, revision] = await registry.read.arc89IsMetadataShort({ assetId })
const quote = await registry.read.arc89GetMetadataMbrDelta({ assetId, newSize: 2_000 })
console.log(quote.signedAmount) // MBR to pay (> 0) or to get back (< 0) for a size of 2,000 bytes
```

## 6. Update the metadata

Read the record, change the JSON, then replace it. The flags do not change. For ARC-3 metadata, add
`arc3Compliant: true` to `fromJson` to validate the ARC-3 fields before the write.

```ts
const current = await registry.read.getAssetMetadata({ assetId })
const json = current.json
json.description = 'A very rare rock'
const metadata = AssetMetadata.fromJson({ assetId, jsonObj: json })
const delta = await registry.write.replaceMetadata({ assetManager: manager, metadata })
console.log(delta.signedAmount) // 2000: five more bytes
```

## 7. Change bytes in place

`replaceMetadataSlice` overwrites `payload.length` bytes at `offset`, so the size does not change. Before the write,
the SDK validates the complete JSON after the change.

```ts
const { body } = await registry.read.getAssetMetadata({ assetId })
const offset = new TextDecoder().decode(body.rawBytes).indexOf('"rare"') + 1 // ASCII: string index = byte offset
await registry.write.replaceMetadataSlice({
  assetManager: manager,
  assetId,
  offset,
  payload: new TextEncoder().encode('epic'),
})
```

## 8. Set flags and make the metadata immutable

> **Caution:** irreversible flags and `setImmutable` cannot be undone. After `setImmutable`, replace, delete and flag
> changes fail.

```ts
await registry.write.setReversibleFlag({ assetManager: manager, assetId, flagIndex: REV_FLG_NTT, value: true })
await registry.write.setIrreversibleFlag({ assetManager: manager, assetId, flagIndex: IRR_FLG_ARC54 })
await registry.write.setImmutable({ assetManager: manager, assetId })

const header = await registry.read.arc89GetMetadataHeader({ assetId })
console.log(header.isNttCrossChain, header.isArc54Burnable, header.isImmutable) // true true true
```

## 9. Migrate a legacy ARC-3 ASA

Pass the original file, byte for byte, not a parsed object. If the ASA has a nonzero `am`, the ARC-3 hash of the file
must match it, and the SDK also sets the immutable flag.

```ts
const fileBytes = await readFile('metadata.json') // the original file, for example from IPFS
await migrateLegacyMetadataToRegistry({
  registry,
  assetManager: manager,
  assetId,
  metadata: fileBytes,
  arc3Compliant: true,
  publishArc2Message: true, // optional ARC-2 announcement in the same group
})

const header = await registry.read.arc89GetMetadataHeader({ assetId })
console.log(header.isArc3Compliant, header.isImmutable) // true true (the ASA has an `am`)
```

## 10. Verify the hashes

`hashMatches` checks the stored Metadata Hash, and the ARC-3 `am` of the ASA when it is set. With a nonzero `am`, it
can throw instead of returning `false`, so treat a throw as a failed check.

```ts
const record = await registry.read.getAssetMetadata({ assetId })
const asa = await algorand.asset.getById(assetId)
let ok = false
try {
  ok = record.hashMatches({ asaAm: asa.metadataHash })
} catch {
  ok = false
}
```

## 11. Work with ARC-90 URIs

```ts
const uri = registry.arc90Uri({ assetId }).toUri() // algorand://net:localnet/app/<app id>?box=<base64url asset ID>
const parsed = Arc90Uri.parse(uri) // parsed.assetId === assetId
const record = await registry.read.getAssetMetadata({ metadataUri: uri })

const asa = await algorand.asset.getById(assetId)
const resolved = await registry.read.resolveArc90UriFromAssetUrl({ assetId, assetUrl: asa.url ?? '' }) // or null
```

## 12. Dry-run a write, or add your own transaction to its group

The `build…Group` methods return the atomic group of a write without sending it. This recipe uses an ASA without
metadata, and builds one group for the dry run and another one to send.

```ts
const metadata = AssetMetadata.fromJson({ assetId, jsonObj: { name: 'Gem', color: 'blue' } })

// Dry run: simulate the complete group, send nothing
const dryRun = await registry.write.buildCreateMetadataGroup({ assetManager: manager, metadata })
await AsaMetadataRegistryWrite.sendGroup({ composer: dryRun, simulate: { ...DEFAULT_SIMULATE_OPTIONS } })

// Send, with your own transaction in the same atomic group
const composer = await registry.write.buildCreateMetadataGroup({ assetManager: manager, metadata })
composer.addTransaction(
  await algorand.createTransaction.payment({
    sender: manager.addr,
    receiver: manager.addr,
    amount: microAlgo(0),
    note: 'metadata for Gem',
  }),
  manager.signer,
)
await AsaMetadataRegistryWrite.sendGroup({ composer })
```

## 13. Delete the metadata

The delete returns the box MBR.

```ts
const refund = await registry.write.deleteMetadata({ assetManager: manager, assetId })
console.log(refund.amount) // microAlgo returned: 37700 for the metadata of recipe 12
```

## 14. Handle errors

The SDK error classes extend `AsaMetadataRegistryError`. BOX reads throw these typed errors. When the contract fails,
AVM reads throw the `LogicError` of the simulated call instead.

```ts
try {
  await registry.read.getAssetMetadata({ assetId })
} catch (e) {
  if (e instanceof BoxNotFoundError) console.log('The ASA has no metadata in the registry')
  else if (e instanceof AsaNotFoundError) console.log('The ASA does not exist')
  else throw e
}
```

## 15. Use the JSON helpers offline

```ts
const bytes = encodeMetadataJson({ name: 'Rock', decimals: 0, image: 'ipfs://cid/rock.png' }) // compact UTF-8
const obj = decodeMetadataJson(bytes) // strict: rejects a BOM, duplicate keys and lone surrogates
validateArc3Schema(obj) // throws MetadataArc3Error if an ARC-3 field is not valid
```
