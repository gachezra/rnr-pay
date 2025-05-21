"use server";

import { z } from 'zod';
import { db } from '@/lib/firebase'; // This will use the simulated DB if Firebase is not set up
// import { collection, addDoc, doc, updateDoc, serverTimestamp } from 'firebase/firestore'; // Actual imports

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
      status: 'confirmed', // Directly confirming for this app's purpose
      // createdAt: serverTimestamp(), // Actual Firestore server timestamp
      createdAt: new Date().toISOString(), // Simulated timestamp
      paymentGatewayReference: `RNR_PAY_${Date.now()}` // Simulated reference
    };

    // Simulate adding to 'transactions' collection
    // const transactionRef = await addDoc(collection(db, 'transactions'), transactionData); // Actual Firestore call
    const transactionRef = await db.collection('transactions').addDoc(transactionData); // Simulated call
    
    // Simulate updating 'tickets' collection
    // const ticketRef = doc(db, 'tickets', ticketId); // Actual Firestore call
    // await updateDoc(ticketRef, { status: 'confirmed', lastPaymentAttempt: serverTimestamp() }); // Actual Firestore call
    await db.collection('tickets').doc(ticketId).updateDoc({ status: 'confirmed', lastPaymentAttempt: new Date().toISOString() }); // Simulated call


    return {
      success: true,
      message: 'Payment confirmed successfully!',
      transactionId: transactionRef.id,
    };
  } catch (error) {
    console.error("Payment confirmation error:", error);
    return {
      success: false,
      message: 'An error occurred while confirming the payment. Please try again.',
    };
  }
}
