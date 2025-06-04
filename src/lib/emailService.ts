
'use server';

import formData from 'form-data';
import Mailgun from 'mailgun.js';
import QRCode from 'qrcode';
import dotenv from 'dotenv';
dotenv.config();

const MAILGUN_API_KEY = process.env.NEXT_PUBLIC_MAILGUN_API_KEY;
const MAILGUN_DOMAIN = process.env.NEXT_PUBLIC_MAILGUN_DOMAIN;
const MAILGUN_FROM_EMAIL = `RNR Pay <tickets@${MAILGUN_DOMAIN}>`;
const MAILGUN_URL = process.env.NEXT_PUBLIC_MAILGUN_URL;

let mailgunClient: any; 

if (MAILGUN_API_KEY && MAILGUN_DOMAIN) {
  const mailgun = new Mailgun(formData);
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
    console.log("[Simulated Email] Mailgun not initialized. Simulating email send:", options.to, options.subject);
    await new Promise(resolve => setTimeout(resolve, 300)); 
    return { success: true, message: "Email sent (simulated as Mailgun is not configured)." };
  }

  try {
    const data = {
      from: MAILGUN_FROM_EMAIL,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html || options.text,
    };
    const response = await mailgunClient.messages.create(MAILGUN_DOMAIN!, data);
    console.log("Email sent successfully via Mailgun:", response);
    return { success: true, message: "Email sent successfully." };
  } catch (error: any) {
    console.error("Error sending email via Mailgun:", error.message || error);
    return { success: false, message: `Failed to send email: ${error.message || 'Unknown Mailgun error'}` };
  }
}

export async function sendPaymentConfirmationEmail(
  toEmail: string,          
  ticketDocId: string,      
  ticketIdField: string,   
  amount: string,
  mpesaReceiptNumber: string,
  phoneNumber: string | null,
  quantity: number | string | null,
  userProvidedEmailForReceipt: string | null 
): Promise<{success: boolean, message?: string}> {
  if (!toEmail) {
    console.log("No recipient email address provided, skipping payment confirmation email.");
    return { success: false, message: "No recipient email address provided."};
  }

  const ticketStatusUrl = `https://rnr-tickets-hub.vercel.app/ticket-status?ticketId=${ticketDocId}`;
  let qrCodeDataUri = '';
  try {
    qrCodeDataUri = await QRCode.toDataURL(ticketStatusUrl, {
      errorCorrectionLevel: 'H',
      type: 'image/png',
      margin: 2,
      width: 150 
    });
  } catch (err) {
    console.error('Failed to generate QR code:', err);
    // Proceed without QR code if generation fails
  }

  const subject = `Payment Confirmed - Ticket ${ticketIdField}`;
  const textBody = `
Dear Customer,

Your payment has been successfully processed!

Ticket Details:
-----------------------------------
Ticket ID: ${ticketIdField}
M-Pesa Receipt: ${mpesaReceiptNumber}
Amount Paid: KES ${amount}
Phone Number: ${phoneNumber || 'N/A'}
Quantity: ${quantity || 'N/A'}
${userProvidedEmailForReceipt ? `Email for Receipt: ${userProvidedEmailForReceipt}` : ''}
-----------------------------------

Thank you for using RNR Pay.
You can view your ticket status here: ${ticketStatusUrl} 
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
    <title>RNR Social Club - Your Adventure Awaits!</title>
    <style>
        body, html { margin: 0; padding: 0; width: 100%; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; font-family: Arial, sans-serif; background-color: #f4f4f4; color: #333; }
        table { border-spacing: 0; }
        img { border: 0; }
        .container { width: 100%; max-width: 600px; margin: 20px auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 0 15px rgba(0,0,0,0.1); overflow: hidden; }
        .header { background-color: #202A44; padding: 20px; text-align: center; }
        .logo-svg { width: 70px; height: 70px; margin-bottom: 15px; }
        .header h1 { color: #ffffff; margin: 0; font-size: 26px; }
        .content { padding: 30px; }
        .content h3 { color: #D32F2F; font-size: 22px; margin-top: 0; font-weight: bold; }
        .content p { line-height: 1.7; margin-bottom: 18px; font-size: 16px; }
        .ticket-details { border: 1px solid #ddd; border-radius: 6px; padding: 20px; margin: 25px 0; background-color: #f9f9f9; }
        .detail-item { margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; font-size: 16px; }
        .detail-item span:first-child { font-weight: bold; color: #555; }
        .detail-value { font-weight: normal; color: #202A44; }
        .footer { background-color: #f0f0f0; padding: 20px; text-align: center; font-size: 14px; color: #777; }
        .button { display: inline-block; background-color: #D32F2F; color: #ffffff !important; padding: 12px 25px; text-decoration: none; border-radius: 5px; margin-top: 15px; font-weight: bold; font-size: 16px; }
        .qr-code-section { text-align: center; margin-top: 25px; margin-bottom: 25px; }
        .qr-code-section h4 { margin-bottom: 10px; color: #333; font-size: 18px; }
        .qr-code-image { width: 150px; height: 150px; border: 1px solid #ddd; border-radius: 4px; }
        @media screen and (max-width: 600px) {
            .content { padding: 20px; }
            .header h1 { font-size: 22px; }
            .content p, .detail-item { font-size: 14px; }
            .button { padding: 10px 20px; font-size: 15px; }
            .qr-code-section h4 { font-size: 16px; }
            .qr-code-image { width: 120px; height: 120px; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
             <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" class="logo-svg">
                <circle cx="60" cy="60" r="55" fill="#FFFFFF"/> 
                <text x="50%" y="53%" dominant-baseline="middle" text-anchor="middle" font-size="40" font-weight="bold" fill="#202A44" font-family="Arial, sans-serif">
                    RNR
                </text>
            </svg>
            <h1>You're In! Get Ready for an Experience.</h1>
        </div>
        <div class="content">
            <h3>Hey there,</h3>
            <p>Your payment is confirmed and your spot is secured. We're thrilled to have you join the RNR Social Club community.</p>

            <div class="ticket-details">
                <div class="detail-item"><span>Ticket ID:</span> <span class="detail-value">${ticketIdField}</span></div>
                <div class="detail-item"><span>M-Pesa Receipt:</span> <span class="detail-value">${mpesaReceiptNumber}</span></div>
                <div class="detail-item"><span>Amount Paid:</span> <span class="detail-value">KES ${amount}</span></div>
                <div class="detail-item"><span>Phone Number:</span> <span class="detail-value">${phoneNumber || 'N/A'}</span></div>
                <div class="detail-item"><span>Tickets Secured:</span> <span class="detail-value">${quantity || 'N/A'}</span></div>
                ${userProvidedEmailForReceipt ? `<div class="detail-item"><span>Email Provided:</span> <span class="detail-value">${userProvidedEmailForReceipt}</span></div>` : ''}
            </div>

            <p>Ready to view your ticket? Click the button below to access all the details and get ready for the main event.</p>
            <div style="text-align: center;">
                <a href="${ticketStatusUrl}" class="button">Access Your Ticket</a>
            </div>
            
            ${qrCodeDataUri ? `
            <div class="qr-code-section">
                <h4>Or Scan QR Code:</h4>
                <img src="${qrCodeDataUri}" alt="Ticket Status QR Code" class="qr-code-image">
            </div>
            ` : ''}

            <p style="font-size:0.9em; text-align:center; margin-top:20px;">Stay tuned for our upcoming lineup of more exciting events designed to elevate your social life!</p>
        </div>
        <div class="footer">
            <p>&copy; ${new Date().getFullYear()} RNR Social Experiences. All rights reserved.</p>
            <p>This is an automated confirmation. No need to reply.</p>
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

  return result;
}
    
