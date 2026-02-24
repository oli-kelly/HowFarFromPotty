import "dotenv/config";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { Resend } from "resend";

const PORT = Number(process.env.PORT || 3000);
const ROOT_DIR = fileURLToPath(new URL(".", import.meta.url));
const DATASET_PAGE_URL = "https://www.toiletmap.org.uk/dataset";
const DATASET_LINK_REGEX = /https:\/\/[^"'<>]+\/exports\/toilets-[^"'<>]+\.json\?download=1/g;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const US_API_BASE_URL = "https://www.refugerestrooms.org/api/v1";
const US_SOURCE_DOCS_URL = "https://www.refugerestrooms.org/api/docs/#!/restrooms/get_api_v1_restrooms_by_location";
const FEATURE_REQUEST_TO = process.env.FEATURE_REQUEST_TO || "oliverkellymain@gmail.com";
const RESEND_SEND_TIMEOUT_MS = Number(process.env.RESEND_SEND_TIMEOUT_MS || 20000);

const UK_BOUNDS = {
  minLat: 49.8,
  maxLat: 60.9,
  minLon: -8.7,
  maxLon: 1.8
};

const US_BOUNDS = {
  minLat: 18.5,
  maxLat: 71.6,
  minLon: -179.2,
  maxLon: -66.0
};

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8"
};

let ukCache = {
  fetchedAt: 0,
  sourceUrl: "",
  toilets: []
};

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function isInUkBounds(lat, lon) {
  return (
    lat >= UK_BOUNDS.minLat &&
    lat <= UK_BOUNDS.maxLat &&
    lon >= UK_BOUNDS.minLon &&
    lon <= UK_BOUNDS.maxLon
  );
}

function isInUsBounds(lat, lon) {
  return (
    lat >= US_BOUNDS.minLat &&
    lat <= US_BOUNDS.maxLat &&
    lon >= US_BOUNDS.minLon &&
    lon <= US_BOUNDS.maxLon
  );
}

function clampText(value, maxLen = 280) {
  if (!value) {
    return null;
  }

  const text = String(value).replace(/\s+/g, " ").trim();
  if (!text) {
    return null;
  }

  return text.length > maxLen ? `${text.slice(0, maxLen - 3)}...` : text;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": contentTypes[".json"]
  });
  res.end(JSON.stringify(body));
}

function getResendConfig() {
  const apiKey = typeof process.env.RESEND_API_KEY === "string" ? process.env.RESEND_API_KEY.trim() : "";
  const from = typeof process.env.RESEND_FROM === "string" ? process.env.RESEND_FROM.trim() : "";

  const missing = [];
  if (!(typeof apiKey === "string" && apiKey.length > 0)) {
    missing.push("RESEND_API_KEY");
  }
  if (!(typeof from === "string" && from.length > 0)) {
    missing.push("RESEND_FROM");
  }

  return {
    enabled: missing.length === 0,
    missing,
    apiKey,
    from
  };
}

function sanitizeFeatureInput(value, maxLen) {
  const text = clampText(value, maxLen);
  return text ? text : "";
}

function mapEmailSendError(error) {
  const errorCode = typeof error?.code === "string" ? error.code : "UNKNOWN";
  const responseCode = Number.isFinite(error?.responseCode) ? error.responseCode : null;
  const providerMessage = clampText(error?.providerMessage || error?.message || "", 220);

  if (errorCode === "ETIMEDOUT" || errorCode === "ERESEND_TIMEOUT") {
    return {
      statusCode: 504,
      body: {
        error: "email_timeout",
        message: "Email provider timed out. Please try again.",
        providerCode: errorCode
      }
    };
  }

  if (errorCode === "ERESEND_AUTH" || responseCode === 401) {
    return {
      statusCode: 502,
      body: {
        error: "email_auth_failed",
        message: "Resend authentication failed. Check RESEND_API_KEY.",
        providerCode: errorCode,
        providerMessage: providerMessage || undefined
      }
    };
  }

  if (errorCode === "ERESEND_FORBIDDEN" || responseCode === 403) {
    return {
      statusCode: 403,
      body: {
        error: "email_sender_not_allowed",
        message: "Resend rejected this sender or recipient. Verify RESEND_FROM/domain and testing restrictions.",
        providerCode: errorCode,
        providerMessage: providerMessage || undefined
      }
    };
  }

  if (errorCode === "ERESEND_RATE_LIMIT" || responseCode === 429) {
    return {
      statusCode: 429,
      body: {
        error: "email_rate_limited",
        message: "Email provider rate limit reached. Please try again shortly.",
        providerCode: errorCode,
        providerMessage: providerMessage || undefined
      }
    };
  }

  if (
    [
      "ESOCKET",
      "ECONNECTION",
      "ENOTFOUND",
      "ECONNREFUSED",
      "EHOSTUNREACH",
      "ERESEND_NETWORK"
    ].includes(errorCode)
  ) {
    return {
      statusCode: 502,
      body: {
        error: "email_connection_failed",
        message: "Could not connect to the email provider. Check provider config and network egress rules.",
        providerCode: errorCode,
        providerMessage: providerMessage || undefined
      }
    };
  }

  return {
    statusCode: 502,
    body: {
      error: "email_send_failed",
      message: "Could not send feature request right now. Please try again.",
      providerCode: errorCode,
      providerMessage: providerMessage || undefined
    }
  };
}

function readJsonBody(req, maxBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;

    req.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        reject(new Error("payload_too_large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8").trim();
        if (!raw) {
          resolve({});
          return;
        }
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("invalid_json"));
      }
    });

    req.on("error", () => reject(new Error("request_stream_error")));
  });
}

async function sendFeatureRequestEmail({ name, email, subject, message }) {
  const resend = getResendConfig();
  if (!resend.enabled) {
    const error = new Error("email_not_configured");
    error.missing = resend.missing;
    throw error;
  }

  const resendClient = new Resend(resend.apiKey);
  const lines = [
    "New feature request for How Far From Potty",
    "",
    `Name: ${name || "Not provided"}`,
    `Email: ${email || "Not provided"}`,
    "",
    "Request:",
    message
  ];

  let timeoutHandle;
  try {
    const response = await Promise.race([
      resendClient.emails.send({
        from: resend.from,
        to: [FEATURE_REQUEST_TO],
        replyTo: email || undefined,
        subject: `[Feature Request] ${subject}`,
        text: lines.join("\n")
      }),
      new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => {
          const timeoutError = new Error("resend_timeout");
          timeoutError.code = "ERESEND_TIMEOUT";
          reject(timeoutError);
        }, RESEND_SEND_TIMEOUT_MS);
      })
    ]);

    if (response?.error) {
      const error = new Error("resend_request_failed");
      error.responseCode = Number(response.error.statusCode) || null;
      error.providerMessage = response.error.message || "";
      if (error.responseCode === 401 || error.responseCode === 403) {
        error.code = error.responseCode === 403 ? "ERESEND_FORBIDDEN" : "ERESEND_AUTH";
      } else if (error.responseCode === 429) {
        error.code = "ERESEND_RATE_LIMIT";
      } else {
        error.code = "ERESEND_REQUEST_FAILED";
      }
      throw error;
    }
  } catch (error) {
    const responseCode = Number(error?.statusCode || error?.responseCode || 0) || null;
    if (responseCode) {
      error.responseCode = responseCode;
    }

    if ((error?.responseCode === 401 || error?.responseCode === 403) && !error?.code) {
      error.code = error.responseCode === 403 ? "ERESEND_FORBIDDEN" : "ERESEND_AUTH";
    } else if (error?.responseCode === 429 && !error?.code) {
      error.code = "ERESEND_RATE_LIMIT";
    }

    if (!error?.code) {
      const networkError = new Error(error?.message || "resend_network_error");
      networkError.code = "ERESEND_NETWORK";
      throw networkError;
    }

    throw error;
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

function parseToilets(rows) {
  return rows
    .filter((row) => row && row.active !== false)
    .map((row) => {
      const coords = row?.location?.coordinates;
      if (!Array.isArray(coords) || coords.length < 2) {
        return null;
      }

      const lon = Number(coords[0]);
      const lat = Number(coords[1]);
      if (!isFiniteNumber(lat) || !isFiniteNumber(lon)) {
        return null;
      }

      return {
        id: row.id,
        name: row.name || "Public toilet",
        lat,
        lon,
        areaName: row?.areas?.name || "Unknown area",
        accessible: row.accessible,
        babyChange: row.baby_change,
        noPayment: row.no_payment,
        radar: row.radar,
        allGender: row.all_gender,
        notes: row.notes,
        openingTimes: row.opening_times,
        updatedAt: row.updated_at
      };
    })
    .filter(Boolean);
}

async function getDataset() {
  const now = Date.now();
  const cacheIsFresh = now - ukCache.fetchedAt < CACHE_TTL_MS && ukCache.toilets.length > 0;
  if (cacheIsFresh) {
    return ukCache;
  }

  const datasetPageResponse = await fetch(DATASET_PAGE_URL, {
    headers: {
      "User-Agent": "HowFarFromPotty/1.0"
    }
  });
  if (!datasetPageResponse.ok) {
    throw new Error(`Dataset page request failed (${datasetPageResponse.status})`);
  }

  const datasetPageHtml = await datasetPageResponse.text();
  const exportLinks = datasetPageHtml.match(DATASET_LINK_REGEX) || [];
  if (!exportLinks.length) {
    throw new Error("Unable to find a JSON export URL in the dataset page.");
  }

  const sourceUrl = exportLinks[0].replace(/&amp;/g, "&");
  const dataResponse = await fetch(sourceUrl, {
    headers: {
      "User-Agent": "HowFarFromPotty/1.0"
    }
  });
  if (!dataResponse.ok) {
    throw new Error(`Dataset JSON request failed (${dataResponse.status})`);
  }

  const rows = await dataResponse.json();
  if (!Array.isArray(rows)) {
    throw new Error("Dataset JSON format was not an array.");
  }

  ukCache = {
    fetchedAt: now,
    sourceUrl,
    toilets: parseToilets(rows)
  };

  return ukCache;
}

function normalizeUsToilet(row) {
  const lat = Number(row?.latitude);
  const lon = Number(row?.longitude);
  if (!isFiniteNumber(lat) || !isFiniteNumber(lon)) {
    return null;
  }

  const notes = [clampText(row?.directions), clampText(row?.comment)].filter(Boolean).join(" | ");
  const areaParts = [row?.city, row?.state].filter(Boolean);

  return {
    id: String(row.id),
    name: clampText(row?.name, 120) || "Public restroom",
    lat,
    lon,
    areaName: areaParts.length ? areaParts.join(", ") : "Unknown area",
    accessible: row?.accessible === true,
    babyChange: row?.changing_table === true,
    noPayment: null,
    radar: null,
    allGender: row?.unisex === true,
    notes: notes || null,
    openingTimes: null,
    updatedAt: row?.updated_at || row?.created_at || null,
    country: row?.country || null,
    approved: row?.approved === true
  };
}

async function getUsNearest(lat, lon, limit) {
  const perPage = 100;
  const maxPages = 4;
  const seenIds = new Set();
  const candidates = [];

  for (let page = 0; page < maxPages; page += 1) {
    const offset = page * perPage;
    const endpoint = `${US_API_BASE_URL}/restrooms/by_location?lat=${encodeURIComponent(
      lat
    )}&lng=${encodeURIComponent(lon)}&per_page=${perPage}&offset=${offset}`;

    const response = await fetch(endpoint, {
      headers: {
        "User-Agent": "HowFarFromPotty/1.0",
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`US API request failed (${response.status})`);
    }

    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      break;
    }

    for (const row of rows) {
      if (row?.approved !== true) {
        continue;
      }

      const toilet = normalizeUsToilet(row);
      if (!toilet || seenIds.has(toilet.id)) {
        continue;
      }

      seenIds.add(toilet.id);
      candidates.push(toilet);
    }

    const usCount = candidates.filter((toilet) => toilet.country === "US").length;
    if (usCount >= limit) {
      break;
    }
  }

  const pool = candidates.some((toilet) => toilet.country === "US")
    ? candidates.filter((toilet) => toilet.country === "US")
    : candidates;

  return pool
    .map((toilet) => ({
      ...toilet,
      distanceKm: haversineKm(lat, lon, toilet.lat, toilet.lon)
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, limit);
}

function sanitizePath(pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const normalizedPath = normalize(decodeURIComponent(safePath)).replace(/^(\.\.[/\\])+/, "");
  return join(ROOT_DIR, normalizedPath);
}

const server = createServer(async (req, res) => {
  try {
    const base = `http://${req.headers.host || "localhost"}`;
    const url = new URL(req.url || "/", base);

    if (url.pathname === "/api/feature-request") {
      if (req.method !== "POST") {
        sendJson(res, 405, {
          error: "method_not_allowed",
          message: "Use POST for feature requests."
        });
        return;
      }

      let requestBody;
      try {
        requestBody = await readJsonBody(req);
      } catch (error) {
        if (error.message === "payload_too_large") {
          sendJson(res, 413, {
            error: "payload_too_large",
            message: "Feature request payload is too large."
          });
          return;
        }

        sendJson(res, 400, {
          error: "invalid_payload",
          message: "Send a valid JSON body."
        });
        return;
      }

      const featureRequest = {
        name: sanitizeFeatureInput(requestBody?.name, 80),
        email: sanitizeFeatureInput(requestBody?.email, 120),
        subject: sanitizeFeatureInput(requestBody?.subject, 120),
        message: sanitizeFeatureInput(requestBody?.message, 3000)
      };

      if (!featureRequest.subject || !featureRequest.message) {
        sendJson(res, 400, {
          error: "missing_fields",
          message: "Both subject and message are required."
        });
        return;
      }

      try {
        await sendFeatureRequestEmail(featureRequest);
        sendJson(res, 200, {
          ok: true,
          message: "Feature request sent.",
          to: FEATURE_REQUEST_TO
        });
        return;
      } catch (error) {
        if (error.message === "email_not_configured") {
          console.error(
            `[feature-request] Email provider is not configured. Missing: ${(error.missing || []).join(", ")}`
          );
          sendJson(res, 503, {
            error: "email_not_configured",
            message: "Feature request delivery is not configured on this server.",
            missing: Array.isArray(error.missing) ? error.missing : []
          });
          return;
        }

        const mappedError = mapEmailSendError(error);
        console.error("[feature-request] Email send failed:", {
          message: error?.message || "unknown_error",
          code: error?.code || null,
          responseCode: error?.responseCode || null
        });
        sendJson(res, mappedError.statusCode, mappedError.body);
        return;
      }
    }

    if (url.pathname === "/api/nearest") {
      const lat = Number(url.searchParams.get("lat"));
      const lon = Number(url.searchParams.get("lon"));
      const requestedLimit = Number(url.searchParams.get("limit") || 5);
      const limit = Number.isFinite(requestedLimit)
        ? Math.min(Math.max(Math.floor(requestedLimit), 1), 20)
        : 5;

      if (!isFiniteNumber(lat) || !isFiniteNumber(lon)) {
        sendJson(res, 400, {
          error: "invalid_coordinates",
          message: "Please provide numeric lat and lon query parameters."
        });
        return;
      }

      if (isInUkBounds(lat, lon)) {
        const { toilets, sourceUrl, fetchedAt } = await getDataset();
        const nearest = toilets
          .map((toilet) => ({
            ...toilet,
            distanceKm: haversineKm(lat, lon, toilet.lat, toilet.lon)
          }))
          .sort((a, b) => a.distanceKm - b.distanceKm)
          .slice(0, limit);

        sendJson(res, 200, {
          count: nearest.length,
          query: { lat, lon, limit, region: "UK" },
          source: {
            name: "The Great British Public Toilet Map",
            datasetPage: DATASET_PAGE_URL,
            datasetExport: sourceUrl,
            license: "CC BY 4.0",
            cachedAt: new Date(fetchedAt).toISOString()
          },
          toilets: nearest
        });
        return;
      }

      if (isInUsBounds(lat, lon)) {
        const nearest = await getUsNearest(lat, lon, limit);

        sendJson(res, 200, {
          count: nearest.length,
          query: { lat, lon, limit, region: "US" },
          source: {
            name: "Refuge Restrooms API",
            docs: US_SOURCE_DOCS_URL,
            endpoint: `${US_API_BASE_URL}/restrooms/by_location`,
            cachedAt: new Date().toISOString()
          },
          toilets: nearest
        });
        return;
      }

      sendJson(res, 400, {
        error: "outside_supported_regions",
        message: "This app currently supports UK and US locations only."
      });
      return;
    }

    const filePath = sanitizePath(url.pathname);
    if (!filePath.startsWith(ROOT_DIR)) {
      res.writeHead(403, { "Content-Type": contentTypes[".txt"] });
      res.end("Forbidden");
      return;
    }

    const ext = extname(filePath).toLowerCase();
    const contentType = contentTypes[ext] || "application/octet-stream";
    const content = await readFile(filePath);
    const noStoreExt = new Set([".html", ".js", ".css"]);

    res.writeHead(200, {
      "Cache-Control": noStoreExt.has(ext) ? "no-store" : "public, max-age=3600",
      "Content-Type": contentType
    });
    res.end(content);
  } catch (error) {
    if (error?.code === "ENOENT") {
      res.writeHead(404, { "Content-Type": contentTypes[".txt"] });
      res.end("Not found");
      return;
    }

    res.writeHead(500, { "Content-Type": contentTypes[".txt"] });
    res.end("Internal server error");
  }
});

server.listen(PORT, () => {
  console.log(`HowFarFromPotty running at http://localhost:${PORT}`);
});
