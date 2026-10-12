import {
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

// POST /sales-invoices
//
// Every amount, the GST split, the number and the customer come from the Sales
// Order and the Quotation it was built from; the request names the order, the
// dispatch and the invoice date. `customerName` is optional and, when sent,
// must be the order's customer (older screens send it).
export class CreateSalesInvoiceDto {
  @IsString()
  salesOrderId: string;

  @IsString()
  dispatchOrderId: string;

  // A calendar day, "YYYY-MM-DD".
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'invoiceDate must be a date written YYYY-MM-DD',
  })
  @IsISO8601({ strict: true })
  invoiceDate: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  customerName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  remarks?: string;
}
