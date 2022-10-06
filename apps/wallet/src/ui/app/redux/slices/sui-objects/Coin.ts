// Copyright (c) Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

import { isSuiMoveObject, Coin as CoinAPI, SUI_TYPE_ARG } from '@mysten/sui.js';

import { SuiIcons } from '_font-icons/output/sui-icons';

import type {
    ObjectId,
    SuiObject,
    SuiMoveObject,
    SuiTransactionResponse,
    RawSigner,
    SuiAddress,
    JsonRpcProvider,
} from '@mysten/sui.js';

const COIN_TYPE = '0x2::coin::Coin';
const COIN_TYPE_ARG_REGEX = /^0x2::coin::Coin<(.+)>$/;
export const DEFAULT_GAS_BUDGET_FOR_SPLIT = 1000;
export const DEFAULT_GAS_BUDGET_FOR_MERGE = 500;
export const DEFAULT_GAS_BUDGET_FOR_TRANSFER = 100;
export const DEFAULT_GAS_BUDGET_FOR_TRANSFER_SUI = 100;
export const DEFAULT_GAS_BUDGET_FOR_PAY = 100;
export const DEFAULT_GAS_BUDGET_FOR_STAKE = 1000;
export const GAS_TYPE_ARG = '0x2::sui::SUI';
export const GAS_SYMBOL = 'SUI';
export const DEFAULT_NFT_TRANSFER_GAS_FEE = 450;
export const SUI_SYSTEM_STATE_OBJECT_ID =
    '0x0000000000000000000000000000000000000005';

// List of all supported coins
// TODO: Extend this list as needed
// Supported coins icons should be included
export const SUPPORTED_COINS_LIST = [
    {
        coinName: 'SUI Coin',
        coinSymbol: GAS_SYMBOL,
        coinType: GAS_TYPE_ARG,
        coinIconName: SuiIcons.SuiLogoIcon,
    },
];

// TODO use sdk
export class Coin {
    public static isCoin(obj: SuiObject) {
        return isSuiMoveObject(obj.data) && obj.data.type.startsWith(COIN_TYPE);
    }

    public static getCoinTypeArg(obj: SuiMoveObject) {
        const res = obj.type.match(COIN_TYPE_ARG_REGEX);
        return res ? res[1] : null;
    }

    public static isSUI(obj: SuiMoveObject) {
        const arg = Coin.getCoinTypeArg(obj);
        return arg ? Coin.getCoinSymbol(arg) === 'SUI' : false;
    }

    public static getCoinSymbol(coinTypeArg: string) {
        return coinTypeArg.substring(coinTypeArg.lastIndexOf(':') + 1);
    }

    public static getBalance(obj: SuiMoveObject): bigint {
        return BigInt(obj.fields.balance);
    }

    public static getID(obj: SuiMoveObject): ObjectId {
        return obj.fields.id.id;
    }

    public static getCoinTypeFromArg(coinTypeArg: string) {
        return `${COIN_TYPE}<${coinTypeArg}>`;
    }

    /**
     * Transfer `amount` of Coin<T> to `recipient`.
     *
     * @param signer A signer with connection to the gateway:e.g., new RawSigner(keypair, new JsonRpcProvider(endpoint))
     * @param coins A list of Coins owned by the signer with the same generic type(e.g., 0x2::Sui::Sui)
     * @param amount The amount to be transfer
     * @param recipient The sui address of the recipient
     */
    public static async transferCoin(
        signer: RawSigner,
        coins: SuiMoveObject[],
        amount: bigint,
        recipient: SuiAddress
    ): Promise<SuiTransactionResponse> {
        await signer.syncAccountState();
        const inputCoins =
            await CoinAPI.selectCoinSetWithCombinedBalanceGreaterThanOrEqual(
                coins,
                amount
            );
        if (inputCoins.length === 0) {
            const totalBalance = CoinAPI.totalBalance(coins);
            throw new Error(
                `Coin balance ${totalBalance.toString()} is not sufficient to cover the transfer amount ` +
                    `${amount.toString()}. Try reducing the transfer amount to ${totalBalance}.`
            );
        }
        return await signer.pay({
            inputCoins: inputCoins.map((c) => CoinAPI.getID(c)),
            recipients: [recipient],
            amounts: [Number(amount)],
            gasBudget: DEFAULT_GAS_BUDGET_FOR_TRANSFER,
        });
    }

    /**
     * Transfer `amount` of Coin<Sui> to `recipient`.
     *
     * @param signer A signer with connection to the gateway:e.g., new RawSigner(keypair, new JsonRpcProvider(endpoint))
     * @param coins A list of Sui Coins owned by the signer
     * @param amount The amount to be transferred
     * @param recipient The sui address of the recipient
     */
    public static async transferSui(
        signer: RawSigner,
        coins: SuiMoveObject[],
        amount: bigint,
        recipient: SuiAddress
    ): Promise<SuiTransactionResponse> {
        await signer.syncAccountState();
        const targetAmount =
            amount + BigInt(DEFAULT_GAS_BUDGET_FOR_TRANSFER_SUI);
        const coinsWithSufficientAmount =
            await CoinAPI.selectCoinsWithBalanceGreaterThanOrEqual(
                coins,
                targetAmount
            );
        if (coinsWithSufficientAmount.length > 0) {
            return await signer.transferSui({
                suiObjectId: CoinAPI.getID(coinsWithSufficientAmount[0]),
                gasBudget: DEFAULT_GAS_BUDGET_FOR_TRANSFER_SUI,
                recipient: recipient,
                amount: Number(amount),
            });
        }

        // TODO: use PaySui Transaction when it is ready
        // If there is not a coin with sufficient balance, use the pay API
        const gasCostForPay =
            // TODO: the required gas budget for pay transaction increases with the number of input
            // coins while the actual gas cost decreases with the number of coins, which seems to
            // be a bug in the gas deduction algorithm
            DEFAULT_GAS_BUDGET_FOR_PAY * Math.min(10, coins.length / 2);
        let inputCoins = await Coin.assertAndGetCoinsWithBalanceGte(
            coins,
            targetAmount,
            gasCostForPay
        );

        // In this case, all coins are needed to cover the transfer amount plus gas budget, leaving
        // no coins for gas payment. This won't be a problem once we introduce `PaySui`.
        if (inputCoins.length === coins.length) {
            // We need to pay for an additional `transferSui` transaction now, assert that we have sufficient balance
            // to cover the additional cost
            await Coin.assertAndGetCoinsWithBalanceGte(
                coins,
                amount +
                    BigInt(gasCostForPay + DEFAULT_GAS_BUDGET_FOR_TRANSFER_SUI),
                gasCostForPay + DEFAULT_GAS_BUDGET_FOR_TRANSFER_SUI
            );

            // Split the gas budget from the coin with largest balance for simplicity. We can also use any coin
            // that has amount greater than or equal to `DEFAULT_GAS_BUDGET_FOR_TRANSFER_SUI * 2`
            const coinWithLargestBalance = inputCoins[inputCoins.length - 1];

            if (
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                CoinAPI.getBalance(coinWithLargestBalance)! <
                gasCostForPay + DEFAULT_GAS_BUDGET_FOR_TRANSFER_SUI
            ) {
                throw new Error(
                    `None of the coins has sufficient balance to cover gas fee`
                );
            }

            await signer.transferSui({
                suiObjectId: CoinAPI.getID(coinWithLargestBalance),
                gasBudget: DEFAULT_GAS_BUDGET_FOR_TRANSFER_SUI,
                recipient: await signer.getAddress(),
                amount: gasCostForPay,
            });

            inputCoins =
                await signer.provider.selectCoinSetWithCombinedBalanceGreaterThanOrEqual(
                    await signer.getAddress(),
                    amount,
                    SUI_TYPE_ARG,
                    []
                );
        }

        return await signer.pay({
            inputCoins: inputCoins.map((c) => CoinAPI.getID(c)),
            recipients: [recipient],
            amounts: [Number(amount)],
            gasBudget: gasCostForPay,
        });
    }

    private static async assertAndGetCoinsWithBalanceGte(
        coins: SuiMoveObject[],
        amount: bigint,
        gasBudget?: number
    ) {
        const inputCoins =
            await CoinAPI.selectCoinSetWithCombinedBalanceGreaterThanOrEqual(
                coins,
                amount
            );
        if (inputCoins.length === 0) {
            const totalBalance = CoinAPI.totalBalance(coins);
            const maxTransferAmount = gasBudget
                ? totalBalance - BigInt(gasBudget)
                : totalBalance;
            const gasText = gasBudget ? ` plus gas budget ${gasBudget}` : '';
            throw new Error(
                `Coin balance ${totalBalance.toString()} is not sufficient to cover the transfer amount ` +
                    `${amount.toString()}${gasText}. ` +
                    `Try reducing the transfer amount to ${maxTransferAmount.toString()}.`
            );
        }
        return inputCoins;
    }

    /**
     * Stake `amount` of Coin<T> to `validator`. Technically it means user delegates `amount` of Coin<T> to `validator`,
     * such that `validator` will stake the `amount` of Coin<T> for the user.
     *
     * @param signer A signer with connection to the gateway:e.g., new RawSigner(keypair, new JsonRpcProvider(endpoint))
     * @param coins A list of Coins owned by the signer with the same generic type(e.g., 0x2::Sui::Sui)
     * @param amount The amount to be staked
     * @param validator The sui address of the chosen validator
     */
    public static async stakeCoin(
        signer: RawSigner,
        coins: SuiMoveObject[],
        amount: bigint,
        validator: SuiAddress
    ): Promise<SuiTransactionResponse> {
        await signer.syncAccountState();
        const coin = await Coin.requestSuiCoinWithExactAmount(
            signer,
            coins,
            amount
        );
        return await signer.executeMoveCall({
            packageObjectId: '0x2',
            module: 'sui_system',
            function: 'request_add_delegation',
            typeArguments: [],
            arguments: [SUI_SYSTEM_STATE_OBJECT_ID, coin, validator],
            gasBudget: DEFAULT_GAS_BUDGET_FOR_STAKE,
        });
    }

    private static async requestSuiCoinWithExactAmount(
        signer: RawSigner,
        coins: SuiMoveObject[],
        amount: bigint
    ): Promise<ObjectId> {
        const coinWithExactAmount = await Coin.selectCoinWithExactAmount(
            signer,
            coins,
            amount
        );
        if (coinWithExactAmount) {
            return coinWithExactAmount;
        }
        // use transferSui API to get a coin with the exact amount
        await Coin.transferSui(
            signer,
            coins,
            amount,
            await signer.getAddress()
        );

        const coinWithExactAmount2 = await Coin.selectCoinWithExactAmount(
            signer,
            coins,
            amount,
            true
        );
        if (!coinWithExactAmount2) {
            throw new Error(`requestCoinWithExactAmount failed unexpectedly`);
        }
        return coinWithExactAmount2;
    }

    private static async selectCoinWithExactAmount(
        signer: RawSigner,
        coins: SuiMoveObject[],
        amount: bigint,
        refreshData = false
    ): Promise<ObjectId | undefined> {
        const coinsWithSufficientAmount = refreshData
            ? await signer.provider.selectCoinsWithBalanceGreaterThanOrEqual(
                  await signer.getAddress(),
                  amount,
                  SUI_TYPE_ARG,
                  []
              )
            : await CoinAPI.selectCoinsWithBalanceGreaterThanOrEqual(
                  coins,
                  amount
              );

        if (
            coinsWithSufficientAmount.length > 0 &&
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            CoinAPI.getBalance(coinsWithSufficientAmount[0])! === amount
        ) {
            return CoinAPI.getID(coinsWithSufficientAmount[0]);
        }

        return undefined;
    }

    public static async getActiveValidators(
        provider: JsonRpcProvider
    ): Promise<Array<SuiMoveObject>> {
        const contents = await provider.getObject(SUI_SYSTEM_STATE_OBJECT_ID);
        const data = (contents.details as SuiObject).data;
        const validators = (data as SuiMoveObject).fields.validators;
        const active_validators = (validators as SuiMoveObject).fields
            .active_validators;
        return active_validators as Array<SuiMoveObject>;
    }
}
