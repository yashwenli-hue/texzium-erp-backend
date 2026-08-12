import {
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class PackInventoryDto {
  @IsUUID()
  dispatchOrderItemId: string;

  @IsNumber()
  @Min(0.000001)
  quantity: number;

  @IsString()
  packedBy: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}
