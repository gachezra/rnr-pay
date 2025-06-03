
'use server';

import formData from 'form-data';
import Mailgun from 'mailgun.js';
import dotenv from 'dotenv';
dotenv.config();

const MAILGUN_API_KEY = process.env.NEXT_PUBLIC_MAILGUN_API_KEY;
const MAILGUN_DOMAIN = process.env.NEXT_PUBLIC_MAILGUN_DOMAIN;
const MAILGUN_FROM_EMAIL = `RNR Pay <mailgun@${MAILGUN_DOMAIN}>`;
const MAILGUN_URL = process.env.NEXT_PUBLIC_MAILGUN_URL;

let mailgunClient: any; // Placeholder for Mailgun client

if (MAILGUN_API_KEY && MAILGUN_DOMAIN) {
  const mailgun = new Mailgun(formData); // formData is required for Node.js environment
  mailgunClient = mailgun.client({ username: 'api', key: MAILGUN_API_KEY , url: MAILGUN_URL});
  console.log("Mailgun client initialized.");
} else {
  console.warn(
    "Mailgun API Key or Domain not configured in environment variables (NEXT_PUBLIC_MAILGUN_API_KEY, NEXT_PUBLIC_MAILGUN_DOMAIN). " +
    "Email sending will be simulated. " +
    "Please set them up in your .env.local file."
  );
}

interface EmailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export async function sendEmail(options: EmailOptions): Promise<{success: boolean, message?: string}> {
  if (!mailgunClient) {
    console.log("[Simulated Email] Mailgun not initialized. Simulating email send:", options);
    await new Promise(resolve => setTimeout(resolve, 300)); // Simulate network delay
    return { success: true, message: "Email sent (simulated as Mailgun is not configured)." };
  }

  // Actual Mailgun sending logic
  try {
    const data = {
      from: MAILGUN_FROM_EMAIL,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html || options.text,
    };
    // Note: For Mailgun EU domains, you might need to specify the base URL:
    // const response = await mailgunClient.messages.create(MAILGUN_DOMAIN, data, {baseUrl: 'https://api.eu.mailgun.net'});
    const response = await mailgunClient.messages.create(MAILGUN_DOMAIN!, data);
    console.log("Email sent successfully via Mailgun:", response);
    return { success: true, message: "Email sent successfully." };
  } catch (error: any) {
    console.error("Error sending email via Mailgun:", error.message || error);
    return { success: false, message: `Failed to send email: ${error.message || 'Unknown Mailgun error'}` };
  }
}

export async function sendPaymentConfirmationEmail(
  toEmail: string,          // The email address to send the confirmation to
  ticketDocId: string,      // The document ID of the ticket from Firestore (e.g., "cMW3VQ1HaEfzOfgbnrXv")
  ticketIdField: string,    // The value of the 'id' field within the ticket document (e.g., "RNR-PXEG-P6030S")
  amount: string,
  mpesaTransactionId: string,
  phoneNumber: string | null,
  quantity: number | string | null,
  userProvidedEmailForReceipt: string | null // Email user entered on the payment page
): Promise<void> {
  if (!toEmail) {
    console.log("No recipient email address provided, skipping payment confirmation email.");
    return;
  }

  const subject = `RNR Pay: Payment Confirmed - Ticket ${ticketIdField}`;
  const textBody = `
Dear Customer,

Your payment has been successfully processed!

Ticket Details:
-----------------------------------
Ticket ID: ${ticketIdField}
Amount Paid: KES ${amount}
M-Pesa Transaction ID: ${mpesaTransactionId}
Phone Number: ${phoneNumber || 'N/A'}
Quantity: ${quantity || 'N/A'}
${userProvidedEmailForReceipt ? `Email for Receipt: ${userProvidedEmailForReceipt}` : ''}
-----------------------------------

Thank you for using RNR Pay.
You can view your ticket status here: https://rnr-tickets-hub.vercel.app/ticket-status?ticketId=${ticketDocId} 
(Note: if your ticket has an associated eventId, the page might redirect you further based on that)

Sincerely,
The RNR Solutions Team
`;

  const htmlBody = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>RNR Pay - Payment Confirmation</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 0; background-color: #f4f4f4; color: #333; }
        .container { max-width: 600px; margin: 20px auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 0 15px rgba(0,0,0,0.1); overflow: hidden; }
        .header { background-color: #202A44; /* Dark Blue/Navy */ padding: 20px; text-align: center; }
        .logo-svg { width: 60px; height: 60px; margin-bottom: 10px; }
        .header h1 { color: #ffffff; margin: 0; font-size: 24px; }
        .content { padding: 25px; }
        .content h2 { color: #8B0000; /* Deep Red */ font-size: 20px; margin-top: 0; }
        .content p { line-height: 1.6; margin-bottom: 15px; }
        .ticket-details { border: 1px solid #ddd; border-radius: 6px; padding: 15px; margin-top: 20px; background-color: #f9f9f9; }
        .ticket-details strong { color: #8B0000; }
        .detail-item { margin-bottom: 8px; display: flex; justify-content: space-between; }
        .detail-item span:first-child { font-weight: bold; color: #555; }
        .detail-value { font-weight: bold; }
        .footer { background-color: #f0f0f0; padding: 15px; text-align: center; font-size: 0.9em; color: #777; }
        .button { display: inline-block; background-color: #00A651; /* M-Pesa Green */ color: #ffffff; padding: 10px 20px; text-decoration: none; border-radius: 5px; margin-top: 15px; }
        a.button { color: #ffffff !important; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
             <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="logo-svg" fill="#FFFFFF">
                <path d="M50 5C25.15 5 5 25.15 5 50s20.15 45 45 45 45-20.15 45-45S74.85 5 50 5zm0 82C29.07 87 13 70.93 13 50S29.07 13 50 13s37 16.07 37 37-16.07 37-37 37z" />
                <text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" font-size="30" font-weight="bold" fill="#202A44"> 
                    RNR
                </text>
            </svg>
            <h1>Payment Confirmed!</h1>
        </div>
        <div class="content">
            <h2>Thank You For Your Payment!</h2>
            <p>Dear Customer,</p>
            <p>Your payment has been successfully processed. Please find your ticket details below:</p>
            
            <div class="ticket-details">
                <div class="detail-item"><span>Ticket ID:&nbsp;</span> <span class="detail-value">${ticketIdField}</span></div>
                <div class="detail-item"><span>Amount Paid:&nbsp;</span> <span class="detail-value">KES ${amount}</span></div>
                <div class="detail-item"><span>Phone Number:&nbsp;</span> <span class="detail-value">${phoneNumber || 'N/A'}</span></div>
                <div class="detail-item"><span>Quantity of Tickets:&nbsp;</span class="detail-value"> <span>${quantity || 'N/A'}</span></div>
            </div>
            
            <p>You can view the status of your ticket or access event details by clicking the button below:</p>
            <div style="text-align: center;">
                <a href="https://rnr-tickets-hub.vercel.app/ticket-status?ticketId=${ticketDocId}" class="button">View Ticket Status</a>
            </div>
            <p style="font-size:0.9em; text-align:center; margin-top:15px;">(Note: If your ticket has an associated eventId, the page might redirect you further based on that)</p>
        </div>
        <div class="footer">
            <p>&copy; ${new Date().getFullYear()} RNR Solutions. All rights reserved.</p>
            <p>This is an automated message. Please do not reply.</p>
        </div>
    </div>
</body>
</html>
  `;

  const result = await sendEmail({
    to: toEmail,
    subject,
    text: textBody,
    html: htmlBody,
  });

  if (result.success) {
    console.log(`Payment confirmation email sent to ${toEmail} for M-Pesa transaction ${mpesaTransactionId}.`);
  } else {
    console.error(`Failed to send payment confirmation email to ${toEmail}: ${result.message}`);
  }
}

// Instructions for setting up Mailgun:
// 1. Sign up for Mailgun: https://www.mailgun.com/
// 2. Add and verify your domain in Mailgun.
// 3. Get your API Key (Private API key) and Domain name from your Mailgun dashboard.
// 4. Create a .env.local file in the root of your project (if it doesn't exist).
// 5. Add your Mailgun credentials to .env.local:
//    NEXT_PUBLIC_MAILGUN_API_KEY=your_actual_api_key_here
//    NEXT_PUBLIC_MAILGUN_DOMAIN=your_mailgun_domain_here (e.g., mg.yourdomain.com or your sandbox domain like sandboxXXXX.mailgun.org)
//    NEXT_PUBLIC_MAILGUN_FROM_EMAIL="Your App Name <noreply@your_mailgun_domain_here>" (Optional, a default will be used)
// 6. Install the necessary packages: `npm install mailgun.js form-data` or `yarn add mailgun.js form-data`.
// 7. Uncomment the import lines at the top of this file and the `mailgunClient` initialization block.
// 8. Uncomment the actual Mailgun sending logic within the `sendEmail` function and remove/comment out the simulation block.
// 9. Restart your Next.js development server for the environment variables to take effect.
// 10. For sandbox domains, Mailgun only allows sending to "Authorized Recipients". Add your test email addresses there.
//     For production, use a verified custom domain.
    