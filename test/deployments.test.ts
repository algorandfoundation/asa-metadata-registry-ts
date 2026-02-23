/**
 * Unit tests for src/deployments module.
 *
 * Tests cover:
 * - RegistryDeployment valid construction across networks
 * - RegistryDeployment constructor validation errors
 * - RegistryDeployment immutability
 * - DEFAULT_DEPLOYMENTS canonical values
 */

import { describe, expect, test } from 'vitest'

import {
  DEFAULT_DEPLOYMENTS,
  MAINNET_GH_B64,
  MAINNET_TRUSTED_DEPLOYER_ADDR,
  RegistryDeployment,
  TESTNET_ASA_METADATA_REGISTRY_APP_ID,
  TESTNET_GH_B64,
  TESTNET_TRUSTED_DEPLOYER_ADDR,
} from '@algorandfoundation/asa-metadata-registry-sdk'

describe('registry deployment', () => {
  // Tests for RegistryDeployment construction and validation.
  test('valid initialization for localnet, testnet, and mainnet', () => {
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
      appId: TESTNET_ASA_METADATA_REGISTRY_APP_ID,
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

  test('throws when genesis hash is null for testnet/mainnet', () => {
    // Test validation error when genesisHashB64 is missing on non-localnet.
    expect(
      () =>
        new RegistryDeployment({
          network: 'testnet',
          genesisHashB64: null,
          appId: TESTNET_ASA_METADATA_REGISTRY_APP_ID,
          creatorAddress: TESTNET_TRUSTED_DEPLOYER_ADDR,
          arc90UriNetauth: 'net:testnet',
        }),
    ).toThrow(/genesisHashB64 required for non-localnet/)

    expect(
      () =>
        new RegistryDeployment({
          network: 'mainnet',
          genesisHashB64: null,
          appId: null,
          creatorAddress: MAINNET_TRUSTED_DEPLOYER_ADDR,
          arc90UriNetauth: null,
        }),
    ).toThrow(/genesisHashB64 required for non-localnet/)
  })

  test('throws when netauth is null for testnet/localnet', () => {
    // Test validation error when arc90UriNetauth is missing on non-mainnet.
    expect(
      () =>
        new RegistryDeployment({
          network: 'testnet',
          genesisHashB64: TESTNET_GH_B64,
          appId: TESTNET_ASA_METADATA_REGISTRY_APP_ID,
          creatorAddress: TESTNET_TRUSTED_DEPLOYER_ADDR,
          arc90UriNetauth: null,
        }),
    ).toThrow(/arc90UriNetauth required for non-mainnet/)

    expect(
      () =>
        new RegistryDeployment({
          network: 'localnet',
          genesisHashB64: null,
          appId: null,
          creatorAddress: null,
          arc90UriNetauth: null,
        }),
    ).toThrow(/arc90UriNetauth required for non-mainnet/)
  })

  test('instances are immutable', () => {
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
      ;(deployment as any).appId = 999
    }).toThrow(TypeError)
  })
})

describe('default deployments', () => {
  // Tests for DEFAULT_DEPLOYMENTS canonical values.
  test('match deployment expected values', () => {
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
})
