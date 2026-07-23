import { IsOptional, IsString } from 'class-validator';

export class CreateDeliveryDto {
  @IsString()
  dispatchId: string;

  @IsString()
  deliveryDate: string;

  @IsOptional()
  @IsString()
  receivedBy?: string;

  @IsOptional()
  @IsString()
  proofOfDelivery?: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}
