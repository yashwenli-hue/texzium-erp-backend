export class CreateCustomerDto {
  customerCode: string;
  customerName: string;
  panNumber?: string;
  email?: string;
  phone?: string;
  customerType?: string;
}
