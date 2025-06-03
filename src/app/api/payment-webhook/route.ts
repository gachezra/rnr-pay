
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/firebase';
import { doc, updateDoc, addDoc, collection, serverTimestamp, getDoc } from 'firebase/firestore';
// Email sending is now handled by Firestore onSnapshot listener in PaymentDisplay calling a server action

const StkCallbackSchema = z.object({
  ResponseCode: z.union([z.number(), z.string().regex(/^\d+$/).transform(Number)]),
  ResponseDescription: z.string(),
  MerchantRequestID: z.string().optional(), // Umeskia success dump has it, error dump might not
  CheckoutRequestID: z.string().optional(), // Umeskia success dump has it, error dump might not
  TransactionID: z.string().optional(), // This is the umeskiaTransactionRequestId from initiation / their TransactionID
  TransactionAmount: z.union([z.number(), z.string().regex(/^[\d.]+$/).transform(Number)]).optional(),
  TransactionReceipt: z.string().optional(),
  TransactionDate: z.string().optional(), // e.g., "20210421114425"
  TransactionReference: z.string().optional(), // This should be our ticketId used as reference
  Msisdn: z.string().optional(), // Phone number that made the payment
}).passthrough(); // Use passthrough for any extra fields Umeskia might send

const UmeskiaWebhookPayloadSchema = z.object({
  Body: z.object({
    stkCallback: StkCallbackSchema,
  }),
}).passthrough();


export async function POST(request: NextRequest) {
  try {
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
      MerchantRequestID, // Umeskia may or may not send this, handle if present
      CheckoutRequestID, // Umeskia may or may not send this, handle if present
      TransactionID: umeskiaTransactionIdFromCallback, 
      TransactionAmount,
      TransactionReceipt,
      TransactionDate,
      TransactionReference, 
      Msisdn: mpesaPhoneNumber,
    } = stkCallback;

    const ticketDocId = TransactionReference; 

    if (!ticketDocId) {
      console.error('Umeskia M-Pesa Webhook: Ticket ID (TransactionReference) not found in stkCallback.');
      return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted", message: "Webhook processed, but Ticket ID (TransactionReference) missing." }, { status: 200 });
    }

    const ticketRef = doc(db, 'tickets', ticketDocId);
    const ticketSnap = await getDoc(ticketRef);
    
    if (!ticketSnap.exists()) {
      console.error(`Umeskia M-Pesa Webhook: Ticket ${ticketDocId} not found in database.`);
      return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted", message: "Webhook processed, ticket not found internally." }, { status: 200 });
    }
    
    const currentTicketData = ticketSnap.data();
    if (currentTicketData?.status === 'confirmed') {
        console.log(`Ticket ${ticketDocId} already confirmed. Webhook processing skipped for status update.`);
        // Log the callback anyway for audit purposes
        await addDoc(collection(db, 'transactions'), {
            ticketId: ticketDocId,
            type: 'umeskia_mpesa_callback_ignored_already_confirmed',
            rawCallbackPayload: stkCallback,
            receivedAt: serverTimestamp(),
        });
        return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted, ticket already confirmed." }, { status: 200 });
    }
    
    const paymentStatus = ResponseCode === 0 ? 'confirmed' : 'failed'; // 'confirmed' will trigger onSnapshot
    
    let parsedTransactionDate: any = serverTimestamp();
    if (TransactionDate) { 
        try {
            const year = parseInt(TransactionDate.substring(0, 4));
            const month = parseInt(TransactionDate.substring(4, 6)) - 1; 
            const day = parseInt(TransactionDate.substring(6, 8));
            const hour = parseInt(TransactionDate.substring(8, 10));
            const minute = parseInt(TransactionDate.substring(10, 12));
            const second = parseInt(TransactionDate.substring(12, 14));
            parsedTransactionDate = new Date(Date.UTC(year, month, day, hour, minute, second));
        } catch (e) {
            console.warn("Could not parse Umeskia M-Pesa transaction date:", TransactionDate, e);
        }
    }

    const ticketUpdateData: any = {
      status: paymentStatus,
      mpesaResultCode: ResponseCode,
      mpesaResultDesc: ResponseDescription,
      umeskiaTransactionId: umeskiaTransactionIdFromCallback || currentTicketData?.umeskiaTransactionRequestId, // Prefer callback, fallback to stored one
      mpesaReceiptNumber: TransactionReceipt || null,
      mpesaAmountPaid: TransactionAmount || null,
      mpesaPhoneNumber: mpesaPhoneNumber || currentTicketData?.phone || null,
      mpesaTransactionTimestamp: parsedTransactionDate instanceof Date ? parsedTransactionDate : serverTimestamp(),
      lastWebhookEventAt: serverTimestamp(),
      lastWebhookEvent: `umeskia_stk_callback_${ResponseCode}`,
      webhookPayload: stkCallback,
    };
    // Add MerchantRequestID and CheckoutRequestID if present in callback
    if (MerchantRequestID) ticketUpdateData.merchantRequestId = MerchantRequestID;
    if (CheckoutRequestID) ticketUpdateData.checkoutRequestId = CheckoutRequestID;

    await updateDoc(ticketRef, ticketUpdateData);
    console.log(`Ticket ${ticketDocId} status updated to ${paymentStatus} via webhook.`);

    const transactionLogData = {
      ticketId: ticketDocId,
      type: 'umeskia_mpesa_callback',
      merchantRequestId: MerchantRequestID,
      checkoutRequestId: CheckoutRequestID,
      umeskiaTransactionId: umeskiaTransactionIdFromCallback,
      resultCode: ResponseCode,
      resultDesc: ResponseDescription,
      status: paymentStatus,
      amount: TransactionAmount,
      mpesaReceiptNumber: TransactionReceipt || null,
      mpesaPhoneNumber: mpesaPhoneNumber || null,
      transactionDate: parsedTransactionDate instanceof Date ? parsedTransactionDate : serverTimestamp(),
      reference: TransactionReference, 
      source: 'umeskia_mpesa_webhook',
      createdAt: serverTimestamp(),
      rawCallbackPayload: stkCallback, 
    };
    await addDoc(collection(db, 'transactions'), transactionLogData);
    console.log(`Umeskia M-Pesa callback transaction log created for Ticket ID: ${ticketDocId}`);

    // Email is no longer sent from here directly.
    // The status update to 'confirmed' will be caught by onSnapshot listener on client if active,
    // which then calls processAndSendTicketEmail server action.

    return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" }, { status: 200 });

  } catch (error) {
    console.error('Error processing Umeskia M-Pesa webhook:', error);
    let errorMessage = 'Internal Server Error';
    if (error instanceof Error) {
        errorMessage = error.message;
    } else if (typeof error === 'string') {
        errorMessage = error;
    }
    // Still acknowledge receipt to M-Pesa to prevent retries if possible
    return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted with internal processing error", error: errorMessage }, { status: 200 });
  }
}

export async function GET(request: NextRequest) {
  return NextResponse.json({ message: 'Umeskia M-Pesa Webhook endpoint is active. Use POST for STK callbacks.' }, { status: 200 });
}

    