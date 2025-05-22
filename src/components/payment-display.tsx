
"use client";

import type { FC } from 'react';
import { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, CheckCircle2, XCircle, Info, Ticket, CreditCard, Phone, Mail, ExternalLink, AlertTriangle, RefreshCw, Search } from 'lucide-react';
import { handlePaymentInitiation, type PaymentInitiationResult, checkTransactionStatus, type TransactionStatusResult } from '@/app/actions';
import { useToast } from "@/hooks/use-toast";
import { db } from '@/lib/firebase';
import { doc, onSnapshot, getDoc, DocumentData } from 'firebase/firestore';

const MANUAL_ACTIONS_DELAY = 20000; // 20 seconds

interface PaymentDisplayProps {
  ticketId?: string;
  amount?: string;
  phone?: string;
  email?: string;
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
  const manualActionsTimerRef = useRef<NodeJS.Timeout | null>(null);

  const [showManualActions, setShowManualActions] = useState(false);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [manualStatusMessage, setManualStatusMessage] = useState<string | null>(null);
  const [umeskiaTransactionRequestIdForStatusCheck, setUmeskiaTransactionRequestIdForStatusCheck] = useState<string | undefined>(undefined);


  const { toast } = useToast();

  const resetManualActionsState = useCallback(() => {
    if (manualActionsTimerRef.current) {
      clearTimeout(manualActionsTimerRef.current);
      manualActionsTimerRef.current = null;
    }
    setShowManualActions(false);
    setManualStatusMessage(null);
    setIsCheckingStatus(false);
  }, []);

  useEffect(() => {
    if (!ticketId || !amount) {
      setShowMissingParamsError(true);
      setPaymentInitiationResult({ success: false, message: "Ticket ID and Amount are required parameters." });
      return; 
    }
    
    setShowMissingParamsError(false);
    setPaymentInitiationResult(null); 
    
    const checkInitialStatus = async () => {
      if (!ticketId) return; 
      const ticketDocRef = doc(db, 'tickets', ticketId);
      try {
        const docSnap = await getDoc(ticketDocRef);
        if (docSnap.exists() && docSnap.data().status === 'confirmed') {
          const ticketData = docSnap.data();
          setIsPaymentReallyConfirmed(true);
          const eventIdForRedirect = ticketData.eventId;
          if (eventIdForRedirect) {
             setRedirectMessage(`Payment Previously Confirmed. Redirecting to event status for ${eventIdForRedirect}...`);
          } else {
             setRedirectMessage(`Payment Previously Confirmed for ticket ${docSnap.id}. Event ID missing for redirect.`);
          }
        }
      } catch (error) {
        console.error("Error checking initial ticket status:", error);
        toast({
          title: "Error",
          description: "Could not check initial ticket status. Please try refreshing.",
          variant: "destructive",
        });
      }
    };
    checkInitialStatus();
  }, [ticketId, amount, toast]);

  useEffect(() => {
    setCurrentPhone(initialPhone || '');
  }, [initialPhone]);

  useEffect(() => {
    setCurrentEmail(initialEmail || '');
  }, [initialEmail]);

  useEffect(() => {
    if (!ticketId) return;
    if (isPaymentReallyConfirmed) return; 

    const ticketDocRef = doc(db, 'tickets', ticketId);
    const unsubscribe = onSnapshot(ticketDocRef, (docSnap) => {
      if (docSnap.exists()) {
        const ticketData = docSnap.data();
        if (ticketData.status === 'confirmed' && !isPaymentReallyConfirmed) { 
          setIsPaymentReallyConfirmed(true);
          resetManualActionsState();
          
          const eventIdForRedirect = ticketData.eventId;
          let confirmationMessage = `Payment Confirmed for ticket ${docSnap.id}!`;
          if (eventIdForRedirect) {
            confirmationMessage = `Payment Confirmed! Redirecting to status for event ${eventIdForRedirect}...`;
          } else {
            confirmationMessage = `Payment Confirmed for ticket ${docSnap.id}! Event ID for redirect not found.`;
             console.warn(`eventId field not found in ticket document ${docSnap.id} for redirect.`);
          }
          setRedirectMessage(confirmationMessage);

          toast({
            title: "Payment Confirmed!",
            description: `Your payment for ticket ${docSnap.id} has been successfully processed.`,
            className: "bg-green-600 dark:bg-green-700 text-white border-green-700 dark:border-green-800",
            duration: 5000,
          });

          if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current);
          
          if (eventIdForRedirect) {
            redirectTimerRef.current = setTimeout(() => {
              window.location.href = `https://rnr-tickets-hub.vercel.app/ticket-status?eventId=${eventIdForRedirect}`;
            }, 3000);
          } else {
            // Fallback or alternative action if eventId is not present
            // For now, we'll just show the message and not redirect if eventId is missing.
            console.warn(`No eventId found for ticket ${docSnap.id}, redirect will not occur automatically.`);
          }
        }
      }
    }, (error) => {
      console.error("Error listening to ticket status:", error);
      toast({
        title: "Listener Error",
        description: "Could not listen for real-time payment updates. Please try checking status manually or refresh.",
        variant: "destructive",
      })
    });

    return () => {
      unsubscribe();
      if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current);
      if (manualActionsTimerRef.current) clearTimeout(manualActionsTimerRef.current);
    };
  }, [ticketId, toast, isPaymentReallyConfirmed, resetManualActionsState]);


  const onInitiatePayment = async () => {
    if (!ticketId || !amount) {
      toast({ title: "Error", description: "Ticket ID and Amount are required.", variant: "destructive" });
      return;
    }
    if (!currentPhone) {
      toast({ title: "Phone Number Required", description: "Please enter your M-Pesa phone number.", variant: "destructive" });
      return;
    }
    if (!/^(0[17]\d{8}|254[17]\d{8})$/.test(currentPhone.replace(/\s+/g, ''))) {
        toast({ title: "Invalid Phone Format", description: "Use 07XXXXXXXX, 01XXXXXXXX, 2547XXXXXXXX or 2541XXXXXXXX.", variant: "destructive" });
        return;
    }
    if (currentEmail && !/\S+@\S+\.\S+/.test(currentEmail)) {
        toast({ title: "Invalid Email Format", description: "Please enter a valid email address.", variant: "destructive" });
        return;
    }

    setIsLoading(true);
    setPaymentInitiationResult(null);
    resetManualActionsState(); 
    setUmeskiaTransactionRequestIdForStatusCheck(undefined);


    const paymentParams = { ticketId, amount, phone: currentPhone, email: currentEmail || undefined };
    const result = await handlePaymentInitiation(paymentParams);
    
    setIsLoading(false);
    setPaymentInitiationResult(result);

    if (result.success && result.umeskiaTransactionRequestId) {
      setUmeskiaTransactionRequestIdForStatusCheck(result.umeskiaTransactionRequestId);
      toast({
        title: "STK Push Sent!",
        description: result.message || "Please check your phone to complete the payment.",
        className: "bg-blue-600 dark:bg-blue-700 text-white border-blue-700 dark:border-blue-800",
      });
      
      if (manualActionsTimerRef.current) clearTimeout(manualActionsTimerRef.current);
      manualActionsTimerRef.current = setTimeout(() => {
        if (!isPaymentReallyConfirmed) { 
            setShowManualActions(true);
        }
      }, MANUAL_ACTIONS_DELAY);
    } else {
      toast({
        title: "Payment Initiation Failed",
        description: result.message || "Could not start M-Pesa payment. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleCheckStatus = async () => {
    if (!umeskiaTransactionRequestIdForStatusCheck || !ticketId) {
      setManualStatusMessage("Missing transaction ID or Ticket ID to check status.");
      toast({ title: "Error", description: "Cannot check status: Missing required IDs.", variant: "destructive" });
      return;
    }
    setIsCheckingStatus(true);
    setManualStatusMessage("Checking transaction status...");

    const result: TransactionStatusResult = await checkTransactionStatus({
      umeskiaTransactionRequestId: umeskiaTransactionRequestIdForStatusCheck,
      ticketId: ticketId,
    });
    
    setIsCheckingStatus(false);
    if (result.success && result.isConfirmed) {
      // Firestore onSnapshot will handle the UI update to confirmed state and redirect
    } else {
      setManualStatusMessage(result.message || "Could not retrieve status or payment not confirmed.");
      if (result.success && !result.isConfirmed) { 
         toast({ title: "Transaction Update", description: result.message, variant: "default"});
      } else if (!result.success) { 
         toast({ title: "Status Check Error", description: result.message, variant: "destructive"});
      }
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
            onClick={async () => {
                if (ticketId) {
                  const ticketDocRef = doc(db, 'tickets', ticketId);
                  try {
                    const docSnap = await getDoc(ticketDocRef);
                    if (docSnap.exists()) {
                      const eventId = docSnap.data()?.eventId;
                      if (eventId) {
                        window.location.href = `https://rnr-tickets-hub.vercel.app/ticket-status?eventId=${eventId}`;
                      } else {
                        window.location.href = `https://rnr-tickets-hub.vercel.app/ticket-status?ticketId=${ticketId}`; // Fallback to ticketId
                        console.warn(`EventID not found for ticket ${ticketId}, redirecting with ticketId.`);
                      }
                    } else {
                       console.error(`Ticket ${ticketId} not found for manual redirect.`);
                       toast({title: "Error", description: "Ticket details not found for redirect.", variant: "destructive"});
                    }
                  } catch (e) {
                    console.error("Error fetching eventId for manual redirect:", e);
                    toast({title: "Error", description: "Could not fetch details for redirect.", variant: "destructive"});
                  }
                }
            }}
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

    if (paymentInitiationResult?.success === true) { 
      return (
        <div className="flex flex-col items-center justify-center space-y-3 p-4">
            <div className="flex items-center space-x-2 text-blue-600 dark:text-blue-400">
              <Info className="h-10 w-10" />
              <span className="text-lg font-semibold text-center">STK Push Sent Successfully!</span>
            </div>
          <p className="text-sm text-muted-foreground text-center px-2">{paymentInitiationResult.message || "Please check your M-Pesa phone to enter your PIN."}</p>
          <div className="mt-3 p-3 bg-yellow-100 dark:bg-yellow-900/30 border border-yellow-400 dark:border-yellow-700 rounded-md text-yellow-700 dark:text-yellow-300">
            <div className="flex items-center space-x-2">
                <AlertTriangle className="h-5 w-5"/>
                <span className="font-medium text-sm">Important: Do not close or refresh this page.</span>
            </div>
            <p className="text-xs mt-1">We are waiting for M-Pesa to confirm your transaction. This page will update automatically.</p>
          </div>
          {showManualActions && (
            <div className="mt-4 space-y-3 w-full">
              <p className="text-xs text-muted-foreground text-center">If you've completed on your phone but the page hasn't updated, you can:</p>
              <Button onClick={handleCheckStatus} disabled={isCheckingStatus || isLoading} className="w-full" variant="outline">
                {isCheckingStatus ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                Check Transaction Status
              </Button>
              <Button onClick={onInitiatePayment} disabled={isLoading || isCheckingStatus} className="w-full" variant="secondary">
                <RefreshCw className="mr-2 h-4 w-4" />
                Retry STK Push
              </Button>
              {manualStatusMessage && <p className="text-xs text-center mt-2 p-2 bg-muted rounded-md">{manualStatusMessage}</p>}
            </div>
          )}
        </div>
      );
    }

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

  const canDisableInputs = isLoading || paymentInitiationResult?.success === true || isPaymentReallyConfirmed || isCheckingStatus;
  const showInitialPaymentButton = !paymentInitiationResult && !showMissingParamsError && !isPaymentReallyConfirmed;
  const showRetryButtonAfterFail = paymentInitiationResult?.success === false && !showMissingParamsError && !isPaymentReallyConfirmed;


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
                  M-Pesa Phone: <span className="text-destructive">*</span>
                </Label>
              </div>
              <Input
                id="phone-input"
                type="tel"
                placeholder="e.g., 07XX XXX XXX or 2547XX XXX XXX"
                value={currentPhone}
                onChange={(e) => setCurrentPhone(e.target.value)}
                className="text-base bg-input text-foreground placeholder:text-muted-foreground"
                disabled={canDisableInputs}
                required
              />
               {currentPhone && !/^(0[17]\d{8}|254[17]\d{8})$/.test(currentPhone.replace(/\s+/g, '')) && !isPaymentReallyConfirmed &&(
                 <p className="text-xs text-destructive pl-1">Use a valid M-Pesa phone format.</p>
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
                disabled={canDisableInputs}
              />
               {currentEmail && !/\S+@\S+\.\S+/.test(currentEmail) && !isPaymentReallyConfirmed &&(
                 <p className="text-xs text-destructive pl-1">Enter a valid email address.</p>
               )}
            </div>
          </>
        )}
        
        <div className="mt-6 min-h-[120px] flex items-center justify-center">
          {renderPaymentStatus()}
        </div>

      </CardContent>
      <CardFooter className="flex flex-col items-center pt-4">
        {showInitialPaymentButton && (
          <Button
            onClick={onInitiatePayment}
            disabled={isLoading || !ticketId || !amount || !currentPhone || (currentPhone && !/^(0[17]\d{8}|254[17]\d{8})$/.test(currentPhone.replace(/\s+/g, '')) ) || (currentEmail && !/\S+@\S+\.\S+/.test(currentEmail)) || isPaymentReallyConfirmed }
            className="w-full text-lg py-3 sm:py-4 bg-primary hover:bg-accent transition-all duration-300 ease-in-out transform hover:scale-105 rounded-md shadow-md"
            aria-label="Initiate M-Pesa Payment"
          >
            {isLoading ? (
              <> <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Processing... </>
            ) : ( 'Pay with M-Pesa' )}
          </Button>
        )}
         {showRetryButtonAfterFail && (
            <Button
            onClick={onInitiatePayment} 
            disabled={isLoading || !ticketId || !amount || !currentPhone || (currentPhone && !/^(0[17]\d{8}|254[17]\d{8})$/.test(currentPhone.replace(/\s+/g, '')) ) || (currentEmail && !/\S+@\S+\.\S+/.test(currentEmail)) || isPaymentReallyConfirmed}
            variant="outline"
            className="w-full text-lg py-3 sm:py-4 mt-2 border-primary text-primary hover:bg-primary/10 rounded-md shadow-sm"
            aria-label="Retry Payment Initiation"
          >
            <RefreshCw className="mr-2 h-4 w-4" /> Retry Payment Initiation
          </Button>
         )}
          {isPaymentReallyConfirmed && !redirectMessage && ( 
             <p className="text-sm text-green-600 dark:text-green-400 mt-4 text-center">
                Your payment is confirmed! Preparing your ticket information...
             </p>
         )}
      </CardFooter>
    </Card>
  );
};

