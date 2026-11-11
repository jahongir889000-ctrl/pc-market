import Stripe from 'stripe';
import { prisma } from './prisma';
import { sendReceiptToTelegram } from './telegram';

// Lazily created so `next build` works without the secret key present.
let _stripe: Stripe | null = null;
export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured');
  if (!_stripe) _stripe = new Stripe(key);
  return _stripe;
}

/**
 * Charge currency. Default UZS (a two-decimal currency in Stripe: amount is in tiyin, sum × 100).
 * Set STRIPE_CURRENCY=usd and STRIPE_UZS_PER_USD=<rate> to charge in dollars instead.
 */
export function toStripeAmount(totalUzs: number): { currency: string; unitAmount: number } {
  const currency = (process.env.STRIPE_CURRENCY || 'uzs').toLowerCase();
  if (currency === 'uzs') return { currency, unitAmount: Math.round(totalUzs) * 100 };
  const rate = Number(process.env.STRIPE_UZS_PER_USD || 0);
  if (!rate) throw new Error(`STRIPE_UZS_PER_USD is required when STRIPE_CURRENCY=${currency}`);
  return { currency, unitAmount: Math.round((totalUzs / rate) * 100) };
}

interface CartItemLike {
  productId?: string;
  quantity?: number;
  isCustomPc?: boolean;
  buildSpecs?: Record<string, { id?: string } | null>;
}

/**
 * Recalculate an order total from current DB prices. Never trust the total sent by the browser.
 */
export async function computeTotalFromItems(items: CartItemLike[]): Promise<number> {
  const qtyById = new Map<string, number>();
  for (const item of items) {
    const qty = Math.max(1, Math.floor(Number(item.quantity) || 1));
    const ids = item.isCustomPc
      ? Object.values(item.buildSpecs || {}).map((p) => p?.id).filter(Boolean) as string[]
      : item.productId ? [item.productId] : [];
    if (ids.length === 0) throw new Error('Cart item without product');
    for (const id of ids) qtyById.set(id, (qtyById.get(id) || 0) + qty);
  }

  const products = await prisma.product.findMany({
    where: { id: { in: [...qtyById.keys()] } },
    select: { id: true, priceUzs: true },
  });
  if (products.length !== qtyById.size) throw new Error('Some products in the cart no longer exist');

  return products.reduce((sum, p) => sum + p.priceUzs * (qtyById.get(p.id) || 0), 0);
}

/**
 * Mark an order paid from a completed Checkout Session. Idempotent: only the first call
 * flips the status and sends the Telegram receipt (webhook and success page may both call it).
 */
export async function markOrderPaidFromSession(session: Stripe.Checkout.Session): Promise<boolean> {
  const orderId = session.metadata?.orderId || session.client_reference_id;
  if (!orderId || session.payment_status !== 'paid') return false;

  const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? null;

  const { count } = await prisma.order.updateMany({
    where: { id: orderId, paidAt: null },
    data: {
      status: 'PAID',
      paymentMethod: 'STRIPE',
      paidAt: new Date(),
      stripeSessionId: session.id,
      stripePaymentIntentId: paymentIntentId,
    },
  });

  if (count === 1) {
    try {
      await sendReceiptToTelegram(orderId);
    } catch (error) {
      console.error('Telegram receipt after Stripe payment failed:', error);
    }
  }
  return count === 1;
}
