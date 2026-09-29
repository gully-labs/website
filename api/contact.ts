import type { VercelRequest, VercelResponse } from '@vercel/node'

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

interface Enquiry {
  name?: string
  email?: string
  message?: string
  types?: string[]
  budget?: string
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ ok: false, error: 'Method not allowed' })
  }

  const body = (req.body ?? {}) as Enquiry
  if (!body.email || !EMAIL_RE.test(body.email) || !Array.isArray(body.types) || body.types.length === 0) {
    return res.status(400).json({ ok: false, error: 'Invalid enquiry' })
  }

  // TODO: forward the enquiry to the email provider or CRM (e.g. Resend):
  //   await resend.emails.send({ from, to, replyTo: body.email, subject, text })
  console.log('New enquiry', body)

  return res.status(200).json({ ok: true })
}
