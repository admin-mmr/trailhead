import { EmailClient } from '@azure/communication-email'

let client: EmailClient | undefined

function getEmailClient(): EmailClient {
  if (!client) {
    client = new EmailClient(process.env.AZURE_COMM_CONNECTION_STRING!)
  }
  return client
}

interface SendEmailParams {
  to: string
  subject: string
  html: string
  text?: string
}

export async function sendEmail({ to, subject, html, text }: SendEmailParams): Promise<void> {
  const emailClient = getEmailClient()
  const message = {
    senderAddress: process.env.EMAIL_FROM!,
    content: { subject, html, plainText: text ?? '' },
    recipients: { to: [{ address: to }] },
  }

  const poller = await emailClient.beginSend(message)
  await poller.pollUntilDone()
}

export async function sendMemberWelcomeEmail(params: {
  to: string
  memberId: string
  name: string
  expiresAt: string
  lang?: 'en' | 'zh'
}): Promise<void> {
  const isZh = params.lang === 'zh'
  await sendEmail({
    to: params.to,
    subject: isZh
      ? `欢迎加入岚山跑团！您的会员编号：${params.memberId}`
      : `Welcome to Misty Mountain Runners! Member ID: ${params.memberId}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
        <div style="background:#1F497D;padding:32px;text-align:center;">
          <h1 style="color:white;margin:0;">Misty Mountain Runners</h1>
          <p style="color:rgba(255,255,255,0.8);margin:8px 0 0;">岚山跑团</p>
        </div>
        <div style="padding:32px;">
          <h2 style="color:#1F497D;">
            ${isZh ? `欢迎，${params.name}！` : `Welcome, ${params.name}!`}
          </h2>
          <p>${isZh ? '您的会员资格已激活。' : 'Your membership is now active.'}</p>
          <div style="background:#f5f7fa;border-radius:12px;padding:20px;margin:20px 0;">
            <p style="margin:0;font-size:14px;color:#666;">
              ${isZh ? '会员编号' : 'Member ID'}
            </p>
            <p style="margin:8px 0 0;font-size:28px;font-weight:bold;color:#E86033;letter-spacing:2px;">
              ${params.memberId}
            </p>
          </div>
          <p style="color:#666;font-size:14px;">
            ${isZh ? '有效期至' : 'Valid until'}:
            <strong>${new Date(params.expiresAt).toLocaleDateString()}</strong>
          </p>
          <a href="${process.env.NEXT_PUBLIC_APP_URL}/portal"
             style="display:inline-block;background:#E86033;color:white;padding:12px 28px;
                    border-radius:99px;text-decoration:none;font-weight:600;margin-top:16px;">
            ${isZh ? '进入会员中心' : 'Go to Member Portal'}
          </a>
        </div>
      </div>
    `,
  })
}
