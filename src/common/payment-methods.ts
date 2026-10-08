/** The payment methods the payments service knows how to charge. */
export const PAYMENT_METHODS = [
  'credit_card',
  'debit_card',
  'pix',
  'boleto',
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
