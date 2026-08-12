import {
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class PickInventoryDto {
  @IsUUID()
  dispatchOrderItemId: string;

  @IsNumber()
  @Min(0.000001)
  quantity: number;

  @IsString()
  pickedBy: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}
