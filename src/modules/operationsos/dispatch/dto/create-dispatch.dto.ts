import { IsOptional, IsString } from 'class-validator';

export class CreateDispatchDto {
  @IsString()
  salesOrderId: string;

  @IsString()
  dispatchDate: string;

  @IsOptional()
  @IsString()
  vehicleNumber?: string;

  @IsOptional()
  @IsString()
  driverName?: string;

  @IsOptional()
  @IsString()
  trackingNumber?: string;
}
