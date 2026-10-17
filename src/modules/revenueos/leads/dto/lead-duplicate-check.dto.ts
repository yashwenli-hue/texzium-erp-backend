import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

const optionalText = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const t = value.trim();
  return t === '' ? undefined : t;
};

// GET /leads/duplicate-check?phone=&alternatePhone=&email=&customerName=&companyName=&city=&gstin=&inventoryItemId=
// Asked while a lead is being typed in, so every field is optional and a partial value
// simply matches nothing. Nothing is written.
export class LeadDuplicateCheckQueryDto {
  @IsOptional()
  @Transform(optionalText)
  @IsString()
  @MaxLength(30)
  phone?: string;
  @IsOptional()
  @Transform(optionalText)
  @IsString()
  @MaxLength(30)
  alternatePhone?: string;
  @IsOptional()
  @Transform(optionalText)
  @IsString()
  @MaxLength(200)
  email?: string;
  @IsOptional()
  @Transform(optionalText)
  @IsString()
  @MaxLength(200)
  customerName?: string;
  @IsOptional()
  @Transform(optionalText)
  @IsString()
  @MaxLength(200)
  companyName?: string;
  @IsOptional()
  @Transform(optionalText)
  @IsString()
  @MaxLength(100)
  city?: string;

  // A customer GSTIN the enquiry gave; spaces, dots, slashes and hyphens are ignored and
  // letters upper-cased. Only a complete GSTIN is compared.
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value.replace(/[\s./-]+/g, '').toUpperCase() || undefined
      : value,
  )
  @IsString()
  @MaxLength(20)
  gstin?: string;

  // The product or machine the enquiry is about, to tell a repeat enquiry about another
  // product from a duplicate of the same one.
  @IsOptional()
  @IsUUID()
  inventoryItemId?: string;
}
