export enum PaymentStatus {
  PENDING = 'PENDING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
}
export enum Currency {
  VND = 'VND',
}
export class CreatePaymentOrderDto {
  userid: string;
  soluot: number;
  tongtien: number;
  loaitien: Currency;
  createdAt: FirebaseFirestore.FieldValue;
  status: PaymentStatus;
}

export class PaymentOrder {
  userid?: string;
  soluot?: number;
  tongtien?: number;
  loaitien?: Currency;
  status?: PaymentStatus;
  responseCode?: string;
  transactionNo?: string;
  createdAt?: FirebaseFirestore.FieldValue;
  updatedAt?: FirebaseFirestore.FieldValue;
  payDate?: FirebaseFirestore.FieldValue;
}
