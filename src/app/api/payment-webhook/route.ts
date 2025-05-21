
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/firebase'; // Using the simulated DB

// Define the expected payload structure from the payment gateway
// This is a generic example; you'll need to adjust it based on your payment provider's webhook format.
const WebhookPayloadSchema = z.object({
  event: z.string().min(1, "Event type is required"), // e.g., "payment.succeeded", "payment.failed"
  data: z.object({
    ticketId: z.string().min(1, "Ticket ID is required"),
    status: z.string().min(1, "New status is required"), // e.g., "confirmed", "failed", "refunded"
    transactionId: z.string().optional(), // Optional: Gateway's transaction ID
    paymentGatewayReference: z.string().optional(), // Optional: Gateway's internal reference
    amount: z.number().optional(),
    currency: z.string().optional(),
    timestamp: z.string().datetime().optional().default(() => new Date().toISOString()),
    metadata: z.record(z.any()).optional(), // For any other data from the gateway
  }),
});

export async function POST(request: NextRequest) {
  try {
    // 1. IMPORTANT: Verify the webhook signature (essential for security)
    // This step is crucial to ensure the request is genuinely from your payment provider.
    // The implementation details depend on the payment provider (e.g., checking a
    // 'Stripe-Signature' header or an HMAC signature in the payload).
    // For now, this is a placeholder:
    // const signature = request.headers.get('your-payment-provider-signature-header');
    // const isValidSignature = await verifySignature(await request.text(), signature); // request.text() consumes the body, so clone or re-parse if needed after
    // if (!isValidSignature) {
    //   console.warn('Invalid webhook signature');
    //   return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    // }
    // Since request.text() consumes the body, if you need to verify signature on raw body,
    // you might need to get raw body first then parse json, or clone the request.
    // For simplicity here, we'll parse JSON directly. If signature verification needs raw body,
    // handle that first.

    const payload = await request.json();
    const validation = WebhookPayloadSchema.safeParse(payload);

    if (!validation.success) {
      console.error("Webhook validation error:", validation.error.format());
      return NextResponse.json({ error: 'Invalid payload', details: validation.error.format() }, { status: 400 });
    }

    const { event, data } = validation.data;
    const { ticketId, status, transactionId, paymentGatewayReference, amount, currency, timestamp, metadata } = data;

    console.log(`Webhook received: Event: ${event}, TicketID: ${ticketId}, Status: ${status}`);

    // 2. Process the event and update your database
    // Example: Update ticket status in Firestore (simulated)
    const ticketRef = db.collection('tickets').doc(ticketId);
    await ticketRef.updateDoc({
      status: status,
      lastWebhookEvent: event,
      webhookReceivedAt: new Date().toISOString(),
      ...(paymentGatewayReference && { paymentGatewayReference: paymentGatewayReference }),
      ...(transactionId && { lastKnownTransactionId: transactionId }),
    });

    // Optionally, you might want to create or update a transaction record here as well,
    // especially if this webhook is the primary source of truth for certain transaction details.
    // For example:
    if (event === 'payment.succeeded' || event === 'payment.failed' || event === 'charge.refunded') {
      // This is a simplified transaction log entry from webhook data.
      // You might want to correlate this with transactions created by `handlePaymentConfirmation`
      // or make this the authoritative source for externally-initiated changes.
      await db.collection('transactions').addDoc({
        ticketId,
        amount: amount ?? null,
        currency: currency ?? null,
        status, // The status from the webhook
        transactionId: transactionId ?? `wh_${Date.now()}`,
        paymentGatewayReference: paymentGatewayReference ?? null,
        eventType: event,
        source: 'webhook',
        createdAt: timestamp, // Use timestamp from webhook if available
        metadata: metadata ?? null,
      });
      console.log(`Transaction log updated for ticket ${ticketId} via webhook.`);
    }


    // 3. Respond to the webhook provider
    // Most providers expect a 2xx response to acknowledge receipt.
    return NextResponse.json({ message: 'Webhook received and processed successfully' }, { status: 200 });

  } catch (error) {
    console.error('Error processing webhook:', error);
    let errorMessage = 'Internal Server Error';
    if (error instanceof Error) {
        errorMessage = error.message;
    } else if (typeof error === 'string') {
        errorMessage = error;
    }
    // Avoid sending detailed error messages back in production for security reasons,
    // unless the payment provider requires specific error formats.
    return NextResponse.json({ error: 'Failed to process webhook', details: errorMessage }, { status: 500 });
  }
}

// Placeholder for signature verification logic (replace with actual implementation)
// async function verifySignature(rawBody: string, signature: string | null): Promise<boolean> {
//   if (!signature) return false;
//   // const secret = process.env.PAYMENT_GATEWAY_WEBHOOK_SECRET;
//   // Implement signature verification logic here (e.g., using crypto library for HMAC)
//   // Example:
//   // const expectedSignature = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
//   // return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
//   console.log("Simulating signature verification for:", rawBody.substring(0,100) + "...", "with signature:", signature)
//   return true; // In a real app, this would be proper verification
// }

export async function GET(request: NextRequest) {
  // Some payment providers might do a GET request to verify the endpoint.
  // You can respond with a simple message or a challenge if required by the provider.
  return NextResponse.json({ message: 'Webhook endpoint is active. Use POST to send events.' }, { status: 200 });
}
