import { b64Decode, b64UrlDecode, b64UrlEncode } from './codec'
import { MAINNET_GH_B64, TESTNET_GH_B64 } from './constants'
import { bytesEqual } from './internal/bytes'

/**
 * Known deployments of the singleton ASA Metadata Registry.
 *
 * Ported from Python `asa_metadata_registry/deployments.py`.
 */

// ---------------------------------------------------------------------------
// Deployment constants
// ---------------------------------------------------------------------------
export const MAINNET_TRUSTED_DEPLOYER_ADDR = 'XODGWLOMKUPTGL3ZV53H3GZZWMCTJVQ5B2BZICFD3STSLA2LPSH6V6RW3I' as const
export const TESTNET_TRUSTED_DEPLOYER_ADDR = 'QYK5DXJ27Y7WIWUJMP3FFOTEU56L4KTRP4CY2GAKRXZHHKLNWV6M7JLYJM' as const

export const TESTNET_ASA_METADATA_REGISTRY_APP_ID = 772_968_354 as const

export type RegistryNetwork = 'mainnet' | 'testnet' | 'localnet'

/**
 * A known deployment of the singleton ASA Metadata Registry.
 *
 * Note: deployments can change. This SDK keeps the deployment list data-only so it can be
 * updated without affecting the rest of the architecture.
 */
export class RegistryDeployment {
  readonly network: RegistryNetwork
  readonly genesisHashB64: string | null
  readonly appId: number | null
  readonly creatorAddress: string | null
  readonly arc90UriNetauth: string | null

  constructor(args: {
    network: RegistryNetwork
    genesisHashB64: string | null
    appId: number | null
    creatorAddress: string | null
    arc90UriNetauth: string | null
  }) {
    this.network = args.network
    this.genesisHashB64 = args.genesisHashB64
    this.appId = args.appId
    this.creatorAddress = args.creatorAddress
    this.arc90UriNetauth = args.arc90UriNetauth

    if (this.network !== 'localnet' && !this.genesisHashB64) throw new Error('genesisHashB64 required for non-localnet')

    if (this.network !== 'mainnet' && !this.arc90UriNetauth) throw new Error('arc90UriNetauth required for non-mainnet')

    Object.freeze(this)
  }
}

export const DEFAULT_DEPLOYMENTS: Readonly<Record<string, RegistryDeployment>> = {
  testnet: new RegistryDeployment({
    network: 'testnet',
    genesisHashB64: TESTNET_GH_B64,
    appId: TESTNET_ASA_METADATA_REGISTRY_APP_ID,
    creatorAddress: TESTNET_TRUSTED_DEPLOYER_ADDR,
    arc90UriNetauth: 'net:testnet',
  }),
  mainnet: new RegistryDeployment({
    network: 'mainnet',
    genesisHashB64: MAINNET_GH_B64,
    appId: null, // mainnet app id is TBD.
    creatorAddress: MAINNET_TRUSTED_DEPLOYER_ADDR,
    arc90UriNetauth: null,
  }),
} as const

/** The trusted deployment for a network genesis hash, if any. */
export const deploymentForGenesis = (genesisHashB64: string): RegistryDeployment | null => {
  for (const d of Object.values(DEFAULT_DEPLOYMENTS)) {
    if (d.genesisHashB64 === genesisHashB64) return d
  }
  return null
}

/** Canonical ARC-90 netauth for a network: the deployment label, else `gh:<base64url>`. */
export const netauthForGenesis = (genesisHashB64: string): string | null => {
  const d = deploymentForGenesis(genesisHashB64)
  if (d !== null) return d.arc90UriNetauth
  return `gh:${b64UrlEncode(b64Decode(genesisHashB64))}`
}

/** True if an ARC-90 netauth denotes the network with the given genesis hash. */
export const netauthMatchesGenesis = (netauth: string | null, genesisHashB64: string): boolean => {
  if (netauth === null) return genesisHashB64 === MAINNET_GH_B64
  if (netauth.startsWith('gh:')) {
    try {
      return bytesEqual(b64UrlDecode(netauth.slice(3)), b64Decode(genesisHashB64))
    } catch {
      return false
    }
  }
  // A label denotes only a known deployment; unknown networks need `gh:` or a configured netauth
  const d = deploymentForGenesis(genesisHashB64)
  return d !== null && d.arc90UriNetauth === netauth
}
