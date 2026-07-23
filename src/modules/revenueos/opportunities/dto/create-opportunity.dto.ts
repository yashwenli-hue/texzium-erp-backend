import { IsNumber, IsString } from 'class-validator';

export class CreateOpportunityDto {
  @IsString()
  leadId: string;

  @IsString()
  title: string;

  @IsNumber()
  expectedValue: number;

  @IsNumber()
  probability: number;

  @IsString()
  expectedCloseDate: string;
}
