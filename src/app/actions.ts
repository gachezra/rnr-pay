
"use server";

import { z } from 'zod';
import { db } from '@/lib/firebase';
import { sendPaymentConfirmationEmail } from '@/lib/emailService'; // Will be used by webhook
import { collection, addDoc, doc, updateDoc, serverTimestamp, getDoc } from 'firebase/firestore';
import axios from 'axios';

// Ensure M-PESA environment variables are set in .env.local
// MPESA_API_KEY=your_mpesa_api_key
// MPESA_UMS_EMAIL=your_umeskia_email
// MPESA_ACCOUNT_ID=your_umeskia_account_id
// MPESA_API_URL=https_api_umeskiasoftwares_com_api_v1_intiatestk (or actual URL)

const PaymentInitiationSchema = z.object({
  ticketId: z.string().min(1, "Ticket ID is required"),
  amount: z.string().refine(val => !isNaN(parseFloat(val)) && parseFloat(val) > 0, {
    message: "Amount must be a positive number",
  }),
  phone: z.string().min(10, "Valid phone number is required").regex(/^\d+$/, "Phone number must contain only digits"), // Basic validation
  email: z.string().email("Invalid email address").optional(),
});

export interface PaymentInitiationResult {
  success: boolean;
  message?: string;
  merchantRequestId?: string;
  checkoutRequestId?: string;
  responseDescription?: string; // From M-Pesa
}

export async function handlePaymentInitiation(
  params: {
    ticketId: string;
    amount: string;
    phone: string; // Made phone mandatory for STK push
    email?: string;
  }
): Promise<PaymentInitiationResult> {
  const validation = PaymentInitiationSchema.safeParse(params);

  if (!validation.success) {
    return {
      success: false,
      message: validation.error.errors.map(e => e.message).join(', '),
    };
  }

  const { ticketId, amount, phone, email } = validation.data;
  const numericAmount = parseFloat(amount);

  const mpesaApiUrl = process.env.MPESA_API_URL;
  const mpesaApiKey = process.env.MPESA_API_KEY;
  const mpesaUmsEmail = process.env.MPESA_UMS_EMAIL;
  const mpesaAccountId = process.env.MPESA_ACCOUNT_ID;

  if (!mpesaApiKey || !mpesaUmsEmail || !mpesaAccountId) {
    console.error("M-Pesa API credentials not configured in environment variables.");
    return {
      success: false,
      message: "Payment gateway configuration error. Please contact support.",
    };
  }

  try {
    // 1. Update ticket with email and phone if provided and not already set, and set status to pending_initiation
    const ticketRef = doc(db, 'tickets', ticketId);
    const ticketSnap = await getDoc(ticketRef);

    if (!ticketSnap.exists()) {
        return { success: false, message: `Ticket ${ticketId} not found.`};
    }
    
    const ticketUpdateData:any = { 
        status: 'payment_initiation_started', 
        lastPaymentAttempt: serverTimestamp(),
        phone // Update phone for STK push
    };
    if (email && !ticketSnap.data()?.email) { // Only update email if not already present or explicitly passed
        ticketUpdateData.email = email;
    }
    await updateDoc(ticketRef, ticketUpdateData);


    // 2. Call M-Pesa STK Push API
    console.log(`Initiating M-Pesa STK push for Ticket ID: ${ticketId}, Amount: ${numericAmount}, Phone: ${phone}`);
    const mpesaResponse = await axios.post(mpesaApiUrl, {
      api_key: mpesaApiKey,
      email: mpesaUmsEmail, // This is UMS email, not customer email
      account_id: mpesaAccountId,
      msisdn: phone, // Customer's phone number for STK push
      amount: numericAmount.toString(), // Amount as string
      reference: ticketId, // Use ticketId as the reference for M-Pesa
    });

    // Assuming M-Pesa API returns data like:
    // { MerchantRequestID: "...", CheckoutRequestID: "...", ResponseCode: "0", ResponseDescription: "...", CustomerMessage: "..." }
    // Adjust based on actual API response structure from umeskiasoftwares
    const mpesaApiResult = mpesaResponse.data;
    console.log("M-Pesa API Response:", mpesaApiResult);
    
    // Check if M-Pesa STK push initiation was accepted by the gateway
    // The exact success condition depends on the API provider (umeskiasoftwares)
    // For Safaricom direct API, ResponseCode "0" is success. Assuming similar for UMS.
    // Common success indicators might be presence of MerchantRequestID/CheckoutRequestID and a success-like ResponseCode/Description
    const isMpesaInitiationAccepted = mpesaApiResult && mpesaApiResult.MerchantRequestID && mpesaApiResult.CheckoutRequestID && (mpesaApiResult.ResponseCode === "0" || mpesaApiResult.ResponseCode === 0 || (typeof mpesaApiResult.success === 'boolean' && mpesaApiResult.success === true) || (mpesaApiResult.ResultCode === 0));


    if (isMpesaInitiationAccepted) {
      const merchantRequestId = mpesaApiResult.MerchantRequestID;
      const checkoutRequestId = mpesaApiResult.CheckoutRequestID;
      const responseDescription = mpesaApiResult.ResponseDescription || mpesaApiResult.ResultDesc || "STK Push initiated";

      // 3. Create initial transaction log
      await addDoc(collection(db, 'transactions'), {
        ticketId,
        amount: numericAmount,
        phone,
        email: email || ticketSnap.data()?.email || null, // Persist email if available
        status: 'initiated_mpesa_stk',
        paymentMethod: 'mpesa',
        merchantRequestId,
        checkoutRequestId,
        initiatedAt: serverTimestamp(),
        mpesaInitiationResponse: responseDescription,
      });

      // 4. Update ticket status to pending M-Pesa confirmation
      await updateDoc(ticketRef, {
        status: 'payment_pending_mpesa',
        merchantRequestId,
        checkoutRequestId,
        lastPaymentAttempt: serverTimestamp(), // Update timestamp
      });

      return {
        success: true,
        message: responseDescription || "STK Push initiated successfully. Please check your phone to complete the payment.",
        merchantRequestId,
        checkoutRequestId,
        responseDescription,
      };
    } else {
      // M-Pesa API did not accept the request or indicated an error
      const errorMessage = mpesaApiResult.ResponseDescription || mpesaApiResult.ResultDesc || mpesaApiResult.message || "Failed to initiate M-Pesa payment via gateway.";
      console.error("M-Pesa STK push initiation failed by gateway:", mpesaApiResult);
      await updateDoc(ticketRef, { status: 'payment_initiation_failed', lastPaymentAttempt: serverTimestamp(), mpesaInitiationError: errorMessage });
      return {
        success: false,
        message: errorMessage,
        responseDescription: errorMessage,
      };
    }

  } catch (error: any) {
    console.error("Payment initiation error:", error);
    let errorMessage = 'An error occurred while initiating the payment. Please try again.';
    if (error.response && error.response.data) {
        // Axios error with response data
        errorMessage = JSON.stringify(error.response.data.errors || error.response.data.message || error.response.data);
    } else if (error.message) {
        errorMessage = error.message;
    }
    
    try {
        // Attempt to update ticket status to failed if an error occurs
        const ticketRef = doc(db, 'tickets', ticketId);
        await updateDoc(ticketRef, { status: 'payment_initiation_error', lastPaymentAttempt: serverTimestamp(), errorDetails: errorMessage });
    } catch (dbError) {
        console.error("Failed to update ticket status on error:", dbError);
    }

    return {
      success: false,
      message: errorMessage,
    };
  }
}
