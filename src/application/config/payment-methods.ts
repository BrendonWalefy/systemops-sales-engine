import { z } from "zod";
import {
  PAYMENT_METHOD_CODES,
  PAYMENT_METHOD_OPTIONS,
  type PaymentMethod,
} from "@/domain/entities/payment-method";

export { PAYMENT_METHOD_OPTIONS };
export type { PaymentMethod };

const paymentMethodsSchema = z
  .array(z.string().trim().pipe(z.enum(PAYMENT_METHOD_CODES as [PaymentMethod, ...PaymentMethod[]])))
  .max(PAYMENT_METHOD_CODES.length)
  .superRefine((methods, context) => {
    if (new Set(methods).size !== methods.length) {
      context.addIssue({ code: "custom", message: "payment methods must be unique" });
    }
  });

export function parsePaymentMethods(value: unknown): PaymentMethod[] {
  return paymentMethodsSchema.parse(value);
}
