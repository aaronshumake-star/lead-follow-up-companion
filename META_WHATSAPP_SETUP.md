# Meta WhatsApp setup — plain-English guide

The integration is implemented but is **not live until you perform these steps
with your own Meta account and test it**.

## 1. Create the Meta app

1. Open [developers.facebook.com](https://developers.facebook.com).
2. Create a developer account if prompted.
3. **My Apps** → **Create App** → choose **Business**.
4. Open the app → **Add products** → **WhatsApp** → **Set up**.

The API Setup page initially gives a **test phone number**. Use it first. A
production number requires business verification and cannot already be active
in the consumer WhatsApp app.

## 2. Copy the identifiers

On **WhatsApp → API Setup**, copy:

- **Phone Number ID** → server secret `WHATSAPP_PHONE_NUMBER_ID`
- **WhatsApp Business Account ID** → `WHATSAPP_BUSINESS_ACCOUNT_ID`

These are identifiers, not passwords, but keep them server-side with the other
configuration.

Add your personal mobile number under **To** / recipient numbers. Store it in
E.164 form, such as `+15125550147`, as `WHATSAPP_APPROVED_NUMBER`. It is the
only number allowed to send commands or receive reminders.

## 3. Access token

The temporary token expires in about 24 hours. For production:

1. Meta Business Settings → **Users → System users** → Add.
2. Assign the app and WhatsApp account.
3. Generate a token with `whatsapp_business_messaging` and
   `whatsapp_business_management`.
4. Set it as Worker secret `WHATSAPP_ACCESS_TOKEN`.

**Never** paste the token into browser variables, screenshots, chat, source
files, GitHub, or Supabase rows.

## 4. Webhook

Meta app → WhatsApp → **Configuration** → Webhook → Edit:

- Callback URL:
  `https://YOUR-WORKER.workers.dev/webhooks/whatsapp`
- Verify token: invent a long random value and set the same value as Worker
  secret `WHATSAPP_WEBHOOK_VERIFY_TOKEN`.

Subscribe to **messages**. That field carries inbound text, voice messages,
delivery, read, and failed-delivery events.

App Settings → Basic → copy **App secret** into the Worker secret
`WHATSAPP_APP_SECRET`. Every POST is checked against
`X-Hub-Signature-256` before the body is parsed or media downloaded.

## 5. First tests

1. From Meta's API Setup page, send the first template message to your approved
   personal number.
2. Reply `What is overdue?`. The webhook should answer from your real data.
3. Send a short voice note: “Called Jesus Ayala. No answer. Follow up tomorrow
   morning.”
4. Open the web app → WhatsApp → Voice Notes. Confirm the state becomes
   **applied**, the audio says **deleted**, and a concise text confirmation
   arrives.

Do not test destructive commands against real customers until text queries and
non-destructive call logging work.

## Moving to production

Complete Meta business verification, add a production phone number, create and
approve reminder templates for messages outside the 24-hour service window,
then replace the test Phone Number ID and token secrets. Keep the approved
personal recipient unchanged.

## Common failures

- **Webhook verification fails:** callback URL, verify token, or Worker deploy
  is wrong.
- **401 invalid signature:** app secret belongs to a different Meta app.
- **Message accepted but not delivered:** recipient was not added in test mode,
  or the 24-hour window requires an approved template.
- **Media expired:** voice media URLs expire; resend the voice note. Permanent
  expired-media failures are not retried.
- **Token expired:** replace the temporary token with a system-user token.
- **Voice unavailable:** `TRANSCRIPTION_ENABLED` is false or the API key/model
  secrets are missing. Text commands continue to work.

## Safe vs secret values

Browser-safe: Supabase URL and anon key only.

Server-only: Meta token, Phone Number ID, Business Account ID, approved number,
verify token, app secret, Supabase service-role key, transcription key.

Never include any server-only value in a screenshot or support chat.
