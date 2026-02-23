import { MAINNET_GH_B64, TESTNET_GH_B64 } from './constants'

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

export const TESTNET_ASA_METADATA_REGISTRY_APP_ID = 753_324_084 as const

export type RegistryNetwork = 'mainnet' | 'testnet' | 'localnet'

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
