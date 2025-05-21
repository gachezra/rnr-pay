
"use server";

import { z } from 'zod';
import { db } from '@/lib/firebase'; // This will use the simulated DB if Firebase is not set up
import { sendPaymentConfirmationEmail } from '@/lib/emailService';
import { collection, addDoc, doc, updateDoc, serverTimestamp } from 'firebase/firestore'; // Actual imports
import axios from 'axios';
require('dotenv').config();

const PaymentSchema = z.object({
  ticketId: z.string().min(1, "Ticket ID is required"),
  amount: z.string().min(1, "Amount is required"), // Should be parsed to number if used in calculations
  phone: z.string().optional(),
  email: z.string().email("Invalid email address").optional(),
});

export interface PaymentConfirmationResult {
  success: boolean;
  message?: string;
  transactionId?: string;
}

export async function handlePaymentConfirmation(
  params: {
    ticketId: string;
    amount: string;
    phone?: string;
    email?: string;
  }
): Promise<PaymentConfirmationResult> {
  const validation = PaymentSchema.safeParse(params);

  if (!validation.success) {
    return {
      success: false,
      message: validation.error.errors.map(e => e.message).join(', '),
    };
  }

  const { ticketId, amount, phone, email } = validation.data;

  try {
    const transactionData = {
      ticketId,
      amount: parseFloat(amount), // Store amount as number
      phone: phone || null,
      email: email || null,
    };

    // Simulate adding to 'transactions' collection
    const transactionRef = await addDoc(collection(db, 'transactions'), transactionData); // Actual Firestore call
    
    let url = 'https://api.umeskiasoftwares.com/api/v1/initiatestk';
    let api = process.env.API_KEY;
    let umsEmail = 'kipkoechgezra@gmail.com';
    let account = process.env.ACCOUNT_ID;

    const res = await axios.post(url, {
      api_key: api,
      email: umsEmail,
      account_id: account,
      msisdn: phone,
      amount: amount,
      reference: ticketId
    })
    // Simulate updating 'tickets' collection
    const ticketRef = doc(db, 'tickets', ticketId); // Actual Firestore call
    await updateDoc(ticketRef, { status: 'confirmed', lastPaymentAttempt: serverTimestamp() }); // Actual Firestore call

    // Send confirmation email if email is provided
    // if (email) {
    //   await sendPaymentConfirmationEmail(email, ticketId, amount, transactionRef.id);
    // }

    return {
      success: true,
      message: 'Payment confirmed successfully!',
      transactionId: transactionRef.id,
      result: res.data
    };
  } catch (error) {
    console.error("Payment confirmation error:", error);
    let errorMessage = 'An error occurred while confirming the payment. Please try again.';
    if (error instanceof Error) {
        errorMessage = error.message;
    }
    return {
      success: false,
      message: errorMessage,
    };
  }
}
