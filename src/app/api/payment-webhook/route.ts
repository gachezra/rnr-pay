
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/firebase';
import { doc, updateDoc, addDoc, collection, serverTimestamp, getDoc } from 'firebase/firestore';
import { sendPaymentConfirmationEmail } from '@/lib/emailService';

// Schema for individual items in M-Pesa's CallbackMetadata
const MpesaCallbackMetadataItemSchema = z.object({
  Name: z.string(),
  Value: z.union([z.string(), z.number(), z.null()]).optional(),
});

// Schema for M-Pesa's CallbackMetadata
const MpesaCallbackMetadataSchema = z.object({
  Item: z.array(MpesaCallbackMetadataItemSchema),
});

// Schema for the stkCallback object
const StkCallbackSchema = z.object({
  MerchantRequestID: z.string(),
  CheckoutRequestID: z.string(),
  ResultCode: z.number(),
  ResultDesc: z.string(),
  CallbackMetadata: MpesaCallbackMetadataSchema.optional(),
});

// Schema for the overall M-Pesa webhook payload
const MpesaWebhookPayloadSchema = z.object({
  Body: z.object({
    stkCallback: StkCallbackSchema,
  }),
});

// Helper function to find a value from CallbackMetadata.Item array
function findMetadataValue(items: z.infer<typeof MpesaCallbackMetadataItemSchema>[] | undefined, name: string): string | number | null | undefined {
  if (!items) return undefined;
  const item = items.find(i => i.Name === name);
  return item?.Value;
}

export async function POST(request: NextRequest) {
  try {
    // IMPORTANT: Implement webhook security (e.g., signature verification or IP whitelisting)
    // For now, we proceed without it for demonstration.
    // console.log("Received M-Pesa webhook from IP:", request.ip);

    const payload = await request.json();
    const validation = MpesaWebhookPayloadSchema.safeParse(payload);

    if (!validation.success) {
      console.error("M-Pesa Webhook validation error:", validation.error.format());
      return NextResponse.json({ error: 'Invalid M-Pesa payload', details: validation.error.format() }, { status: 400 });
    }

    const { Body: { stkCallback } } = validation.data;
    const { MerchantRequestID, CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata } = stkCallback;

    // Extract ticketId (assuming it's 'AccountReference' from your STK push initiation)
    const ticketId = findMetadataValue(CallbackMetadata?.Item, 'AccountReference')?.toString();

    if (!ticketId) {
      console.error('M-Pesa Webhook: Ticket ID (AccountReference) not found in CallbackMetadata for MerchantRequestID:', MerchantRequestID);
      // Acknowledge M-Pesa to prevent retries, but log the critical error.
      return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted", message: "Webhook processed, but Ticket ID (AccountReference) missing." }, { status: 200 });
    }

    console.log(`M-Pesa Webhook received: MerchantRequestID: ${MerchantRequestID}, CheckoutRequestID: ${CheckoutRequestID}, ResultCode: ${ResultCode}, TicketID: ${ticketId}`);

    const paymentStatus = ResultCode === 0 ? 'confirmed' : 'failed';
    const mpesaReceiptNumber = findMetadataValue(CallbackMetadata?.Item, 'MpesaReceiptNumber')?.toString();
    const amountPaidValue = findMetadataValue(CallbackMetadata?.Item, 'Amount');
    const amountPaid = typeof amountPaidValue === 'number' ? amountPaidValue : (typeof amountPaidValue === 'string' ? parseFloat(amountPaidValue) : null);
    const phoneNumber = findMetadataValue(CallbackMetadata?.Item, 'PhoneNumber')?.toString();
    const transactionDateRaw = findMetadataValue(CallbackMetadata?.Item, 'TransactionDate')?.toString();
    
    let transactionTimestamp: any = serverTimestamp();
    if (transactionDateRaw) {
        try {
            const year = parseInt(transactionDateRaw.substring(0, 4));
            const month = parseInt(transactionDateRaw.substring(4, 6)) -1;
            const day = parseInt(transactionDateRaw.substring(6, 8));
            const hour = parseInt(transactionDateRaw.substring(8, 10));
            const minute = parseInt(transactionDateRaw.substring(10, 12));
            const second = parseInt(transactionDateRaw.substring(12, 14));
            transactionTimestamp = new Date(Date.UTC(year, month, day, hour, minute, second)); // Use UTC
        } catch (e) {
            console.warn("Could not parse M-Pesa transaction date:", transactionDateRaw, e);
        }
    }

    // Fetch ticket details to get email for notification
    const ticketRef = doc(db, 'tickets', ticketId);
    const ticketSnap = await getDoc(ticketRef);
    let userEmail: string | null = null;
    let originalAmount: string | null = null;

    if (!ticketSnap.exists()) {
      console.error(`M-Pesa Webhook: Ticket ${ticketId} not found in database.`);
      // Still acknowledge M-Pesa, but this is an internal issue.
      return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted", message: "Webhook processed, ticket not found internally." }, { status: 200 });
    } else {
      userEmail = ticketSnap.data()?.email || null;
      originalAmount = ticketSnap.data()?.amount?.toString() || null; // Assuming 'amount' is stored on the ticket
    }

    // Update ticket status in Firestore
    await updateDoc(ticketRef, {
      status: paymentStatus, // 'confirmed' or 'failed'
      mpesaResultCode: ResultCode,
      mpesaResultDesc: ResultDesc,
      mpesaCheckoutRequestId: CheckoutRequestID, // Should match what was stored at initiation
      mpesaReceiptNumber: mpesaReceiptNumber || null,
      mpesaAmountPaid: amountPaid, // Amount from M-Pesa callback
      mpesaPhoneNumber: phoneNumber || null, // Phone from M-Pesa callback
      mpesaTransactionTimestamp: transactionTimestamp instanceof Date ? transactionTimestamp : null, // Store parsed date or null
      lastWebhookEventAt: serverTimestamp(),
      lastWebhookEvent: `mpesa_stk_callback_${ResultCode}`,
    });
    console.log(`Ticket ${ticketId} status updated to ${paymentStatus}.`);

    // Log the M-Pesa callback event as a transaction entry
    // This is a separate log entry for the callback itself.
    const transactionLogData = {
      ticketId,
      type: 'mpesa_callback', // Differentiate from initiation log
      merchantRequestId: MerchantRequestID,
      checkoutRequestId: CheckoutRequestID,
      resultCode: ResultCode,
      resultDesc: ResultDesc,
      status: paymentStatus, // 'confirmed' or 'failed'
      amount: amountPaid, // Amount confirmed by M-Pesa
      mpesaReceiptNumber: mpesaReceiptNumber || null,
      phoneNumber: phoneNumber || null,
      transactionDate: transactionTimestamp instanceof Date ? transactionTimestamp : serverTimestamp(), // Use parsed date or server timestamp
      source: 'mpesa_webhook',
      createdAt: serverTimestamp(),
      rawCallbackPayload: stkCallback, // Store raw callback for auditing
    };
    await addDoc(collection(db, 'transactions'), transactionLogData);
    console.log(`M-Pesa callback transaction log created for Ticket ID: ${ticketId}`);

    // Send confirmation email if payment was successful and email is available
    if (paymentStatus === 'confirmed' && userEmail && mpesaReceiptNumber) {
      // Use originalAmount from ticket for email if amountPaid from M-Pesa is not trustworthy or for consistency
      const emailAmount = originalAmount || (amountPaid ? amountPaid.toFixed(2) : 'N/A');
      await sendPaymentConfirmationEmail(userEmail, ticketId, emailAmount, mpesaReceiptNumber);
    }

    return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" }, { status: 200 });

  } catch (error) {
    console.error('Error processing M-Pesa webhook:', error);
    let errorMessage = 'Internal Server Error';
    if (error instanceof Error) {
        errorMessage = error.message;
    } else if (typeof error === 'string') {
        errorMessage = error;
    }
    return NextResponse.json({ ResultCode: 1, ResultDesc: "Failed to process webhook due to internal error", error: errorMessage }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return NextResponse.json({ message: 'M-Pesa Webhook endpoint is active. Use POST for STK callbacks.' }, { status: 200 });
}
