import { IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateAmcDto {
  @IsString()
  warrantyId: string;

  @IsString()
  amcStart: string;

  @IsString()
  amcEnd: string;

  @IsString()
  visitFrequency: string;

  @IsNumber()
  contractValue: number;

  @IsOptional()
  @IsString()
  remarks?: string;
}
