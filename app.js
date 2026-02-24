const locateButton = document.querySelector("#locate-button");
const statusLine = document.querySelector("#status");
const currentLocationLine = document.querySelector("#current-location");
const resultsList = document.querySelector("#results");
const mapElement = document.querySelector("#toilet-map");
const featureRequestButton = document.querySelector("#feature-request-button");
const featureRequestDialog = document.querySelector("#feature-request-dialog");
const featureRequestForm = document.querySelector("#feature-request-form");
const featureRequestStatus = document.querySelector("#feature-request-status");
const featureRequestSubmit = document.querySelector("#feature-submit");
const closeFeatureRequestButton = document.querySelector("#close-feature-request");
const cancelFeatureRequestButton = document.querySelector("#feature-cancel");
const FEATURE_REQUEST_TIMEOUT_MS = 20000;

let map;
let tileLayer;
let mapMarkers;
let userMarker;
let hoverPath;
let hoverDistanceMarker;
let currentUserLocation;
const toiletsById = new Map();
const toiletMarkersById = new Map();

function initMap() {
  if (map || !mapElement) {
    return;
  }

  if (!window.L) {
    setStatus("Map library failed to load. Please refresh the page.");
    return;
  }

  map = window.L.map(mapElement, {
    zoomControl: true
  }).setView([54.5, -2.2], 6);

  tileLayer = window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  });
  tileLayer.addTo(map);

  mapMarkers = window.L.layerGroup().addTo(map);
  requestAnimationFrame(() => map.invalidateSize());
  setTimeout(() => map.invalidateSize(), 250);
}

function setStatus(message) {
  statusLine.textContent = message;
}

function setFeatureRequestStatus(message, type = "default") {
  if (!featureRequestStatus) {
    return;
  }

  featureRequestStatus.textContent = message;
  featureRequestStatus.classList.remove("error", "success");

  if (type === "error") {
    featureRequestStatus.classList.add("error");
  }

  if (type === "success") {
    featureRequestStatus.classList.add("success");
  }
}

function openFeatureRequestDialog() {
  if (!featureRequestDialog) {
    return;
  }

  if (typeof featureRequestDialog.showModal === "function") {
    featureRequestDialog.showModal();
  } else {
    featureRequestDialog.setAttribute("open", "open");
  }

  setFeatureRequestStatus("");
}

function closeFeatureRequestDialog() {
  if (!featureRequestDialog) {
    return;
  }

  if (typeof featureRequestDialog.close === "function") {
    featureRequestDialog.close();
  } else {
    featureRequestDialog.removeAttribute("open");
  }
}

async function submitFeatureRequest(event) {
  event.preventDefault();
  if (!featureRequestForm || !featureRequestSubmit) {
    return;
  }

  const formData = new FormData(featureRequestForm);
  const payload = {
    name: String(formData.get("name") || "").trim(),
    email: String(formData.get("email") || "").trim(),
    subject: String(formData.get("subject") || "").trim(),
    message: String(formData.get("message") || "").trim()
  };

  if (!payload.subject || !payload.message) {
    setFeatureRequestStatus("Subject and request are required.", "error");
    return;
  }

  featureRequestSubmit.disabled = true;
  setFeatureRequestStatus("Sending feature request...");

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), FEATURE_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch("/api/feature-request", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    clearTimeout(timeoutHandle);

    const responseBody = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (responseBody?.error === "smtp_not_configured" || responseBody?.error === "email_not_configured") {
        const missing = Array.isArray(responseBody.missing) ? responseBody.missing.join(", ") : "";
        const hint = missing ? ` Missing: ${missing}.` : "";
        throw new Error(`Server email is not configured.${hint}`);
      }
      throw new Error(responseBody.message || "Unable to send feature request.");
    }

    setFeatureRequestStatus("Feature request sent.", "success");
    featureRequestForm.reset();
    const subjectInput = featureRequestForm.querySelector("#feature-subject");
    if (subjectInput) {
      subjectInput.value = "Feature request for How Far From Potty";
    }
    setTimeout(() => closeFeatureRequestDialog(), 650);
  } catch (error) {
    clearTimeout(timeoutHandle);
    if (error?.name === "AbortError") {
      setFeatureRequestStatus(
        "Feature request timed out. Please try again in a moment.",
        "error"
      );
      return;
    }
    setFeatureRequestStatus(error.message || "Unable to send feature request.", "error");
  } finally {
    featureRequestSubmit.disabled = false;
  }
}

function clearHoverPath() {
  if (!map) {
    return;
  }

  if (hoverPath) {
    map.removeLayer(hoverPath);
    hoverPath = null;
  }

  if (hoverDistanceMarker) {
    map.removeLayer(hoverDistanceMarker);
    hoverDistanceMarker = null;
  }
}

function clearResults() {
  clearHoverPath();
  resultsList.innerHTML = "";
}

function formatDistance(km) {
  if (km < 1) {
    return `${Math.round(km * 1000)} m`;
  }
  return `${km.toFixed(2)} km`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderTag(text, warning = false) {
  return `<span class="tag${warning ? " warning" : ""}">${text}</span>`;
}

function showHoverPath(toiletId) {
  initMap();
  if (!map || !currentUserLocation || !toiletsById.has(toiletId)) {
    return;
  }

  clearHoverPath();

  const toilet = toiletsById.get(toiletId);
  const start = [currentUserLocation.lat, currentUserLocation.lon];
  const end = [toilet.lat, toilet.lon];
  const midpoint = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];

  hoverPath = window.L.polyline([start, end], {
    color: "#e6843d",
    weight: 4,
    opacity: 0.95,
    dashArray: "8 8"
  }).addTo(map);

  hoverDistanceMarker = window.L.marker(midpoint, {
    interactive: false,
    keyboard: false,
    icon: window.L.divIcon({
      className: "distance-chip",
      html: `<span>${formatDistance(toilet.distanceKm)} away</span>`
    })
  }).addTo(map);

  const marker = toiletMarkersById.get(toiletId);
  if (marker) {
    marker.openPopup();
  }
}

function bindResultInteractions() {
  const items = resultsList.querySelectorAll(".result-item");
  items.forEach((item) => {
    const toiletId = item.getAttribute("data-toilet-id");
    if (!toiletId) {
      return;
    }

    item.addEventListener("mouseenter", () => showHoverPath(toiletId));
    item.addEventListener("mouseleave", () => {
      clearHoverPath();
      const marker = toiletMarkersById.get(toiletId);
      if (marker) {
        marker.closePopup();
      }
    });

    item.addEventListener("focusin", () => showHoverPath(toiletId));
    item.addEventListener("focusout", (event) => {
      if (item.contains(event.relatedTarget)) {
        return;
      }

      clearHoverPath();
      const marker = toiletMarkersById.get(toiletId);
      if (marker) {
        marker.closePopup();
      }
    });
  });
}

function updateMap(latitude, longitude, toilets) {
  initMap();
  if (!map || !mapMarkers) {
    return;
  }

  clearHoverPath();
  mapMarkers.clearLayers();
  toiletMarkersById.clear();
  toiletsById.clear();
  currentUserLocation = { lat: latitude, lon: longitude };

  if (userMarker) {
    map.removeLayer(userMarker);
  }

  userMarker = window.L.circleMarker([latitude, longitude], {
    radius: 9,
    color: "#7d0014",
    weight: 3,
    fillColor: "#ff2d55",
    fillOpacity: 0.95
  }).addTo(map);
  userMarker.bindPopup("You are here");

  const boundsPoints = [[latitude, longitude]];

  toilets.forEach((toilet) => {
    toiletsById.set(toilet.id, toilet);

    const marker = window.L.marker([toilet.lat, toilet.lon], {
      title: toilet.name
    });

    marker.bindPopup(
      `<strong>${escapeHtml(toilet.name)}</strong><br>${escapeHtml(toilet.areaName)}<br>${formatDistance(
        toilet.distanceKm
      )} away`
    );

    marker.addTo(mapMarkers);
    toiletMarkersById.set(toilet.id, marker);
    boundsPoints.push([toilet.lat, toilet.lon]);
  });

  const bounds = window.L.latLngBounds(boundsPoints);
  map.fitBounds(bounds, { padding: [36, 36], maxZoom: 15 });
}

function renderToilet(toilet) {
  const tagList = [];

  if (toilet.accessible === true) {
    tagList.push(renderTag("Accessible"));
  }
  if (toilet.babyChange === true) {
    tagList.push(renderTag("Baby change"));
  }
  if (toilet.radar === true) {
    tagList.push(renderTag("RADAR key"));
  }
  if (toilet.noPayment === true) {
    tagList.push(renderTag("Free"));
  }
  if (toilet.noPayment === false) {
    tagList.push(renderTag("May require payment", true));
  }
  if (toilet.allGender === true) {
    tagList.push(renderTag("All gender"));
  }
  if (tagList.length === 0) {
    tagList.push(renderTag("Amenity details unknown", true));
  }

  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${toilet.lat},${toilet.lon}`
  )}`;

  const safeName = escapeHtml(toilet.name);
  const safeArea = escapeHtml(toilet.areaName);
  const safeNotes = toilet.notes ? escapeHtml(toilet.notes) : "";
  const notes = safeNotes ? `<p class="result-meta">Notes: ${safeNotes}</p>` : "";

  return `
    <li class="result-item" data-toilet-id="${toilet.id}" tabindex="0">
      <div class="result-head">
        <span class="result-name">${safeName}</span>
        <span class="result-distance">${formatDistance(toilet.distanceKm)}</span>
      </div>
      <p class="result-meta">Area: ${safeArea}</p>
      ${notes}
      <div class="tags">${tagList.join("")}</div>
      <a class="result-link" href="${mapsUrl}" target="_blank" rel="noopener noreferrer">
        Open in maps
      </a>
    </li>
  `;
}

function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation is not supported in this browser."));
      return;
    }

    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0
    });
  });
}

async function findNearestToilets() {
  initMap();
  locateButton.disabled = true;
  setStatus("Requesting your location...");
  clearResults();
  currentLocationLine.textContent = "";

  try {
    const position = await getCurrentPosition();
    const { latitude, longitude } = position.coords;
    setStatus("Finding nearby toilets...");

    currentLocationLine.textContent = `Your location: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;

    const response = await fetch(
      `/api/nearest?lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}&limit=5`
    );

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.message || "Unable to look up nearest toilets.");
    }

    if (!payload.toilets.length) {
      updateMap(latitude, longitude, []);
      setStatus(`No nearby toilets found from ${payload.source?.name || "the selected data source"}.`);
      return;
    }

    resultsList.innerHTML = payload.toilets.map(renderToilet).join("");
    bindResultInteractions();
    updateMap(latitude, longitude, payload.toilets);
    setStatus(
      `Showing ${payload.toilets.length} closest toilets from ${payload.source?.name || "the data source"} (${payload.query?.region || "Auto"}).`
    );
  } catch (error) {
    setStatus(error.message || "Something went wrong while finding toilets.");
  } finally {
    locateButton.disabled = false;
  }
}

initMap();
window.addEventListener("load", () => {
  if (map) {
    map.invalidateSize();
  }
});
window.addEventListener("resize", () => {
  if (map) {
    map.invalidateSize();
  }
});
locateButton.addEventListener("click", findNearestToilets);

if (featureRequestButton && featureRequestDialog && featureRequestForm) {
  featureRequestButton.addEventListener("click", openFeatureRequestDialog);
  featureRequestForm.addEventListener("submit", submitFeatureRequest);
  closeFeatureRequestButton?.addEventListener("click", closeFeatureRequestDialog);
  cancelFeatureRequestButton?.addEventListener("click", closeFeatureRequestDialog);

  featureRequestDialog.addEventListener("click", (event) => {
    if (event.target === featureRequestDialog) {
      closeFeatureRequestDialog();
    }
  });
}
