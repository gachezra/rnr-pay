
"use client";

import type { FC } from 'react';
import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, CheckCircle2, XCircle, Info, Ticket, CreditCard, Phone, Mail } from 'lucide-react';
import { handlePaymentInitiation, type PaymentInitiationResult } from '@/app/actions';
import { useToast } from "@/hooks/use-toast";

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
  
  // Editable phone and email states
  const [currentPhone, setCurrentPhone] = useState(initialPhone || '');
  const [currentEmail, setCurrentEmail] = useState(initialEmail || '');

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
        className: "bg-blue-500 text-white", // Custom styling for info toast
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
    if (isLoading) {
      return (
        <div className="flex items-center justify-center space-x-2 text-primary">
          <Loader2 className="h-8 w-8 animate-spin" />
          <span className="text-lg font-medium">Initiating M-Pesa Payment...</span>
        </div>
      );
    }
    if (paymentInitiationResult?.success === true) {
      return (
        <div className="flex flex-col items-center justify-center space-y-3 text-green-600 dark:text-green-400 p-4 border border-green-500 rounded-md bg-green-50 dark:bg-green-900/30">
          <Info className="h-12 w-12 text-blue-500" /> {/* Changed icon */}
          <span className="text-xl font-semibold text-center">STK Push Sent Successfully!</span>
          <p className="text-sm text-muted-foreground text-center px-2">{paymentInitiationResult.message || "Please check your M-Pesa phone to enter your PIN and complete the payment."}</p>
          <p className="text-xs text-muted-foreground text-center mt-2">You will receive a confirmation once the payment is processed by M-Pesa.</p>
        </div>
      );
    }
    if (paymentInitiationResult?.success === false && !showMissingParamsError) { // Don't show if it's a missing param error
       return (
        <div className="flex flex-col items-center justify-center space-y-2 text-destructive p-4 border border-destructive rounded-md bg-red-50 dark:bg-red-900/30">
          <XCircle className="h-12 w-12" />
          <span className="text-xl font-semibold">Initiation Failed</span>
          {paymentInitiationResult.message && <p className="text-sm text-center">{paymentInitiationResult.message}</p>}
        </div>
      );
    }
    return null; // Default state, no message or before any action
  };

  // Can edit contact info if payment hasn't been successfully initiated OR if there are missing params
  const canEditContactInfo = (!paymentInitiationResult?.success || showMissingParamsError);
  const showPaymentButton = !paymentInitiationResult?.success && !showMissingParamsError;
  const showRetryButton = paymentInitiationResult?.success === false && !showMissingParamsError;


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

            {/* Phone Number - Now always editable before first initiation attempt */}
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
                disabled={isLoading || paymentInitiationResult?.success === true}
                required
              />
               {currentPhone && !/^\d{10,12}$/.test(currentPhone) && (
                 <p className="text-xs text-destructive pl-8">Enter a valid phone number (e.g. 2547... or 07...).</p>
               )}
            </div>

            {/* Email Address - Optional, always editable before first initiation */}
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
                disabled={isLoading || paymentInitiationResult?.success === true}
              />
               {currentEmail && !/\S+@\S+\.\S+/.test(currentEmail) && (
                 <p className="text-xs text-destructive pl-8">Enter a valid email address.</p>
               )}
            </div>
          </>
        )}
        
        <div className="mt-6 min-h-[80px] flex items-center justify-center">
          {renderPaymentStatus()}
        </div>

      </CardContent>
      <CardFooter className="flex flex-col items-center pt-4">
        {showPaymentButton && (
          <Button
            onClick={onInitiatePayment}
            disabled={isLoading || !ticketId || !amount || !currentPhone || (currentPhone && !/^\d{10,12}$/.test(currentPhone)) || (currentEmail && !/\S+@\S+\.\S+/.test(currentEmail)) }
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
         {paymentInitiationResult?.success === true && (
           <p className="text-sm text-muted-foreground mt-4 text-center">Waiting for M-Pesa confirmation. Do not close this page yet.</p>
         )}
         {showRetryButton && (
            <Button
            onClick={onInitiatePayment} // Retry uses the same logic
            disabled={isLoading || !ticketId || !amount || !currentPhone || (currentPhone && !/^\d{10,12}$/.test(currentPhone)) || (currentEmail && !/\S+@\S+\.\S+/.test(currentEmail))}
            variant="outline"
            className="w-full text-lg py-3 sm:py-4 mt-2 border-primary text-primary hover:bg-primary/10 rounded-md shadow-sm"
            aria-label="Retry Payment Initiation"
          >
            Retry Payment Initiation
          </Button>
         )}
      </CardFooter>
    </Card>
  );
};
