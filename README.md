# How Far From Potty

Website that tells users how far they are from the nearest public toilet using their current location (UK and US supported).

## Data sources

- The Great British Public Toilet Map: https://www.toiletmap.org.uk/dataset
- License: CC BY 4.0
- Refuge Restrooms API (US): https://www.refugerestrooms.org/api/docs/

## Run locally

```bash
npm start
```

Then open `http://localhost:3000`.

Create a `.env` file first (copy from `.env.example`) if you want feature-request emails to work locally.

## Notes

- The browser requests geolocation permission from the user.
- The app auto-selects source by coordinates:
  - UK bounds -> The Great British Public Toilet Map
  - US bounds -> Refuge Restrooms API
- The server caches the latest UK dataset export in memory for 6 hours to avoid repeated large downloads.

## Feature request emails

- The app includes a `Feature Request` button that opens an in-app form.
- Requests are sent to `oliverkellymain@gmail.com`.
- Requests are sent directly from the server (no client email login required).
- Provider: Resend API over HTTPS (works on Render free tier).

### Resend configuration (recommended)

- `RESEND_API_KEY`
- `RESEND_FROM` (must be a verified sender/domain in Resend; `onboarding@resend.dev` works for testing)
- `FEATURE_REQUEST_TO` (optional override for recipient email)
- `RESEND_SEND_TIMEOUT_MS` (optional, default: `20000`)

### PowerShell example (Resend)

```powershell
$env:RESEND_API_KEY="re_xxxxxxxxxxxxxxxxx"
$env:RESEND_FROM="HowFarFromPotty <onboarding@resend.dev>"
$env:FEATURE_REQUEST_TO="oliverkellymain@gmail.com"
npm start
```

If Resend is missing/invalid, `/api/feature-request` returns `503` and the form shows an error.

## Troubleshooting feature request send

- `503 email_not_configured`: Resend env vars are missing.
- `502 email_auth_failed`: Resend authentication failed (`RESEND_API_KEY` invalid/revoked).
- `502 email_connection_failed`: host/port/network issue reaching provider.
- `504 email_timeout`: provider connection/send timed out.

### `.env` example (recommended)

```env
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxx
RESEND_FROM=HowFarFromPotty <onboarding@resend.dev>
FEATURE_REQUEST_TO=oliverkellymain@gmail.com
```
