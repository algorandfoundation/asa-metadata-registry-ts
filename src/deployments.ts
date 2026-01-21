import { MAINNET_GH_B64, TESTNET_GH_B64 } from './constants'

/**
 * Known deployments of the singleton ASA Metadata Registry.
 *
 * Ported from Python `asa_metadata_registry/deployments.py`.
 */

// ---------------------------------------------------------------------------
// Deployment constants
// ---------------------------------------------------------------------------
export const MAINNET_TRUSTED_DEPLOYER_ADDR =
  'XODGWLOMKUPTGL3ZV53H3GZZWMCTJVQ5B2BZICFD3STSLA2LPSH6V6RW3I' as const
export const TESTNET_TRUSTED_DEPLOYER_ADDR =
  'QYK5DXJ27Y7WIWUJMP3FFOTEU56L4KTRP4CY2GAKRXZHHKLNWV6M7JLYJM' as const

export const TESTNET_ASA_METADATA_REGISTRY_APP_ID = 753_324_084 as const

export type RegistryNetwork = 'mainnet' | 'testnet'

export interface RegistryDeployment {
  /** Network name (`mainnet` or `testnet`). */
  network: RegistryNetwork
  /** Base64 genesis hash. */
  genesisHashB64: string
  /** Registry App ID; may be `null` when unknown/TBD. */
  appId: number | null
  /** Optional creator address for trusted resolution. */
  creatorAddress?: string | null
  /** Optional ARC-90 netauth string. */
  arc90UriNetauth?: string | null
}

export const DEFAULT_DEPLOYMENTS: Readonly<Record<string, RegistryDeployment>> = {
  testnet: {
    network: 'testnet',
    genesisHashB64: TESTNET_GH_B64,
    appId: TESTNET_ASA_METADATA_REGISTRY_APP_ID,
    creatorAddress: TESTNET_TRUSTED_DEPLOYER_ADDR,
    arc90UriNetauth: 'net:testnet',
  },
  mainnet: {
    network: 'mainnet',
    genesisHashB64: MAINNET_GH_B64,
    appId: null, // mainnet app id is TBD.
    creatorAddress: MAINNET_TRUSTED_DEPLOYER_ADDR,
    arc90UriNetauth: null,
  },
} as const
