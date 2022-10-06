// Copyright (c) Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

import {
  getObjectFields,
  GetObjectDataResponse,
  SuiMoveObject,
  SuiObjectInfo,
  SuiObject,
  SuiData,
  getMoveObjectType,
  ObjectId,
  getObjectId,
} from './objects';
import { normalizeSuiObjectId, SuiAddress } from './common';

import { getOption, Option } from './option';
import { StructTag } from './sui-bcs';
import { isSuiMoveObject } from './index.guard';

export const COIN_PACKAGE_ID = '0x2';
export const COIN_MODULE_NAME = 'coin';
export const COIN_TYPE = `${COIN_PACKAGE_ID}::${COIN_MODULE_NAME}::Coin`;
export const COIN_SPLIT_VEC_FUNC_NAME = 'split_vec';
export const COIN_JOIN_FUNC_NAME = 'join';
const COIN_TYPE_ARG_REGEX = /^0x2::coin::Coin<(.+)>$/;

export const SUI_TYPE_ARG = '0x2::sui::SUI';

type ObjectData = ObjectDataFull | SuiObjectInfo;
type ObjectDataFull = GetObjectDataResponse | SuiMoveObject;

/**
 * Utility class for 0x2::coin
 * as defined in https://github.com/MystenLabs/sui/blob/ca9046fd8b1a9e8634a4b74b0e7dabdc7ea54475/sui_programmability/framework/sources/Coin.move#L4
 */
export class Coin {
  static isCoin(data: ObjectData): boolean {
    return Coin.getType(data)?.startsWith(COIN_TYPE) ?? false;
  }

  static getCoinTypeArg(obj: ObjectData) {
    const res = Coin.getType(obj)?.match(COIN_TYPE_ARG_REGEX);
    return res ? res[1] : null;
  }

  static isSUI(obj: ObjectData) {
    const arg = Coin.getCoinTypeArg(obj);
    return arg ? Coin.getCoinSymbol(arg) === 'SUI' : false;
  }

  static getCoinSymbol(coinTypeArg: string) {
    return coinTypeArg.substring(coinTypeArg.lastIndexOf(':') + 1);
  }

  static getCoinStructTag(coinTypeArg: string): StructTag {
    return {
      address: normalizeSuiObjectId(coinTypeArg.split('::')[0]),
      module: coinTypeArg.split('::')[1],
      name: coinTypeArg.split('::')[2],
      typeParams: [],
    };
  }

  public static getID(obj: ObjectData): ObjectId {
    if (isSuiMoveObject(obj)) {
      return obj.fields.id.id;
    }
    return getObjectId(obj);
  }

  /**
   * Convenience method for select coin objects that has a balance greater than or equal to `amount`
   *
   * @param amount coin balance
   * @param exclude object ids of the coins to exclude
   * @return a list of coin objects that has balance greater than `amount` in an ascending order
   */
  static selectCoinsWithBalanceGreaterThanOrEqual(
    coins: ObjectDataFull[],
    amount: bigint,
    exclude: ObjectId[] = []
  ): ObjectDataFull[] {
    return Coin.sortByBalance(
      coins.filter(
        (c) => !exclude.includes(Coin.getID(c)) && Coin.getBalance(c)! >= amount
      )
    );
  }

  /**
   * Convenience method for select a minimal set of coin objects that has a balance greater than
   * or equal to `amount`. The output can be used for `PayTransaction`
   *
   * @param amount coin balance
   * @param exclude object ids of the coins to exclude
   * @return a minimal list of coin objects that has a combined balance greater than or equal
   * to`amount` in an ascending order. If no such set exists, an empty list is returned
   */
  static selectCoinSetWithCombinedBalanceGreaterThanOrEqual(
    coins: ObjectDataFull[],
    amount: bigint,
    exclude: ObjectId[] = []
  ): ObjectDataFull[] {
    const sortedCoins = Coin.sortByBalance(
      coins.filter((c) => !exclude.includes(Coin.getID(c)))
    );

    const total = Coin.totalBalance(sortedCoins);
    // return empty set if the aggregate balance of all coins is smaller than amount
    if (total < amount) {
      return [];
    } else if (total === amount) {
      return sortedCoins;
    }

    return Coin.sortByBalance(Coin.selectCoinSetRecursive(sortedCoins, amount));
  }

  static totalBalance(coins: ObjectDataFull[]): bigint {
    return coins.reduce(
      (partialSum, c) => partialSum + Coin.getBalance(c)!,
      BigInt(0)
    );
  }

  /**
   * Sort coin by balance in an ascending order
   */
  static sortByBalance(coins: ObjectDataFull[]): ObjectDataFull[] {
    return coins.sort((a, b) =>
      Coin.getBalance(a)! < Coin.getBalance(b)!
        ? -1
        : Coin.getBalance(a)! > Coin.getBalance(b)!
        ? 1
        : 0
    );
  }

  private static selectCoinSetRecursive(
    sortedCoins: ObjectDataFull[],
    amount: bigint,
    ret: ObjectDataFull[] = []
  ): ObjectDataFull[] {
    const coinWithSmallestSufficientBalance = sortedCoins.find(
      (c) => Coin.getBalance(c)! >= amount
    );
    if (coinWithSmallestSufficientBalance) {
      ret.push(coinWithSmallestSufficientBalance);
      return ret;
    }
    // Add the coin with largest balance to the return set
    const coinWithLargestBalance = sortedCoins.pop()!;
    ret.push(coinWithLargestBalance);
    return Coin.selectCoinSetRecursive(
      sortedCoins,
      amount - Coin.getBalance(coinWithLargestBalance)!,
      ret
    );
  }

  static getBalance(data: ObjectDataFull): bigint | undefined {
    if (!Coin.isCoin(data)) {
      return undefined;
    }
    const balance = getObjectFields(data)?.balance;
    return BigInt(balance);
  }

  static getZero(): bigint {
    return BigInt(0);
  }

  private static getType(data: ObjectData): string | undefined {
    if ('status' in data) {
      return getMoveObjectType(data);
    }
    return data.type;
  }
}

export type DelegationData = SuiMoveObject &
  Pick<SuiData, 'dataType'> & {
    type: '0x2::delegation::Delegation';
    fields: {
      active_delegation: Option<number>;
      delegate_amount: number;
      next_reward_unclaimed_epoch: number;
      validator_address: SuiAddress;
      info: {
        id: string;
        version: number;
      };
      coin_locked_until_epoch: Option<SuiMoveObject>;
      ending_epoch: Option<number>;
    };
  };

export type DelegationSuiObject = Omit<SuiObject, 'data'> & {
  data: DelegationData;
};

// Class for delegation.move
// see https://github.com/MystenLabs/fastnft/blob/161aa27fe7eb8ecf2866ec9eb192e768f25da768/crates/sui-framework/sources/governance/delegation.move
export class Delegation {
  public static readonly SUI_OBJECT_TYPE = '0x2::delegation::Delegation';
  private suiObject: DelegationSuiObject;

  public static isDelegationSuiObject(
    obj: SuiObject
  ): obj is DelegationSuiObject {
    return 'type' in obj.data && obj.data.type === Delegation.SUI_OBJECT_TYPE;
  }

  constructor(obj: DelegationSuiObject) {
    this.suiObject = obj;
  }

  public nextRewardUnclaimedEpoch() {
    return this.suiObject.data.fields.next_reward_unclaimed_epoch;
  }

  public activeDelegation() {
    return BigInt(getOption(this.suiObject.data.fields.active_delegation) || 0);
  }

  public delegateAmount() {
    return this.suiObject.data.fields.delegate_amount;
  }

  public endingEpoch() {
    return getOption(this.suiObject.data.fields.ending_epoch);
  }

  public validatorAddress() {
    return this.suiObject.data.fields.validator_address;
  }

  public isActive() {
    return this.activeDelegation() > 0 && !this.endingEpoch();
  }

  public hasUnclaimedRewards(epoch: number) {
    return (
      this.nextRewardUnclaimedEpoch() <= epoch &&
      (this.isActive() || (this.endingEpoch() || 0) > epoch)
    );
  }
}
