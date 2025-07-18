
"use server";

import { z } from 'zod';
import { db } from '@/lib/firebase';
import { sendPaymentConfirmationEmail } from '@/lib/emailService';
import { collection, addDoc, doc, updateDoc, serverTimestamp, getDoc, increment } from 'firebase/firestore';
import axios from 'axios';

const PaymentInitiationSchema = z.object({
  ticketId: z.string().min(1, "Ticket ID is required"),
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

  const { ticketId: ticketDocId, amount, phone, email } = validation.data;
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
        emailSent: false, // Initialize emailSent status
    };
    if (email) {
        ticketUpdateData.email = email;
    }
    await updateDoc(ticketRef, ticketUpdateData);

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
    const responseMessage = mpesaApiResult.massage || mpesaApiResult.message || mpesaApiResult.ResultDesc || "No message from provider.";
    
    // Correctly check for Umeskia's success code and transaction ID based on user-provided response
    if (mpesaApiResult.success === "200" && mpesaApiResult.transaction_request_id) {
      const umeskiaTransactionRequestIdFromApi = mpesaApiResult.transaction_request_id;

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
        providerResponse: responseMessage,
      });
      
      return {
        success: true,
        message: responseMessage || "STK Push initiated successfully. Please check your phone to complete the payment.",
        umeskiaTransactionRequestId: umeskiaTransactionRequestIdFromApi,
        responseDescription: responseMessage,
      };
    } else {
      // The API call was successful (2xx) but the business logic indicates a failure.
      const errorMessage = responseMessage || "M-Pesa STK push initiation failed. Unexpected response from provider.";
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
        const responseData = error.response.data;
        if (typeof responseData === 'string') {
            errorMessage = responseData;
        } else if (responseData && (responseData.errors || responseData.message || responseData.massage || responseData.ResultDesc || responseData.ResponseDescription)) {
            errorMessage = JSON.stringify(responseData.errors || responseData.message || responseData.massage || responseData.ResultDesc || responseData.ResponseDescription);
        } else {
            errorMessage = `M-Pesa API request failed with status ${error.response.status}.`;
        }
    } else if (error.message) {
        errorMessage = error.message;
    }
    try {
        const ticketRef = doc(db, 'tickets', ticketDocId);
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
  success: boolean;
  message: string;
  isConfirmed?: boolean;
  data?: any;
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

  const { umeskiaTransactionRequestId, ticketId: ticketDocId } = validation.data;
  
  const rawApiUrl = process.env.MPESA_API_URL;
  if (!rawApiUrl) {
    console.error("MPESA_API_URL not configured.");
    return { success: false, message: "Payment gateway URL configuration error." };
  }
  const mpesaApiUrlBase = rawApiUrl.substring(0, rawApiUrl.lastIndexOf('/'));
  const mpesaStatusApiUrl = `${mpesaApiUrlBase}/transactionstatus`;
  
  const mpesaApiKey = process.env.MPESA_API_KEY;
  const mpesaUmsEmail = process.env.MPESA_UMS_EMAIL;

  if (!mpesaStatusApiUrl || !mpesaApiKey || !mpesaUmsEmail) {
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

    const statusPayload = {
      api_key: mpesaApiKey,
      email: mpesaUmsEmail,
      tranasaction_request_id: umeskiaTransactionRequestId,
    };

    const statusResponse = await axios.post(mpesaStatusApiUrl, statusPayload, {
      headers: { 'Content-Type': 'application/json' }
    });

    const statusApiResult = statusResponse.data;
    
    await addDoc(collection(db, 'transactions'), {
        ticketId: ticketDocId,
        type: 'mpesa_status_check_api',
        umeskiaTransactionRequestId,
        statusCheckResponse: statusApiResult,
        checkedAt: serverTimestamp(),
    });

    if (statusApiResult.ResultCode === "200" &&
        statusApiResult.TransactionStatus === "Completed" &&
        statusApiResult.TransactionCode === "0") {

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
        status: 'confirmed', // This will trigger onSnapshot in PaymentDisplay
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
        reference: statusApiResult.TransactionReference,
        source: 'umeskia_manual_status_check',
        createdAt: serverTimestamp(),
        rawCallbackPayload: statusApiResult,
      });
      
      // Email sending is now handled by onSnapshot in PaymentDisplay via processAndSendTicketEmail
      return {
        success: true,
        message: statusApiResult.ResultDesc || "Payment confirmed via status check. Email will be sent shortly if not already.",
        isConfirmed: true,
        data: statusApiResult,
      };

    } else if (statusApiResult.ResultCode === "200" && statusApiResult.TransactionStatus !== "Completed") {
      return {
        success: true,
        message: `Transaction status: ${statusApiResult.TransactionStatus}. ${statusApiResult.ResultDesc || ''}`,
        isConfirmed: false,
        data: statusApiResult
      };
    } else {
      const message = statusApiResult.ResultDesc || statusApiResult.message || "Could not confirm transaction or transaction failed/not found.";
      return {
        success: false,
        message: message,
        isConfirmed: false,
        data: statusApiResult
      };
    }

  } catch (error: any) {
    console.error("Transaction status check error:", error);
    let errorMessage = 'An error occurred while checking transaction status.';
    if (axios.isAxiosError(error) && error.response) {
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

export interface ProcessEmailResult {
  attempted: boolean;
  success?: boolean;
  message: string;
}

export async function processAndSendTicketEmail(ticketId: string): Promise<ProcessEmailResult> {
  if (!ticketId) {
    return { attempted: false, message: "Ticket ID is required." };
  }
  const ticketRef = doc(db, 'tickets', ticketId);
  const ticketSnap = await getDoc(ticketRef);

  if (!ticketSnap.exists()) {
    return { attempted: false, message: "Ticket not found." };
  }

  const ticketData = ticketSnap.data();

  if (ticketData.status !== 'confirmed') {
    return { attempted: false, message: "Ticket not confirmed yet." };
  }

  if (!ticketData.email) {
    return { attempted: false, message: "No email address on file for this ticket to send receipt." };
  }

  if (ticketData.emailSent === true) {
    return { attempted: true, success: true, message: "Ticket email was already sent previously." };
  }

  const recipientEmail = ticketData.email;
  const ticketIdFieldVal = ticketData.id || ticketId;
  const amount = ticketData.mpesaAmountPaid?.toString() || ticketData.amount?.toString() || 'N/A';
  const mpesaReceipt = ticketData.mpesaReceiptNumber || 'N/A';
  const phone = ticketData.mpesaPhoneNumber || ticketData.phone || 'N/A';
  const quantity = ticketData.quantity || 1;

  const emailResult = await sendPaymentConfirmationEmail(
    recipientEmail,
    ticketId,
    ticketIdFieldVal,
    amount,
    mpesaReceipt,
    phone,
    quantity,
    recipientEmail
  );

  if (emailResult.success) {
    await updateDoc(ticketRef, { emailSent: true, lastEmailAttemptAt: serverTimestamp() });
    return { attempted: true, success: true, message: "Ticket email sent successfully." };
  } else {
    await updateDoc(ticketRef, { lastEmailAttemptAt: serverTimestamp(), lastEmailError: emailResult.message });
    return { attempted: true, success: false, message: emailResult.message || "Failed to send ticket email." };
  }
}

export async function resendTicketEmailAction(ticketId: string): Promise<{ success: boolean; message: string }> {
  if (!ticketId) {
    return { success: false, message: "Ticket ID is required." };
  }
  const ticketRef = doc(db, 'tickets', ticketId);
  const ticketSnap = await getDoc(ticketRef);

  if (!ticketSnap.exists()) {
    return { success: false, message: "Ticket not found." };
  }
  const ticketData = ticketSnap.data();

  if (ticketData.status !== 'confirmed') {
    return { success: false, message: "Ticket is not confirmed. Cannot resend email." };
  }
  if (!ticketData.email) {
    return { success: false, message: "No email address on file for this ticket." };
  }

  const recipientEmail = ticketData.email;
  const ticketIdFieldVal = ticketData.id || ticketId;
  const amount = ticketData.mpesaAmountPaid?.toString() || ticketData.amount?.toString() || 'N/A';
  const mpesaReceipt = ticketData.mpesaReceiptNumber || 'N/A';
  const phone = ticketData.mpesaPhoneNumber || ticketData.phone || 'N/A';
  const quantity = ticketData.quantity || 1;

  const emailResult = await sendPaymentConfirmationEmail(
    recipientEmail,
    ticketId,
    ticketIdFieldVal,
    amount,
    mpesaReceipt,
    phone,
    quantity,
    recipientEmail
  );

  const updateData: any = {
    lastEmailAttemptAt: serverTimestamp(),
    resentEmailCount: increment(1) // Consider adding a 'resentEmailCount' field to your ticket schema
  };
  if (emailResult.success) {
    updateData.emailSent = true; // Ensure it's marked as sent
    await updateDoc(ticketRef, updateData);
    return { success: true, message: "Ticket email resent successfully." };
  } else {
    updateData.lastEmailError = emailResult.message;
    await updateDoc(ticketRef, updateData);
    return { success: false, message: emailResult.message || "Failed to resend ticket email." };
  }
}

    