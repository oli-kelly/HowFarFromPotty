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
- Configure SMTP environment variables:
  - `SMTP_HOST`
  - `SMTP_PORT` (default: `587`)
  - `SMTP_SECURE` (`true`/`false`, default: `false`)
  - `SMTP_USER`
  - `SMTP_PASS`
  - `SMTP_FROM` (optional, defaults to `SMTP_USER`)
  - `FEATURE_REQUEST_TO` (optional override for recipient email)
  - `SMTP_CONNECT_TIMEOUT_MS` (optional, default: `15000`)
  - `SMTP_SEND_TIMEOUT_MS` (optional, default: `25000`)

### PowerShell example (local dev)

```powershell
$env:SMTP_HOST="smtp.gmail.com"
$env:SMTP_PORT="587"
$env:SMTP_SECURE="false"
$env:SMTP_USER="your-account@gmail.com"
$env:SMTP_PASS="your-app-password"
$env:SMTP_FROM="HowFarFromPotty <your-account@gmail.com>"
$env:FEATURE_REQUEST_TO="oliverkellymain@gmail.com"
npm start
```

If SMTP is missing or invalid, `/api/feature-request` returns `503` and the form shows an error.

## Troubleshooting feature request send

- `503 smtp_not_configured`: SMTP env vars are missing.
- `502 email_auth_failed`: Gmail rejected login (`SMTP_USER` / `SMTP_PASS` mismatch).
- `502 email_connection_failed`: host/port/network issue reaching SMTP.
- `504 email_timeout`: SMTP connection/send timed out.

### `.env` example (recommended)

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-account@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=HowFarFromPotty <your-account@gmail.com>
FEATURE_REQUEST_TO=oliverkellymain@gmail.com
```
