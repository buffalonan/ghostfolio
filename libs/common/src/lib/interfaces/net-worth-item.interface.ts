export type NetWorthGroup =
  | 'CASH'
  | 'CRYPTO'
  | 'INVESTMENTS'
  | 'LIABILITY'
  | 'PENSION';

export interface NetWorthItem {
  group: NetWorthGroup;
  name: string;

  /**
   * Units held, e.g. the number of bitcoins, if the value derives from a price
   */
  quantity?: number;

  /**
   * Current price of one unit in the base currency (only in the suggestion)
   */
  unitPrice?: number;

  /**
   * Value in the base currency, a liability is stored as a positive value
   */
  value: number;
}
