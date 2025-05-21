
"use server";

import { z } from 'zod';
import { db } from '@/lib/firebase';
// import { sendPaymentConfirmationEmail } from '@/lib/emailService'; // Will be used by webhook
import { collection, addDoc, doc, updateDoc, serverTimestamp, getDoc } from 'firebase/firestore';
import axios from 'axios';

// Ensure M-PESA environment variables are set in .env.local
// MPESA_API_URL=https_api_umeskiasoftwares_com_api_v1_intiatestk
// MPESA_API_KEY=your_mpesa_api_key
// MPESA_UMS_EMAIL=your_umeskia_email
// MPESA_ACCOUNT_ID=your_umeskia_account_id

const PaymentInitiationSchema = z.object({
  ticketId: z.string().min(1, "Ticket ID is required"),
  amount: z.string().refine(val => !isNaN(parseFloat(val)) && parseFloat(val) > 0, {
    message: "Amount must be a positive number",
  }),
  phone: z.string().min(10, "Valid phone number is required").regex(/^\d+$/, "Phone number must contain only digits"),
  email: z.string().email("Invalid email address").optional(),
});

export interface PaymentInitiationResult {
  success: boolean;
  message?: string;
  umeskiaTransactionRequestId?: string; // Changed from merchantRequestId & checkoutRequestId
  responseDescription?: string; // From M-Pesa direct response
}

export async function handlePaymentInitiation(
  params: {
    ticketId: string;
    amount: string;
    phone: string;
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

  if (!mpesaApiUrl || !mpesaApiKey || !mpesaUmsEmail || !mpesaAccountId) {
    console.error("M-Pesa API credentials not configured in environment variables.");
    return {
      success: false,
      message: "Payment gateway configuration error. Please contact support.",
    };
  }

  let umeskiaTransactionRequestId: string | undefined;

  try {
    // 1. Update ticket status to 'payment_pending_mpesa' and store contact details
    const ticketRef = doc(db, 'tickets', ticketId);
    const ticketSnap = await getDoc(ticketRef);

    if (!ticketSnap.exists()) {
        return { success: false, message: `Ticket ${ticketId} not found.`};
    }
    
    const ticketUpdateData: any = {
        status: 'payment_pending_mpesa', // Status indicating STK push is initiated
        lastPaymentAttemptAt: serverTimestamp(),
        phone: phone, // Ensure phone is updated/set
    };
    if (email) { // Update email if provided
        ticketUpdateData.email = email;
    }
    await updateDoc(ticketRef, ticketUpdateData);

    // 2. Call M-Pesa STK Push API (Umeskia)
    console.log(`Initiating M-Pesa STK push via Umeskia for Ticket ID: ${ticketId}, Amount: ${numericAmount}, Phone: ${phone}`);
    
    const mpesaPayload = {
      api_key: mpesaApiKey,
      email: mpesaUmsEmail,
      account_id: mpesaAccountId,
      msisdn: phone,
      amount: numericAmount.toString(),
      reference: ticketId,
    };

    const mpesaResponse = await axios.post(mpesaApiUrl, mpesaPayload, {
      headers: {
        'Content-Type': 'application/json',
      }
    });

    const mpesaApiResult = mpesaResponse.data;
    console.log("M-Pesa API Direct Response:", mpesaApiResult);

    // Based on Umeskia documentation: {"success": "200", "massage": "...", "tranasaction_request_id": "..."}
    if (mpesaApiResult.success === "200" && mpesaApiResult.tranasaction_request_id) {
      umeskiaTransactionRequestId = mpesaApiResult.tranasaction_request_id;

      // Update ticket with Umeskia's transaction_request_id
      await updateDoc(ticketRef, {
        umeskiaTransactionRequestId: umeskiaTransactionRequestId,
        status: 'payment_stk_sent', // More specific status
      });

      // Log initial transaction attempt (initiation part)
      await addDoc(collection(db, 'transactions'), {
        ticketId,
        type: 'mpesa_stk_initiation',
        status: 'initiated',
        amount: numericAmount,
        phone,
        email: email || null,
        umeskiaTransactionRequestId: umeskiaTransactionRequestId,
        initiatedAt: serverTimestamp(),
        providerResponse: mpesaApiResult.massage || mpesaApiResult.message || "STK push initiated.",
      });
      
      return {
        success: true,
        message: mpesaApiResult.massage || mpesaApiResult.message || "STK Push initiated successfully. Please check your phone to complete the payment.",
        umeskiaTransactionRequestId: umeskiaTransactionRequestId,
        responseDescription: mpesaApiResult.massage || mpesaApiResult.message,
      };
    } else {
      // Handle cases where success is not "200" or tranasaction_request_id is missing
      const errorMessage = mpesaApiResult.massage || mpesaApiResult.message || "M-Pesa STK push initiation failed. Unexpected response from provider.";
      console.error("M-Pesa STK Push initiation failed:", errorMessage, mpesaApiResult);
      await updateDoc(ticketRef, { 
        status: 'payment_initiation_failed', 
        errorDetails: errorMessage,
        lastPaymentAttemptAt: serverTimestamp(),
      });
      return {
        success: false,
        message: errorMessage,
      };
    }

  } catch (error: any) {
    console.error("Payment initiation error:", error);
    let errorMessage = 'An error occurred while initiating the payment. Please try again.';
    
    if (axios.isAxiosError(error) && error.response) {
        // Error from M-Pesa API itself (e.g., 4xx, 5xx)
        console.error("M-Pesa API Error Response Data:", error.response.data);
        const responseData = error.response.data;
        if (typeof responseData === 'string') {
            errorMessage = responseData;
        } else if (responseData && (responseData.errors || responseData.message || responseData.massage || responseData.ResponseDescription)) {
            errorMessage = JSON.stringify(responseData.errors || responseData.message || responseData.massage || responseData.ResponseDescription);
        } else {
            errorMessage = `M-Pesa API request failed with status ${error.response.status}.`;
        }
    } else if (error.message) {
        errorMessage = error.message;
    }
    
    try {
        const ticketRef = doc(db, 'tickets', ticketId);
        await updateDoc(ticketRef, { 
            status: 'payment_initiation_error', 
            lastPaymentAttemptAt: serverTimestamp(), 
            errorDetails: errorMessage 
        });
    } catch (dbError) {
        console.error("Failed to update ticket status on error:", dbError);
    }

    return {
      success: false,
      message: errorMessage,
    };
  }
}
