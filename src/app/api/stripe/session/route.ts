import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getStripe, markOrderPaidFromSession } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

// Called by the cart page after Stripe redirects back. Confirms the payment with Stripe
// (in case the webhook is late) and returns the order for the success screen.
export async function GET(request: Request) {
  const sessionId = new URL(request.url).searchParams.get('session_id');
  if (!sessionId || !sessionId.startsWith('cs_')) {
    return NextResponse.json({ error: 'session_id is required' }, { status: 400 });
  }

  try {
    const session = await getStripe().checkout.sessions.retrieve(sessionId);
    await markOrderPaidFromSession(session);

    const orderId = session.metadata?.orderId || session.client_reference_id;
    const order = orderId
      ? await prisma.order.findUnique({
          where: { id: orderId },
          select: {
            id: true, orderNumber: true, customerName: true, customerPhone: true, customerTelegram: true,
            totalUzs: true, status: true, paymentMethod: true, paidAt: true,
            paymentReceiptUrl: true, paymentReceiptName: true,
          },
        })
      : null;

    return NextResponse.json({ paymentStatus: session.payment_status, sessionStatus: session.status, order });
  } catch (error: any) {
    console.error('Stripe session lookup error:', error);
    return NextResponse.json({ error: 'Failed to verify payment' }, { status: 500 });
  }
}
