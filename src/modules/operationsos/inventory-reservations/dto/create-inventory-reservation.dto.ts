import { IsNumber, IsString } from 'class-validator';
import { IsOptional } from 'class-validator';


export class CreateInventoryReservationDto {
  @IsString()
  inventoryItemId: string;

  @IsString()
  salesOrderId: string;

  @IsNumber()
  quantity: number;

  @IsOptional()
  @IsString()
  reservedById?: string;

  @IsOptional()
  @IsString()
  reservationType?: string;

  @IsOptional() 
  @IsString()
  expiryDate?: string;

  @IsOptional()
  @IsString()
  priorityLevel?: string;

  @IsOptional() 
  @IsString()
  remarks?: string;

}

