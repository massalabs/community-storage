import { Args, Serializable, Result } from '@massalabs/as-types';

/**
 * Contract configuration parameters
 */
@serializable
export class StorageConfig implements Serializable {
  /** Reward per GB per period (nanoMAS) */
  rewardPerGbPerPeriod: u64 = 1_000_000; // 0.001 MAS default
  /** Minimum storage to register (GB) */
  minAllocatedGb: u64 = 1;
  /** Maximum storage per node (GB) */
  maxAllocatedGb: u64 = 1000;
  /** Challenge response timeout (ms) */
  challengeResponseTimeout: u64 = 60_000; // 1 minute
  /** Penalty for failed challenge (percentage 0-100) */
  slashPercentage: u64 = 10;
  /** Required stake to register (nanoMAS) */
  minStake: u64 = 100_000_000_000; // 100 MAS default
  /** Number of periods between reward distributions */
  rewardDistributionPeriod: u64 = 100;

  constructor() {}

  serialize(): StaticArray<u8> {
    return new Args()
      .add(this.rewardPerGbPerPeriod)
      .add(this.minAllocatedGb)
      .add(this.maxAllocatedGb)
      .add(this.challengeResponseTimeout)
      .add(this.slashPercentage)
      .add(this.minStake)
      .add(this.rewardDistributionPeriod)
      .serialize();
  }

  deserialize(data: StaticArray<u8>, offset: i32): Result<i32> {
    const args = new Args(data, offset);

    const rewardPerGbPerPeriod = args.nextU64();
    if (rewardPerGbPerPeriod.isErr()) {
      return new Result(0, 'Failed to deserialize rewardPerGbPerPeriod');
    }
    this.rewardPerGbPerPeriod = rewardPerGbPerPeriod.unwrap();

    const minAllocatedGb = args.nextU64();
    if (minAllocatedGb.isErr()) {
      return new Result(0, 'Failed to deserialize minAllocatedGb');
    }
    this.minAllocatedGb = minAllocatedGb.unwrap();

    const maxAllocatedGb = args.nextU64();
    if (maxAllocatedGb.isErr()) {
      return new Result(0, 'Failed to deserialize maxAllocatedGb');
    }
    this.maxAllocatedGb = maxAllocatedGb.unwrap();

    const challengeResponseTimeout = args.nextU64();
    if (challengeResponseTimeout.isErr()) {
      return new Result(0, 'Failed to deserialize challengeResponseTimeout');
    }
    this.challengeResponseTimeout = challengeResponseTimeout.unwrap();

    const slashPercentage = args.nextU64();
    if (slashPercentage.isErr()) {
      return new Result(0, 'Failed to deserialize slashPercentage');
    }
    this.slashPercentage = slashPercentage.unwrap();

    const minStake = args.nextU64();
    if (minStake.isErr()) {
      return new Result(0, 'Failed to deserialize minStake');
    }
    this.minStake = minStake.unwrap();

    const rewardDistributionPeriod = args.nextU64();
    if (rewardDistributionPeriod.isErr()) {
      return new Result(0, 'Failed to deserialize rewardDistributionPeriod');
    }
    this.rewardDistributionPeriod = rewardDistributionPeriod.unwrap();

    return new Result(args.offset);
  }
}
