import { IsString } from 'class-validator';

export class CreateConnectorMappingDto {
  @IsString()
  connectorId: string;

  @IsString()
  sourceField: string;

  @IsString()
  targetField: string;
}
