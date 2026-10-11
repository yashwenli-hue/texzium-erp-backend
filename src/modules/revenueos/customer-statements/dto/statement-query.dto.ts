import { IsISO8601, IsOptional, Matches } from 'class-validator';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

// Optional statement period, as calendar days (inclusive). Without either, the
// statement covers all time. Unknown query parameters are refused by the
// ValidationPipe.
export class StatementQueryDto {
  @IsOptional()
  @Matches(DAY, { message: 'from must be a date written as YYYY-MM-DD' })
  @IsISO8601({ strict: true }, { message: 'from must be a real calendar date' })
  from?: string;

  @IsOptional()
  @Matches(DAY, { message: 'to must be a date written as YYYY-MM-DD' })
  @IsISO8601({ strict: true }, { message: 'to must be a real calendar date' })
  to?: string;
}
