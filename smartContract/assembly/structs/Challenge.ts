import { Args, Serializable, Result } from '@massalabs/as-types';

/**
 * Represents a storage challenge issued to a node
 */
@serializable
export class Challenge implements Serializable {
  /** Challenge unique ID (hash) */
  id: string = '';
  /** Challenged node address */
  nodeAddress: string = '';
  /** Chunk to prove */
  chunkId: string = '';
  /** Random nonce */
  nonce: u64 = 0;
  /** Period when issued */
  issuedPeriod: u64 = 0;
  /** Timestamp deadline (ms) */
  deadline: u64 = 0;
  /** Has been resolved */
  resolved: bool = false;
  /** Did node pass */
  passed: bool = false;

  constructor(
    id: string = '',
    nodeAddress: string = '',
    chunkId: string = '',
    nonce: u64 = 0,
    issuedPeriod: u64 = 0,
    deadline: u64 = 0,
  ) {
    this.id = id;
    this.nodeAddress = nodeAddress;
    this.chunkId = chunkId;
    this.nonce = nonce;
    this.issuedPeriod = issuedPeriod;
    this.deadline = deadline;
    this.resolved = false;
    this.passed = false;
  }

  serialize(): StaticArray<u8> {
    return new Args()
      .add(this.id)
      .add(this.nodeAddress)
      .add(this.chunkId)
      .add(this.nonce)
      .add(this.issuedPeriod)
      .add(this.deadline)
      .add(this.resolved)
      .add(this.passed)
      .serialize();
  }

  deserialize(data: StaticArray<u8>, offset: i32): Result<i32> {
    const args = new Args(data, offset);

    const id = args.nextString();
    if (id.isErr()) {
      return new Result(0, 'Failed to deserialize id');
    }
    this.id = id.unwrap();

    const nodeAddress = args.nextString();
    if (nodeAddress.isErr()) {
      return new Result(0, 'Failed to deserialize nodeAddress');
    }
    this.nodeAddress = nodeAddress.unwrap();

    const chunkId = args.nextString();
    if (chunkId.isErr()) {
      return new Result(0, 'Failed to deserialize chunkId');
    }
    this.chunkId = chunkId.unwrap();

    const nonce = args.nextU64();
    if (nonce.isErr()) {
      return new Result(0, 'Failed to deserialize nonce');
    }
    this.nonce = nonce.unwrap();

    const issuedPeriod = args.nextU64();
    if (issuedPeriod.isErr()) {
      return new Result(0, 'Failed to deserialize issuedPeriod');
    }
    this.issuedPeriod = issuedPeriod.unwrap();

    const deadline = args.nextU64();
    if (deadline.isErr()) {
      return new Result(0, 'Failed to deserialize deadline');
    }
    this.deadline = deadline.unwrap();

    const resolved = args.nextBool();
    if (resolved.isErr()) {
      return new Result(0, 'Failed to deserialize resolved');
    }
    this.resolved = resolved.unwrap();

    const passed = args.nextBool();
    if (passed.isErr()) {
      return new Result(0, 'Failed to deserialize passed');
    }
    this.passed = passed.unwrap();

    return new Result(args.offset);
  }
}
