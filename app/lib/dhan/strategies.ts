import { buildPlaybookCards } from "../strategies/registry";
import type { TradeProposal } from "../strategies/types";

export type CreditSpread = TradeProposal & {
  id: string;
  available: boolean;
  reason?: string;
};

export type CreditSpreadId = string;

export { buildPlaybookCards as buildCreditSpreads };
