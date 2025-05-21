
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/firebase'; // Using the simulated DB
import { doc, updateDoc, addDoc, collection, serverTimestamp } from 'firebase/firestore';

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
  CallbackMetadata: MpesaCallbackMetadataSchema.optional(), // Optional, as it might not be present on initial failure
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
    // 1. IMPORTANT: Verify the webhook source (e.g., IP whitelisting for M-Pesa)
    // M-Pesa callbacks typically don't use signatures like Stripe. Security relies on HTTPS
    // and ensuring the request originates from M-Pesa's known IP addresses.
    // This step is crucial for production.
    // console.log("Received M-Pesa webhook from IP:", request.ip); // Log IP for verification

    const payload = await request.json();
    const validation = MpesaWebhookPayloadSchema.safeParse(payload);

    if (!validation.success) {
      console.error("M-Pesa Webhook validation error:", validation.error.format());
      return NextResponse.json({ error: 'Invalid M-Pesa payload', details: validation.error.format() }, { status: 400 });
    }

    const { Body: { stkCallback } } = validation.data;
    const { MerchantRequestID, CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata } = stkCallback;

    // 2. Extract ticketId (AccountReference) from CallbackMetadata
    // This assumes 'AccountReference' was used to pass your internal ticketId during STK push initiation.
    // Adjust 'AccountReference' if M-Pesa returns your reference under a different name.
    const ticketId = findMetadataValue(CallbackMetadata?.Item, 'AccountReference')?.toString();

    if (!ticketId) {
      console.error('M-Pesa Webhook: Ticket ID (AccountReference) not found in CallbackMetadata for MerchantRequestID:', MerchantRequestID);
      // Respond with success to M-Pesa to prevent retries, but log error.
      // Or, if this is critical, you might respond with an error if M-Pesa handles it well.
      // For now, acknowledge receipt but log:
      return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted", message: "Webhook processed, but Ticket ID (AccountReference) missing." }, { status: 200 });
    }

    console.log(`M-Pesa Webhook received: MerchantRequestID: ${MerchantRequestID}, CheckoutRequestID: ${CheckoutRequestID}, ResultCode: ${ResultCode}, TicketID: ${ticketId}`);

    // 3. Process the event and update your database
    const paymentStatus = ResultCode === 0 ? 'confirmed' : 'failed';
    const mpesaReceiptNumber = findMetadataValue(CallbackMetadata?.Item, 'MpesaReceiptNumber')?.toString();
    const amountPaid = findMetadataValue(CallbackMetadata?.Item, 'Amount');
    const phoneNumber = findMetadataValue(CallbackMetadata?.Item, 'PhoneNumber')?.toString();
    const transactionDateRaw = findMetadataValue(CallbackMetadata?.Item, 'TransactionDate')?.toString();
    
    // Convert M-Pesa transaction date (YYYYMMDDHHMMSS) to ISO string or Firestore Timestamp
    let transactionTimestamp: any = serverTimestamp(); // Default to server time
    if (transactionDateRaw) {
        try {
            const year = parseInt(transactionDateRaw.substring(0, 4));
            const month = parseInt(transactionDateRaw.substring(4, 6)) -1; // JS months are 0-indexed
            const day = parseInt(transactionDateRaw.substring(6, 8));
            const hour = parseInt(transactionDateRaw.substring(8, 10));
            const minute = parseInt(transactionDateRaw.substring(10, 12));
            const second = parseInt(transactionDateRaw.substring(12, 14));
            transactionTimestamp = new Date(year, month, day, hour, minute, second);
        } catch (e) {
            console.warn("Could not parse M-Pesa transaction date:", transactionDateRaw, e);
        }
    }


    // Update ticket status in Firestore
    const ticketRef = doc(db, 'tickets', ticketId);
    await updateDoc(ticketRef, {
      status: paymentStatus,
      mpesaResultCode: ResultCode,
      mpesaResultDesc: ResultDesc,
      mpesaCheckoutRequestId: CheckoutRequestID, // Store M-Pesa's ID
      mpesaReceiptNumber: mpesaReceiptNumber || null,
      lastWebhookEvent: `mpesa_stk_callback_${ResultCode}`,
      webhookReceivedAt: serverTimestamp(),
    });
    console.log(`Ticket ${ticketId} status updated to ${paymentStatus}.`);

    // Log the transaction details
    await addDoc(collection(db, 'transactions'), {
      ticketId,
      merchantRequestId: MerchantRequestID,
      checkoutRequestId: CheckoutRequestID,
      resultCode: ResultCode,
      resultDesc: ResultDesc,
      status: paymentStatus,
      amount: typeof amountPaid === 'number' ? amountPaid : (typeof amountPaid === 'string' ? parseFloat(amountPaid) : null),
      mpesaReceiptNumber: mpesaReceiptNumber || null,
      phoneNumber: phoneNumber || null,
      transactionDate: transactionTimestamp, // Use parsed date or server timestamp
      source: 'mpesa_webhook',
      createdAt: serverTimestamp(),
      rawCallbackMetadata: CallbackMetadata || null, // Store raw metadata for auditing
    });
    console.log(`Transaction log created for M-Pesa callback, Ticket ID: ${ticketId}`);

    // 4. Respond to M-Pesa
    // M-Pesa expects a specific JSON response format for acknowledgment.
    // A common success response is: {"ResultCode": 0, "ResultDesc": "Accepted"} or "Service request is successful"
    // Failure to respond correctly might lead to M-Pesa retrying the callback.
    return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" }, { status: 200 });

  } catch (error) {
    console.error('Error processing M-Pesa webhook:', error);
    let errorMessage = 'Internal Server Error';
    if (error instanceof Error) {
        errorMessage = error.message;
    } else if (typeof error === 'string') {
        errorMessage = error;
    }
    // M-Pesa might expect a specific error format too.
    // For now, a generic 500 with an error code that does not look like success to M-Pesa.
    return NextResponse.json({ ResultCode: 1, ResultDesc: "Failed to process webhook", error: errorMessage }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  // M-Pesa does not typically use GET for STK callbacks.
  // This can be used for simple health checks if needed by other services.
  return NextResponse.json({ message: 'M-Pesa Webhook endpoint is active. Use POST to send STK callback events.' }, { status: 200 });
}

    