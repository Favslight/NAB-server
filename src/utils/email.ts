import { Resend } from 'resend';
import { config } from '../config';

let resendClient: Resend | null = null;

if (config.resend.apiKey) {
  resendClient = new Resend(config.resend.apiKey);
}

export async function sendEmail(options: {
  to: string;
  subject: string;
  html: string;
}): Promise<any> {
  if (!resendClient) {
    console.warn('Resend API key not configured. Skipping email sent to:', options.to);
    return false;
  }

  try {
    const data = await resendClient.emails.send({
      from: `${config.resend.fromName} <${config.resend.fromEmail}>`,
      to: options.to,
      subject: options.subject,
      html: options.html,
    });
    return data;
  } catch (error) {
    console.error('Error sending email:', error);
    return false;
  }
}
