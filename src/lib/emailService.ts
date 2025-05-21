
'use server';

// import formData from 'form-data';
// import Mailgun from 'mailgun.js';

// --- Mailgun Configuration ---
// IMPORTANT: You need to set these environment variables in your .env.local file (create if it doesn't exist)
// NEXT_PUBLIC_MAILGUN_API_KEY=your_mailgun_api_key
// NEXT_PUBLIC_MAILGUN_DOMAIN=your_mailgun_domain (e.g., mg.yourdomain.com or your sandbox domain)
// NEXT_PUBLIC_MAILGUN_FROM_EMAIL="RNR Pay <noreply@your_mailgun_domain>" (Optional, defaults are provided)
//
// You also need to install the mailgun-js library:
// npm install mailgun.js form-data
// OR
// yarn add mailgun.js form-data
//
// Then, uncomment the import statements above and the Mailgun client initialization code below.

const MAILGUN_API_KEY = process.env.NEXT_PUBLIC_MAILGUN_API_KEY;
const MAILGUN_DOMAIN = process.env.NEXT_PUBLIC_MAILGUN_DOMAIN;
const MAILGUN_FROM_EMAIL = process.env.NEXT_PUBLIC_MAILGUN_FROM_EMAIL || `RNR Pay <mailgun@${MAILGUN_DOMAIN || 'example.com'}>`;

// let mailgunClient: any; // Placeholder for Mailgun client

// if (MAILGUN_API_KEY && MAILGUN_DOMAIN) {
//   const mailgun = new Mailgun(formData); // formData is required for Node.js environment
//   mailgunClient = mailgun.client({ username: 'api', key: MAILGUN_API_KEY });
//   console.log("Mailgun client initialized.");
// } else {
//   console.warn(
//     "Mailgun API Key or Domain not configured in environment variables (NEXT_PUBLIC_MAILGUN_API_KEY, NEXT_PUBLIC_MAILGUN_DOMAIN). " +
//     "Email sending will be simulated. " +
//     "Please set them up in your .env.local file."
//   );
// }

interface EmailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export async function sendEmail(options: EmailOptions): Promise<{success: boolean, message?: string}> {
  // if (!mailgunClient) {
  //   console.log("[Simulated Email] Mailgun not initialized. Simulating email send:", options);
  //   await new Promise(resolve => setTimeout(resolve, 300)); // Simulate network delay
  //   return { success: true, message: "Email sent (simulated as Mailgun is not configured)." };
  // }

  // // Actual Mailgun sending logic
  // try {
  //   const data = {
  //     from: MAILGUN_FROM_EMAIL,
  //     to: options.to,
  //     subject: options.subject,
  //     text: options.text,
  //     html: options.html || options.text,
  //   };
  //   // Note: For Mailgun EU domains, you might need to specify the base URL:
  //   // const response = await mailgunClient.messages.create(MAILGUN_DOMAIN, data, {baseUrl: 'https://api.eu.mailgun.net'});
  //   const response = await mailgunClient.messages.create(MAILGUN_DOMAIN!, data);
  //   console.log("Email sent successfully via Mailgun:", response);
  //   return { success: true, message: "Email sent successfully." };
  // } catch (error: any) {
  //   console.error("Error sending email via Mailgun:", error.message || error);
  //   return { success: false, message: `Failed to send email: ${error.message || 'Unknown Mailgun error'}` };
  // }

  // Fallback simulation if not configured
  console.log(`[Simulated Email Service] Sending email to ${options.to} with subject "${options.subject}"`);
  console.log(`Text: ${options.text}`);
  if(!MAILGUN_API_KEY || !MAILGUN_DOMAIN) {
    console.warn("Reminder: Mailgun is not configured. This is a simulated email.");
  }
  await new Promise(resolve => setTimeout(resolve, 300)); // Simulate network delay for simulation
  return { success: true, message: "Email sent (simulated)." };
}

export async function sendPaymentConfirmationEmail(
  toEmail: string,
  ticketId: string,
  amount: string,
  transactionId: string
): Promise<void> {
  if (!toEmail) {
    console.log("No email address provided, skipping payment confirmation email.");
    return;
  }

  const subject = `Payment Confirmation for Ticket ${ticketId} - RNR Pay`;
  const textBody = `Dear Customer,\n\nYour payment for ticket ${ticketId} (Amount: $${amount}) has been successfully processed.\nTransaction ID: ${transactionId}\n\nThank you for using RNR Pay.\n\nRNR Solutions`;
  const htmlBody = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6;">
      <h2 style="color: #8B0000;">RNR Pay - Payment Confirmation</h2>
      <p>Dear Customer,</p>
      <p>Your payment for ticket <strong>${ticketId}</strong> (Amount: <strong>$${amount}</strong>) has been successfully processed.</p>
      <p>Transaction ID: <strong>${transactionId}</strong></p>
      <p>If you have any questions, please contact our support.</p>
      <p>Thank you for your payment!</p>
      <p><em>Sincerely,<br/>The RNR Solutions Team</em></p>
      <hr/>
      <p style="font-size: 0.8em; color: #777;">This is an automated message. Please do not reply directly to this email.</p>
    </div>
  `;

  const result = await sendEmail({
    to: toEmail,
    subject,
    text: textBody,
    html: htmlBody,
  });

  if (result.success) {
    console.log(`Payment confirmation email sent to ${toEmail} for transaction ${transactionId}.`);
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
