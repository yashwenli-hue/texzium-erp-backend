import { IsOptional, IsString } from 'class-validator';

export class CreateRmaDto {
  @IsString()
  warrantyId: string;

  @IsOptional()
  @IsString()
  serviceTicketId?: string;

  @IsString()
  reason: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}
