import { Address, BigDecimal, BigInt, log } from '@graphprotocol/graph-ts'
import { Ohmie, Transaction } from '../../generated/schema'
import { OlympusERC20 } from '../../generated/WETHBond/OlympusERC20'
import { sOlympusERC20V2 } from '../../generated/WETHBond/sOlympusERC20V2'
import { BondDepository } from '../../generated/WETHBond/BondDepository'

import {
  SQUIDETHLPBOND_CONTRACT,
  SQUIDETHLPBOND_CONTRACT_BLOCK,
  WETHBOND_CONTRACT,
  WETHBOND_CONTRACT_BLOCK,
  WETHBOND_CONTRACT2,
  WETHBOND_CONTRACT2_BLOCK,
  OHM_ERC20_CONTRACT,
  SOHM_ERC20_CONTRACTV2,
} from '../utils/Constants'
import { loadOrCreateOhmieBalance } from './OhmieBalances'
import { toDecimal } from './Decimals'
import { getOHMUSDRate } from './Price'
import { loadOrCreateContractInfo } from './ContractInfo'
import { getHolderAux } from './Aux'

export function loadOrCreateOHMie(addres: Address): Ohmie{
    let ohmie = Ohmie.load(addres.toHex())
    if (ohmie == null) {
        let holders = getHolderAux()
        holders.value = holders.value.plus(BigInt.fromI32(1))
        holders.save()

        ohmie = new Ohmie(addres.toHex())
        ohmie.active = true
        ohmie.save()
    }
    return ohmie as Ohmie
}

export function updateOhmieBalance(ohmie: Ohmie, transaction: Transaction): void{

    let balance = loadOrCreateOhmieBalance(ohmie, transaction.timestamp)

    let ohm_contract = OlympusERC20.bind(Address.fromString(OHM_ERC20_CONTRACT))
    let sohm_contract = sOlympusERC20V2.bind(Address.fromString(SOHM_ERC20_CONTRACTV2))
    balance.ohmBalance = toDecimal(ohm_contract.balanceOf(Address.fromString(ohmie.id)), 9)
    balance.sohmBalance = toDecimal(sohm_contract.balanceOf(Address.fromString(ohmie.id)), 9)

    let stakes = balance.stakes

    balance.stakes = stakes

    if(ohmie.active && balance.ohmBalance.lt(BigDecimal.fromString("0.01")) && balance.sohmBalance.lt(BigDecimal.fromString("0.01"))){
        let holders = getHolderAux()
        holders.value = holders.value.minus(BigInt.fromI32(1))
        holders.save()
        ohmie.active = false
    }
    else if(ohmie.active==false && (balance.ohmBalance.gt(BigDecimal.fromString("0.01")) || balance.sohmBalance.gt(BigDecimal.fromString("0.01")))){
        let holders = getHolderAux()
        holders.value = holders.value.plus(BigInt.fromI32(1))
        holders.save()
        ohmie.active = true
    }

    // SQUID-ETH
    let bonds = balance.bonds
    if(transaction.blockNumber.gt(BigInt.fromString(SQUIDETHLPBOND_CONTRACT_BLOCK))){
        let bondSquidETH_contract = BondDepository.bind(Address.fromString(SQUIDETHLPBOND_CONTRACT))
        let pending = bondSquidETH_contract.bondInfo(Address.fromString(ohmie.id))
        if (pending.value1.gt(BigInt.fromString("0"))){
            let pending_bond = toDecimal(pending.value1, 9)
            balance.bondBalance = balance.bondBalance.plus(pending_bond)

            let binfo = loadOrCreateContractInfo(ohmie.id + transaction.timestamp.toString() + "SQUIDETHLPBond")
            binfo.name = "SQUID-ETH"
            binfo.contract = SQUIDETHLPBOND_CONTRACT
            binfo.amount = pending_bond
            binfo.save()
            bonds.push(binfo.id)

            log.debug("Ohmie {} pending SQUIDETHLPBond {} on tx {}", [ohmie.id, toDecimal(pending.value1, 9).toString(), transaction.id])
        }
    }

    //DAI
    if(transaction.blockNumber.gt(BigInt.fromString(WETHBOND_CONTRACT_BLOCK))){
        let bondWETH_contract = BondDepository.bind(Address.fromString(WETHBOND_CONTRACT))
        let pending = bondWETH_contract.bondInfo(Address.fromString(ohmie.id))
        if (pending.value1.gt(BigInt.fromString("0"))){
            let pending_bond = toDecimal(pending.value1, 9)
            balance.bondBalance = balance.bondBalance.plus(pending_bond)

            let binfo = loadOrCreateContractInfo(ohmie.id + transaction.timestamp.toString() + "WETHBondV1")
            binfo.name = "WETH"
            binfo.contract = WETHBOND_CONTRACT
            binfo.amount = pending_bond
            binfo.save()
            bonds.push(binfo.id)

            log.debug("Ohmie {} pending WETHBond {} on tx {}", [ohmie.id, toDecimal(pending.value1, 9).toString(), transaction.id])
        }
    }

    if(transaction.blockNumber.gt(BigInt.fromString(WETHBOND_CONTRACT2_BLOCK))){
        let bondWETH_contract = BondDepository.bind(Address.fromString(WETHBOND_CONTRACT))
        let pending = bondWETH_contract.bondInfo(Address.fromString(ohmie.id))
        if (pending.value1.gt(BigInt.fromString("0"))){
            let pending_bond = toDecimal(pending.value1, 9)
            balance.bondBalance = balance.bondBalance.plus(pending_bond)

            let binfo = loadOrCreateContractInfo(ohmie.id + transaction.timestamp.toString() + "WETHBondV2")
            binfo.name = "WETH"
            binfo.contract = WETHBOND_CONTRACT2
            binfo.amount = pending_bond
            binfo.save()
            bonds.push(binfo.id)

            log.debug("Ohmie {} pending WETHBondV2 {} on tx {}", [ohmie.id, toDecimal(pending.value1, 9).toString(), transaction.id])
        }
    }

    balance.bonds = bonds

    //Price
    let usdRate = getOHMUSDRate()
    balance.dollarBalance = balance.ohmBalance.times(usdRate).plus(balance.sohmBalance.times(usdRate)).plus(balance.bondBalance.times(usdRate))
    balance.save()

    ohmie.lastBalance = balance.id;
    ohmie.save()
}
