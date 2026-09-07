import { logger } from "./logger";

export class EmailNotConfiguredError extends Error {
  readonly code = "EMAIL_NOT_CONFIGURED";
  constructor() {
    super("Email service is not configured on the server.");
  }
}

export class EmailSendError extends Error {
  readonly code = "EMAIL_SEND_FAILED";
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

function fromAddress(): string {
  return process.env.INVITE_FROM_EMAIL || "invites@roundhouse.app";
}

function fromName(): string {
  return process.env.INVITE_FROM_NAME || "Roundhouse";
}

export function isEmailConfigured(): boolean {
  return Boolean(process.env.SENDGRID_API_KEY);
}

export async function sendEmail(msg: EmailMessage): Promise<void> {
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) {
    throw new EmailNotConfiguredError();
  }

  const body = {
    personalizations: [{ to: [{ email: msg.to }] }],
    from: { email: fromAddress(), name: fromName() },
    subject: msg.subject,
    content: [
      { type: "text/plain", value: msg.text },
      ...(msg.html ? [{ type: "text/html", value: msg.html }] : []),
    ],
  };

  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    logger.warn(
      { status: res.status, detail: detail.slice(0, 500) },
      "SendGrid rejected outbound email",
    );
    throw new EmailSendError(
      `Email provider returned HTTP ${res.status}.`,
      res.status,
    );
  }
}
