import { Args, Serializable, Result } from '@massalabs/as-types';

/**
 * Statistics for a specific period
 */
@serializable
export class PeriodStats implements Serializable {
  /** Period number */
  period: u64 = 0;
  /** Total GB stored across all nodes */
  totalGbStored: u64 = 0;
  /** Total MAS distributed (nanoMAS) */
  totalRewardsDistributed: u64 = 0;
  /** Number of active nodes */
  activeNodes: u64 = 0;
  /** Challenges issued this period */
  challengesIssued: u64 = 0;
  /** Challenges passed this period */
  challengesPassed: u64 = 0;
  /** Whether rewards have been distributed for this period */
  rewardsDistributed: bool = false;

  constructor(period: u64 = 0) {
    this.period = period;
  }

  serialize(): StaticArray<u8> {
    return new Args()
      .add(this.period)
      .add(this.totalGbStored)
      .add(this.totalRewardsDistributed)
      .add(this.activeNodes)
      .add(this.challengesIssued)
      .add(this.challengesPassed)
      .add(this.rewardsDistributed)
      .serialize();
  }

  deserialize(data: StaticArray<u8>, offset: i32): Result<i32> {
    const args = new Args(data, offset);

    const period = args.nextU64();
    if (period.isErr()) {
      return new Result(0, 'Failed to deserialize period');
    }
    this.period = period.unwrap();

    const totalGbStored = args.nextU64();
    if (totalGbStored.isErr()) {
      return new Result(0, 'Failed to deserialize totalGbStored');
    }
    this.totalGbStored = totalGbStored.unwrap();

    const totalRewardsDistributed = args.nextU64();
    if (totalRewardsDistributed.isErr()) {
      return new Result(0, 'Failed to deserialize totalRewardsDistributed');
    }
    this.totalRewardsDistributed = totalRewardsDistributed.unwrap();

    const activeNodes = args.nextU64();
    if (activeNodes.isErr()) {
      return new Result(0, 'Failed to deserialize activeNodes');
    }
    this.activeNodes = activeNodes.unwrap();

    const challengesIssued = args.nextU64();
    if (challengesIssued.isErr()) {
      return new Result(0, 'Failed to deserialize challengesIssued');
    }
    this.challengesIssued = challengesIssued.unwrap();

    const challengesPassed = args.nextU64();
    if (challengesPassed.isErr()) {
      return new Result(0, 'Failed to deserialize challengesPassed');
    }
    this.challengesPassed = challengesPassed.unwrap();

    const rewardsDistributed = args.nextBool();
    if (rewardsDistributed.isErr()) {
      return new Result(0, 'Failed to deserialize rewardsDistributed');
    }
    this.rewardsDistributed = rewardsDistributed.unwrap();

    return new Result(args.offset);
  }
}
