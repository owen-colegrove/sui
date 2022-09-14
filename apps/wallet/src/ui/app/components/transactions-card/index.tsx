// Copyright (c) 2022, Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

import cl from 'classnames';
import { memo, useMemo } from 'react';
import { useIntl } from 'react-intl';
import { Link } from 'react-router-dom';

import { coinFormat } from '_app/shared/coin-balance/coin-format';
import Icon, { SuiIcons } from '_components/icon';
import { formatDate } from '_helpers';
import { useMiddleEllipsis } from '_hooks';
import { GAS_TYPE_ARG } from '_redux/slices/sui-objects/Coin';

import type { TxResultState } from '_redux/slices/txresults';

import st from './TransactionsCard.module.scss';

const TRUNCATE_MAX_LENGTH = 8;
const TRUNCATE_PREFIX_LENGTH = 4;

// Truncatte text after one line (~ 35 characters)
const TRUNCATE_MAX_CHAR = 35;

function TransactionCard({ txn }: { txn: TxResultState }) {
    const intl = useIntl();

    const toAddrStr = useMiddleEllipsis(
        txn.to || '',
        TRUNCATE_MAX_LENGTH,
        TRUNCATE_PREFIX_LENGTH
    );
    const fromAddrStr = useMiddleEllipsis(
        txn.from || '',
        TRUNCATE_MAX_LENGTH,
        TRUNCATE_PREFIX_LENGTH
    );

    const truncatedNftName = useMiddleEllipsis(
        txn?.name || '',
        TRUNCATE_MAX_CHAR,
        TRUNCATE_MAX_CHAR - 1
    );
    const truncatedNftDiscription = useMiddleEllipsis(
        txn?.description || '',
        TRUNCATE_MAX_CHAR,
        TRUNCATE_MAX_CHAR - 1
    );

    // TODO: update to account for bought, minted, swapped, etc
    const transferType =
        txn.kind === 'Call' ? 'Call' : txn.isSender ? 'Sent' : 'Received';

    const transferMeta = {
        Call: {
            txName: 'Minted',
            transfer: false,
            address: false,
            icon: SuiIcons.Buy,
            iconClassName: cl(st.arrowActionIcon, st.buyIcon),
        },
        Sent: {
            txName: 'Sent',
            transfer: 'To',
            address: toAddrStr,
            icon: SuiIcons.ArrowLeft,
            iconClassName: cl(st.arrowActionIcon, st.angledArrow),
        },
        Received: {
            txName: 'Received',
            transfer: 'From',
            address: fromAddrStr,
            icon: SuiIcons.ArrowLeft,
            iconClassName: cl(st.arrowActionIcon, st.angledArrow, st.received),
        },
    };

    const date = txn?.timestampMs
        ? formatDate(txn.timestampMs, ['month', 'day', 'hour', 'minute'])
        : false;

    const TransferSuiTxn = txn.kind === 'TransferSui' ? <span>SUI</span> : null;
    const TransferFailed =
        txn.status !== 'success' ? (
            <div className={st.transferFailed}>Failed</div>
        ) : null;

    const TxnsAddress = transferMeta[transferType]?.address ? (
        <div className={st.address}>
            <div className={st.txTypeName}>
                {transferMeta[transferType].transfer}
            </div>
            <div className={cl(st.txValue, st.txAddress)}>
                {transferMeta[transferType].address}
            </div>
        </div>
    ) : null;
    const { amount: txAmount, txGas } = txn;
    // XXX: supports only SUI - it seems we always assume the type of the amount of a tx is SUI
    const txAmountFormatted = useMemo(() => {
        const amountToFormat = BigInt(
            txAmount !== undefined ? txAmount : txGas
        );
        return coinFormat(intl, amountToFormat, GAS_TYPE_ARG, 'loose');
    }, [txAmount, txGas, intl]);
    return (
        <Link
            to={`/receipt?${new URLSearchParams({
                txdigest: txn.txId,
            }).toString()}`}
            className={st.txCard}
        >
            <div className={st.card} key={txn.txId}>
                <div className={st.cardIcon}>
                    <Icon
                        icon={transferMeta[transferType].icon}
                        className={transferMeta[transferType].iconClassName}
                    />
                </div>
                <div className={st.cardContent}>
                    <div className={st.txResult}>
                        <div className={cl(st.txTypeName, st.kind)}>
                            {transferMeta[transferType].txName} {TransferSuiTxn}
                        </div>

                        <div className={st.txTransferred}>
                            <div className={st.txAmount}>
                                {txAmountFormatted.displayBalance}
                                <span>{txAmountFormatted.symbol}</span>
                            </div>
                        </div>
                    </div>

                    {TxnsAddress || TransferFailed ? (
                        <div className={st.txResult}>
                            {TxnsAddress}
                            {TransferFailed}
                        </div>
                    ) : null}

                    {txn.url && (
                        <div className={st.txImage}>
                            <img
                                src={txn.url.replace(
                                    /^ipfs:\/\//,
                                    'https://ipfs.io/ipfs/'
                                )}
                                alt={txn?.name || 'NFT'}
                            />
                            <div className={st.nftInfo}>
                                <div className={st.nftName}>
                                    {truncatedNftName}
                                </div>
                                <div className={st.nftDescription}>
                                    {truncatedNftDiscription}
                                </div>
                            </div>
                        </div>
                    )}
                    {date && <div className={st.txTypeDate}>{date}</div>}
                </div>
            </div>
        </Link>
    );
}

export default memo(TransactionCard);
