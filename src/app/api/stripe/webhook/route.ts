import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { getStripe, markOrderPaidFromSession } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

// Stripe webhook: verifies the signature on the raw body, then marks the order paid.
export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = request.headers.get('stripe-signature');
  if (!secret) return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
  if (!signature) return NextResponse.json({ error: 'Missing stripe-signature' }, { status: 400 });

  let event: Stripe.Event;
  try {
    const rawBody = await request.text();
    event = getStripe().webhooks.constructEvent(rawBody, signature, secret);
  } catch (error: any) {
    console.error('Stripe webhook signature check failed:', error?.message);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
        await markOrderPaidFromSession(event.data.object as Stripe.Checkout.Session);
        break;
      default:
        break;
    }
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Stripe webhook handler error:', error);
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 });
  }
}
