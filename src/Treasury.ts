import { Address, BigDecimal, log } from "@graphprotocol/graph-ts"
import { ReservesManaged } from "../generated/Treasury/Treasury"

import { Managed } from "../generated/schema"
import { loadOrCreateTransaction } from "./utils/Transactions"
import { updateProtocolMetrics } from "./utils/ProtocolMetrics"
import { toDecimal } from "./utils/Decimals"


export function handleReservesManaged(event: ReservesManaged): void {
  log.debug("managed {} {}", [event.params.token.toHexString(), event.params.amount.toString()])
  if (!event.params.token.equals(Address.fromString("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"))) {
    return
  }

  let managed = Managed.load("ETH")
  if (!managed) {
    managed = new Managed("ETH")
    managed.amount = BigDecimal.fromString("0")
  }

  managed.amount = managed.amount.plus(toDecimal(event.params.amount, 18))
  managed.save()

  let transaction = loadOrCreateTransaction(event.transaction, event.block)
  updateProtocolMetrics(transaction)
}
