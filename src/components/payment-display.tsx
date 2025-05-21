
"use client";

import type { FC } from 'react';
import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, CheckCircle2, XCircle, Ticket, CreditCard, Phone, Mail } from 'lucide-react';
import { handlePaymentConfirmation, type PaymentConfirmationResult } from '@/app/actions';
import { useToast } from "@/hooks/use-toast";

interface PaymentDisplayProps {
  ticketId?: string;
  amount?: string;
  phone?: string;
  email?: string;
}

export const PaymentDisplay: FC<PaymentDisplayProps> = ({ ticketId, amount, phone: initialPhone, email: initialEmail }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [paymentResult, setPaymentResult] = useState<PaymentConfirmationResult | null>(null);
  const [showMissingParamsError, setShowMissingParamsError] = useState(false);
  
  const [currentPhone, setCurrentPhone] = useState(initialPhone || '');
  const [currentEmail, setCurrentEmail] = useState(initialEmail || '');

  const { toast } = useToast();

  useEffect(() => {
    if (!ticketId || !amount) {
      setShowMissingParamsError(true);
      setPaymentResult({ success: false, message: "Ticket ID and Amount are required parameters." });
    } else {
      setShowMissingParamsError(false);
      // Reset payment result if params change and are valid, allowing for a new attempt
      setPaymentResult(null); 
    }
  }, [ticketId, amount]);

  useEffect(() => {
    setCurrentPhone(initialPhone || '');
  }, [initialPhone]);

  useEffect(() => {
    setCurrentEmail(initialEmail || '');
  }, [initialEmail]);


  const onConfirmPayment = async () => {
    if (!ticketId || !amount) {
      toast({
        title: "Error",
        description: "Ticket ID and Amount are required to proceed.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    setPaymentResult(null);

    const paymentParams: {
      ticketId: string;
      amount: string;
      phone?: string;
      email?: string;
    } = { ticketId, amount };

    if (currentPhone) {
      paymentParams.phone = currentPhone;
    }
    if (currentEmail) {
      paymentParams.email = currentEmail;
    }

    const result = await handlePaymentConfirmation(paymentParams);
    setIsLoading(false);
    setPaymentResult(result);

    if (result.success) {
      toast({
        title: "Payment Confirmed",
        description: result.message,
      });
    } else {
      toast({
        title: "Payment Failed",
        description: result.message || "An unknown error occurred.",
        variant: "destructive",
      });
    }
  };
  
  const renderPaymentStatus = () => {
    if (isLoading) {
      return (
        <div className="flex items-center justify-center space-x-2 text-primary">
          <Loader2 className="h-8 w-8 animate-spin" />
          <span className="text-lg font-medium">Processing Payment...</span>
        </div>
      );
    }
    if (paymentResult?.success === true) {
      return (
        <div className="flex flex-col items-center justify-center space-y-2 text-green-500">
          <CheckCircle2 className="h-12 w-12" />
          <span className="text-xl font-semibold">Payment Confirmed!</span>
          {paymentResult.transactionId && <p className="text-sm text-muted-foreground">Transaction ID: {paymentResult.transactionId}</p>}
        </div>
      );
    }
    if (paymentResult?.success === false && !showMissingParamsError) {
       return (
        <div className="flex flex-col items-center justify-center space-y-2 text-destructive">
          <XCircle className="h-12 w-12" />
          <span className="text-xl font-semibold">Payment Failed</span>
          {paymentResult.message && <p className="text-sm">{paymentResult.message}</p>}
        </div>
      );
    }
    return null;
  };

  const canEditContactInfo = !paymentResult?.success && !showMissingParamsError;

  return (
    <Card className="w-full max-w-md shadow-2xl">
      <CardHeader>
        <CardTitle className="text-3xl font-bold text-center text-primary">Payment Details</CardTitle>
        <CardDescription className="text-center">
          Please review your payment information below.
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
            <div className="flex items-center justify-between p-3 bg-background/50 rounded-md border">
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

            <div className="flex items-center justify-between p-3 bg-background/50 rounded-md border">
              <div className="flex items-center space-x-3">
                <CreditCard className="h-5 w-5 text-primary" />
                <Label htmlFor="amount-display" className="text-base font-medium text-foreground/80">
                  Amount:
                </Label>
              </div>
              <span id="amount-display" className="text-base font-semibold text-foreground">
                {amount ? `$${parseFloat(amount).toFixed(2)}` : 'N/A'}
              </span>
            </div>

            {/* Phone Number */}
            <div className="space-y-2">
              <div className="flex items-center space-x-3">
                <Phone className="h-5 w-5 text-primary" />
                <Label htmlFor="phone-input" className="text-base font-medium text-foreground/80">
                  Phone (Optional):
                </Label>
              </div>
              {canEditContactInfo && !initialPhone ? (
                <Input
                  id="phone-input"
                  type="tel"
                  placeholder="Enter your phone number"
                  value={currentPhone}
                  onChange={(e) => setCurrentPhone(e.target.value)}
                  className="text-base"
                  disabled={isLoading || paymentResult?.success}
                />
              ) : (
                <p className="text-base text-foreground pl-8">{currentPhone || 'Not provided'}</p>
              )}
            </div>

            {/* Email Address */}
            <div className="space-y-2">
              <div className="flex items-center space-x-3">
                <Mail className="h-5 w-5 text-primary" />
                <Label htmlFor="email-input" className="text-base font-medium text-foreground/80">
                  Email (Optional):
                </Label>
              </div>
              {canEditContactInfo && !initialEmail ? (
                <Input
                  id="email-input"
                  type="email"
                  placeholder="Enter your email address"
                  value={currentEmail}
                  onChange={(e) => setCurrentEmail(e.target.value)}
                  className="text-base"
                  disabled={isLoading || paymentResult?.success}
                />
              ) : (
                <p className="text-base text-foreground pl-8">{currentEmail || 'Not provided'}</p>
              )}
            </div>
          </>
        )}
        
        <div className="mt-6 min-h-[60px]">
          {renderPaymentStatus()}
        </div>

      </CardContent>
      <CardFooter className="flex flex-col items-center pt-4">
        {!paymentResult?.success && !showMissingParamsError && (
          <Button
            onClick={onConfirmPayment}
            disabled={isLoading || !ticketId || !amount}
            className="w-full text-lg py-6 bg-primary hover:bg-accent transition-all duration-300 ease-in-out transform hover:scale-105"
            aria-label="Confirm Payment"
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Processing...
              </>
            ) : (
              'Confirm Payment'
            )}
          </Button>
        )}
         {paymentResult?.success && (
           <p className="text-sm text-muted-foreground mt-4">Thank you for your payment!</p>
         )}
         {paymentResult?.success === false && !showMissingParamsError && (
            <Button
            onClick={onConfirmPayment} // Retry uses the same logic
            disabled={isLoading || !ticketId || !amount}
            variant="outline"
            className="w-full text-lg py-6 mt-2 border-primary text-primary hover:bg-primary/10"
            aria-label="Retry Payment"
          >
            Retry Payment
          </Button>
         )}
      </CardFooter>
    </Card>
  );
};
