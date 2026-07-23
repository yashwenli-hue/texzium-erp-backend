import { IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateEngineerVisitDto {
  @IsString()
  serviceTicketId: string;

  @IsString()
  visitDate: string;

  @IsString()
  engineerName: string;

  @IsString()
  workDone: string;

  @IsOptional()
  @IsString()
  partsUsed?: string;

  @IsNumber()
  timeSpentHours: number;

  @IsOptional()
  @IsNumber()
  travelExpense?: number;

  @IsOptional()
  @IsString()
  findings?: string;

  @IsOptional()
  @IsString()
  nextAction?: string;
}
