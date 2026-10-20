/**
 * Unit tests for src/deployments module.
 *
 * Ported from Python `tests/sdk/test_deployments.py`.
 *
 * Tests cover:
 * - RegistryDeployment valid construction across networks
 * - RegistryDeployment constructor validation errors
 * - RegistryDeployment immutability
 * - DEFAULT_DEPLOYMENTS canonical values
 * - deploymentForGenesis / netauthForGenesis / netauthMatchesGenesis
 */

import { describe, expect, test } from 'vitest'

import {
  b64Encode,
  b64UrlEncode,
  DEFAULT_DEPLOYMENTS,
  deploymentForGenesis,
  MAINNET_GH_B64,
  MAINNET_TRUSTED_DEPLOYER_ADDR,
  netauthForGenesis,
  netauthMatchesGenesis,
  RegistryDeployment,
  TESTNET_ASA_METADATA_REGISTRY_APP_ID,
  TESTNET_GH_B64,
  TESTNET_TRUSTED_DEPLOYER_ADDR,
} from '@algorandfoundation/asa-metadata-registry-sdk'

/** Genesis hash of a network unknown to the SDK (32 zero bytes). */
const UNKNOWN_GH_B64 = b64Encode(new Uint8Array(32))

describe('registry deployment', () => {
  // Tests for RegistryDeployment construction and validation.
  test('valid initialization for all networks', () => {
    // Test valid initialization for localnet, testnet, and mainnet.
    const localnet = new RegistryDeployment({
      network: 'localnet',
      genesisHashB64: null,
      appId: null,
      creatorAddress: null,
      arc90UriNetauth: 'net:localnet',
    })
    const testnet = new RegistryDeployment({
      network: 'testnet',
      genesisHashB64: TESTNET_GH_B64,
      appId: 123,
      creatorAddress: TESTNET_TRUSTED_DEPLOYER_ADDR,
      arc90UriNetauth: 'net:testnet',
    })
    const mainnet = new RegistryDeployment({
      network: 'mainnet',
      genesisHashB64: MAINNET_GH_B64,
      appId: null,
      creatorAddress: MAINNET_TRUSTED_DEPLOYER_ADDR,
      arc90UriNetauth: null,
    })

    expect(localnet.network).toBe('localnet')
    expect(testnet.network).toBe('testnet')
    expect(mainnet.network).toBe('mainnet')
  })

  test.each(['testnet', 'mainnet'] as const)('throws when genesis hash is null for non-localnet (%s)', (network) => {
    // Test validation error when genesisHashB64 is missing on non-localnet.
    expect(
      () =>
        new RegistryDeployment({
          network,
          genesisHashB64: null,
          appId: network === 'testnet' ? TESTNET_ASA_METADATA_REGISTRY_APP_ID : null,
          creatorAddress: network === 'testnet' ? TESTNET_TRUSTED_DEPLOYER_ADDR : MAINNET_TRUSTED_DEPLOYER_ADDR,
          arc90UriNetauth: network === 'testnet' ? 'net:testnet' : null,
        }),
    ).toThrow(/genesisHashB64 required for non-localnet/)
  })

  test.each(['testnet', 'localnet'] as const)('throws when arc90 netauth is null for non-mainnet (%s)', (network) => {
    // Test validation error when arc90UriNetauth is missing on non-mainnet.
    expect(
      () =>
        new RegistryDeployment({
          network,
          genesisHashB64: network === 'testnet' ? TESTNET_GH_B64 : null,
          appId: network === 'testnet' ? TESTNET_ASA_METADATA_REGISTRY_APP_ID : null,
          creatorAddress: network === 'testnet' ? TESTNET_TRUSTED_DEPLOYER_ADDR : null,
          arc90UriNetauth: null,
        }),
    ).toThrow(/arc90UriNetauth required for non-mainnet/)
  })

  test('instance is immutable', () => {
    // Test that RegistryDeployment instances are immutable.
    const deployment = new RegistryDeployment({
      network: 'testnet',
      genesisHashB64: TESTNET_GH_B64,
      appId: TESTNET_ASA_METADATA_REGISTRY_APP_ID,
      creatorAddress: TESTNET_TRUSTED_DEPLOYER_ADDR,
      arc90UriNetauth: 'net:testnet',
    })

    expect(Object.isFrozen(deployment)).toBe(true)
    expect(() => {
      ;(deployment as any).appId = 2
    }).toThrow(TypeError)
  })
})

describe('default deployments', () => {
  // Tests for DEFAULT_DEPLOYMENTS canonical values.
  test('default deployments match expected values', () => {
    // Test DEFAULT_DEPLOYMENTS values against expected deployments.
    const expectedTestnet = new RegistryDeployment({
      network: 'testnet',
      genesisHashB64: TESTNET_GH_B64,
      appId: TESTNET_ASA_METADATA_REGISTRY_APP_ID,
      creatorAddress: TESTNET_TRUSTED_DEPLOYER_ADDR,
      arc90UriNetauth: 'net:testnet',
    })
    const expectedMainnet = new RegistryDeployment({
      network: 'mainnet',
      genesisHashB64: MAINNET_GH_B64,
      appId: null,
      creatorAddress: MAINNET_TRUSTED_DEPLOYER_ADDR,
      arc90UriNetauth: null,
    })

    expect(DEFAULT_DEPLOYMENTS.testnet).toEqual(expectedTestnet)
    expect(DEFAULT_DEPLOYMENTS.mainnet).toEqual(expectedMainnet)
  })

  test('testnet registry app id (TS-only)', () => {
    // Pin the ARC-89 v1.0.0 TestNet deployment.
    expect(TESTNET_ASA_METADATA_REGISTRY_APP_ID).toBe(772_968_354)
    expect(DEFAULT_DEPLOYMENTS.testnet.appId).toBe(772_968_354)
  })
})

describe('netauth matches genesis', () => {
  test('unknown network rejects labels', () => {
    const gh = b64Encode(new Uint8Array(32))
    expect(netauthMatchesGenesis('net:testnet', gh)).toBe(false)
    expect(netauthMatchesGenesis('net:localnet', gh)).toBe(false)
    expect(netauthMatchesGenesis(`gh:${b64UrlEncode(new Uint8Array(32))}`, gh)).toBe(true)
  })

  test('known network label', () => {
    expect(netauthMatchesGenesis('net:testnet', TESTNET_GH_B64)).toBe(true)
    expect(netauthMatchesGenesis('net:mainnet', TESTNET_GH_B64)).toBe(false)
  })

  test('mainnet netauth and gh forms (TS-only)', () => {
    // A null netauth denotes MainNet only.
    expect(netauthMatchesGenesis(null, MAINNET_GH_B64)).toBe(true)
    expect(netauthMatchesGenesis(null, TESTNET_GH_B64)).toBe(false)
    expect(netauthMatchesGenesis(null, UNKNOWN_GH_B64)).toBe(false)
    // The `gh:<base64url>` form also denotes a known network.
    const testnetGh = `gh:${b64UrlEncode(new Uint8Array(Buffer.from(TESTNET_GH_B64, 'base64')))}`
    expect(netauthMatchesGenesis(testnetGh, TESTNET_GH_B64)).toBe(true)
    expect(netauthMatchesGenesis(testnetGh, MAINNET_GH_B64)).toBe(false)
    // Invalid (or non-canonical) base64url never matches.
    expect(netauthMatchesGenesis('gh:!!!', TESTNET_GH_B64)).toBe(false)
    expect(netauthMatchesGenesis(`gh:${b64Encode(new Uint8Array(32))}`, UNKNOWN_GH_B64)).toBe(false)
  })
})

describe('deployment and netauth for genesis (TS-only)', () => {
  // Python covers these helpers through the reader tests.
  test('deployment for genesis', () => {
    expect(deploymentForGenesis(TESTNET_GH_B64)).toBe(DEFAULT_DEPLOYMENTS.testnet)
    expect(deploymentForGenesis(MAINNET_GH_B64)).toBe(DEFAULT_DEPLOYMENTS.mainnet)
    expect(deploymentForGenesis(UNKNOWN_GH_B64)).toBeNull()
  })

  test('netauth for genesis', () => {
    // Known networks use the deployment label (none on MainNet), unknown ones `gh:<base64url>`.
    expect(netauthForGenesis(TESTNET_GH_B64)).toBe('net:testnet')
    expect(netauthForGenesis(MAINNET_GH_B64)).toBeNull()
    expect(netauthForGenesis(UNKNOWN_GH_B64)).toBe('gh:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')
    for (const gh of [TESTNET_GH_B64, MAINNET_GH_B64, UNKNOWN_GH_B64]) {
      expect(netauthMatchesGenesis(netauthForGenesis(gh), gh)).toBe(true)
    }
  })
})
