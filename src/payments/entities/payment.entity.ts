import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { decimalToNumberTransformer } from '../../common/transformers/decimal-to-number.transformer';
import { PaymentStatus } from '../enums/payment-status.enum';

@Entity('payments')
// One payment per order: a redelivered message never charges twice.
@Index('UQ_payments_order', ['orderId'], { unique: true })
@Index('IDX_payments_user', ['userId'])
@Check('CHK_payments_amount_positive', `"amount" > 0 AND "amount" <> 'NaN'`)
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** The checkout order it pays; no foreign key, orders live in another database. */
  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    transformer: decimalToNumberTransformer,
  })
  amount: number;

  @Column({
    type: 'enum',
    enum: PaymentStatus,
    enumName: 'payment_status',
    default: PaymentStatus.PENDING,
  })
  status: PaymentStatus;

  @Column({ name: 'payment_method', type: 'varchar', length: 50 })
  paymentMethod: string;

  @Column({
    name: 'transaction_id',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  transactionId: string | null;

  @Column({
    name: 'rejection_reason',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  rejectionReason: string | null;

  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
