import { Args, Serializable, Result } from '@massalabs/as-types';

/**
 * Represents a storage provider node in the network
 */
@serializable
export class StorageNode implements Serializable {
  /** Node's address */
  address: string = '';
  /** Allocated storage in GB */
  allocatedGb: u64 = 0;
  /** Period when registered */
  registeredPeriod: u64 = 0;
  /** Total challenges received */
  totalChallenges: u64 = 0;
  /** Challenges passed */
  passedChallenges: u64 = 0;
  /** Unclaimed rewards (nanoMAS) */
  pendingRewards: u64 = 0;
  /** Last challenge period (u64.MAX_VALUE = never challenged) */
  lastChallengedPeriod: u64 = u64.MAX_VALUE;
  /** Last period rewards were calculated for */
  lastRewardedPeriod: u64 = 0;
  /** Is node currently active */
  active: bool = false;

  constructor(
    address: string = '',
    allocatedGb: u64 = 0,
    registeredPeriod: u64 = 0,
  ) {
    this.address = address;
    this.allocatedGb = allocatedGb;
    this.registeredPeriod = registeredPeriod;
    this.lastChallengedPeriod = u64.MAX_VALUE; // Never challenged
    this.lastRewardedPeriod = registeredPeriod;
    this.active = true;
  }

  /**
   * Check if node passed the challenge for the current period
   */
  hasPassedCurrentChallenge(currentPeriod: u64): bool {
    return (
      this.lastChallengedPeriod == currentPeriod &&
      this.passedChallenges > 0 &&
      this.passedChallenges == this.totalChallenges
    );
  }

  serialize(): StaticArray<u8> {
    return new Args()
      .add(this.address)
      .add(this.allocatedGb)
      .add(this.registeredPeriod)
      .add(this.totalChallenges)
      .add(this.passedChallenges)
      .add(this.pendingRewards)
      .add(this.lastChallengedPeriod)
      .add(this.lastRewardedPeriod)
      .add(this.active)
      .serialize();
  }

  deserialize(data: StaticArray<u8>, offset: i32): Result<i32> {
    const args = new Args(data, offset);

    const address = args.nextString();
    if (address.isErr()) {
      return new Result(0, 'Failed to deserialize address');
    }
    this.address = address.unwrap();

    const allocatedGb = args.nextU64();
    if (allocatedGb.isErr()) {
      return new Result(0, 'Failed to deserialize allocatedGb');
    }
    this.allocatedGb = allocatedGb.unwrap();

    const registeredPeriod = args.nextU64();
    if (registeredPeriod.isErr()) {
      return new Result(0, 'Failed to deserialize registeredPeriod');
    }
    this.registeredPeriod = registeredPeriod.unwrap();

    const totalChallenges = args.nextU64();
    if (totalChallenges.isErr()) {
      return new Result(0, 'Failed to deserialize totalChallenges');
    }
    this.totalChallenges = totalChallenges.unwrap();

    const passedChallenges = args.nextU64();
    if (passedChallenges.isErr()) {
      return new Result(0, 'Failed to deserialize passedChallenges');
    }
    this.passedChallenges = passedChallenges.unwrap();

    const pendingRewards = args.nextU64();
    if (pendingRewards.isErr()) {
      return new Result(0, 'Failed to deserialize pendingRewards');
    }
    this.pendingRewards = pendingRewards.unwrap();

    const lastChallengedPeriod = args.nextU64();
    if (lastChallengedPeriod.isErr()) {
      return new Result(0, 'Failed to deserialize lastChallengedPeriod');
    }
    this.lastChallengedPeriod = lastChallengedPeriod.unwrap();

    const lastRewardedPeriod = args.nextU64();
    if (lastRewardedPeriod.isErr()) {
      return new Result(0, 'Failed to deserialize lastRewardedPeriod');
    }
    this.lastRewardedPeriod = lastRewardedPeriod.unwrap();

    const active = args.nextBool();
    if (active.isErr()) {
      return new Result(0, 'Failed to deserialize active');
    }
    this.active = active.unwrap();

    return new Result(args.offset);
  }
}
