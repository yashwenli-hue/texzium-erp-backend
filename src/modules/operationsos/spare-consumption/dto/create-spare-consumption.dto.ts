import { IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateSpareConsumptionDto {
  @IsString()
  engineerVisitId: string;

  @IsString()
  inventoryItemId: string;

  @IsNumber()
  quantityUsed: number;

  @IsNumber()
  unitCost: number;

  @IsOptional()
  @IsString()
  remarks?: string;
}
