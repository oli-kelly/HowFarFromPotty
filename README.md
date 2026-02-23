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

## Notes

- The browser requests geolocation permission from the user.
- The app auto-selects source by coordinates:
  - UK bounds -> The Great British Public Toilet Map
  - US bounds -> Refuge Restrooms API
- The server caches the latest UK dataset export in memory for 6 hours to avoid repeated large downloads.
