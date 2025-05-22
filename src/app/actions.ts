
"use server";

import { z } from 'zod';
import { db } from '@/lib/firebase';
import { sendPaymentConfirmationEmail } from '@/lib/emailService';
import { collection, addDoc, doc, updateDoc, serverTimestamp, getDoc } from 'firebase/firestore';
import axios from 'axios';

// Ensure M-PESA environment variables are set in .env.local
// MPESA_API_URL=https://api.umeskiasoftwares.com/api/v1/intiatestk (initiation)
// MPESA_API_KEY=your_mpesa_api_key
// MPESA_UMS_EMAIL=your_umeskia_email (UMS Portal login email)
// MPESA_ACCOUNT_ID=your_umeskia_account_id

const PaymentInitiationSchema = z.object({
  ticketId: z.string().min(1, "Ticket ID is required"),
  amount: z.string().refine(val => !isNaN(parseFloat(val)) && parseFloat(val) > 0, {
    message: "Amount must be a positive number",
  }),
  phone: z.string().min(10, "Valid phone number is required").regex(/^\d{10,12}$/, "Phone number must be 10-12 digits"), // Allow 254... and 07...
  email: z.string().email("Invalid email address").optional().or(z.literal('')),
});

export interface PaymentInitiationResult {
  success: boolean;
  message?: string;
  umeskiaTransactionRequestId?: string; 
  responseDescription?: string;
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
  const mpesaUmsEmail = process.env.MPESA_UMS_EMAIL; // UMS Portal login email
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
    const ticketRef = doc(db, 'tickets', ticketId);
    const ticketSnap = await getDoc(ticketRef);

    if (!ticketSnap.exists()) {
        return { success: false, message: `Ticket ${ticketId} not found.`};
    }
    
    const ticketUpdateData: any = {
        status: 'payment_pending_mpesa',
        lastPaymentAttemptAt: serverTimestamp(),
        phone: phone,
    };
    if (email) {
        ticketUpdateData.email = email;
    }
    await updateDoc(ticketRef, ticketUpdateData);

    console.log(`Initiating M-Pesa STK push via Umeskia for Ticket ID: ${ticketId}, Amount: ${numericAmount}, Phone: ${phone}`);
    
    const mpesaPayload = {
      api_key: mpesaApiKey,
      email: mpesaUmsEmail, // UMS Portal login email
      account_id: mpesaAccountId,
      msisdn: phone,
      amount: numericAmount.toString(),
      reference: ticketId, 
    };

    const mpesaResponse = await axios.post(mpesaApiUrl, mpesaPayload, {
      headers: { 'Content-Type': 'application/json' }
    });

    const mpesaApiResult = mpesaResponse.data;
    console.log("M-Pesa API Direct Initiation Response:", mpesaApiResult);

    if (mpesaApiResult.success === "200" && mpesaApiResult.tranasaction_request_id) {
      umeskiaTransactionRequestId = mpesaApiResult.tranasaction_request_id;

      await updateDoc(ticketRef, {
        umeskiaTransactionRequestId: umeskiaTransactionRequestId,
        status: 'payment_stk_sent',
      });

      await addDoc(collection(db, 'transactions'), {
        ticketId,
        type: 'mpesa_stk_initiation',
        status: 'initiated_stk_push',
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


const TransactionStatusCheckSchema = z.object({
  umeskiaTransactionRequestId: z.string().min(1, "Umeskia Transaction Request ID is required"),
  ticketId: z.string().min(1, "Ticket ID is required"),
});

export interface TransactionStatusResult {
  success: boolean;
  message: string;
  isConfirmed?: boolean; // True if payment is confirmed by this check
  data?: any; // Full response from status check for debugging
}

export async function checkTransactionStatus(
  params: {
    umeskiaTransactionRequestId: string;
    ticketId: string;
  }
): Promise<TransactionStatusResult> {
  const validation = TransactionStatusCheckSchema.safeParse(params);
  if (!validation.success) {
    return {
      success: false,
      message: validation.error.errors.map(e => e.message).join(', '),
    };
  }

  const { umeskiaTransactionRequestId, ticketId } = validation.data;

  const mpesaApiUrlBase = process.env.MPESA_API_URL?.substring(0, process.env.MPESA_API_URL.lastIndexOf('/')); //e.g. https://api.umeskiasoftwares.com/api/v1
  const mpesaStatusApiUrl = `${mpesaApiUrlBase}/transactionstatus`;
  
  const mpesaApiKey = process.env.MPESA_API_KEY;
  const mpesaUmsEmail = process.env.MPESA_UMS_EMAIL; // UMS Portal login email

  if (!mpesaStatusApiUrl || !mpesaApiKey || !mpesaUmsEmail || !process.env.MPESA_API_URL) {
    console.error("M-Pesa API credentials or status URL for status check not configured.");
    return {
      success: false,
      message: "Payment status check configuration error.",
    };
  }
  
  try {
    const ticketRef = doc(db, 'tickets', ticketId);
    const ticketSnap = await getDoc(ticketRef);

    if (!ticketSnap.exists()) {
      return { success: false, message: `Ticket ${ticketId} not found for status check.` };
    }
    const currentTicketData = ticketSnap.data();
    if (currentTicketData?.status === 'confirmed') {
        return { success: true, message: "Payment already confirmed.", isConfirmed: true };
    }

    console.log(`Checking M-Pesa transaction status for Umeskia ID: ${umeskiaTransactionRequestId}`);
    const statusPayload = {
      api_key: mpesaApiKey,
      email: mpesaUmsEmail, // UMS Portal login email
      tranasaction_request_id: umeskiaTransactionRequestId,
    };

    const statusResponse = await axios.post(mpesaStatusApiUrl, statusPayload, {
      headers: { 'Content-Type': 'application/json' }
    });

    const statusApiResult = statusResponse.data;
    console.log("M-Pesa Transaction Status API Response:", statusApiResult);
    
    // Log this attempt
    await addDoc(collection(db, 'transactions'), {
        ticketId,
        type: 'mpesa_status_check_api',
        umeskiaTransactionRequestId,
        statusCheckResponse: statusApiResult,
        checkedAt: serverTimestamp(),
    });

    // "ResultCode": "200", "TransactionStatus": "Completed", "TransactionCode": "0"
    if (statusApiResult.ResultCode === "200" && 
        statusApiResult.TransactionStatus === "Completed" &&
        statusApiResult.TransactionCode === "0") {

      // Payment Confirmed
      const userEmail = currentTicketData?.email || null;
      const originalAmount = currentTicketData?.amount?.toString() || statusApiResult.TransactionAmount?.toString();
      
      let parsedTransactionDate: any = serverTimestamp();
      if (statusApiResult.TransactionDate) { 
          try {
              const year = parseInt(statusApiResult.TransactionDate.substring(0, 4));
              const month = parseInt(statusApiResult.TransactionDate.substring(4, 6)) - 1;
              const day = parseInt(statusApiResult.TransactionDate.substring(6, 8));
              const hour = parseInt(statusApiResult.TransactionDate.substring(8, 10));
              const minute = parseInt(statusApiResult.TransactionDate.substring(10, 12));
              const second = parseInt(statusApiResult.TransactionDate.substring(12, 14));
              parsedTransactionDate = new Date(Date.UTC(year, month, day, hour, minute, second));
          } catch (e) { console.warn("Could not parse status check transaction date", e); }
      }

      const ticketUpdateData: any = {
        status: 'confirmed',
        mpesaResultCode: statusApiResult.TransactionCode, // Use TransactionCode from status for consistency
        mpesaResultDesc: statusApiResult.ResultDesc,
        // MerchantRequestID and CheckoutRequestID are not in this status response directly,
        // they should have been on the ticket from an earlier callback if one arrived.
        // If not, this status check confirms payment without them from this specific API response.
        umeskiaTransactionId: statusApiResult.TransactionID, // Confirming based on status check
        mpesaReceiptNumber: statusApiResult.TransactionReceipt || null,
        mpesaAmountPaid: statusApiResult.TransactionAmount || null,
        mpesaPhoneNumber: statusApiResult.Msisdn || null,
        mpesaTransactionTimestamp: parsedTransactionDate instanceof Date ? parsedTransactionDate : serverTimestamp(),
        lastWebhookEventAt: serverTimestamp(), // Indicate an update from status check
        lastWebhookEvent: `umeskia_status_check_confirmed_${statusApiResult.TransactionCode}`,
        statusCheckConfirmationPayload: statusApiResult,
      };
      await updateDoc(ticketRef, ticketUpdateData);

      // Log this specific confirmation as a transaction event
      await addDoc(collection(db, 'transactions'), {
        ticketId,
        type: 'umeskia_mpesa_status_confirmed',
        umeskiaTransactionId: statusApiResult.TransactionID,
        resultCode: statusApiResult.TransactionCode,
        resultDesc: statusApiResult.ResultDesc,
        status: 'confirmed',
        amount: statusApiResult.TransactionAmount,
        mpesaReceiptNumber: statusApiResult.TransactionReceipt || null,
        mpesaPhoneNumber: statusApiResult.Msisdn || null,
        transactionDate: parsedTransactionDate instanceof Date ? parsedTransactionDate : serverTimestamp(),
        reference: statusApiResult.TransactionReference,
        source: 'umeskia_manual_status_check',
        createdAt: serverTimestamp(),
        rawCallbackPayload: statusApiResult,
      });

      if (userEmail && statusApiResult.TransactionReceipt) {
        await sendPaymentConfirmationEmail(userEmail, ticketId, originalAmount, statusApiResult.TransactionReceipt);
      }
      
      return { 
        success: true, 
        message: statusApiResult.ResultDesc || "Payment confirmed via status check.",
        isConfirmed: true,
        data: statusApiResult 
      };

    } else if (statusApiResult.ResultCode === "200" && statusApiResult.TransactionStatus !== "Completed") {
      // Transaction found but not completed (e.g., Pending, Failed but not an error code)
      return {
        success: false, // Not a processing success in terms of payment confirmation
        message: `Transaction status: ${statusApiResult.TransactionStatus}. ${statusApiResult.ResultDesc}`,
        isConfirmed: false,
        data: statusApiResult
      };
    } else {
      // Other errors or transaction not found by that ID (Umeskia might return specific errors)
      // The provided doc doesn't list error ResultCodes for status check, so this is a general catch
      return {
        success: false,
        message: statusApiResult.ResultDesc || "Could not confirm transaction or transaction failed.",
        isConfirmed: false,
        data: statusApiResult
      };
    }

  } catch (error: any) {
    console.error("Transaction status check error:", error);
    let errorMessage = 'An error occurred while checking transaction status.';
    if (axios.isAxiosError(error) && error.response) {
      console.error("Status Check API Error Response Data:", error.response.data);
      errorMessage = error.response.data?.ResultDesc || error.response.data?.message || JSON.stringify(error.response.data) || `Status API request failed with status ${error.response.status}.`;
    } else if (error.message) {
      errorMessage = error.message;
    }
    return {
      success: false,
      message: errorMessage,
    };
  }
}

    