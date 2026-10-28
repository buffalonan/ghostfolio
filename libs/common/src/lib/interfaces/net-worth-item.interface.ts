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
   * Value in the base currency, a liability is stored as a positive value
   */
  value: number;
}
