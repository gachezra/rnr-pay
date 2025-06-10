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
  inline?: {filename: string; data: Buffer; cid: string}[];
}

export async function sendEmail(options: EmailOptions): Promise<{success: boolean, message?: string}> {
  if (!mailgunClient) {
    console.log("[Simulated Email] Mailgun not initialized. Simulating email send:", options.to, options.subject);
    if (options.inline && options.inline.length > 0) {
        console.log(`[Simulated Email] Would have attached ${options.inline.length} inline image(s). First CID: ${options.inline[0].cid}`);
    }
    await new Promise(resolve => setTimeout(resolve, 300)); 
    return { success: true, message: "Email sent (simulated as Mailgun is not configured)." };
  }

  try {
    const data: any = {
      from: MAILGUN_FROM_EMAIL,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html || options.text,
    };
    if (options.inline && options.inline.length > 0) {
        data.inline = options.inline;
    }
    const response = await mailgunClient.messages.create(MAILGUN_DOMAIN!, data);
    console.log("Email sent successfully via Mailgun:", response);
    return { success: true, message: "Email sent successfully." };
  } catch (error: any) {
    console.error("Error sending email via Mailgun:", error.message || error);
    return { success: false, message: `Failed to send email: ${error.message || 'Unknown Mailgun error'}` };
  }
}

// Function to generate QR code matrix data
async function generateQRCodeMatrix(data: string): Promise<boolean[][]> {
  try {
    // Generate QR code as matrix (2D array of booleans)
    const qrMatrix = await QRCode.create(data, {
      width: 200,
      margin: 2,
      errorCorrectionLevel: 'M'
    });
    
    // Convert the QR code modules to a 2D boolean array
    const size = qrMatrix.modules.size;
    const matrix: boolean[][] = [];
    
    for (let row = 0; row < size; row++) {
      matrix[row] = [];
      for (let col = 0; col < size; col++) {
        matrix[row][col] = qrMatrix.modules.get(row, col);
      }
    }
    
    return matrix;
  } catch (error) {
    console.error('Error generating QR code matrix:', error);
    // Return a simple 3x3 fallback pattern
    return [
      [true, false, true],
      [false, true, false],
      [true, false, true]
    ];
  }
}

// Function to generate HTML/CSS QR code
async function generateQRCodeHTML(data: string): Promise<string> {
  try {
    const matrix = await generateQRCodeMatrix(data);
    const size = matrix.length;
    const cellSize = Math.floor(160 / size); // Adjust cell size based on matrix size
    const totalSize = cellSize * size;
    
    // Generate the HTML table structure
    let htmlRows = '';
    for (let row = 0; row < size; row++) {
      let htmlCells = '';
      for (let col = 0; col < size; col++) {
        const cellClass = matrix[row][col] ? 'qr-dark' : 'qr-light';
        htmlCells += `<td class="${cellClass}"></td>`;
      }
      htmlRows += `<tr>${htmlCells}</tr>`;
    }
    
    const qrCodeHTML = `
      <div class="qr-code-html" style="display: inline-block; padding: 10px; background-color: #ffffff; border: 2px solid #202A44; border-radius: 8px;">
        <table class="qr-table" style="border-collapse: collapse; border-spacing: 0; margin: 0; padding: 0; width: ${totalSize}px; height: ${totalSize}px;">
          ${htmlRows}
        </table>
      </div>
      <style>
        .qr-table td {
          width: ${cellSize}px;
          height: ${cellSize}px;
          padding: 0;
          margin: 0;
          border: none;
        }
        .qr-dark {
          background-color: #000000;
        }
        .qr-light {
          background-color: #ffffff;
        }
      </style>
    `;
    
    return qrCodeHTML;
  } catch (error) {
    console.error('Error generating HTML QR code:', error);
    // Return a fallback HTML pattern
    return `
      <div class="qr-code-html" style="display: inline-block; padding: 10px; background-color: #ffffff; border: 2px solid #202A44; border-radius: 8px;">
        <div style="width: 160px; height: 160px; background-color: #f0f0f0; display: flex; align-items: center; justify-content: center; font-size: 12px; color: #666; text-align: center;">
          QR Code<br>Generation Error
        </div>
      </div>
    `;
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

  const ticketStatusUrl = `https://rnrsocialhub.com/ticket-status?ticketId=${ticketDocId}`;
  
  // Generate HTML/CSS QR code instead of image
  const qrCodeHTML = await generateQRCodeHTML(ticketStatusUrl);

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
        img { border: 0; display: block; max-width: 100%; height: auto; }
        .container { width: 100%; max-width: 600px; margin: 20px auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 0 15px rgba(0,0,0,0.1); overflow: hidden; }
        .header { background-color: #202A44; padding: 20px; text-align: center; }
        .logo-svg { width: 70px; height: 70px; margin-bottom: 15px; }
        .header h1 { color: #ffffff; margin: 0; font-size: 26px; }
        .content { padding: 30px; }
        .content h3 { color: #D32F2F; font-size: 20px; margin-top: 0; font-weight: bold; }
        .content p { line-height: 1.7; margin-bottom: 18px; font-size: 16px; }
        .ticket-details { border: 1px solid #ddd; border-radius: 6px; padding: 20px; margin: 25px 0; background-color: #f9f9f9; }
        .detail-item { margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; font-size: 16px; }
        .detail-item span:first-child { font-weight: bold; color: #555; }
        .detail-value { font-weight: normal; color: #202A44; }
        .footer { background-color: #f0f0f0; padding: 20px; text-align: center; font-size: 14px; color: #777; }
        .button { display: inline-block; background-color: #D32F2F; color: #ffffff !important; padding: 12px 25px; text-decoration: none; border-radius: 5px; margin-top: 15px; font-weight: bold; font-size: 16px; }
        .qr-code-section { text-align: center; margin: 30px 0; padding: 20px; background-color: #f8f9fa; border-radius: 8px; border: 1px solid #e0e0e0; }
        .qr-code-section h4 { margin-bottom: 15px; color: #333; font-size: 18px; font-weight: bold; }
        .qr-instruction { font-size: 14px; color: #666; margin-top: 10px; font-style: italic; }
        
        /* QR Code HTML/CSS Styles */
        .qr-table td {
          padding: 0;
          margin: 0;
          border: none;
        }
        .qr-dark {
          background-color: #000000;
        }
        .qr-light {
          background-color: #ffffff;
        }
        
        @media screen and (max-width: 600px) {
            .content { padding: 20px; }
            .header h1 { font-size: 22px; }
            .content p, .detail-item { font-size: 14px; }
            .button { padding: 10px 20px; font-size: 15px; }
            .qr-code-section h4 { font-size: 16px; }
            .qr-code-html { transform: scale(0.8); }
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
            <h3>Hey there</h3>
            <p>Your payment is confirmed and your spot is secured. We're thrilled to have you join the RNR Social Club community.</p>

            <div class="qr-code-section">
                <h4>Ticket QR Code</h4>
                ${qrCodeHTML}
                <div class="qr-instruction">
                    Scan with your phone's camera for quick access
                </div>
            </div>

            <div class="ticket-details">
                <h4>Ticket Details</h4>
                <div class="detail-item"><span>Ticket ID:&ensp;</span> <span class="detail-value">${ticketIdField}</span></div>
                <div class="detail-item"><span>Amount Paid:&ensp;</span> <span class="detail-value">KES ${amount}</span></div>
                <div class="detail-item"><span>Phone Number:&ensp;</span> <span class="detail-value">${phoneNumber || 'N/A'}</span></div>
                <div class="detail-item"><span>Tickets Secured:&ensp;</span> <span class="detail-value">${quantity || 'N/A'}</span></div>
            </div>

            <p>Ready to view your ticket? Click the button below to access all the details and get ready for the main event.</p>
            <div style="text-align: center;">
                <a href="${ticketStatusUrl}" class="button">Access Your Ticket</a>
            </div>
            

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
  
  const emailOptions: EmailOptions = {
    to: toEmail,
    subject,
    text: textBody,
    html: htmlBody,
  };

  const result = await sendEmail(emailOptions);

  return result;
}