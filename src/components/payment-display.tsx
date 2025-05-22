"use client";

import type { FC } from 'react';
import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, CheckCircle2, XCircle, Info, Ticket, CreditCard, Phone, Mail, ExternalLink } from 'lucide-react';
import { handlePaymentInitiation, type PaymentInitiationResult } from '@/app/actions';
import { useToast } from "@/hooks/use-toast";
import { db } from '@/lib/firebase'; // Import Firestore instance
import { doc, onSnapshot } from 'firebase/firestore'; // Import Firestore listener functions

interface PaymentDisplayProps {
  ticketId?: string;
  amount?: string;
  phone?: string; // Phone from URL params
  email?: string; // Email from URL params
}

export const PaymentDisplay: FC<PaymentDisplayProps> = ({ ticketId, amount, phone: initialPhone, email: initialEmail }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [paymentInitiationResult, setPaymentInitiationResult] = useState<PaymentInitiationResult | null>(null);
  const [showMissingParamsError, setShowMissingParamsError] = useState(false);
  
  const [currentPhone, setCurrentPhone] = useState(initialPhone || '');
  const [currentEmail, setCurrentEmail] = useState(initialEmail || '');

  const [isPaymentReallyConfirmed, setIsPaymentReallyConfirmed] = useState(false);
  const [redirectMessage, setRedirectMessage] = useState<string | null>(null);
  const redirectTimerRef = useRef<NodeJS.Timeout | null>(null);

  const { toast } = useToast();

  useEffect(() => {
    if (!ticketId || !amount) {
      setShowMissingParamsError(true);
      setPaymentInitiationResult({ success: false, message: "Ticket ID and Amount are required parameters." });
    } else {
      setShowMissingParamsError(false);
      setPaymentInitiationResult(null); 
    }
  }, [ticketId, amount]);

  useEffect(() => {
    setCurrentPhone(initialPhone || '');
  }, [initialPhone]);

  useEffect(() => {
    setCurrentEmail(initialEmail || '');
  }, [initialEmail]);

  // Firestore listener for real-time payment status updates
  useEffect(() => {
    if (!ticketId) return;

    const ticketDocRef = doc(db, 'tickets', ticketId);
    const unsubscribe = onSnapshot(ticketDocRef, (docSnap) => {
      if (docSnap.exists()) {
        const ticketData = docSnap.data();
        if (ticketData.status === 'confirmed' && !isPaymentReallyConfirmed) {
          setIsPaymentReallyConfirmed(true);
          setRedirectMessage("Payment Confirmed! Redirecting to your ticket status page...");
          toast({
            title: "Payment Confirmed!",
            description: "Your payment has been successfully processed. You will be redirected shortly.",
            className: "bg-green-600 dark:bg-green-700 text-white border-green-700 dark:border-green-800", // Custom success styling
            duration: 5000, // Keep toast longer
          });

          if (redirectTimerRef.current) {
            clearTimeout(redirectTimerRef.current);
          }
          redirectTimerRef.current = setTimeout(() => {
            window.location.href = `https://rnr-tickets-hub.vercel.app/ticket-status?ticketId=${ticketId}`;
          }, 3000); // 3-second delay for redirect
        }
      }
    });

    // Cleanup listener on component unmount or when ticketId changes
    return () => {
      unsubscribe();
      if (redirectTimerRef.current) {
        clearTimeout(redirectTimerRef.current);
      }
    };
  }, [ticketId, toast, isPaymentReallyConfirmed]); // isPaymentReallyConfirmed ensures we don't re-setup redirect logic if already confirmed


  const onInitiatePayment = async () => {
    if (!ticketId || !amount) {
      toast({
        title: "Error",
        description: "Ticket ID and Amount are required.",
        variant: "destructive",
      });
      return;
    }
    if (!currentPhone) {
      toast({
        title: "Phone Number Required",
        description: "Please enter your M-Pesa phone number to proceed.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    setPaymentInitiationResult(null);

    const paymentParams = { 
        ticketId, 
        amount, 
        phone: currentPhone, 
        email: currentEmail || undefined 
    };

    const result = await handlePaymentInitiation(paymentParams);
    setIsLoading(false);
    setPaymentInitiationResult(result);

    if (result.success) {
      toast({
        title: "STK Push Sent!",
        description: result.message || "Please check your phone to complete the payment. You'll be notified of the outcome.",
        className: "bg-blue-600 dark:bg-blue-700 text-white border-blue-700 dark:border-blue-800",
      });
    } else {
      toast({
        title: "Payment Initiation Failed",
        description: result.message || "Could not start M-Pesa payment. Please try again.",
        variant: "destructive",
      });
    }
  };
  
  const renderPaymentStatus = () => {
    if (isPaymentReallyConfirmed && redirectMessage) {
      return (
        <div className="flex flex-col items-center justify-center space-y-3 text-green-600 dark:text-green-400 p-4 border border-green-500 rounded-md bg-green-50 dark:bg-green-900/30 shadow-lg">
          <CheckCircle2 className="h-12 w-12" />
          <span className="text-xl font-semibold text-center">Payment Confirmed!</span>
          <p className="text-sm text-muted-foreground text-center px-2">{redirectMessage}</p>
          <Button 
            variant="outline" 
            className="mt-2 border-primary text-primary hover:bg-primary/10"
            onClick={() => window.location.href = `https://rnr-tickets-hub.vercel.app/ticket-status?ticketId=${ticketId}`}
          >
            Go to Ticket Status Now <ExternalLink className="ml-2 h-4 w-4"/>
          </Button>
        </div>
      );
    }

    if (isLoading) {
      return (
        <div className="flex items-center justify-center space-x-2 text-primary">
          <Loader2 className="h-8 w-8 animate-spin" />
          <span className="text-lg font-medium">Initiating M-Pesa Payment...</span>
        </div>
      );
    }
    // This message is for successful STK PUSH INITIATION
    if (paymentInitiationResult?.success === true) {
      return (
        <div className="flex flex-col items-center justify-center space-y-3 text-blue-600 dark:text-blue-400 p-4 border border-blue-500 rounded-md bg-blue-50 dark:bg-blue-900/30 shadow-md">
          <Info className="h-12 w-12" />
          <span className="text-xl font-semibold text-center">STK Push Sent Successfully!</span>
          <p className="text-sm text-muted-foreground text-center px-2">{paymentInitiationResult.message || "Please check your M-Pesa phone to enter your PIN and complete the payment."}</p>
          <p className="text-xs text-muted-foreground text-center mt-2">Waiting for M-Pesa to confirm the transaction. This page will update automatically.</p>
        </div>
      );
    }
    // This message is for FAILED STK PUSH INITIATION
    if (paymentInitiationResult?.success === false && !showMissingParamsError) {
       return (
        <div className="flex flex-col items-center justify-center space-y-2 text-destructive p-4 border border-destructive rounded-md bg-red-50 dark:bg-red-900/30 shadow-md">
          <XCircle className="h-12 w-12" />
          <span className="text-xl font-semibold">Initiation Failed</span>
          {paymentInitiationResult.message && <p className="text-sm text-center">{paymentInitiationResult.message}</p>}
        </div>
      );
    }
    return null; 
  };

  const canEditContactInfo = (!paymentInitiationResult?.success || showMissingParamsError) && !isPaymentReallyConfirmed;
  const showPaymentButton = !paymentInitiationResult?.success && !showMissingParamsError && !isPaymentReallyConfirmed;
  const showRetryButton = paymentInitiationResult?.success === false && !showMissingParamsError && !isPaymentReallyConfirmed;


  return (
    <Card className="w-full max-w-md shadow-2xl bg-card text-card-foreground rounded-xl">
      <CardHeader className="pb-4">
        <CardTitle className="text-3xl font-bold text-center text-primary">M-Pesa Payment</CardTitle>
        <CardDescription className="text-center text-muted-foreground">
          Review details and confirm to initiate STK push.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {showMissingParamsError && (
          <Alert variant="destructive" className="mb-4">
            <XCircle className="h-4 w-4" />
            <AlertTitle>Missing Information</AlertTitle>
            <AlertDescription>
              Ticket ID and Amount are required. Please check the URL or contact support.
            </AlertDescription>
          </Alert>
        )}

        {!showMissingParamsError && (
          <>
            <div className="flex items-center justify-between p-3 bg-secondary/30 dark:bg-secondary/50 rounded-md border">
              <div className="flex items-center space-x-3">
                <Ticket className="h-5 w-5 text-primary" />
                <Label htmlFor="ticket-id-display" className="text-base font-medium text-foreground/80">
                  Ticket ID:
                </Label>
              </div>
              <span id="ticket-id-display" className="text-base font-semibold text-foreground">
                {ticketId}
              </span>
            </div>

            <div className="flex items-center justify-between p-3 bg-secondary/30 dark:bg-secondary/50 rounded-md border">
              <div className="flex items-center space-x-3">
                <CreditCard className="h-5 w-5 text-primary" />
                <Label htmlFor="amount-display" className="text-base font-medium text-foreground/80">
                  Amount (KES):
                </Label>
              </div>
              <span id="amount-display" className="text-base font-semibold text-foreground">
                {amount ? `${parseFloat(amount).toFixed(2)}` : 'N/A'}
              </span>
            </div>

            <div className="space-y-2">
              <div className="flex items-center space-x-3">
                <Phone className="h-5 w-5 text-primary" />
                <Label htmlFor="phone-input" className="text-base font-medium text-foreground/80">
                  M-Pesa Phone Number: <span className="text-destructive">*</span>
                </Label>
              </div>
              <Input
                id="phone-input"
                type="tel"
                placeholder="e.g., 2547XXXXXXXX"
                value={currentPhone}
                onChange={(e) => setCurrentPhone(e.target.value)}
                className="text-base bg-input text-foreground placeholder:text-muted-foreground"
                disabled={isLoading || paymentInitiationResult?.success === true || isPaymentReallyConfirmed}
                required
              />
               {currentPhone && !/^\d{10,12}$/.test(currentPhone) && !isPaymentReallyConfirmed && (
                 <p className="text-xs text-destructive pl-8">Enter a valid phone number (e.g. 2547... or 07...).</p>
               )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center space-x-3">
                <Mail className="h-5 w-5 text-primary" />
                <Label htmlFor="email-input" className="text-base font-medium text-foreground/80">
                  Email (For Receipt):
                </Label>
              </div>
              <Input
                id="email-input"
                type="email"
                placeholder="your@email.com (Optional)"
                value={currentEmail}
                onChange={(e) => setCurrentEmail(e.target.value)}
                className="text-base bg-input text-foreground placeholder:text-muted-foreground"
                disabled={isLoading || paymentInitiationResult?.success === true || isPaymentReallyConfirmed}
              />
               {currentEmail && !/\S+@\S+\.\S+/.test(currentEmail) && !isPaymentReallyConfirmed &&(
                 <p className="text-xs text-destructive pl-8">Enter a valid email address.</p>
               )}
            </div>
          </>
        )}
        
        <div className="mt-6 min-h-[100px] flex items-center justify-center"> {/* Increased min-h for new message */}
          {renderPaymentStatus()}
        </div>

      </CardContent>
      <CardFooter className="flex flex-col items-center pt-4">
        {showPaymentButton && (
          <Button
            onClick={onInitiatePayment}
            disabled={isLoading || !ticketId || !amount || !currentPhone || (currentPhone && !/^\d{10,12}$/.test(currentPhone)) || (currentEmail && !/\S+@\S+\.\S+/.test(currentEmail)) || isPaymentReallyConfirmed }
            className="w-full text-lg py-3 sm:py-4 bg-primary hover:bg-accent transition-all duration-300 ease-in-out transform hover:scale-105 rounded-md shadow-md"
            aria-label="Initiate M-Pesa Payment"
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Processing...
              </>
            ) : (
              'Pay with M-Pesa'
            )}
          </Button>
        )}
         {showRetryButton && (
            <Button
            onClick={onInitiatePayment} 
            disabled={isLoading || !ticketId || !amount || !currentPhone || (currentPhone && !/^\d{10,12}$/.test(currentPhone)) || (currentEmail && !/\S+@\S+\.\S+/.test(currentEmail)) || isPaymentReallyConfirmed}
            variant="outline"
            className="w-full text-lg py-3 sm:py-4 mt-2 border-primary text-primary hover:bg-primary/10 rounded-md shadow-sm"
            aria-label="Retry Payment Initiation"
          >
            Retry Payment Initiation
          </Button>
         )}
          {isPaymentReallyConfirmed && (
             <p className="text-sm text-green-600 dark:text-green-400 mt-4 text-center">
                Your payment is confirmed! Taking you to your ticket...
             </p>
         )}
      </CardFooter>
    </Card>
  );
};

