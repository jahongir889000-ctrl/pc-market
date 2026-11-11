import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { computeTotalFromItems, getStripe, toStripeAmount } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

// Creates a Stripe Checkout Session for an existing unpaid order and returns its URL.
export async function POST(request: Request) {
  try {
    const { orderId, lang } = await request.json();
    if (!orderId) return NextResponse.json({ error: 'orderId is required' }, { status: 400 });

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    if (order.paidAt) return NextResponse.json({ error: 'Order is already paid' }, { status: 409 });

    // Server-side price check: the amount always comes from the database
    const totalUzs = await computeTotalFromItems(JSON.parse(order.itemsJson));
    if (totalUzs <= 0) return NextResponse.json({ error: 'Empty order' }, { status: 400 });

    await prisma.order.update({
      where: { id: order.id },
      data: { totalUzs, paymentMethod: 'STRIPE' },
    });

    const { currency, unitAmount } = toStripeAmount(totalUzs);
    const origin = new URL(request.url).origin;

    const session = await getStripe().checkout.sessions.create({
      mode: 'payment',
      client_reference_id: order.id,
      metadata: { orderId: order.id, orderNumber: order.orderNumber },
      payment_intent_data: { metadata: { orderId: order.id, orderNumber: order.orderNumber } },
      locale: lang === 'uz' ? 'auto' : 'ru',
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency,
            unit_amount: unitAmount,
            product_data: {
              name: `JK-MARKET.UZ — заказ ${order.orderNumber}`,
              description: order.isCustomPc ? 'Кастомная сборка ПК' : 'Комплектующие ПК',
            },
          },
        },
      ],
      success_url: `${origin}/cart?stripe=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/cart?stripe=cancel&order=${encodeURIComponent(order.orderNumber)}`,
    });

    await prisma.order.update({ where: { id: order.id }, data: { stripeSessionId: session.id } });

    return NextResponse.json({ url: session.url });
  } catch (error: any) {
    console.error('Stripe checkout error:', error);
    return NextResponse.json({ error: error?.message || 'Failed to start payment' }, { status: 500 });
  }
}
