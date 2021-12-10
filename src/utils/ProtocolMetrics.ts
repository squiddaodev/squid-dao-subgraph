import { Address, BigDecimal, BigInt, log} from '@graphprotocol/graph-ts'
import { OlympusERC20 } from '../../generated/OlympusStakingV2/OlympusERC20';
import { sOlympusERC20V2 } from '../../generated/OlympusStakingV2/sOlympusERC20V2';
import { ERC20 } from '../../generated/OlympusStakingV2/ERC20';
import { UniswapV2Pair } from '../../generated/OlympusStakingV2/UniswapV2Pair';
import { OlympusStakingV2 } from '../../generated/OlympusStakingV2/OlympusStakingV2';

import { ProtocolMetric, Transaction, Managed } from '../../generated/schema'
import {
  OHM_ERC20_CONTRACT,
  SOHM_ERC20_CONTRACTV2,
  STAKING_CONTRACT_V2,
  STAKING_CONTRACT_V2_BLOCK,
  ERC20WETH_CONTRACT,
  SUSHI_SQUIDETH_PAIR,
  TREASURY_ADDRESS_V2,
} from './Constants';
import { dayFromTimestamp } from './Dates';
import { toDecimal } from './Decimals';
import { getOHMUSDRate, getDiscountedPairUSD, getPairUSD } from './Price';
import { getHolderAux } from './Aux';
import { updateBondDiscounts } from './BondDiscounts';

export function loadOrCreateProtocolMetric(timestamp: BigInt): ProtocolMetric{
    let dayTimestamp = dayFromTimestamp(timestamp);

    let protocolMetric = ProtocolMetric.load(dayTimestamp)
    if (protocolMetric == null) {
        protocolMetric = new ProtocolMetric(dayTimestamp)
        protocolMetric.timestamp = timestamp
        protocolMetric.ohmCirculatingSupply = BigDecimal.fromString("0")
        protocolMetric.sOhmCirculatingSupply = BigDecimal.fromString("0")
        protocolMetric.totalSupply = BigDecimal.fromString("0")
        protocolMetric.ohmPrice = BigDecimal.fromString("0")
        protocolMetric.marketCap = BigDecimal.fromString("0")
        protocolMetric.totalValueLocked = BigDecimal.fromString("0")
        protocolMetric.managed = BigDecimal.fromString("0")
        protocolMetric.treasuryRiskFreeValue = BigDecimal.fromString("0")
        protocolMetric.treasuryMarketValue = BigDecimal.fromString("0")
        protocolMetric.nextEpochRebase = BigDecimal.fromString("0")
        protocolMetric.nextDistributedOhm = BigDecimal.fromString("0")
        protocolMetric.currentAPY = BigDecimal.fromString("0")
        protocolMetric.treasuryEthRiskFreeValue = BigDecimal.fromString("0")
        protocolMetric.treasuryEthMarketValue = BigDecimal.fromString("0")
        protocolMetric.treasurySquidEthPOL = BigDecimal.fromString("0")
        protocolMetric.holders = BigInt.fromI32(0)

        protocolMetric.save()
    }
    return protocolMetric as ProtocolMetric
}


function getTotalSupply(): BigDecimal{
    let ohm_contract = OlympusERC20.bind(Address.fromString(OHM_ERC20_CONTRACT))
    let total_supply = toDecimal(ohm_contract.totalSupply(), 9)
    log.debug("Total Supply {}", [total_supply.toString()])
    return total_supply
}

function getSohmSupply(): BigDecimal{
    let sohm_contract_v2 = sOlympusERC20V2.bind(Address.fromString(SOHM_ERC20_CONTRACTV2))
    let sohm_supply = toDecimal(sohm_contract_v2.circulatingSupply(), 9)
    log.debug("sOHM Supply {}", [sohm_supply.toString()])
    return sohm_supply
}

function getMV_RFV(transaction: Transaction): BigDecimal[]{
    let wethERC20 = ERC20.bind(Address.fromString(ERC20WETH_CONTRACT))

    let squidethPair = UniswapV2Pair.bind(Address.fromString(SUSHI_SQUIDETH_PAIR))

    let treasury_address = TREASURY_ADDRESS_V2;

    let wethBalance = wethERC20.balanceOf(Address.fromString(treasury_address))

    // SQUID-ETH
    let squidethSushiBalance = squidethPair.balanceOf(Address.fromString(treasury_address))
    let squidethBalance = squidethSushiBalance
    let squidethTotalLP = toDecimal(squidethPair.totalSupply(), 18)
    let squidethPOL = toDecimal(squidethBalance, 18).div(squidethTotalLP).times(BigDecimal.fromString("100"))
    let squideth_value = getPairUSD(squidethBalance, SUSHI_SQUIDETH_PAIR)
    let squideth_rfv = getDiscountedPairUSD(squidethBalance, SUSHI_SQUIDETH_PAIR)

    let stableValue = wethBalance
    let stableValueDecimal = toDecimal(stableValue, 18)

    let lpValue = squideth_value
    let rfvLpValue = squideth_rfv

    let mv = stableValueDecimal.plus(lpValue)
    let rfv = stableValueDecimal.plus(rfvLpValue)

    log.debug("Treasury Market Value {}", [mv.toString()])
    log.debug("Treasury RFV {}", [rfv.toString()])
    log.debug("Treasury WETH value {}", [toDecimal(wethBalance, 18).toString()])
    log.debug("Treasury SQUID-ETH RFV {}", [squideth_rfv.toString()])

    return [
        mv,
        rfv,
        // treasuryDaiRiskFreeValue = DAI RFV * DAI
        squideth_rfv.plus(toDecimal(wethBalance, 18)),
        // treasuryDaiMarketValue = DAI LP * DAI
        squideth_value.plus(toDecimal(wethBalance, 18)),
        // POL
        squidethPOL,
    ]
}

function getNextOHMRebase(transaction: Transaction): BigDecimal{
    let next_distribution = BigDecimal.fromString("0")

    if(transaction.blockNumber.gt(BigInt.fromString(STAKING_CONTRACT_V2_BLOCK))){
        let staking_contract_v2 = OlympusStakingV2.bind(Address.fromString(STAKING_CONTRACT_V2))
        let distribution_v2 = toDecimal(staking_contract_v2.epoch().value3,9)
        log.debug("next_distribution v2 {}", [distribution_v2.toString()])
        next_distribution = next_distribution.plus(distribution_v2)
    }

    log.debug("next_distribution total {}", [next_distribution.toString()])

    return next_distribution
}

function getAPY_Rebase(sOHM: BigDecimal, distributedOHM: BigDecimal): BigDecimal[]{
    let nextEpochRebase = distributedOHM.div(sOHM).times(BigDecimal.fromString("100"));

    let nextEpochRebase_number = Number.parseFloat(nextEpochRebase.toString())
    let currentAPY = Math.pow(((nextEpochRebase_number/100)+1), (365*3)-1)*100

    let currentAPYdecimal = BigDecimal.fromString(currentAPY.toString())

    log.debug("next_rebase {}", [nextEpochRebase.toString()])
    log.debug("current_apy total {}", [currentAPYdecimal.toString()])

    return [currentAPYdecimal, nextEpochRebase]
}

function getRunway(sOHM: BigDecimal, rfv: BigDecimal, rebase: BigDecimal): BigDecimal[]{
    let runway2dot5k = BigDecimal.fromString("0")
    let runway5k = BigDecimal.fromString("0")
    let runway7dot5k = BigDecimal.fromString("0")
    let runway10k = BigDecimal.fromString("0")
    let runway20k = BigDecimal.fromString("0")
    let runway50k = BigDecimal.fromString("0")
    let runway70k = BigDecimal.fromString("0")
    let runway100k = BigDecimal.fromString("0")
    let runwayCurrent = BigDecimal.fromString("0")

    if(sOHM.gt(BigDecimal.fromString("0")) && rfv.gt(BigDecimal.fromString("0")) &&  rebase.gt(BigDecimal.fromString("0"))){
        let treasury_runway = Number.parseFloat(rfv.div(sOHM).toString())

        let runway2dot5k_num = (Math.log(treasury_runway) / Math.log(1+0.0029438))/3;
        let runway5k_num = (Math.log(treasury_runway) / Math.log(1+0.003579))/3;
        let runway7dot5k_num = (Math.log(treasury_runway) / Math.log(1+0.0039507))/3;
        let runway10k_num = (Math.log(treasury_runway) / Math.log(1+0.00421449))/3;
        let runway20k_num = (Math.log(treasury_runway) / Math.log(1+0.00485037))/3;
        let runway50k_num = (Math.log(treasury_runway) / Math.log(1+0.00569158))/3;
        let runway70k_num = (Math.log(treasury_runway) / Math.log(1+0.00600065))/3;
        let runway100k_num = (Math.log(treasury_runway) / Math.log(1+0.00632839))/3;
        let nextEpochRebase_number = Number.parseFloat(rebase.toString())/100
        let runwayCurrent_num = (Math.log(treasury_runway) / Math.log(1+nextEpochRebase_number))/3;

        runway2dot5k = BigDecimal.fromString(runway2dot5k_num.toString())
        runway5k = BigDecimal.fromString(runway5k_num.toString())
        runway7dot5k = BigDecimal.fromString(runway7dot5k_num.toString())
        runway10k = BigDecimal.fromString(runway10k_num.toString())
        runway20k = BigDecimal.fromString(runway20k_num.toString())
        runway50k = BigDecimal.fromString(runway50k_num.toString())
        runway70k = BigDecimal.fromString(runway70k_num.toString())
        runway100k = BigDecimal.fromString(runway100k_num.toString())
        runwayCurrent = BigDecimal.fromString(runwayCurrent_num.toString())
    }

    return [runway2dot5k, runway5k, runway7dot5k, runway10k, runway20k, runway50k, runway70k, runway100k, runwayCurrent]
}


export function updateProtocolMetrics(transaction: Transaction): void{
    let pm = loadOrCreateProtocolMetric(transaction.timestamp);

    //Total Supply
    pm.totalSupply = getTotalSupply()

    //Circ Supply
    pm.ohmCirculatingSupply = pm.totalSupply

    //sOhm Supply
    pm.sOhmCirculatingSupply = getSohmSupply()

    //OHM Price
    pm.ohmPrice = getOHMUSDRate()

    //OHM Market Cap
    pm.marketCap = pm.ohmCirculatingSupply.times(pm.ohmPrice)

    //Total Value Locked
    pm.totalValueLocked = pm.sOhmCirculatingSupply.times(pm.ohmPrice)

    let managed = Managed.load("ETH")
    if (managed) {
      pm.managed = managed.amount
    }

    //Treasury RFV and MV
    let mv_rfv = getMV_RFV(transaction)
    pm.treasuryMarketValue = mv_rfv[0].plus(pm.managed)
    pm.treasuryRiskFreeValue = mv_rfv[1].plus(pm.managed)
    pm.treasuryEthRiskFreeValue = mv_rfv[2].plus(pm.managed)
    pm.treasuryEthMarketValue = mv_rfv[3].plus(pm.managed)
    pm.treasurySquidEthPOL = mv_rfv[4]


    // Rebase rewards, APY, rebase
    pm.nextDistributedOhm = getNextOHMRebase(transaction)
    let apy_rebase = getAPY_Rebase(pm.sOhmCirculatingSupply, pm.nextDistributedOhm)
    pm.currentAPY = apy_rebase[0]
    pm.nextEpochRebase = apy_rebase[1]

    //Runway
    let runways = getRunway(pm.sOhmCirculatingSupply, pm.treasuryRiskFreeValue, pm.nextEpochRebase)
    pm.runway2dot5k = runways[0]
    pm.runway5k = runways[1]
    pm.runway7dot5k = runways[2]
    pm.runway10k = runways[3]
    pm.runway20k = runways[4]
    pm.runway50k = runways[5]
    pm.runway70k = runways[6]
    pm.runway100k = runways[7]
    pm.runwayCurrent = runways[8]

    //Holders
    pm.holders = getHolderAux().value

    pm.save()

    updateBondDiscounts(transaction)
}
