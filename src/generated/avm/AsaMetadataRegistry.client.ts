// This file is auto-generated, do not modify
/* eslint-disable */
import type { gtxn } from '@algorandfoundation/algorand-typescript'
import { Contract, abimethod, arc4, err } from '@algorandfoundation/algorand-typescript'

export class MbrDelta extends arc4.Struct<{
  sign: arc4.Uint<8>
  amount: arc4.Uint<64>
}> {}

export class RegistryParameters extends arc4.Struct<{
  key_size: arc4.Uint<8>
  header_size: arc4.Uint<16>
  max_metadata_size: arc4.Uint<16>
  short_metadata_size: arc4.Uint<16>
  page_size: arc4.Uint<16>
  first_payload_max_size: arc4.Uint<16>
  extra_payload_max_size: arc4.Uint<16>
  replace_payload_max_size: arc4.Uint<16>
  flat_mbr: arc4.Uint<64>
  byte_mbr: arc4.Uint<64>
}> {}

export class MetadataExistence extends arc4.Struct<{
  asa_exists: arc4.Bool
  metadata_exists: arc4.Bool
}> {}

export class MutableFlag extends arc4.Struct<{
  flag: arc4.Bool
  revision: arc4.Uint<64>
}> {}

export class MetadataHeader extends arc4.Struct<{
  identifiers: arc4.Byte
  reversible_flags: arc4.Byte
  irreversible_flags: arc4.Byte
  hash: arc4.StaticArray<arc4.Byte, 32>
  revision: arc4.Uint<64>
  deprecated_by: arc4.Uint<64>
}> {}

export class Pagination extends arc4.Struct<{
  metadata_size: arc4.Uint<16>
  page_size: arc4.Uint<16>
  total_pages: arc4.Uint<8>
  revision: arc4.Uint<64>
  deprecated_by: arc4.Uint<64>
}> {}

export class PaginatedMetadata extends arc4.Struct<{
  has_next_page: arc4.Bool
  revision: arc4.Uint<64>
  page_content: arc4.DynamicBytes
}> {}

export class MetadataSlice extends arc4.Struct<{
  revision: arc4.Uint<64>
  content: arc4.DynamicBytes
}> {}

export class HashRevision extends arc4.Struct<{
  hash: arc4.StaticArray<arc4.Byte, 32>
  revision: arc4.Uint<64>
}> {}

/**
 * 
 *     Singleton Application providing ASA metadata via Algod API and AVM
 *     
 */
export abstract class AsaMetadataRegistry extends Contract {
  /**
   * Create Asset Metadata for an existing ASA, restricted to the ASA Manager Address.
   */
  @abimethod()
  arc89_create_metadata(
    asset_id: arc4.Uint<64>,
    reversible_flags: arc4.Byte,
    irreversible_flags: arc4.Byte,
    metadata_size: arc4.Uint<16>,
    payload: arc4.DynamicBytes,
    mbr_delta_payment: gtxn.PaymentTxn,
  ): MbrDelta {
    err('stub only')
  }

  /**
   * Replace mutable Metadata with a smaller or equal size payload for an existing ASA,
   * restricted to the ASA Manager Address.
   */
  @abimethod()
  arc89_replace_metadata(
    asset_id: arc4.Uint<64>,
    metadata_size: arc4.Uint<16>,
    payload: arc4.DynamicBytes,
  ): MbrDelta {
    err('stub only')
  }

  /**
   * Replace mutable Metadata with a larger size payload for an existing ASA,
   * restricted to the ASA Manager Address.
   */
  @abimethod()
  arc89_replace_metadata_larger(
    asset_id: arc4.Uint<64>,
    metadata_size: arc4.Uint<16>,
    payload: arc4.DynamicBytes,
    mbr_delta_payment: gtxn.PaymentTxn,
  ): MbrDelta {
    err('stub only')
  }

  /**
   * Replace a slice of the Asset Metadata for an ASA with a payload of the same size,
   * restricted to the ASA Manager Address.
   */
  @abimethod()
  arc89_replace_metadata_slice(
    asset_id: arc4.Uint<64>,
    offset: arc4.Uint<16>,
    payload: arc4.DynamicBytes,
  ): void {
    err('stub only')
  }

  /**
   * Migrate the Asset Metadata for an ASA to a new ASA Metadata Registry version,
   * restricted to the ASA Manager Address
   */
  @abimethod()
  arc89_migrate_metadata(
    asset_id: arc4.Uint<64>,
    new_registry_id: arc4.Uint<64>,
  ): void {
    err('stub only')
  }

  /**
   * Delete Asset Metadata for an ASA, restricted to the ASA Manager Address (if the ASA still exists).
   */
  @abimethod()
  arc89_delete_metadata(asset_id: arc4.Uint<64>): MbrDelta {
    err('stub only')
  }

  /**
   * Concatenate extra payload to Asset Metadata head call methods (creation or replacement).
   */
  @abimethod()
  arc89_extra_payload(
    asset_id: arc4.Uint<64>,
    payload: arc4.DynamicBytes,
  ): void {
    err('stub only')
  }

  /**
   * Set a reversible Asset Metadata Flag, restricted to the ASA Manager Address
   */
  @abimethod()
  arc89_set_reversible_flag(
    asset_id: arc4.Uint<64>,
    flag: arc4.Uint<8>,
    value: arc4.Bool,
  ): void {
    err('stub only')
  }

  /**
   * Set an irreversible Asset Metadata Flag, restricted to the ASA Manager Address
   */
  @abimethod()
  arc89_set_irreversible_flag(
    asset_id: arc4.Uint<64>,
    flag: arc4.Uint<8>,
  ): void {
    err('stub only')
  }

  /**
   * Set Asset Metadata as immutable, restricted to the ASA Manager Address.
   */
  @abimethod()
  arc89_set_immutable(asset_id: arc4.Uint<64>): void {
    err('stub only')
  }

  /**
   * Return the ASA Metadata Registry parameters.
   */
  @abimethod({ readonly: true })
  arc89_get_metadata_registry_parameters(): RegistryParameters {
    err('stub only')
  }

  /**
   * Return the Asset Metadata ARC-90 partial URI, without compliance fragment (optional)
   */
  @abimethod({ readonly: true })
  arc89_get_metadata_partial_uri(): arc4.Str {
    err('stub only')
  }

  /**
   * Return the Asset Metadata Box MBR Delta for an ASA, given a new Asset Metadata byte size.
   * If the Asset Metadata Box does not exist, the creation MBR Delta is returned. If new_metadata_size is DELETE_METADATA_SIZE (0xFFFF), the deletion MBR Delta is returned.
   */
  @abimethod({ readonly: true })
  arc89_get_metadata_mbr_delta(
    asset_id: arc4.Uint<64>,
    new_metadata_size: arc4.Uint<16>,
  ): MbrDelta {
    err('stub only')
  }

  /**
   * Checks whether the specified ASA exists and whether its associated Asset Metadata is available.
   */
  @abimethod({ readonly: true })
  arc89_check_metadata_exists(asset_id: arc4.Uint<64>): MetadataExistence {
    err('stub only')
  }

  /**
   * Return True if the Asset Metadata for an ASA is immutable, False otherwise.
   */
  @abimethod({ readonly: true })
  arc89_is_metadata_immutable(asset_id: arc4.Uint<64>): arc4.Bool {
    err('stub only')
  }

  /**
   * Return True if Asset Metadata for an ASA is short (up to 4096 bytes), False otherwise.
   */
  @abimethod({ readonly: true })
  arc89_is_metadata_short(asset_id: arc4.Uint<64>): MutableFlag {
    err('stub only')
  }

  /**
   * Return the Asset Metadata Header for an ASA.
   */
  @abimethod({ readonly: true })
  arc89_get_metadata_header(asset_id: arc4.Uint<64>): MetadataHeader {
    err('stub only')
  }

  /**
   * Return the Asset Metadata pagination for an ASA.
   */
  @abimethod({ readonly: true })
  arc89_get_metadata_pagination(asset_id: arc4.Uint<64>): Pagination {
    err('stub only')
  }

  /**
   * Return paginated Asset Metadata (without Header) for an ASA.
   */
  @abimethod({ readonly: true })
  arc89_get_metadata(
    asset_id: arc4.Uint<64>,
    page: arc4.Uint<8>,
  ): PaginatedMetadata {
    err('stub only')
  }

  /**
   * Return a slice of the Asset Metadata for an ASA.
   */
  @abimethod({ readonly: true })
  arc89_get_metadata_slice(
    asset_id: arc4.Uint<64>,
    offset: arc4.Uint<16>,
    size: arc4.Uint<16>,
  ): MetadataSlice {
    err('stub only')
  }

  /**
   * Return the Metadata Header Hash for an ASA.
   */
  @abimethod({ readonly: true })
  arc89_get_metadata_header_hash(asset_id: arc4.Uint<64>): HashRevision {
    err('stub only')
  }

  /**
   * Return the SHA512-256 of a Metadata page for an ASA.
   */
  @abimethod({ readonly: true })
  arc89_get_metadata_page_hash(
    asset_id: arc4.Uint<64>,
    page: arc4.Uint<8>,
  ): HashRevision {
    err('stub only')
  }

  /**
   * Return the Metadata Hash for an ASA.
   */
  @abimethod({ readonly: true })
  arc89_get_metadata_hash(asset_id: arc4.Uint<64>): HashRevision {
    err('stub only')
  }

  /**
   * Return the UTF-8 string value for a top-level JSON key of type JSON String
   * from short Metadata for an ASA; errors if the key does not exist or is not a JSON String
   */
  @abimethod({ readonly: true })
  arc89_get_metadata_string_by_key(
    asset_id: arc4.Uint<64>,
    key: arc4.Str,
  ): arc4.Str {
    err('stub only')
  }

  /**
   * Return the uint64 value for a top-level JSON key of type JSON Uint64 from
   * short Metadata for an ASA; errors if the key does not exist or is not a JSON Uint64
   */
  @abimethod({ readonly: true })
  arc89_get_metadata_uint64_by_key(
    asset_id: arc4.Uint<64>,
    key: arc4.Str,
  ): arc4.Uint<64> {
    err('stub only')
  }

  /**
   * Return the UTF-8 object value for a top-level JSON key of type JSON Object
   * from short Metadata for an ASA; errors if the key does not exist or is not a JSON Object
   */
  @abimethod({ readonly: true })
  arc89_get_metadata_object_by_key(
    asset_id: arc4.Uint<64>,
    key: arc4.Str,
  ): arc4.Str {
    err('stub only')
  }

  /**
   * Return the base64-decoded bytes for a top-level JSON key of type JSON String
   * from short Metadata for an ASA; errors if the key does not exist, is not a JSON String, or is not valid base64 for the chosen encoding
   */
  @abimethod({ readonly: true })
  arc89_get_metadata_b64_bytes_by_key(
    asset_id: arc4.Uint<64>,
    key: arc4.Str,
    b64_encoding: arc4.Uint<8>,
  ): arc4.DynamicBytes {
    err('stub only')
  }

  /**
   * Non-normative placeholder method to acquire AVM extra resources.
   */
  @abimethod()
  extra_resources(): void {
    err('stub only')
  }

  /**
   * Non-normative method to withdraw balance excess due to accidental deposits
   * (it should never happen if deposits match exactly the required MBR. Deleted metadata MBR is not included in the excess, since it is immediately returned on delete).
   */
  @abimethod()
  withdraw_balance_excess(): void {
    err('stub only')
  }
}
