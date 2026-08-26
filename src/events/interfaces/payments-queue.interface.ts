export interface PaymentOrderMessage {
  orderId: string;
  userId: string;
  amount: number;
  discount: number;
  items: Array<{
    productId: string;
    quantity: number;
    price: number;
  }>;
  paymentMethod: string;
  description?: string;
  createdAt: Date;
}
