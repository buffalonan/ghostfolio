import type { NetWorthGroup } from '@ghostfolio/common/interfaces';

import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsInt,
  IsArray,
  IsIn,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested
} from 'class-validator';

export class NetWorthItemDto {
  @IsIn(['CASH', 'CRYPTO', 'INVESTMENTS', 'LIABILITY', 'PENSION'])
  group: NetWorthGroup;

  @IsString()
  @MaxLength(100)
  name: string;

  @IsNumber()
  @IsOptional()
  quantity?: number;

  @IsNumber()
  value: number;
}

export class CreateNetWorthSnapshotDto {
  @IsNumber()
  @IsOptional()
  contribution?: number;

  @IsISO8601()
  date: string;

  @ArrayMaxSize(50)
  @IsArray()
  @Type(() => NetWorthItemDto)
  @ValidateNested({ each: true })
  items: NetWorthItemDto[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class UpdateNetWorthTaxDto {
  @IsNumber()
  amount: number;

  @IsInt()
  year: number;
}

export class ImportNetWorthSnapshotsDto {
  @ArrayMaxSize(1000)
  @IsArray()
  @Type(() => CreateNetWorthSnapshotDto)
  @ValidateNested({ each: true })
  snapshots: CreateNetWorthSnapshotDto[];
}
