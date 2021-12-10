import { Address, BigDecimal, BigInt, log} from '@graphprotocol/graph-ts'
import { BondDepository } from '../../generated/WETHBond/BondDepository';

import { BondDiscount, Transaction } from '../../generated/schema'
import {
  SQUIDETHLPBOND_CONTRACT,
  SQUIDETHLPBOND_CONTRACT_BLOCK,
  WETHBOND_CONTRACT,
  WETHBOND_CONTRACT_BLOCK,
} from './Constants';
import { hourFromTimestamp } from './Dates';
import { toDecimal } from './Decimals';
import { getOHMUSDRate } from './Price';

export function loadOrCreateBondDiscount(timestamp: BigInt): BondDiscount{
    let hourTimestamp = hourFromTimestamp(timestamp);

    let bondDiscount = BondDiscount.load(hourTimestamp)
    if (bondDiscount == null) {
        bondDiscount = new BondDiscount(hourTimestamp)
        bondDiscount.timestamp = timestamp
        bondDiscount.weth_discount = BigDecimal.fromString("0")
        bondDiscount.squideth_discount  = BigDecimal.fromString("0")
        bondDiscount.save()
    }
    return bondDiscount as BondDiscount
}

export function updateBondDiscounts(transaction: Transaction): void{
    let bd = loadOrCreateBondDiscount(transaction.timestamp);
    let ohmRate = getOHMUSDRate();

    // SQUID-ETH
    if(transaction.blockNumber.gt(BigInt.fromString(SQUIDETHLPBOND_CONTRACT_BLOCK))){
        let bond = BondDepository.bind(Address.fromString(SQUIDETHLPBOND_CONTRACT))
        let price_call = bond.try_bondPriceInUSD()
        if(price_call.reverted===false && price_call.value.gt(BigInt.fromI32(0))){
            bd.squideth_discount = ohmRate.div(toDecimal(price_call.value, 18))
            bd.squideth_discount = bd.squideth_discount.minus(BigDecimal.fromString("1"))
            bd.squideth_discount = bd.squideth_discount.times(BigDecimal.fromString("100"))
            log.debug("SQUIDETH Discount SQUID price {}  Bond Price {}  Discount {}", [ohmRate.toString(), price_call.value.toString(), bd.squideth_discount.toString()])
        }
    }

    // WETH
    if(transaction.blockNumber.gt(BigInt.fromString(WETHBOND_CONTRACT_BLOCK))){
        let bond = BondDepository.bind(Address.fromString(WETHBOND_CONTRACT))
        let price_call = bond.try_bondPriceInUSD()
        if(price_call.reverted===false && price_call.value.gt(BigInt.fromI32(0))){
            bd.weth_discount = ohmRate.div(toDecimal(price_call.value, 18))
            bd.weth_discount = bd.weth_discount.minus(BigDecimal.fromString("1"))
            bd.weth_discount = bd.weth_discount.times(BigDecimal.fromString("100"))
            log.debug("WETH Discount SQUID price {}  Bond Price {}  Discount {}", [ohmRate.toString(), price_call.value.toString(), bd.weth_discount.toString()])
        }
    }

    bd.save()
}
