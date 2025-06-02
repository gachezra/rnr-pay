
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
  ticketId: z.string().min(1, "Ticket ID is required"), // This is the Firestore document ID
  amount: z.string().refine(val => !isNaN(parseFloat(val)) && parseFloat(val) > 0, {
    message: "Amount must be a positive number",
  }),
  phone: z.string().min(10, "Valid phone number is required").regex(/^(0[17]\d{8}|254[17]\d{8})$/, "Phone number must be in format 07xxxxxxxx, 01xxxxxxxx, 2547xxxxxxxx or 2541xxxxxxxx"),
  email: z.string().email("Invalid email address").optional().or(z.literal('')),
});

export interface PaymentInitiationResult {
  success: boolean;
  message?: string;
  umeskiaTransactionRequestId?: string; 
  responseDescription?: string; // Message from Mpesa API direct initiation
}

export async function handlePaymentInitiation(
  params: {
    ticketId: string; // Firestore document ID
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

  const { ticketId: ticketDocId, amount, phone, email } = validation.data;
  const numericAmount = parseFloat(amount);

  const mpesaApiUrl = process.env.MPESA_API_URL; // Should be https://api.umeskiasoftwares.com/api/v1/intiatestk
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

  let umeskiaTransactionRequestIdFromApi: string | undefined;

  try {
    const ticketRef = doc(db, 'tickets', ticketDocId);
    const ticketSnap = await getDoc(ticketRef);

    if (!ticketSnap.exists()) {
        return { success: false, message: `Ticket ${ticketDocId} not found.`};
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

    console.log(`Initiating M-Pesa STK push via Umeskia for Ticket Doc ID: ${ticketDocId}, Amount: ${numericAmount}, Phone: ${phone}`);
    
    const mpesaPayload = {
      api_key: mpesaApiKey,
      email: mpesaUmsEmail, 
      account_id: mpesaAccountId,
      msisdn: phone,
      amount: numericAmount.toString(),
      reference: ticketDocId, 
    };

    const mpesaResponse = await axios.post(mpesaApiUrl, mpesaPayload, {
      headers: { 'Content-Type': 'application/json' }
    });

    const mpesaApiResult = mpesaResponse.data;
    console.log("M-Pesa API Direct Initiation Response:", mpesaApiResult);

    // Expecting: {"success": "200", "massage": "Request sent sucessfully.", "tranasaction_request_id": "UMSPID..."}
    // Note: "massage" might be a typo in Umeskia docs for "message"
    if (mpesaApiResult.success === "200" && mpesaApiResult.tranasaction_request_id) {
      umeskiaTransactionRequestIdFromApi = mpesaApiResult.tranasaction_request_id;

      await updateDoc(ticketRef, {
        umeskiaTransactionRequestId: umeskiaTransactionRequestIdFromApi,
        status: 'payment_stk_sent', 
      });

      await addDoc(collection(db, 'transactions'), {
        ticketId: ticketDocId,
        type: 'mpesa_stk_initiation',
        status: 'initiated_stk_push',
        amount: numericAmount,
        phone,
        email: email || null,
        umeskiaTransactionRequestId: umeskiaTransactionRequestIdFromApi,
        initiatedAt: serverTimestamp(),
        providerResponse: mpesaApiResult.massage || mpesaApiResult.message || "STK push initiated.",
      });
      
      return {
        success: true,
        message: mpesaApiResult.massage || mpesaApiResult.message || "STK Push initiated successfully. Please check your phone to complete the payment.",
        umeskiaTransactionRequestId: umeskiaTransactionRequestIdFromApi,
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
        const ticketRef = doc(db, 'tickets', ticketDocId);
        // Check if ticket exists before trying to update, though it should if we reached here after initial check
        const ticketSnap = await getDoc(ticketRef);
        if (ticketSnap.exists()) {
            await updateDoc(ticketRef, { 
                status: 'payment_initiation_error', 
                lastPaymentAttemptAt: serverTimestamp(), 
                errorDetails: errorMessage 
            });
        }
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
  ticketId: z.string().min(1, "Ticket ID (Firestore Doc ID) is required"),
});

export interface TransactionStatusResult {
  success: boolean; // True if the API call to check status itself was successful
  message: string;
  isConfirmed?: boolean; // True if payment is confirmed by this check
  data?: any; // Full response from status check for debugging
  emailSendAttempted?: boolean;
  emailSentSuccessfully?: boolean;
  emailSendMessage?: string;
}

export async function checkTransactionStatus(
  params: {
    umeskiaTransactionRequestId: string;
    ticketId: string; // Firestore document ID
  }
): Promise<TransactionStatusResult> {
  const validation = TransactionStatusCheckSchema.safeParse(params);
  if (!validation.success) {
    return {
      success: false,
      message: validation.error.errors.map(e => e.message).join(', '),
    };
  }

  const { umeskiaTransactionRequestId, ticketId: ticketDocId } = validation.data;

  const mpesaApiUrlBase = process.env.MPESA_API_URL?.substring(0, process.env.MPESA_API_URL.lastIndexOf('/'));
  const mpesaStatusApiUrl = `${mpesaApiUrlBase}/transactionstatus`; // Should be https://api.umeskiasoftwares.com/api/v1/transactionstatus
  
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
    const ticketRef = doc(db, 'tickets', ticketDocId);
    const ticketSnap = await getDoc(ticketRef);

    if (!ticketSnap.exists()) {
      return { success: false, message: `Ticket ${ticketDocId} not found for status check.` };
    }
    const currentTicketData = ticketSnap.data();
    
    if (currentTicketData?.status === 'confirmed') {
        return { 
            success: true, 
            message: "Payment already confirmed.", 
            isConfirmed: true, 
            data: currentTicketData.statusCheckConfirmationPayload || currentTicketData.webhookPayload || null 
        };
    }

    console.log(`Checking M-Pesa transaction status for Umeskia ID: ${umeskiaTransactionRequestId}`);
    const statusPayload = {
      api_key: mpesaApiKey,
      email: mpesaUmsEmail, 
      tranasaction_request_id: umeskiaTransactionRequestId, // Umeskia doc has a space here, using without based on common practice
    };

    const statusResponse = await axios.post(mpesaStatusApiUrl, statusPayload, {
      headers: { 'Content-Type': 'application/json' }
    });

    const statusApiResult = statusResponse.data;
    console.log("M-Pesa Transaction Status API Response:", statusApiResult);
    
    await addDoc(collection(db, 'transactions'), {
        ticketId: ticketDocId,
        type: 'mpesa_status_check_api',
        umeskiaTransactionRequestId,
        statusCheckResponse: statusApiResult,
        checkedAt: serverTimestamp(),
    });

    let emailSendAttempted = false;
    let emailSentSuccessfully = false;
    let emailSendMessage: string | undefined = undefined;

    // Expected Umeskia status check response: {"ResultCode": "200", "TransactionStatus": "Completed", "TransactionCode": "0", ...}
    if (statusApiResult.ResultCode === "200" && 
        statusApiResult.TransactionStatus === "Completed" &&
        statusApiResult.TransactionCode === "0") {

      const recipientEmail = currentTicketData?.email || null; 
      const originalAmount = currentTicketData?.amount?.toString() || statusApiResult.TransactionAmount?.toString();
      const ticketIdFieldVal = currentTicketData?.id || ticketDocId; 
      const quantity = currentTicketData?.quantity || 1;
      const mpesaPhoneNumber = statusApiResult.Msisdn || currentTicketData?.phone || null;
      
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
        mpesaResultCode: statusApiResult.TransactionCode, 
        mpesaResultDesc: statusApiResult.ResultDesc,
        umeskiaTransactionId: statusApiResult.TransactionID, 
        mpesaReceiptNumber: statusApiResult.TransactionReceipt || null,
        mpesaAmountPaid: statusApiResult.TransactionAmount || null,
        mpesaPhoneNumber: mpesaPhoneNumber,
        mpesaTransactionTimestamp: parsedTransactionDate instanceof Date ? parsedTransactionDate : serverTimestamp(),
        lastCheckedAt: serverTimestamp(), 
        lastCheckedEvent: `umeskia_status_check_confirmed_${statusApiResult.TransactionCode}`,
        statusCheckConfirmationPayload: statusApiResult, 
      };
      await updateDoc(ticketRef, ticketUpdateData);

      await addDoc(collection(db, 'transactions'), {
        ticketId: ticketDocId,
        type: 'umeskia_mpesa_status_confirmed',
        umeskiaTransactionId: statusApiResult.TransactionID,
        resultCode: statusApiResult.TransactionCode,
        resultDesc: statusApiResult.ResultDesc,
        status: 'confirmed',
        amount: statusApiResult.TransactionAmount,
        mpesaReceiptNumber: statusApiResult.TransactionReceipt || null,
        mpesaPhoneNumber: mpesaPhoneNumber,
        transactionDate: parsedTransactionDate instanceof Date ? parsedTransactionDate : serverTimestamp(),
        reference: statusApiResult.TransactionReference, // This should be ticketDocId
        source: 'umeskia_manual_status_check',
        createdAt: serverTimestamp(),
        rawCallbackPayload: statusApiResult,
      });

      if (recipientEmail && statusApiResult.TransactionReceipt) {
        const emailResult = await sendPaymentConfirmationEmail(
            recipientEmail,
            ticketDocId,
            ticketIdFieldVal,
            originalAmount,
            statusApiResult.TransactionReceipt,
            mpesaPhoneNumber,
            quantity,
            recipientEmail 
        );
        emailSendAttempted = true;
        emailSentSuccessfully = emailResult.success;
        emailSendMessage = emailResult.message;
      }
      
      return { 
        success: true, 
        message: statusApiResult.ResultDesc || "Payment confirmed via status check.",
        isConfirmed: true,
        data: statusApiResult,
        emailSendAttempted,
        emailSentSuccessfully,
        emailSendMessage,
      };

    } else if (statusApiResult.ResultCode === "200" && statusApiResult.TransactionStatus !== "Completed") {
      return {
        success: true, // API call was successful
        message: `Transaction status: ${statusApiResult.TransactionStatus}. ${statusApiResult.ResultDesc || ''}`,
        isConfirmed: false,
        data: statusApiResult
      };
    } else {
      // Other errors (e.g. ResultCode != "200") or transaction not found by that ID
      // Umeskia API might return a different structure for "transaction not found" or other errors.
      // E.g., ResponseCode might not be "200" if the transaction_request_id is invalid.
      const message = statusApiResult.ResultDesc || statusApiResult.message || "Could not confirm transaction or transaction failed/not found.";
      return {
        success: false, // Indicates the status check didn't confirm or failed to find
        message: message,
        isConfirmed: false,
        data: statusApiResult
      };
    }

  } catch (error: any) {
    console.error("Transaction status check error:", error);
    let errorMessage = 'An error occurred while checking transaction status.';
    if (axios.isAxiosError(error) && error.response) {
      console.error("Status Check API Error Response Data:", error.response.data);
      // Handle various error structures from Umeskia status check
      const responseData = error.response.data;
      if (responseData && (responseData.ResultDesc || responseData.message || responseData.error || typeof responseData === 'string')) {
        errorMessage = responseData.ResultDesc || responseData.message || responseData.error || JSON.stringify(responseData);
      } else {
        errorMessage = `Status API request failed with status ${error.response.status}.`;
      }
    } else if (error.message) {
      errorMessage = error.message;
    }
    return {
      success: false,
      message: errorMessage,
    };
  }
}
    

    