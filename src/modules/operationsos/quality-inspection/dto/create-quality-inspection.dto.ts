import {
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateQualityInspectionDto {
  @IsString()
  goodsReceiptId: string;

  @IsString()
  status: string;

  @IsNumber()
  acceptedQty: number;

  @IsNumber()
  rejectedQty: number;

  @IsOptional()
  @IsString()
  remarks?: string;

  @IsOptional()
  @IsString()
  inspectorName?: string;
}
