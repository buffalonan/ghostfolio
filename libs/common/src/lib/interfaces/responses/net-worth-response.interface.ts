import { NetWorthItem } from '../net-worth-item.interface';

export interface NetWorthSnapshotItem {
  contribution: number;
  date: string;
  id: string;
  items: NetWorthItem[];
  note?: string;
}

export interface NetWorthResponse {
  snapshots: NetWorthSnapshotItem[];

  /**
   * Items of the latest snapshot, updated with the current values of the
   * accounts with the same name
   */
  suggestion: NetWorthItem[];
}
