
"use client";

import type { FC } from 'react';
import { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, CheckCircle2, XCircle, Info, Ticket, CreditCard, Phone, Mail, ExternalLink, AlertTriangle, RefreshCw, Search, Copy, Check, Send, MailWarning } from 'lucide-react';
import {
  handlePaymentInitiation, type PaymentInitiationResult,
  checkTransactionStatus, type TransactionStatusResult,
  processAndSendTicketEmail, type ProcessEmailResult,
  resendTicketEmailAction
} from '@/app/actions';
import { useToast } from "@/hooks/use-toast";
import { db } from '@/lib/firebase';
import { doc, onSnapshot, getDoc, DocumentData } from 'firebase/firestore';

const MANUAL_ACTIONS_DELAY = 20000; // 20 seconds
const MPESA_GREEN = "#00A651";

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
  const [isResendingEmail, setIsResendingEmail] = useState(false);
  const [manualStatusMessage, setManualStatusMessage] = useState<string | null>(null);
  const [umeskiaTransactionRequestIdForStatusCheck, setUmeskiaTransactionRequestIdForStatusCheck] = useState<string | undefined>(undefined);

  const [ticketCopied, setTicketCopied] = useState(false);
  const [ticketDataFromDb, setTicketDataFromDb] = useState<DocumentData | null>(null);
  const [isProcessingEmail, setIsProcessingEmail] = useState(false);


  const { toast } = useToast();

  const handleCopyTicketId = () => {
    if (ticketId) {
      navigator.clipboard.writeText(ticketId).then(() => {
        setTicketCopied(true);
        toast({ title: "Copied!", description: "Ticket ID copied to clipboard.", className: "bg-green-600 border-green-700 text-white dark:bg-green-700 dark:border-green-800" });
        setTimeout(() => setTicketCopied(false), 2000);
      }).catch(err => {
        toast({ title: "Copy Error", description: "Could not copy Ticket ID.", variant: "destructive" });
      });
    }
  };

  const resetManualActionsState = useCallback(() => {
    if (manualActionsTimerRef.current) {
      clearTimeout(manualActionsTimerRef.current);
      manualActionsTimerRef.current = null;
    }
    setShowManualActions(false);
    setManualStatusMessage(null);
    setIsCheckingStatus(false);
  }, []);

  const performRedirect = useCallback(async (confirmedTicketDocId: string, eventIdForRedirect?: string) => {
    let urlToOpen = `https://rnr-tickets-hub.vercel.app/ticket-status?ticketId=${confirmedTicketDocId}`;
    let message = `Payment Confirmed for ticket ${confirmedTicketDocId}!`;

    if (eventIdForRedirect) {
      urlToOpen = `https://rnr-tickets-hub.vercel.app/ticket-status?eventId=${eventIdForRedirect}`;
      message = `Payment Confirmed! Redirecting to status for event ${eventIdForRedirect}...`;
    } else {
       message = `Payment Confirmed for ticket ${confirmedTicketDocId}! Redirecting to ticket status...`;
    }
    setRedirectMessage(message);

    if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current);
    redirectTimerRef.current = setTimeout(() => {
        window.open(urlToOpen, '_blank');
    }, 3000);
  }, [setRedirectMessage]);

  const triggerEmailSendIfNeeded = useCallback(async (currentTicketId: string, currentTicketData: DocumentData) => {
    if (currentTicketData.status === 'confirmed' &&
        currentTicketData.email &&
        !currentTicketData.emailSent && // Client-side check
        !isProcessingEmail) {

      setIsProcessingEmail(true);
      const emailResult: ProcessEmailResult = await processAndSendTicketEmail(currentTicketId);

      // processAndSendTicketEmail returns success:true if email was sent OR if it was already sent (checked on server)
      if (emailResult.attempted && emailResult.success) {
        toast({ title: "Email Sent!", description: "Your ticket has been sent to your email address.", className: "bg-green-600 dark:bg-green-700 text-white border-green-700 dark:border-green-800" });
      } else if (emailResult.attempted && !emailResult.success) { // Explicitly an error occurred during sending
        toast({ title: "Email Issue", description: emailResult.message, variant: "destructive", duration: 7000 });
      }
      // If not attempted (e.g., server determined no email on file or ticket not confirmed again), no new toast here.
      setIsProcessingEmail(false);
    }
  }, [toast, isProcessingEmail]);


  useEffect(() => {
    if (!ticketId || !amount) {
      setShowMissingParamsError(true);
      setPaymentInitiationResult({ success: false, message: "Ticket ID and Amount are required parameters." });
      return;
    }
    setShowMissingParamsError(false);
    setPaymentInitiationResult(null);

    const ticketDocRef = doc(db, 'tickets', ticketId);

    const initialFetchAndEmail = async () => {
        try {
            const docSnap = await getDoc(ticketDocRef);
            if (docSnap.exists()) {
                const data = docSnap.data();
                setTicketDataFromDb(data);
                if (data.status === 'confirmed') {
                    setIsPaymentReallyConfirmed(true); // Set this early if already confirmed
                    // Only redirect on initial load if not already handled by listener during session
                    if (!redirectMessage) { 
                        performRedirect(docSnap.id, data.eventId);
                    }
                }
                // Attempt to send email on initial load if confirmed and not sent
                await triggerEmailSendIfNeeded(docSnap.id, data);
            } else {
                toast({ title: "Error", description: `Ticket ${ticketId} not found.`, variant: "destructive" });
                setShowMissingParamsError(true);
            }
        } catch (error) {
            console.error("Error fetching initial ticket status:", error);
            toast({ title: "Error", description: "Could not fetch initial ticket data.", variant: "destructive" });
        }
    };
    initialFetchAndEmail();


    const unsubscribe = onSnapshot(ticketDocRef, async (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setTicketDataFromDb(data);

        if (data.status === 'confirmed' && !isPaymentReallyConfirmed) {
          setIsPaymentReallyConfirmed(true);
          resetManualActionsState();
          toast({
            title: "Payment Confirmed!",
            description: `Your payment for ticket ${docSnap.id} has been successfully processed.`,
            className: "bg-green-600 dark:bg-green-700 text-white border-green-700 dark:border-green-800",
            duration: 5000,
          });
          // Perform redirect only if not already in a redirecting state from initial load
          if (!redirectMessage) {
             await performRedirect(docSnap.id, data.eventId);
          }
        }
        // Always try to trigger email if status is confirmed and other conditions met
        await triggerEmailSendIfNeeded(docSnap.id, data);

      } else {
        console.warn(`Ticket ${ticketId} no longer exists.`);
        setIsPaymentReallyConfirmed(false);
        setTicketDataFromDb(null);
      }
    }, (error) => {
      console.error("Error listening to ticket status:", error);
      toast({ title: "Listener Error", description: "Real-time payment updates may be affected.", variant: "destructive" });
    });

    return () => {
      unsubscribe();
      if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current);
      if (manualActionsTimerRef.current) clearTimeout(manualActionsTimerRef.current);
    };
  }, [ticketId, amount, toast, isPaymentReallyConfirmed, resetManualActionsState, performRedirect, triggerEmailSendIfNeeded, redirectMessage]);


  useEffect(() => {
    setCurrentPhone(initialPhone || '');
  }, [initialPhone]);

  useEffect(() => {
    setCurrentEmail(initialEmail || '');
  }, [initialEmail]);

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
        toast({ title: "Invalid Phone Format", description: "Use 07xx.., 01xx.., 2547xx.. or 2541xx..", variant: "destructive" });
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
    setManualStatusMessage(result.message || "Status check complete."); // Display result message from check

    // The onSnapshot listener will handle UI updates for payment confirmation and initial email sending.
    // We only show a general toast here if the status is still pending from this check.
    if (result.success && !result.isConfirmed) {
       toast({ title: "Transaction Update", description: result.message, variant: "default"});
    } else if (!result.success) {
       toast({ title: "Status Check Info", description: result.message, variant: "default"});
    }
    // If result.isConfirmed is true, onSnapshot will take over for confirmation UI and email toast.
  };

  const handleResendEmail = async () => {
    if (!ticketId) {
      toast({ title: "Error", description: "Ticket ID not available.", variant: "destructive"});
      return;
    }
    setIsResendingEmail(true);
    const result = await resendTicketEmailAction(ticketId);
    setIsResendingEmail(false);

    if (result.success) {
      toast({ title: "Email Resent!", description: "Your ticket has been resent.", className: "bg-green-600 dark:bg-green-700 text-white border-green-700 dark:border-green-800" });
    } else {
      toast({ title: "Resend Failed", description: result.message, variant: "destructive" });
    }
  };

  const renderPaymentStatus = () => {
    if (isPaymentReallyConfirmed && redirectMessage) {
      return (
        <div className="flex flex-col items-center justify-center space-y-3 text-center">
          <CheckCircle2 className="h-12 w-12 mx-auto text-green-500" />
          <p className="text-lg font-semibold text-foreground">{redirectMessage}</p>
          <div className="flex flex-col sm:flex-row gap-2 mt-2">
            <Button
              variant="outline"
              className="border-primary hover:bg-primary/10"
              onClick={async () => {
                  if (ticketId) {
                    const currentTicketSnap = await getDoc(doc(db, 'tickets', ticketId));
                    if (currentTicketSnap.exists()) {
                      await performRedirect(ticketId, currentTicketSnap.data()?.eventId);
                    } else {
                      await performRedirect(ticketId);
                    }
                  }
              }}
            >
              Go to Ticket Status Now <ExternalLink className="ml-1 h-4 w-4"/>
            </Button>
             {ticketDataFromDb?.email && (
                <Button onClick={handleResendEmail} disabled={isResendingEmail} variant="secondary">
                    {isResendingEmail ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                    Resend Ticket Email
                </Button>
            )}
          </div>
        </div>
      );
    }

    if (isLoading) {
      return (
        <div className="flex flex-col items-center justify-center space-y-2 text-center">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <span className="text-lg font-medium text-muted-foreground">Initiating M-Pesa Payment...</span>
        </div>
      );
    }

    if (paymentInitiationResult?.success === true) {
      return (
        <div className="flex flex-col items-center justify-center space-y-4 p-4 text-center">
            <div className="flex items-center space-x-2 text-blue-500">
              <Info className="h-10 w-10" />
              <span className="text-xl font-semibold">STK Push Sent!</span>
            </div>
          <p className="text-base text-muted-foreground">{paymentInitiationResult.message || "Please check your M-Pesa phone to enter your PIN."}</p>
          <div className="mt-3 p-3 bg-yellow-100 dark:bg-yellow-900/30 border border-yellow-500 dark:border-yellow-700 rounded-md text-yellow-700 dark:text-yellow-400 w-full">
            <div className="flex items-center space-x-2">
                <AlertTriangle className="h-5 w-5 flex-shrink-0"/>
                <span className="font-medium text-sm">Important: Do not close or refresh this page.</span>
            </div>
            <p className="text-xs mt-1">We are waiting for M-Pesa to confirm your transaction. This page will update automatically.</p>
          </div>
          {showManualActions && (
            <div className="mt-6 space-y-3 w-full max-w-xs mx-auto">
              <p className="text-sm text-muted-foreground">If you've completed on your phone but the page hasn't updated, you can:</p>
              <Button onClick={handleCheckStatus} disabled={isCheckingStatus || isLoading} className="w-full bg-secondary hover:bg-secondary/80 text-secondary-foreground">
                {isCheckingStatus ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                Check Transaction Status
              </Button>
              <Button onClick={onInitiatePayment} disabled={isLoading || isCheckingStatus} className="w-full" variant="outline">
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
        <div className="flex flex-col items-center justify-center space-y-3 text-destructive p-4 border border-destructive rounded-md bg-red-50 dark:bg-red-900/30 shadow-md text-center">
          <XCircle className="h-12 w-12 mx-auto" />
          <span className="text-xl font-semibold">Initiation Failed</span>
          {paymentInitiationResult.message && <p className="text-base">{paymentInitiationResult.message}</p>}
        </div>
      );
    }
    return null;
  };

  const canDisableInputs = isLoading || paymentInitiationResult?.success === true || isPaymentReallyConfirmed || isCheckingStatus;
  const showInitialPaymentButton = !paymentInitiationResult && !showMissingParamsError && !isPaymentReallyConfirmed;
  const showRetryButtonAfterFail = paymentInitiationResult?.success === false && !showMissingParamsError && !isPaymentReallyConfirmed;


  return (
    <Card className="w-full max-w-lg shadow-2xl bg-card text-card-foreground rounded-xl border-border">
      <CardHeader className="pb-4 pt-6">
        <CardTitle className="text-3xl sm:text-4xl font-bold text-center text-foreground">M-Pesa Payment</CardTitle>
        {!isPaymentReallyConfirmed && (
            <CardDescription className="text-center text-muted-foreground pt-1 text-sm sm:text-base">
            Review details and confirm to initiate STK push.
            </CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-6 px-4 sm:px-6 py-6">
        {showMissingParamsError && (
          <Alert variant="destructive" className="mb-4">
            <XCircle className="h-5 w-5" />
            <AlertTitle className="font-semibold">Missing Information</AlertTitle>
            <AlertDescription>
              Ticket ID and Amount are required. Please check the URL or contact support if this persists.
            </AlertDescription>
          </Alert>
        )}

        {!showMissingParamsError && !isPaymentReallyConfirmed && (
          <>
            <div className="space-y-2 p-3 bg-secondary/30 dark:bg-secondary/50 rounded-lg border border-border/50">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Ticket className="h-5 w-5 text-primary" />
                  <Label htmlFor="ticket-id-display" className="text-sm font-medium text-foreground/80">
                    Ticket ID:
                  </Label>
                </div>
                 <Button variant="ghost" size="sm" onClick={handleCopyTicketId} className="p-1 h-auto text-muted-foreground hover:text-primary">
                  {ticketCopied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <span id="ticket-id-display" className="block text-base sm:text-lg font-mono text-foreground break-all">
                {ticketId}
              </span>
            </div>

            <div className="space-y-1 p-3 bg-secondary/30 dark:bg-secondary/50 rounded-lg border border-border/50">
              <div className="flex items-center space-x-2">
                <CreditCard className="h-5 w-5 text-primary" />
                <Label htmlFor="amount-display" className="text-sm font-medium text-foreground/80">
                  Amount (KES):
                </Label>
              </div>
              <span id="amount-display" className="block text-2xl sm:text-3xl font-bold text-foreground">
                {amount ? `${parseFloat(amount).toFixed(2)}` : 'N/A'}
              </span>
            </div>

            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <Phone className="h-5 w-5 text-primary" />
                <Label htmlFor="phone-input" className="text-sm font-medium text-foreground/80">
                  M-Pesa Phone <span className="text-destructive">*</span>
                </Label>
              </div>
              <Input
                id="phone-input"
                type="tel"
                placeholder="e.g. 0712345678 or 254712345678"
                value={currentPhone}
                onChange={(e) => setCurrentPhone(e.target.value.replace(/\s+/g, ''))}
                className="text-base py-2.5 bg-input border-input focus:border-primary placeholder:text-muted-foreground/70"
                disabled={canDisableInputs}
                required
                aria-required="true"
              />
               {currentPhone && !/^(0[17]\d{8}|254[17]\d{8})$/.test(currentPhone) && !isPaymentReallyConfirmed &&(
                 <p className="text-xs text-destructive pl-1 pt-1">Use a valid M-Pesa phone format (07.. or 2547..).</p>
               )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <Mail className="h-5 w-5 text-primary" />
                <Label htmlFor="email-input" className="text-sm font-medium text-foreground/80">
                  Email (For Receipt & Ticket)
                </Label>
              </div>
              <Input
                id="email-input"
                type="email"
                placeholder="your.email@example.com (Optional but recommended)"
                value={currentEmail}
                onChange={(e) => setCurrentEmail(e.target.value)}
                className="text-base py-2.5 bg-input border-input focus:border-primary placeholder:text-muted-foreground/70"
                disabled={canDisableInputs}
              />
               {currentEmail && !/\S+@\S+\.\S+/.test(currentEmail) && !isPaymentReallyConfirmed &&(
                 <p className="text-xs text-destructive pl-1 pt-1">Enter a valid email address.</p>
               )}
              {currentEmail && (
                <p className="text-xs text-muted-foreground flex items-center gap-1 pl-1 pt-1">
                  <MailWarning className="h-3 w-3 text-yellow-500" />
                  If you don't receive your ticket, please check your spam/junk folder.
                </p>
              )}
            </div>
          </>
        )}

        <div className="mt-6 min-h-[100px] flex items-center justify-center">
          {renderPaymentStatus()}
        </div>

      </CardContent>
      {!isPaymentReallyConfirmed && (
        <CardFooter className="flex flex-col items-center pt-2 pb-6 px-4 sm:px-6">
          {showInitialPaymentButton && (
            <Button
              onClick={onInitiatePayment}
              disabled={isLoading || !ticketId || !amount || !currentPhone || (currentPhone && !/^(0[17]\d{8}|254[17]\d{8})$/.test(currentPhone)) || (currentEmail && !/\S+@\S+\.\S+/.test(currentEmail)) || isPaymentReallyConfirmed }
              className="w-full text-lg py-3 sm:py-4 text-white hover:opacity-90 transition-all duration-300 ease-in-out transform hover:scale-105 rounded-lg shadow-md"
              style={{ backgroundColor: MPESA_GREEN }}
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
              disabled={isLoading || !ticketId || !amount || !currentPhone || (currentPhone && !/^(0[17]\d{8}|254[17]\d{8})$/.test(currentPhone)) || (currentEmail && !/\S+@\S+\.\S+/.test(currentEmail)) || isPaymentReallyConfirmed}
              style={{ backgroundColor: MPESA_GREEN }}
              className="w-full text-lg py-3 sm:py-4 mt-2 text-white hover:opacity-90 rounded-lg shadow-sm"
              aria-label="Retry Payment Initiation"
            >
              <RefreshCw className="mr-2 h-4 w-4" /> Retry Payment Initiation
            </Button>
          )}
        </CardFooter>
      )}
       {isPaymentReallyConfirmed && !redirectMessage && ticketDataFromDb?.email && (
        <CardFooter className="flex flex-col items-center pt-2 pb-6 px-4 sm:px-6">
          <Button onClick={handleResendEmail} disabled={isResendingEmail} variant="outline" className="w-full max-w-xs">
            {isResendingEmail ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            Resend Ticket Email
          </Button>
           <p className="text-xs text-muted-foreground mt-2 text-center">
                Ticket email already sent to {ticketDataFromDb.email}. Check spam/junk if not found.
            </p>
        </CardFooter>
      )}
    </Card>
  );
};
