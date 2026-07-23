import { IsOptional, IsString } from 'class-validator';

export class CreateFollowupDto {
  @IsString()
  leadId: string;

  @IsString()
  followupDate: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}

