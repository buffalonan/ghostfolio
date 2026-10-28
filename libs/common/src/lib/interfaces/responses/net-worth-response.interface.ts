import { NetWorthItem } from '../net-worth-item.interface';

export interface NetWorthSnapshotItem {
  contribution: number;
  date: string;
  id: string;
  items: NetWorthItem[];
  note?: string;
}

export interface NetWorthTaxItem {
  amount: number;
  year: number;
}

export interface NetWorthResponse {
  snapshots: NetWorthSnapshotItem[];

  /**
   * Items of the latest snapshot, updated with the current values of the
   * accounts with the same name
   */
  suggestion: NetWorthItem[];

  /**
   * Tax to be paid per year, which is accrued monthly
   */
  taxes: NetWorthTaxItem[];
}
