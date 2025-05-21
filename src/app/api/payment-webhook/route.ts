
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/firebase';
import { doc, updateDoc, addDoc, collection, serverTimestamp, getDoc } from 'firebase/firestore';
import { sendPaymentConfirmationEmail } from '@/lib/emailService';

// Schema for Umeskia's STK Push callback object, based on provided "Success dump" / "Error dump"
const UmeskiaStkCallbackSchema = z.object({
  ResponseCode: z.union([z.number(), z.string().regex(/^\d+$/).transform(Number)]),
  ResponseDescription: z.string(),
  MerchantRequestID: z.string(),
  CheckoutRequestID: z.string(),
  TransactionID: z.string().optional(), // This is the umeskiaTransactionRequestId from initiation
  TransactionAmount: z.union([z.number(), z.string().regex(/^[\d.]+$/).transform(Number)]).optional(),
  TransactionReceipt: z.string().optional(),
  TransactionDate: z.string().optional(), // e.g., "20210421114425"
  TransactionReference: z.string().optional(), // This should be our ticketId used as reference
  Msisdn: z.string().optional(), // Phone number that made the payment
  // any other fields that might appear in the callback
}).passthrough(); // Allow other fields not strictly defined

// Schema for the overall M-Pesa webhook payload from Umeskia
const UmeskiaWebhookPayloadSchema = z.object({
  Body: z.object({
    stkCallback: UmeskiaStkCallbackSchema,
  }),
}).passthrough();


export async function POST(request: NextRequest) {
  try {
    // IMPORTANT: Implement webhook security (e.g., signature verification from Umeskia or IP whitelisting)
    // console.log("Received Umeskia M-Pesa webhook from IP:", request.ip);
    // const rawBody = await request.text(); // For signature verification if needed
    // const payload = JSON.parse(rawBody);

    const payload = await request.json();
    console.log("Umeskia Webhook Payload Received:", JSON.stringify(payload, null, 2));

    const validation = UmeskiaWebhookPayloadSchema.safeParse(payload);

    if (!validation.success) {
      console.error("Umeskia M-Pesa Webhook validation error:", validation.error.format());
      return NextResponse.json({ error: 'Invalid Umeskia M-Pesa payload', details: validation.error.format() }, { status: 400 });
    }

    const { Body: { stkCallback } } = validation.data;
    const {
      ResponseCode,
      ResponseDescription,
      MerchantRequestID,
      CheckoutRequestID,
      TransactionID, // This is the umeskiaTransactionRequestId
      TransactionAmount,
      TransactionReceipt,
      TransactionDate,
      TransactionReference, // This should be our ticketId
      Msisdn,
    } = stkCallback;

    const ticketId = TransactionReference;

    if (!ticketId) {
      console.error('Umeskia M-Pesa Webhook: Ticket ID (TransactionReference) not found in stkCallback for MerchantRequestID:', MerchantRequestID);
      // Acknowledge to prevent retries, but log critical error.
      return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted", message: "Webhook processed, but Ticket ID (TransactionReference) missing." }, { status: 200 });
    }

    console.log(`Umeskia M-Pesa Webhook: MerchantRequestID: ${MerchantRequestID}, CheckoutRequestID: ${CheckoutRequestID}, ResponseCode: ${ResponseCode}, TicketID: ${ticketId}`);

    const paymentStatus = ResponseCode === 0 ? 'confirmed' : 'failed';
    
    let parsedTransactionDate: any = serverTimestamp();
    if (TransactionDate) { // Format "YYYYMMDDHHMMSS"
        try {
            const year = parseInt(TransactionDate.substring(0, 4));
            const month = parseInt(TransactionDate.substring(4, 6)) - 1; // JS months are 0-indexed
            const day = parseInt(TransactionDate.substring(6, 8));
            const hour = parseInt(TransactionDate.substring(8, 10));
            const minute = parseInt(TransactionDate.substring(10, 12));
            const second = parseInt(TransactionDate.substring(12, 14));
            parsedTransactionDate = new Date(Date.UTC(year, month, day, hour, minute, second));
        } catch (e) {
            console.warn("Could not parse Umeskia M-Pesa transaction date:", TransactionDate, e);
            parsedTransactionDate = serverTimestamp(); // Fallback
        }
    }

    const ticketRef = doc(db, 'tickets', ticketId);
    const ticketSnap = await getDoc(ticketRef);
    let userEmail: string | null = null;
    let originalAmountExpected: string | null = null; // Amount expected from the ticket

    if (!ticketSnap.exists()) {
      console.error(`Umeskia M-Pesa Webhook: Ticket ${ticketId} not found in database.`);
      return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted", message: "Webhook processed, ticket not found internally." }, { status: 200 });
    } else {
      userEmail = ticketSnap.data()?.email || null;
      originalAmountExpected = ticketSnap.data()?.amount?.toString() || null;
    }

    // Update ticket status in Firestore
    const ticketUpdateData: any = {
      status: paymentStatus,
      mpesaResultCode: ResponseCode,
      mpesaResultDesc: ResponseDescription,
      merchantRequestId: MerchantRequestID, // Store the actual MerchantRequestID from callback
      checkoutRequestId: CheckoutRequestID, // Store/update CheckoutRequestID from callback
      umeskiaTransactionId: TransactionID, // The ID from initiation, confirming it
      mpesaReceiptNumber: TransactionReceipt || null,
      mpesaAmountPaid: TransactionAmount || null,
      mpesaPhoneNumber: Msisdn || null,
      mpesaTransactionTimestamp: parsedTransactionDate instanceof Date ? parsedTransactionDate : null,
      lastWebhookEventAt: serverTimestamp(),
      lastWebhookEvent: `umeskia_stk_callback_${ResponseCode}`,
      webhookPayload: stkCallback, // Store the full callback for auditing
    };
    await updateDoc(ticketRef, ticketUpdateData);
    console.log(`Ticket ${ticketId} status updated to ${paymentStatus}.`);

    // Log the M-Pesa callback event as a transaction entry
    const transactionLogData = {
      ticketId,
      type: 'umeskia_mpesa_callback',
      merchantRequestId: MerchantRequestID,
      checkoutRequestId: CheckoutRequestID,
      umeskiaTransactionId: TransactionID,
      resultCode: ResponseCode,
      resultDesc: ResponseDescription,
      status: paymentStatus,
      amount: TransactionAmount,
      mpesaReceiptNumber: TransactionReceipt || null,
      mpesaPhoneNumber: Msisdn || null,
      transactionDate: parsedTransactionDate instanceof Date ? parsedTransactionDate : serverTimestamp(),
      reference: TransactionReference,
      source: 'umeskia_mpesa_webhook',
      createdAt: serverTimestamp(),
      rawCallbackPayload: stkCallback, // Store raw callback for auditing
    };
    await addDoc(collection(db, 'transactions'), transactionLogData);
    console.log(`Umeskia M-Pesa callback transaction log created for Ticket ID: ${ticketId}`);

    if (paymentStatus === 'confirmed' && userEmail && TransactionReceipt) {
      const emailAmount = originalAmountExpected || (TransactionAmount ? TransactionAmount.toFixed(2) : 'N/A');
      await sendPaymentConfirmationEmail(userEmail, ticketId, emailAmount, TransactionReceipt);
    }

    // Acknowledge receipt to Umeskia/M-Pesa
    return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" }, { status: 200 });

  } catch (error) {
    console.error('Error processing Umeskia M-Pesa webhook:', error);
    let errorMessage = 'Internal Server Error';
    if (error instanceof Error) {
        errorMessage = error.message;
    } else if (typeof error === 'string') {
        errorMessage = error;
    }
    // Do not return a non-200 to M-Pesa if possible, to avoid retries for internal errors.
    // Log it, but tell M-Pesa it's okay (or handle specific M-Pesa error codes if they expect non-0 for certain issues).
    // For now, if we reach here due to an internal processing error, we'll acknowledge M-Pesa.
    // Consider how Umeskia expects errors to be reported. Generally, a 200 OK with a specific body is preferred for callbacks.
    return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted with internal processing error", error: errorMessage }, { status: 200 });
  }
}

export async function GET(request: NextRequest) {
  return NextResponse.json({ message: 'Umeskia M-Pesa Webhook endpoint is active. Use POST for STK callbacks.' }, { status: 200 });
}
