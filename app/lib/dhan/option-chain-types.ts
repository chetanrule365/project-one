export type OptionSide = {
  lastPrice: number;
  oi: number;
  volume: number;
  iv: number;
  bid: number;
  ask: number;
  delta: number;
  theta: number;
  gamma: number;
  vega: number;
};

export type OptionChainRow = {
  strike: number;
  ce: OptionSide | null;
  pe: OptionSide | null;
};

export type OptionChainData = {
  spot: number;
  expiry: string;
  expiries: string[];
  rows: OptionChainRow[];
};
