import {
  buildPlaybookCards,
  buildPlaybookSnapshot,
  type PlaybookSnapshot,
} from "../strategies/registry";
import type { TradeProposal } from "../strategies/types";

export type CreditSpread = TradeProposal & {
  id: string;
  available: boolean;
  reason?: string;
};

export type CreditSpreadId = string;

export type { PlaybookSnapshot };
export { buildPlaybookCards as buildCreditSpreads, buildPlaybookSnapshot };
