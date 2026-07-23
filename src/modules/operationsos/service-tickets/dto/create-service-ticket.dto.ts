import { IsOptional, IsString } from 'class-validator';

export class CreateServiceTicketDto {
  @IsString()
  warrantyId: string;

  @IsString()
  complaintTitle: string;

  @IsString()
  complaintDetail: string;

  @IsOptional()
  @IsString()
  priority?: string;

  @IsOptional()
  @IsString()
  assignedTo?: string;
}
