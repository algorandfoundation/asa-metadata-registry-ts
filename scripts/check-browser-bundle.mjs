// Checks that the ESM build runs in a browser without Node polyfills, as a plain web app would load it.
// 1. Static: bundle the build for the browser with Vite, the peer dependencies external. Vite replaces a
//    Node built-in (e.g. `crypto`) with an empty `__vite-browser-external` module, so the SDK must not
//    import one.
// 2. Runtime: bundle the build with its peers into one script, run it in a new realm (node:vm) with only
//    browser globals (no Buffer, no process), call the pure entry points and compare with the Node build.
/* global TextEncoder -- the case functions run in Node and in the browser realm, which both have it */
import { readFileSync } from 'node:fs'
import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'
import vm from 'node:vm'
import { build } from 'vite'

const { name, peerDependencies } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const peers = Object.keys(peerDependencies)
const isPeer = (id) => peers.some((peer) => id === peer || id.startsWith(`${peer}/`))
const entry = fileURLToPath(new URL('../dist/esm/index.js', import.meta.url))

const bundle = async (format, external) => {
  const messages = []
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      lib: { entry, formats: [format], name: 'sdk' },
      rolldownOptions: {
        external,
        // Record the externalized built-ins, and pass every log on to Vite (it fails on an unresolved import).
        onLog: (level, log, handler) => {
          if (log.message.includes('externalized for browser compatibility')) messages.push(log.message)
          handler(level, log)
        },
      },
    },
  })
  const chunks = (Array.isArray(result) ? result : [result]).flatMap(({ output }) => output)
  return { chunks: chunks.filter((chunk) => chunk.type === 'chunk'), messages }
}

// 1. Static check. Vite logs an externalized built-in only in production mode (NODE_ENV unset or
// 'production'), but the module ids of the bundle always show it.
const esm = await bundle('es', isPeer)
const externalIds = esm.chunks
  .flatMap((chunk) => chunk.moduleIds)
  .filter((id) => id.startsWith('__vite-browser-external'))
if (externalIds.length > 0) {
  const details = [...new Set([...externalIds, ...esm.messages])].join('\n')
  throw new Error(`${name}: the browser bundle needs Node built-ins:\n${details}`)
}

// 2. Runtime check. Each case runs once with the Node build and once in the browser realm, and must give
// the same string. The case functions are copied into the realm as source code, so they may use only
// their `sdk` argument and globals that both realms have.
const cases = {
  'SHA-256 and SHA-512/256': (sdk) => {
    const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
    const data = new TextEncoder().encode('ARC-89')
    return `${hex(sdk.sha256(data))} ${hex(sdk.sha512_256(data))}`
  },
  'base64 and base64url round trips': (sdk) => {
    const data = Uint8Array.from({ length: 256 }, (_, i) => i)
    const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])
    const b64 = sdk.b64Encode(data)
    const b64url = sdk.b64UrlEncode(data)
    return `${b64} ${b64url} ${same(sdk.b64Decode(b64), data)} ${same(sdk.b64UrlDecode(b64url), data)}`
  },
  'ARC-90 URI parse and toUri': (sdk) => {
    const uri = sdk.Arc90Uri.parse('algorand://net:testnet/app/772968354?box=AAAAAAAAAAE#arc3')
    return `${uri.assetId} ${uri.toUri()}`
  },
  'ARC-3 metadata hash with extra_metadata': (sdk) => {
    const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
    return hex(sdk.computeArc3MetadataHash(new TextEncoder().encode('{"name":"ARC-89","extra_metadata":"AAEC"}')))
  },
  'netauth of an unknown network': (sdk) => sdk.netauthForGenesis(sdk.b64Encode(new Uint8Array(32).fill(7))),
  'metadata read from a box through algod': async (sdk) => {
    const body = new TextEncoder().encode('{"name":"ARC-89"}')
    const header = new sdk.MetadataHeader({
      identifiers: 0,
      flags: sdk.MetadataFlags.empty(),
      metadataHash: new Uint8Array(32),
      revision: 1n,
      deprecatedBy: 0n,
    })
    const value = new Uint8Array([...header.serialized, ...body])
    const algod = {
      getAssetByID: () => ({ do: async () => ({ index: 1n, params: {} }) }),
      getApplicationBoxByName: () => ({ do: async () => ({ value }) }),
      getTransactionParams: () => ({ do: async () => ({ genesisHash: new Uint8Array(32) }) }),
    }
    const record = await sdk.AsaMetadataRegistry.forNetwork('testnet', { algod }).read.getAssetMetadata({ assetId: 1n })
    return JSON.stringify(record.json)
  },
}

const iife = await bundle('iife', [])
// Web APIs that browsers and Node share. A new realm has only the ECMAScript built-ins.
const webApis = ['TextDecoder', 'atob', 'btoa', 'URL', 'URLSearchParams', 'crypto', 'console', 'setTimeout']
const realm = vm.createContext({
  ...Object.fromEntries(webApis.map((api) => [api, globalThis[api]])),
  HostTextEncoder: globalThis.TextEncoder,
})
// Browser-like globals. TextEncoder must return the realm's own Uint8Array (instanceof checks).
vm.runInContext(
  `globalThis.self = globalThis
  globalThis.window = globalThis
  const Host = globalThis.HostTextEncoder
  delete globalThis.HostTextEncoder
  globalThis.TextEncoder = class TextEncoder {
    get encoding() { return 'utf-8' }
    encode(input = '') { return new Uint8Array(new Host().encode(input)) }
  }`,
  realm,
)
vm.runInContext(iife.chunks[0].code, realm)

const node = await import(name)
const failures = []
for (const [label, run] of Object.entries(cases)) {
  const inNode = await run(node)
  try {
    const inBrowser = await vm.runInContext(`(${run})(sdk)`, realm)
    if (inBrowser !== inNode) failures.push(`${label}: browser realm gave ${inBrowser}, Node gave ${inNode}`)
  } catch (error) {
    failures.push(`${label}: ${error}`)
  }
}
if (failures.length > 0) {
  throw new Error(`${name}: the browser bundle fails in a realm without Node globals:\n${failures.join('\n')}`)
}
process.stdout.write(
  `${name}: the ESM build bundles for the browser without Node built-ins, and ${Object.keys(cases).length} ` +
    'pure entry points give the Node results in a realm without Node globals\n',
)
