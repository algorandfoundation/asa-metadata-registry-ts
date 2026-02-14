/**
 * Unit tests for flag models in src/models.
 *
 * Tests cover:
 * - ReversibleFlags
 * - IrreversibleFlags
 * - MetadataFlags
 */

import { describe, expect, test } from 'vitest'
import { models, bitmasks } from '@algorandfoundation/asa-metadata-registry-sdk'

const { ReversibleFlags, IrreversibleFlags, MetadataFlags, MetadataHeader } = models

describe('reversible flags', () => {
  // Tests for ReversibleFlags dataclass.
  test('empty flags', () => {
    // Test creating empty flags.
    const flags = ReversibleFlags.empty()
    expect(flags.arc20).toBe(false)
    expect(flags.arc62).toBe(false)
    expect(flags.ntt).toBe(false)
    expect(flags.reserved3).toBe(false)
    expect(flags.reserved4).toBe(false)
    expect(flags.reserved5).toBe(false)
    expect(flags.reserved6).toBe(false)
    expect(flags.reserved7).toBe(false)
    expect(flags.byteValue).toBe(0)
  })

  test('arc20 flag', () => {
    // Test ARC-20 flag.
    const flags = new ReversibleFlags({ arc20: true })
    expect(flags.arc20).toBe(true)
    expect(flags.byteValue).toBe(bitmasks.MASK_REV_ARC20)
    expect(flags.byteValue).toBe(0b00000001)
  })

  test('arc62 flag', () => {
    // Test ARC-62 flag.
    const flags = new ReversibleFlags({ arc62: true })
    expect(flags.arc62).toBe(true)
    expect(flags.byteValue).toBe(bitmasks.MASK_REV_ARC62)
    expect(flags.byteValue).toBe(0b00000010)
  })

  test('ntt flag', () => {
    // Test NTT flag.
    const flags = new ReversibleFlags({ ntt: true })
    expect(flags.ntt).toBe(true)
    expect(flags.byteValue).toBe(bitmasks.MASK_REV_NTT)
    expect(flags.byteValue).toBe(0b00000100)
  })

  test('multiple flags', () => {
    // Test multiple flags set simultaneously.
    const flags = new ReversibleFlags({ arc20: true, arc62: true, ntt: true })
    expect(flags.arc20).toBe(true)
    expect(flags.arc62).toBe(true)
    expect(flags.ntt).toBe(true)
    expect(flags.byteValue).toBe(bitmasks.MASK_REV_ARC20 | bitmasks.MASK_REV_ARC62 | bitmasks.MASK_REV_NTT)
    expect(flags.byteValue).toBe(0b00000111)
  })

  test('all flags set', () => {
    // Test all flags set to True.
    const flags = new ReversibleFlags({
      arc20: true,
      arc62: true,
      ntt: true,
      reserved3: true,
      reserved4: true,
      reserved5: true,
      reserved6: true,
      reserved7: true,
    })
    expect(flags.byteValue).toBe(0b11111111)
  })

  test('from byte zero', () => {
    // Test fromByte with 0.
    const flags = ReversibleFlags.fromByte(0)
    expect(flags.arc20).toBe(false)
    expect(flags.arc62).toBe(false)
    expect(flags.ntt).toBe(false)
    expect(flags.byteValue).toBe(0)
  })

  test('from byte arc20', () => {
    // Test fromByte with ARC-20 flag set.
    const flags = ReversibleFlags.fromByte(bitmasks.MASK_REV_ARC20)
    expect(flags.arc20).toBe(true)
    expect(flags.arc62).toBe(false)
    expect(flags.ntt).toBe(false)
    expect(flags.byteValue).toBe(bitmasks.MASK_REV_ARC20)
  })

  test('from byte ntt', () => {
    // Test fromByte with NTT flag set.
    const flags = ReversibleFlags.fromByte(bitmasks.MASK_REV_NTT)
    expect(flags.ntt).toBe(true)
    expect(flags.arc20).toBe(false)
    expect(flags.arc62).toBe(false)
    expect(flags.byteValue).toBe(bitmasks.MASK_REV_NTT)
  })

  test('from byte multiple', () => {
    // Test fromByte with multiple flags.
    const value = bitmasks.MASK_REV_ARC20 | bitmasks.MASK_REV_ARC62 | bitmasks.MASK_REV_NTT
    const flags = ReversibleFlags.fromByte(value)
    expect(flags.arc20).toBe(true)
    expect(flags.arc62).toBe(true)
    expect(flags.ntt).toBe(true)
    expect(flags.byteValue).toBe(value)
  })

  test('from byte all flags', () => {
    // Test fromByte with all flags set.
    const flags = ReversibleFlags.fromByte(0xff)
    expect(flags.arc20).toBe(true)
    expect(flags.arc62).toBe(true)
    expect(flags.ntt).toBe(true)
    expect(flags.reserved3).toBe(true)
    expect(flags.reserved4).toBe(true)
    expect(flags.reserved5).toBe(true)
    expect(flags.reserved6).toBe(true)
    expect(flags.reserved7).toBe(true)
    expect(flags.byteValue).toBe(0b11111111)
  })

  test('from byte invalid negative', () => {
    // Test fromByte with negative value raises.
    expect(() => ReversibleFlags.fromByte(-1)).toThrow(/Byte value must be 0-255/)
  })

  test('from byte invalid too large', () => {
    // Test fromByte with value > 255 raises.
    expect(() => ReversibleFlags.fromByte(256)).toThrow(/Byte value must be 0-255/)
  })

  test('round trip conversion', () => {
    // Test round-trip conversion flags -> byte -> flags.
    const original = new ReversibleFlags({ arc20: true, ntt: true, reserved7: true })
    const byteVal = original.byteValue
    const reconstructed = ReversibleFlags.fromByte(byteVal)
    expect(reconstructed.arc20).toBe(original.arc20)
    expect(reconstructed.arc62).toBe(original.arc62)
    expect(reconstructed.ntt).toBe(original.ntt)
    expect(reconstructed.reserved3).toBe(original.reserved3)
    expect(reconstructed.reserved4).toBe(original.reserved4)
    expect(reconstructed.reserved5).toBe(original.reserved5)
    expect(reconstructed.reserved6).toBe(original.reserved6)
    expect(reconstructed.reserved7).toBe(original.reserved7)
    expect(reconstructed.byteValue).toBe(byteVal)
  })
})

describe('irreversible flags', () => {
  // Tests for IrreversibleFlags dataclass.
  test('empty flags', () => {
    // Test creating empty flags.
    const flags = IrreversibleFlags.empty()
    expect(flags.arc3).toBe(false)
    expect(flags.arc89Native).toBe(false)
    expect(flags.burnable).toBe(false)
    expect(flags.reserved3).toBe(false)
    expect(flags.reserved4).toBe(false)
    expect(flags.reserved5).toBe(false)
    expect(flags.reserved6).toBe(false)
    expect(flags.immutable).toBe(false)
    expect(flags.byteValue).toBe(0)
  })

  test('arc3 flag', () => {
    // Test ARC-3 flag.
    const flags = new IrreversibleFlags({ arc3: true })
    expect(flags.arc3).toBe(true)
    expect(flags.byteValue).toBe(bitmasks.MASK_IRR_ARC3)
    expect(flags.byteValue).toBe(0b00000001)
  })

  test('arc89 native flag', () => {
    // Test ARC-89 native flag.
    const flags = new IrreversibleFlags({ arc89Native: true })
    expect(flags.arc89Native).toBe(true)
    expect(flags.byteValue).toBe(bitmasks.MASK_IRR_ARC89_NATIVE)
    expect(flags.byteValue).toBe(0b00000010)
  })

  test('arc54 burnable flag', () => {
    // Test ARC-54 burnable flag.
    const flags = new IrreversibleFlags({ burnable: true })
    expect(flags.burnable).toBe(true)
    expect(flags.byteValue).toBe(bitmasks.MASK_IRR_ARC54)
    expect(flags.byteValue).toBe(0b00000100)
  })

  test('immutable flag', () => {
    // Test immutable flag.
    const flags = new IrreversibleFlags({ immutable: true })
    expect(flags.immutable).toBe(true)
    expect(flags.byteValue).toBe(bitmasks.MASK_IRR_IMMUTABLE)
    expect(flags.byteValue).toBe(0b10000000)
  })

  test('multiple flags', () => {
    // Test multiple flags set simultaneously.
    const flags = new IrreversibleFlags({ arc3: true, arc89Native: true, burnable: true, immutable: true })
    expect(flags.arc3).toBe(true)
    expect(flags.arc89Native).toBe(true)
    expect(flags.burnable).toBe(true)
    expect(flags.immutable).toBe(true)
    expect(flags.byteValue).toBe(
      bitmasks.MASK_IRR_ARC3 | bitmasks.MASK_IRR_ARC89_NATIVE | bitmasks.MASK_IRR_ARC54 | bitmasks.MASK_IRR_IMMUTABLE,
    )
    expect(flags.byteValue).toBe(0b10000111)
  })

  test('all flags set', () => {
    // Test all flags set to True.
    const flags = new IrreversibleFlags({
      arc3: true,
      arc89Native: true,
      burnable: true,
      reserved3: true,
      reserved4: true,
      reserved5: true,
      reserved6: true,
      immutable: true,
    })
    expect(flags.byteValue).toBe(0b11111111)
  })

  test('from byte zero', () => {
    // Test fromByte with 0.
    const flags = IrreversibleFlags.fromByte(0)
    expect(flags.arc3).toBe(false)
    expect(flags.immutable).toBe(false)
    expect(flags.byteValue).toBe(0)
  })

  test('from byte arc3', () => {
    // Test fromByte with ARC-3 flag set.
    const flags = IrreversibleFlags.fromByte(bitmasks.MASK_IRR_ARC3)
    expect(flags.arc3).toBe(true)
    expect(flags.arc89Native).toBe(false)
    expect(flags.burnable).toBe(false)
    expect(flags.immutable).toBe(false)
    expect(flags.byteValue).toBe(bitmasks.MASK_IRR_ARC3)
  })

  test('from byte arc54', () => {
    // Test fromByte with ARC-54 flag set.
    const flags = IrreversibleFlags.fromByte(bitmasks.MASK_IRR_ARC54)
    expect(flags.burnable).toBe(true)
    expect(flags.arc3).toBe(false)
    expect(flags.arc89Native).toBe(false)
    expect(flags.immutable).toBe(false)
    expect(flags.byteValue).toBe(bitmasks.MASK_IRR_ARC54)
  })

  test('from byte immutable', () => {
    // Test fromByte with immutable flag set.
    const flags = IrreversibleFlags.fromByte(bitmasks.MASK_IRR_IMMUTABLE)
    expect(flags.immutable).toBe(true)
    expect(flags.arc3).toBe(false)
    expect(flags.byteValue).toBe(bitmasks.MASK_IRR_IMMUTABLE)
  })

  test('from byte multiple', () => {
    // Test fromByte with multiple flags.
    const value = bitmasks.MASK_IRR_ARC3 | bitmasks.MASK_IRR_IMMUTABLE | bitmasks.MASK_IRR_ARC54
    const flags = IrreversibleFlags.fromByte(value)
    expect(flags.arc3).toBe(true)
    expect(flags.burnable).toBe(true)
    expect(flags.immutable).toBe(true)
    expect(flags.byteValue).toBe(value)
  })

  test('from byte all flags', () => {
    // Test fromByte with all flags set.
    const flags = IrreversibleFlags.fromByte(0xff)
    expect(flags.arc3).toBe(true)
    expect(flags.arc89Native).toBe(true)
    expect(flags.burnable).toBe(true)
    expect(flags.reserved3).toBe(true)
    expect(flags.reserved4).toBe(true)
    expect(flags.reserved5).toBe(true)
    expect(flags.reserved6).toBe(true)
    expect(flags.immutable).toBe(true)
    expect(flags.byteValue).toBe(0b11111111)
  })

  test('from byte invalid negative', () => {
    // Test fromByte with negative value raises.
    expect(() => IrreversibleFlags.fromByte(-1)).toThrow(/Byte value must be 0-255/)
  })

  test('from byte invalid too large', () => {
    // Test fromByte with value > 255 raises.
    expect(() => IrreversibleFlags.fromByte(256)).toThrow(/Byte value must be 0-255/)
  })

  test('round trip conversion', () => {
    // Test round-trip conversion flags -> byte -> flags.
    const original = new IrreversibleFlags({ arc3: true, arc89Native: true, burnable: true, immutable: true })
    const byteVal = original.byteValue
    const reconstructed = IrreversibleFlags.fromByte(byteVal)
    expect(reconstructed.arc3).toBe(original.arc3)
    expect(reconstructed.arc89Native).toBe(original.arc89Native)
    expect(reconstructed.burnable).toBe(original.burnable)
    expect(reconstructed.reserved3).toBe(original.reserved3)
    expect(reconstructed.reserved4).toBe(original.reserved4)
    expect(reconstructed.reserved5).toBe(original.reserved5)
    expect(reconstructed.reserved6).toBe(original.reserved6)
    expect(reconstructed.immutable).toBe(original.immutable)
    expect(reconstructed.byteValue).toBe(byteVal)
  })
})

describe('metadata flags', () => {
  // Tests for MetadataFlags combined flags.
  test('empty flags', () => {
    // Test creating empty combined flags.
    const flags = MetadataFlags.empty()
    expect(flags.reversible.byteValue).toBe(0)
    expect(flags.irreversible.byteValue).toBe(0)
    expect(flags.reversibleByte).toBe(0)
    expect(flags.irreversibleByte).toBe(0)
  })

  test('from bytes both zero', () => {
    // Test fromBytes with both bytes zero.
    const flags = MetadataFlags.fromBytes(0, 0)
    expect(flags.reversibleByte).toBe(0)
    expect(flags.irreversibleByte).toBe(0)
  })

  test('from bytes reversible only', () => {
    // Test fromBytes with only reversible flags set.
    const revByte = bitmasks.MASK_REV_ARC20
    const flags = MetadataFlags.fromBytes(revByte, 0)
    expect(flags.reversibleByte).toBe(revByte)
    expect(flags.irreversibleByte).toBe(0)
    expect(flags.reversible.arc20).toBe(true)
    expect(flags.irreversible.arc3).toBe(false)
  })

  test('from bytes irreversible only', () => {
    // Test fromBytes with only irreversible flags set.
    const irrByte = bitmasks.MASK_IRR_ARC3
    const flags = MetadataFlags.fromBytes(0, irrByte)
    expect(flags.reversibleByte).toBe(0)
    expect(flags.irreversibleByte).toBe(irrByte)
    expect(flags.reversible.arc20).toBe(false)
    expect(flags.irreversible.arc3).toBe(true)
  })

  test('from bytes both set', () => {
    // Test fromBytes with both reversible and irreversible flags.
    const revByte = bitmasks.MASK_REV_ARC20 | bitmasks.MASK_REV_ARC62
    const irrByte = bitmasks.MASK_IRR_ARC3 | bitmasks.MASK_IRR_IMMUTABLE
    const flags = MetadataFlags.fromBytes(revByte, irrByte)

    expect(flags.reversibleByte).toBe(revByte)
    expect(flags.irreversibleByte).toBe(irrByte)
    expect(flags.reversible.arc20).toBe(true)
    expect(flags.reversible.arc62).toBe(true)
    expect(flags.irreversible.arc3).toBe(true)
    expect(flags.irreversible.immutable).toBe(true)
  })

  test('from bytes all flags', () => {
    // Test fromBytes with all flags set.
    const flags = MetadataFlags.fromBytes(0xff, 0xff)
    expect(flags.reversibleByte).toBe(0xff)
    expect(flags.irreversibleByte).toBe(0xff)
  })

  test('construct with flag objects', () => {
    // Test constructing MetadataFlags with flag objects.
    const rev = new ReversibleFlags({ arc20: true, arc62: true })
    const irr = new IrreversibleFlags({ arc3: true, immutable: true })
    const flags = new MetadataFlags({ reversible: rev, irreversible: irr })

    expect(flags.reversible.arc20).toBe(rev.arc20)
    expect(flags.reversible.arc62).toBe(rev.arc62)
    expect(flags.irreversible.arc3).toBe(irr.arc3)
    expect(flags.irreversible.immutable).toBe(irr.immutable)
    expect(flags.reversibleByte).toBe(rev.byteValue)
    expect(flags.irreversibleByte).toBe(irr.byteValue)
  })

  test('round trip conversion', () => {
    // Test round-trip conversion.
    const original = MetadataFlags.fromBytes(0xab, 0xcd)
    const revByte = original.reversibleByte
    const irrByte = original.irreversibleByte
    const reconstructed = MetadataFlags.fromBytes(revByte, irrByte)

    expect(reconstructed.reversibleByte).toBe(revByte)
    expect(reconstructed.irreversibleByte).toBe(irrByte)
    expect(reconstructed.reversible.byteValue).toBe(original.reversible.byteValue)
    expect(reconstructed.irreversible.byteValue).toBe(original.irreversible.byteValue)
  })
})

describe('flags use cases', () => {
  // Test real-world use cases.
  test('arc3 nft', () => {
    // Test flags for a standard ARC-3 NFT.
    const flags = new MetadataFlags({
      reversible: ReversibleFlags.empty(),
      irreversible: new IrreversibleFlags({ arc3: true }),
    })
    expect(flags.irreversibleByte).toBe(1)
    expect(flags.reversibleByte).toBe(0)
  })

  test('arc54 burnable asa', () => {
    // Test flags for a standard ARC-54 burnable ASA.
    const flags = new MetadataFlags({
      reversible: ReversibleFlags.empty(),
      irreversible: new IrreversibleFlags({ burnable: true }),
    })
    expect(flags.irreversibleByte).toBe(4)
    expect(flags.reversibleByte).toBe(0)
  })

  test('immutable arc3 nft', () => {
    // Test flags for an immutable ARC-3 NFT.
    const flags = new MetadataFlags({
      reversible: ReversibleFlags.empty(),
      irreversible: new IrreversibleFlags({ arc3: true, immutable: true }),
    })
    expect(flags.irreversibleByte).toBe(129)
  })

  test('arc20 smart asa', () => {
    // Test flags for an ARC-20 Smart ASA.
    const flags = new MetadataFlags({
      reversible: new ReversibleFlags({ arc20: true }),
      irreversible: IrreversibleFlags.empty(),
    })
    expect(flags.reversibleByte).toBe(1)
  })

  test('arc62 circulating supply', () => {
    // Test flags for ARC-62 circulating supply tracking.
    const flags = new MetadataFlags({
      reversible: new ReversibleFlags({ arc62: true }),
      irreversible: IrreversibleFlags.empty(),
    })
    expect(flags.reversibleByte).toBe(2)
  })

  test('ntt native token transfer', () => {
    // Test flags for NTT (Native Token Transfer) ASA.
    const flags = new MetadataFlags({
      reversible: new ReversibleFlags({ ntt: true }),
      irreversible: IrreversibleFlags.empty(),
    })
    expect(flags.reversibleByte).toBe(4)
  })

  test('parse existing metadata', () => {
    // Test parsing existing metadata flags from chain.
    // Simulate reading from chain
    const reversibleByte = 3 // arc20 + arc62
    const irreversibleByte = 129 // arc3 + immutable

    const flags = MetadataFlags.fromBytes(reversibleByte, irreversibleByte)

    expect(flags.irreversible.arc3).toBe(true)
    expect(flags.irreversible.immutable).toBe(true)
    expect(flags.reversible.arc20).toBe(true)
    expect(flags.reversible.arc62).toBe(true)
  })
})

describe('metadata header integration', () => {
  // Test integration with MetadataHeader.
  test('metadata header get flags', () => {
    // Test that MetadataHeader flags property returns correct MetadataFlags.
    const header = new MetadataHeader({
      identifiers: 0,
      flags: MetadataFlags.fromBytes(3, 129),
      metadataHash: new Uint8Array(32),
      lastModifiedRound: 1000,
      deprecatedBy: 0,
    })

    const flags = header.flags

    expect(flags.reversible.arc20).toBe(true)
    expect(flags.reversible.arc62).toBe(true)
    expect(flags.irreversible.arc3).toBe(true)
    expect(flags.irreversible.immutable).toBe(true)
  })

  test('metadata header convenience properties', () => {
    // Test that existing header properties still work.
    const header = new MetadataHeader({
      identifiers: 0,
      flags: MetadataFlags.fromBytes(3, 129),
      metadataHash: new Uint8Array(32),
      lastModifiedRound: 1000,
      deprecatedBy: 0,
    })

    expect(header.isArc3Compliant).toBe(true)
    expect(header.isImmutable).toBe(true)
    expect(header.isArc20SmartAsa).toBe(true)
    expect(header.isArc62CirculatingSupply).toBe(true)
  })
})
