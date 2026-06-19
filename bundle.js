/* Territory Manager Community Starter
   GitHub Pages frontend + optional Supabase backend.
*/
const ZIP_URLS = [
  "https://raw.githubusercontent.com/OpenDataDE/State-zip-code-GeoJSON/master/ca_california_zip_codes_geo.min.json",
  "https://raw.githubusercontent.com/OpenDataDE/State-zip-code-GeoJSON/master/ca_california_zip_codes_geo.min.json?cacheBust=1"
];
const STORAGE_KEY = "tm-community-state-v1";

const defaultState = {
  teams: [
    { id: "team1", name: "Team 1", color: "#2563eb" },
    { id: "team2", name: "Team 2", color: "#9333ea" },
    { id: "team3", name: "Team 3", color: "#ec4899" },
    { id: "team4", name: "Team 4", color: "#0f766e" },
    { id: "team5", name: "Team 5", color: "#f59e0b" },
    { id: "team6", name: "Team 6", color: "#22c55e" }
  ],
  territories: {},
  coverageAreas: {},
  settings: {
    boundaryMode: "auto",
    labelsMode: "off",
    zipZoom: 9,
    timeMode: "months",
    threshold: 3,
    userColor: "#22c55e",
    userTag: "",
    coverageFilterMode: "all",
    coverageFilterTag: "",
    shareLocation: "off"
  }
};

let state = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") || structuredClone(defaultState);
let currentUser = null;
let isAdmin = false;
let supabaseClient = null;
let zipData = null;
let zipLayer = null;
let coverageLayer = null;
let coverageTagLayer = null;
let activeDrawingLayer = null;
let myLocationMarker = null;
let myAccuracyCircle = null;
let locationWatchId = null;
let teamLocationLayer = null;
let teamLocationRefreshTimer = null;
let selectedZip = null;
let selectedCoverageId = null;
let renderTimer = null;
let coverageSyncTimer = null;
let isDrawing = false;
let drawingPoints = [];
let editingCoverageId = null;
let isPointerDrawing = false;
let zipPopupOpen = false;

const hasSupabase = Boolean(window.TM_SUPABASE_URL && window.TM_SUPABASE_ANON_KEY);

if (hasSupabase && window.supabase) {
  supabaseClient = window.supabase.createClient(window.TM_SUPABASE_URL, window.TM_SUPABASE_ANON_KEY);
}

const map = L.map("map", { preferCanvas: true }).setView([38.8, -121.3], 7);

// Dedicated panes keep ZIPs and freehand coverage from fighting each other.
map.createPane("coveragePane");
map.getPane("coveragePane").style.zIndex = 390;
map.getPane("coveragePane").style.pointerEvents = "auto";

map.createPane("zipPane");
map.getPane("zipPane").style.zIndex = 470;
map.getPane("zipPane").style.pointerEvents = "auto";

map.createPane("tagPane");
map.getPane("tagPane").style.zIndex = 650;
map.getPane("tagPane").style.pointerEvents = "auto";

const canvasRenderer = L.canvas({ padding: 0.5 });
const zipRenderer = L.canvas({ padding: 0.5, pane: "zipPane" });
const coverageRenderer = L.canvas({ padding: 0.5, pane: "coveragePane" });

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

function saveLocal() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function ensureZipLineSettings() {
  state.settings = state.settings || {};
  if (!state.settings.boundaryMode || state.settings.boundaryMode === "on") state.settings.boundaryMode = "auto";
  if (!state.settings.zipZoom) state.settings.zipZoom = 9;
  if (!state.settings.labelsMode) state.settings.labelsMode = "off";
}
ensureZipLineSettings();


function teamById(id) {
  return state.teams.find(t => t.id === id) || state.teams[0];
}

function hexToRgb(hex) {
  const n = parseInt(String(hex || "#000000").replace("#", ""), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function rgbToHex(r,g,b) {
  const h = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return "#" + h(r) + h(g) + h(b);
}
function mix(a,b,t) {
  const x = hexToRgb(a), y = hexToRgb(b);
  return rgbToHex(x.r+(y.r-x.r)*t, x.g+(y.g-x.g)*t, x.b+(y.b-x.b)*t);
}

function ensureCoverageState() {
  state.coverageAreas = state.coverageAreas || {};
  state.settings = state.settings || {};
  state.settings.userColor = state.settings.userColor || "#22c55e";
  state.settings.userTag = state.settings.userTag || "";
  state.settings.coverageFilterMode = state.settings.coverageFilterMode || "all";
  state.settings.coverageFilterTag = state.settings.coverageFilterTag || "";
}
ensureCoverageState();

function coverageColor(area) {
  const base = area.color || "#22c55e";
  if (!area.last_worked) return base;
  const pct = Math.max(0, Math.min(1, elapsedUnits(area.last_worked) / Number(state.settings.threshold || 3)));
  // As the area ages, it fades toward black using the same timer as ZIPs.
  return mix(base, "#000000", pct);
}

function coverageOpacity(area) {
  if (!area.last_worked) return 0.28;
  const pct = Math.max(0, Math.min(1, elapsedUnits(area.last_worked) / Number(state.settings.threshold || 3)));
  return 0.62 - (pct * 0.18);
}

function userDisplayName() {
  return state.settings.userTag || currentUser?.email || "Local user";
}

async function saveUserProfile() {
  ensureCoverageState();

  const nameEl = document.getElementById("profileNameInput") || document.getElementById("userTagInput");
  const colorEl = document.getElementById("profileColorInput") || document.getElementById("userColorInputFab");

  const displayName = nameEl ? nameEl.value.trim() : "";
  const color = colorEl ? colorEl.value : "#22c55e";

  state.settings.userTag = displayName || state.settings.userTag || currentUser?.email || "User";
  state.settings.userColor = color || state.settings.userColor || "#22c55e";
  saveLocal();

  syncProfileInputs();

  // Make existing drawings by this account match the account settings.
  state.coverageAreas = state.coverageAreas || {};
  Object.values(state.coverageAreas).forEach(area => {
    if (!area) return;
    const belongsToUser = currentUser
      ? (area.user_id === currentUser.id || area.user_email === currentUser.email)
      : (area.user_email === state.settings.userTag || area.user_tag === state.settings.userTag);
    if (belongsToUser) {
      area.user_tag = state.settings.userTag;
      area.color = state.settings.userColor;
      area.user_email = currentUser?.email || area.user_email || state.settings.userTag;
    }
  });
  saveLocal();
  renderCoverageAreas();

  if (supabaseClient && currentUser) {
    await supabaseClient.from("user_profiles").upsert({
      user_id: currentUser.id,
      email: currentUser.email,
      display_name: state.settings.userTag,
      color: state.settings.userColor,
      updated_at: new Date().toISOString()
    });

    await supabaseClient
      .from("coverage_areas")
      .update({
        user_tag: state.settings.userTag,
        color: state.settings.userColor,
        updated_at: new Date().toISOString()
      })
      .eq("user_id", currentUser.id);
  }

  alert("Profile saved. Your existing drawings now match this name/color.");
}

function syncProfileInputs() {
  const ids = ["profileNameInput", "userTagInput"];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = state.settings.userTag || "";
  });

  const colorIds = ["profileColorInput", "userColorInputFab", "userColorInput"];
  colorIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = state.settings.userColor || "#22c55e";
  });
}

async function loadUserProfile() {
  if (!supabaseClient || !currentUser) {
    syncProfileInputs();
    return;
  }

  const { data } = await supabaseClient
    .from("user_profiles")
    .select("*")
    .eq("user_id", currentUser.id)
    .maybeSingle();

  if (data) {
    state.settings.userTag = data.display_name || state.settings.userTag || currentUser.email;
    state.settings.userColor = data.color || state.settings.userColor || "#22c55e";
    saveLocal();
  } else if (!state.settings.userTag) {
    state.settings.userTag = currentUser.email;
    saveLocal();
  }

  syncProfileInputs();
}

function coveragePassesFilter(area) {
  const mode = state.settings.coverageFilterMode || "all";
  const tag = String(state.settings.coverageFilterTag || "").trim().toLowerCase();

  if (mode === "all") return true;

  if (mode === "mine") {
    if (!currentUser) return area.user_email === state.settings.userTag || area.user_tag === state.settings.userTag;
    return area.user_id === currentUser.id || area.user_email === currentUser.email;
  }

  if (mode === "tag") {
    if (!tag) return true;
    const combined = `${area.user_tag || ""} ${area.user_email || ""}`.toLowerCase();
    return combined.includes(tag);
  }

  return true;
}


function normalizeCoverageArea(row, previous = {}) {
  if (!row || !row.id) return null;

  const userEmail = row.user_email || previous.user_email || "";
  const fallbackTag =
    row.user_tag ||
    previous.user_tag ||
    userEmail ||
    state.settings.userTag ||
    "Coverage";

  return {
    id: row.id,
    zip: row.zip || previous.zip || null,
    user_id: row.user_id || previous.user_id || null,
    user_email: userEmail,
    user_tag: fallbackTag,
    color: row.color || previous.color || "#22c55e",
    last_worked: row.last_worked || previous.last_worked || null,
    geometry: row.geometry || previous.geometry
  };
}

function elapsedUnits(dateStr) {
  if (!dateStr) return 0;
  const days = Math.max(0, (Date.now() - new Date(dateStr + "T00:00:00").getTime()) / 86400000);
  if (state.settings.timeMode === "days") return days;
  if (state.settings.timeMode === "weeks") return days / 7;
  return days / 30.4375;
}
function territoryColor(zip) {
  const t = state.territories[zip];
  if (!t || !t.last_worked) return "transparent";
  const owner = teamById(t.owner_team_id || state.teams[0].id);
  const handoff = teamById(t.handoff_team_id || state.teams[Math.min(1,state.teams.length-1)].id);
  const pct = Math.max(0, Math.min(1, elapsedUnits(t.last_worked) / Number(state.settings.threshold || 3)));
  return mix(owner.color, handoff.color, pct);
}
function zipCode(f) {
  const p = f.properties || {};
  return String(p.ZCTA5CE10 || p.ZCTA5CE20 || p.zip_code || p.ZIP_CODE || p.zip || p.name || "");
}
function featureInBounds(feature, bounds) {
  try {
    return bounds.intersects(L.geoJSON(feature).getBounds());
  } catch {
    return false;
  }
}
function shouldShowMapWorkLayers() {
  ensureZipLineSettings();
  if (state.settings.boundaryMode === "off") return false;
  const minZoom = Number(state.settings.zipZoom || 9);
  return map.getZoom() >= minZoom;
}

function shouldShowZips() {
  return shouldShowMapWorkLayers();
}
function zipStyle(feature) {
  const zip = zipCode(feature);
  const zoom = map.getZoom();
  const selected = selectedZip === zip;
  let weight = zoom <= 8 ? 0.55 : zoom <= 10 ? 0.95 : zoom <= 12 ? 1.35 : 1.8;
  return {
    pane: "zipPane",
    renderer: zipRenderer,
    color: selected ? "#2563eb" : "#000",
    weight: selected ? weight + 1.5 : weight,
    opacity: 1,
    fillColor: territoryColor(zip),
    fillOpacity: state.territories[zip]?.last_worked ? 0.42 : 0.01,
    interactive: true
  };
}
function bindTooltip(layer, feature) {
  const z = zipCode(feature);
  layer.bindTooltip(z, { permanent:true, direction:"center", className:"zip-label" });
  updateLabels();
}
function updateLabels() {
  if (!zipLayer) return;
  const mode = state.settings.labelsMode;
  const show = mode === "on" || (mode === "auto" && map.getZoom() >= 11);
  zipLayer.eachLayer(l => {
    if (show) { try { l.openTooltip(); } catch {} }
    else { try { l.closeTooltip(); } catch {} }
  });
}
function renderVisibleZips() {
  if (zipLayer) {
    map.removeLayer(zipLayer);
    zipLayer = null;
  }

  if (!zipData) return;

  if (!shouldShowZips()) {
    updateSelectedInfo();
    return;
  }

  const b = map.getBounds().pad(0.35);
  const features = (zipData.features || []).filter(f => featureInBounds(f, b)).slice(0, 900);

  zipLayer = L.geoJSON({ type:"FeatureCollection", features }, {
    pane: "zipPane",
    renderer: zipRenderer,
    style: zipStyle,
    interactive: true,
    onEachFeature: (f, layer) => {
      bindTooltip(layer, f);
      layer.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        selectedZip = zipCode(f);
        openZipPopup(layer, selectedZip);
        updateSelectedInfo();
        if (zipLayer) zipLayer.setStyle(zipStyle);
      });
    }
  }).addTo(map);

  try { zipLayer.bringToFront(); } catch {}
  if (coverageTagLayer) try { coverageTagLayer.bringToFront(); } catch {}
  updateLabels();
}
function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderVisibleZips, 160);
}
async function loadZipData() {
  const infoEl = document.getElementById("selectedInfo");
  if (infoEl) infoEl.innerHTML = "Loading ZIP data…";

  const cached = localStorage.getItem("tm_zip_geojson_cache");
  if (cached) {
    try {
      zipData = JSON.parse(cached);
      scheduleRender();
    } catch {}
  }

  for (const url of ZIP_URLS) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error("ZIP fetch failed " + res.status);
      const data = await res.json();
      if (!data || !data.features || !data.features.length) throw new Error("ZIP data empty");
      zipData = data;
      try { localStorage.setItem("tm_zip_geojson_cache", JSON.stringify(zipData)); } catch {}
      scheduleRender();
      updateSelectedInfo();
      return;
    } catch (err) {
      console.warn("ZIP source failed:", url, err.message);
    }
  }

  if (infoEl) infoEl.innerHTML = "Could not load ZIP boundaries. Check connection, then refresh.";
}
function teamOptions(selectedId) {
  return state.teams.map(t => `<option value="${t.id}" ${selectedId === t.id ? "selected" : ""}>${t.name}</option>`).join("");
}
function openZipPopup(layer, zip) {
  zipPopupOpen = true;
  const t = state.territories[zip] || {};
  const defaultOwner = state.teams[0]?.id || "team1";
  const defaultHandoff = state.teams[1]?.id || defaultOwner;
  const today = new Date().toISOString().slice(0,10);
  const yesterdayDate = new Date(Date.now() - 86400000).toISOString().slice(0,10);
  layer.bindPopup(`
    <div class="zipQuickMenu">
      <div class="zipTitle">ZIP ${zip}</div>
      <div class="zipSub">Last worked: ${t.last_worked || "Not set"}</div>

      <div class="quickGrid">
        <button onclick="setZipDate('${zip}', '${today}')">Today</button>
        <button class="secondary" onclick="setZipDate('${zip}', '${yesterdayDate}')">Yesterday</button>
      </div>

      <label>Past date / exact date</label>
      <div class="dateRow">
        <input id="date_${zip}" type="date" value="${t.last_worked || ""}">
        <button onclick="saveDateForZip('${zip}')">Save</button>
      </div>

      <details open>
        <summary>Teams</summary>
        <label>Owner team</label>
        <select id="owner_${zip}">${teamOptions(t.owner_team_id || defaultOwner)}</select>
        <label>Handoff team</label>
        <select id="handoff_${zip}">${teamOptions(t.handoff_team_id || defaultHandoff)}</select>
        <button class="secondary" onclick="saveTeamsForZip('${zip}')">Save Teams</button>
      </details>

      <details>
        <summary>Notes</summary>
        <textarea id="notes_${zip}" placeholder="Notes for this ZIP...">${t.notes || ""}</textarea>
        <button class="secondary" onclick="saveNotesForZip('${zip}')">Save Notes</button>
      </details>

      <button class="danger" onclick="clearZip('${zip}')">Clear ZIP</button>
    </div>
  `).openPopup();
}
window.markToday = async function(zip) {
  state.territories[zip] = state.territories[zip] || {};
  state.territories[zip].last_worked = new Date().toISOString().slice(0,10);
  await saveTerritory(zip);
  refreshMap();
  zipPopupOpen = true;
};

window.setZipDate = async function(zip, dateValue) {
  state.territories[zip] = state.territories[zip] || {};
  state.territories[zip].last_worked = dateValue;
  await saveTerritory(zip);
  refreshMap();
};

window.saveDateForZip = async function(zip) {
  const el = document.getElementById("date_" + zip);
  if (!el || !el.value) return;
  state.territories[zip] = state.territories[zip] || {};
  state.territories[zip].last_worked = el.value;
  await saveTerritory(zip);
  refreshMap();
  zipPopupOpen = true;
};

window.saveTeamsForZip = async function(zip) {
  state.territories[zip] = state.territories[zip] || {};
  state.territories[zip].owner_team_id = document.getElementById("owner_"+zip).value;
  state.territories[zip].handoff_team_id = document.getElementById("handoff_"+zip).value;
  await saveTerritory(zip);
  refreshMap();
  zipPopupOpen = true;
};
window.saveNotesForZip = async function(zip) {
  state.territories[zip] = state.territories[zip] || {};
  state.territories[zip].notes = document.getElementById("notes_"+zip).value.trim();
  await saveTerritory(zip);
  refreshMap();
  zipPopupOpen = true;
};
window.clearZip = async function(zip) {
  delete state.territories[zip];
  if (supabaseClient && currentUser) {
    await supabaseClient.from("territories").delete().eq("zip", zip);
  }
  saveLocal();
  refreshMap();
};
function refreshMap() {
  ensureCoverageState();
  ensureZipLineSettings();
  saveLocal();
  renderCoverageAreas();
  if (zipLayer) zipLayer.setStyle(zipStyle);
  if (!zipLayer && zipData && shouldShowZips()) scheduleRender();
  updateSelectedInfo();
}


function coveragePopupHtml(a) {
  return `
    <div class="coveragePopup">
      <strong>Coverage area</strong><br>
      Tag: ${a.user_tag || "Not set"}<br>
      By: ${a.user_email || "Unknown"}<br>
      Date: ${a.last_worked || "Not set"}<br>
      ZIP: ${a.zip || "Not assigned"}<br>

      <label>Tag/name</label>
      <input id="coverageTag_${a.id}" type="text" value="${a.user_tag || ""}" placeholder="Tag above drawing">

      <label>Area color</label>
      <input id="coverageColor_${a.id}" type="color" value="${a.color || "#22c55e"}">

      <label>Worked date</label>
      <input id="coverageDate_${a.id}" type="date" value="${a.last_worked || ""}">

      <button class="secondary" onclick="saveCoverageDetails('${a.id}')">Save Area Details</button>
      <button onclick="startEditCoverageArea('${a.id}')">Redraw / Edit Shape</button>
      <button class="danger" onclick="deleteCoverageArea('${a.id}')">Delete Area</button>
    </div>
  `;
}

function polygonCenterFromGeometry(geometry) {
  try {
    const coords = geometry.coordinates && geometry.coordinates[0] ? geometry.coordinates[0] : [];
    if (!coords.length) return null;
    let lat = 0, lng = 0, count = 0;
    coords.forEach(pair => {
      if (!Array.isArray(pair) || pair.length < 2) return;
      lng += Number(pair[0]);
      lat += Number(pair[1]);
      count++;
    });
    if (!count) return null;
    return [lat / count, lng / count];
  } catch {
    return null;
  }
}

function openCoverageEditor(id) {
  zipPopupOpen = false;
  selectedCoverageId = id;
  const a = state.coverageAreas[id];
  if (!a) return;
  const center = polygonCenterFromGeometry(a.geometry);
  if (!center) return;
  L.popup()
    .setLatLng(center)
    .setContent(coveragePopupHtml(a))
    .openOn(map);
}
window.openCoverageEditor = openCoverageEditor;

function shouldShowCoverageTags() {
  return shouldShowMapWorkLayers() && map.getZoom() >= 10;
}

function renderCoverageAreas() {
  ensureCoverageState();
  if (coverageLayer) {
    map.removeLayer(coverageLayer);
    coverageLayer = null;
  }
  if (coverageTagLayer) {
    map.removeLayer(coverageTagLayer);
    coverageTagLayer = null;
  }

  if (!shouldShowMapWorkLayers()) return;

  const features = Object.values(state.coverageAreas || {})
    .filter(a => a && a.geometry)
    .filter(coveragePassesFilter);

  coverageLayer = L.geoJSON({
    type: "FeatureCollection",
    features: features.map(a => ({
      type: "Feature",
      properties: { id: a.id },
      geometry: a.geometry
    }))
  }, {
    pane: "coveragePane",
    renderer: coverageRenderer,
    interactive: true,
    style: feature => {
      const a = state.coverageAreas[feature.properties.id];
      return {
        pane: "coveragePane",
        color: a.color || "#22c55e",
        weight: 2,
        opacity: 0.95,
        fillColor: coverageColor(a),
        fillOpacity: coverageOpacity(a)
      };
    },
    onEachFeature: (feature, layer) => {
      const a = state.coverageAreas[feature.properties.id];
      layer.bindPopup(coveragePopupHtml(a));
      layer.on("click", () => openCoverageEditor(a.id));
    }
  }).addTo(map);

  coverageTagLayer = L.layerGroup();
  features.forEach(a => {
    const center = polygonCenterFromGeometry(a.geometry);
    if (!center) return;
    const isSelected = selectedCoverageId === a.id;
    if (!shouldShowCoverageTags() && !isSelected) return;
    const tagText = a.user_tag || a.user_email || "Coverage";
    const marker = L.marker(center, {
      pane: "tagPane",
      interactive: true,
      keyboard: false,
      icon: L.divIcon({
        className: "coverage-tag-marker",
        html: `<button class="coverage-tag-button ${isSelected ? "selected-tag" : ""}" onclick="openCoverageEditor('${a.id}')">${tagText}</button>`,
        iconSize: null
      })
    });
    marker.on("click", () => openCoverageEditor(a.id));
    coverageTagLayer.addLayer(marker);
  });
  coverageTagLayer.addTo(map);

  try { if (coverageLayer) coverageLayer.bringToBack(); } catch {}
  try { if (zipLayer) zipLayer.bringToFront(); } catch {}
  try { if (coverageTagLayer) coverageTagLayer.bringToFront(); } catch {}
}

function updateSelectedInfo() {
  if (!selectedZip) {
    document.getElementById("selectedInfo").innerHTML = shouldShowZips()
      ? "Tap a visible ZIP."
      : `ZIP boundaries hidden until zoom ${state.settings.zipZoom}.`;
    return;
  }
  const t = state.territories[selectedZip] || {};
  document.getElementById("selectedInfo").innerHTML = `
    <strong>ZIP ${selectedZip}</strong><br>
    Last worked: ${t.last_worked || "Not set"}<br>
    Owner: ${teamById(t.owner_team_id)?.name || "None"}<br>
    Handoff: ${teamById(t.handoff_team_id)?.name || "None"}<br>
    Notes: ${t.notes || "None"}
  `;
}

// Local/Supabase persistence
async function saveTerritory(zip) {
  saveLocal();
  if (!supabaseClient || !currentUser) return;
  const t = state.territories[zip] || {};
  await supabaseClient.from("territories").upsert({
    zip,
    last_worked: t.last_worked || null,
    owner_team_id: t.owner_team_id || null,
    handoff_team_id: t.handoff_team_id || null,
    notes: t.notes || null,
    updated_by: currentUser.id,
    updated_at: new Date().toISOString()
  });
}
async function loadCloudData() {
  if (!supabaseClient || !currentUser) return;
  const teams = await supabaseClient.from("teams").select("*").order("sort_order");
  if (!teams.error && teams.data?.length) {
    state.teams = teams.data.map(t => ({ id:t.id, name:t.name, color:t.color }));
  }
  const appSettings = await supabaseClient.from("app_settings").select("*").eq("id", "global").maybeSingle();
  if (!appSettings.error && appSettings.data) {
    state.settings.timeMode = appSettings.data.time_mode || state.settings.timeMode || "months";
    state.settings.threshold = Number(appSettings.data.threshold || state.settings.threshold || 3);
  }

  const territories = await supabaseClient.from("territories").select("*");
  if (!territories.error && territories.data) {
    state.territories = {};
    territories.data.forEach(t => {
      state.territories[t.zip] = {
        last_worked: t.last_worked,
        owner_team_id: t.owner_team_id,
        handoff_team_id: t.handoff_team_id,
        notes: t.notes || ""
      };
    });
  }
  const coverage = await supabaseClient.from("coverage_areas").select("*");
  if (!coverage.error && coverage.data) {
    // Supabase is the source of truth. Replace local cache on successful fetch
    // so drawings deleted on another device do not come back from localStorage.
    const freshCoverageAreas = {};
    coverage.data.forEach(a => {
      if (!a || !a.id || !a.geometry) return;
      const normalized = normalizeCoverageArea(a, {});
      if (normalized) freshCoverageAreas[a.id] = normalized;
    });
    state.coverageAreas = freshCoverageAreas;
  } else if (coverage.error) {
    console.warn("Coverage load failed:", coverage.error.message);
  }

  saveLocal();
  renderTeamsEditor();
  refreshMap();
}
function subscribeRealtime() {
  if (!supabaseClient || !currentUser) return;
  supabaseClient.channel("territory-updates")
    .on("postgres_changes", { event:"*", schema:"public", table:"territories" }, payload => {
      const row = payload.new || payload.old;
      if (!row?.zip) return;
      if (payload.eventType === "DELETE") delete state.territories[row.zip];
      else state.territories[row.zip] = {
        last_worked: row.last_worked,
        owner_team_id: row.owner_team_id,
        handoff_team_id: row.handoff_team_id,
        notes: row.notes || ""
      };
      refreshMap();
    })
    .subscribe();

  supabaseClient.channel("coverage-area-updates")
    .on("postgres_changes", { event:"*", schema:"public", table:"coverage_areas" }, payload => {
      const row = payload.new || payload.old;
      if (!row?.id) return;
      if (payload.eventType === "DELETE") {
        delete state.coverageAreas[row.id];
        if (selectedCoverageId === row.id) selectedCoverageId = null;
        saveLocal();
        try { map.closePopup(); } catch {}
      }
      else {
        const normalized = normalizeCoverageArea(row, state.coverageAreas[row.id] || {});
        if (normalized) state.coverageAreas[row.id] = normalized;
      }
      refreshMap();
    })
    .subscribe();

  supabaseClient.channel("app-settings-updates")
    .on("postgres_changes", { event:"*", schema:"public", table:"app_settings" }, payload => {
      const row = payload.new;
      if (!row || row.id !== "global") return;
      state.settings.timeMode = row.time_mode || state.settings.timeMode;
      state.settings.threshold = Number(row.threshold || state.settings.threshold || 3);
      saveLocal();
      initControls();
initLocationControls();
      refreshMap();
    })
    .subscribe();
}

function startCoverageSyncRefresh() {
  if (coverageSyncTimer) clearInterval(coverageSyncTimer);
  if (!supabaseClient || !currentUser) return;

  coverageSyncTimer = setInterval(() => {
    if (!document.hidden && currentUser) {
      loadCloudData();
    }
  }, 15000);
}



// Safe Location Services
function locationDisplayName() {
  return state?.settings?.userTag || currentUser?.email || "Me";
}

function setLocationStatus(text) {
  const el = document.getElementById("locationStatus");
  if (el) el.textContent = text;
}

function locationPaneName() {
  return map.getPane("tagPane") ? "tagPane" : "markerPane";
}

function updateMyLocationMarker(lat, lng, accuracy) {
  const latlng = [lat, lng];

  if (!myLocationMarker) {
    myLocationMarker = L.marker(latlng, {
      pane: locationPaneName(),
      icon: L.divIcon({
        className: "",
        html: '<div class="my-location-dot"></div>',
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      })
    }).addTo(map);
    myLocationMarker.bindTooltip("You", {
      permanent: false,
      direction: "top",
      className: "location-label"
    });
  } else {
    myLocationMarker.setLatLng(latlng);
  }

  if (myAccuracyCircle) {
    try { map.removeLayer(myAccuracyCircle); } catch {}
  }

  myAccuracyCircle = L.circle(latlng, {
    radius: accuracy || 25,
    color: "#1976ff",
    weight: 1,
    opacity: 0.35,
    fillColor: "#1976ff",
    fillOpacity: 0.08,
    interactive: false
  }).addTo(map);
}

async function saveMyLocationToCloud(lat, lng, accuracy) {
  if (!supabaseClient || !currentUser) return;
  if ((state.settings.shareLocation || "off") !== "on") return;

  const { error } = await supabaseClient.from("user_locations").upsert({
    user_id: currentUser.id,
    email: currentUser.email,
    display_name: locationDisplayName(),
    lat,
    lng,
    accuracy: accuracy || null,
    updated_at: new Date().toISOString()
  });

  if (error) console.warn("Location save failed:", error.message);
}

function handleLocationPosition(position, shouldCenter) {
  const { latitude, longitude, accuracy } = position.coords;
  updateMyLocationMarker(latitude, longitude, accuracy);
  setLocationStatus("Location active. Accuracy: " + Math.round(accuracy || 0) + "m");

  if (shouldCenter) {
    map.setView([latitude, longitude], Math.max(map.getZoom(), 14));
  }

  saveMyLocationToCloud(latitude, longitude, accuracy);
}

function locateMe(shouldCenter = true) {
  if (!navigator.geolocation) {
    alert("Location is not supported on this device.");
    return;
  }

  setLocationStatus("Finding your location...");
  navigator.geolocation.getCurrentPosition(
    pos => handleLocationPosition(pos, shouldCenter),
    err => {
      setLocationStatus("Location failed: " + err.message);
      alert("Location failed: " + err.message);
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
  );
}

function startLiveTracking() {
  if (!navigator.geolocation) {
    alert("Location is not supported on this device.");
    return;
  }

  if (locationWatchId !== null) {
    navigator.geolocation.clearWatch(locationWatchId);
  }

  setLocationStatus("Live tracking active...");
  locationWatchId = navigator.geolocation.watchPosition(
    pos => handleLocationPosition(pos, false),
    err => setLocationStatus("Tracking failed: " + err.message),
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 3000 }
  );
}

function stopLiveTracking() {
  if (locationWatchId !== null) {
    navigator.geolocation.clearWatch(locationWatchId);
    locationWatchId = null;
  }
  setLocationStatus("Live tracking stopped.");
}

async function loadTeamLocations() {
  if (!supabaseClient || !currentUser) return;

  const { data, error } = await supabaseClient
    .from("user_locations")
    .select("*")
    .gte("updated_at", new Date(Date.now() - 1000 * 60 * 60).toISOString());

  if (error) {
    console.warn("Team location load failed:", error.message);
    return;
  }

  if (teamLocationLayer) {
    try { map.removeLayer(teamLocationLayer); } catch {}
  }

  teamLocationLayer = L.layerGroup();

  (data || []).forEach(row => {
    if (!row.lat || !row.lng) return;
    if (row.user_id === currentUser.id) return;

    const name = row.display_name || row.email || "User";
    const initials = String(name).trim().split(/\s+/).map(s => s[0]).join("").slice(0,2).toUpperCase();

    const marker = L.marker([row.lat, row.lng], {
      pane: locationPaneName(),
      icon: L.divIcon({
        className: "",
        html: '<div class="team-location-dot">' + (initials || "?") + '</div>',
        iconSize: [28, 28],
        iconAnchor: [14, 14]
      })
    }).bindTooltip(name, {
      permanent: false,
      direction: "top",
      className: "location-label"
    });

    teamLocationLayer.addLayer(marker);
  });

  teamLocationLayer.addTo(map);
}

function startTeamLocationRefresh() {
  if (teamLocationRefreshTimer) clearInterval(teamLocationRefreshTimer);
  if (!supabaseClient || !currentUser) return;
  loadTeamLocations();
  teamLocationRefreshTimer = setInterval(() => {
    if (!document.hidden && currentUser) loadTeamLocations();
  }, 20000);
}

function initLocationControls() {
  const gpsFab = document.getElementById("gpsFab");
  const gpsPanel = document.getElementById("gpsPanel");
  const closeBtn = document.getElementById("closeGpsPanelBtn");
  const locateBtn = document.getElementById("locateMeBtn");
  const followBtn = document.getElementById("followMeBtn");
  const stopBtn = document.getElementById("stopFollowBtn");
  const shareInput = document.getElementById("shareLocationInput");
  const saveBtn = document.getElementById("saveLocationSettingsBtn");

  if (shareInput) shareInput.value = state.settings.shareLocation || "off";
  if (gpsFab && gpsPanel) gpsFab.onclick = () => gpsPanel.classList.toggle("hidden");
  if (closeBtn && gpsPanel) closeBtn.onclick = () => gpsPanel.classList.add("hidden");
  if (locateBtn) locateBtn.onclick = () => locateMe(true);
  if (followBtn) followBtn.onclick = startLiveTracking;
  if (stopBtn) stopBtn.onclick = stopLiveTracking;

  if (saveBtn) {
    saveBtn.onclick = () => {
      state.settings.shareLocation = shareInput ? shareInput.value : "off";
      saveLocal();
      setLocationStatus(state.settings.shareLocation === "on"
        ? "Location sharing on. Tap Locate Me or Start Live Tracking."
        : "Location sharing off.");
    };
  }
}


// Admin permissions
async function checkAdminStatus() {
  isAdmin = false;

  if (!supabaseClient || !currentUser) return false;

  const { data, error } = await supabaseClient
    .from("admins")
    .select("user_id")
    .eq("user_id", currentUser.id)
    .maybeSingle();

  if (error) {
    console.warn("Admin check failed:", error.message);
    return false;
  }

  isAdmin = !!data;
  return isAdmin;
}

async function saveCoverageArea(area) {
  ensureCoverageState();

  const previous = state.coverageAreas[area.id] || {};
  const normalized = normalizeCoverageArea(area, previous);

  if (!normalized.user_tag) normalized.user_tag = state.settings.userTag || userDisplayName();
  if (!normalized.color) normalized.color = state.settings.userColor || "#22c55e";

  // Preserve the original creator when editing someone else's drawing.
  normalized.user_id = normalized.user_id || currentUser?.id || "local";
  normalized.user_email = normalized.user_email || currentUser?.email || userDisplayName();

  state.coverageAreas[normalized.id] = normalized;
  saveLocal();

  if (!supabaseClient || !currentUser) {
    refreshMap();
    return;
  }

  const { error } = await supabaseClient.from("coverage_areas").upsert({
    id: normalized.id,
    zip: normalized.zip || null,
    user_id: normalized.user_id === "local" ? currentUser.id : normalized.user_id,
    user_email: normalized.user_email || currentUser.email,
    user_tag: normalized.user_tag || normalized.user_email || state.settings.userTag || currentUser.email,
    color: normalized.color,
    last_worked: normalized.last_worked,
    geometry: normalized.geometry,
    updated_at: new Date().toISOString()
  });

  if (error) {
    alert("Could not save coverage area: " + error.message);
  }

  refreshMap();
}

window.deleteCoverageArea = async function(id) {
  if (!state.coverageAreas[id]) return;
  if (!confirm("Delete this freehand area for everyone?")) return;

  const backup = state.coverageAreas[id];

  delete state.coverageAreas[id];
  if (selectedCoverageId === id) selectedCoverageId = null;
  saveLocal();
  refreshMap();

  try { map.closePopup(); } catch {}

  if (supabaseClient && currentUser) {
    const { error } = await supabaseClient
      .from("coverage_areas")
      .delete()
      .eq("id", id);

    if (error) {
      // Put it back if Supabase refused the delete.
      state.coverageAreas[id] = backup;
      saveLocal();
      refreshMap();
      alert("Could not delete freehand area from the shared database: " + error.message);
      return;
    }
  }

  // Extra refresh catches devices/browsers that missed the realtime delete event.
  setTimeout(loadCloudData, 400);
};

window.saveCoverageDetails = async function(id) {
  const area = state.coverageAreas[id];
  if (!area) return;

  const tagEl = document.getElementById("coverageTag_" + id);
  const colorEl = document.getElementById("coverageColor_" + id);
  const dateEl = document.getElementById("coverageDate_" + id);

  const newTag = tagEl ? tagEl.value.trim() : area.user_tag;
  area.user_tag = newTag || area.user_tag || area.user_email || "Coverage";
  area.color = colorEl ? colorEl.value : area.color;
  area.last_worked = dateEl && dateEl.value ? dateEl.value : area.last_worked;

  await saveCoverageArea(area);
  map.closePopup();
};

window.startEditCoverageArea = function(id) {
  const area = state.coverageAreas[id];
  if (!area) return;

  editingCoverageId = id;

  if (activeDrawingLayer) {
    map.removeLayer(activeDrawingLayer);
    activeDrawingLayer = null;
  }

  startFreehandDrawing();
  showDrawHint("Editing area: redraw the shape, then tap Finish.");
  map.closePopup();
};


function nearestSelectedZip() {
  return selectedZip || null;
}

function makeCoverageId() {
  if (window.crypto?.randomUUID) return crypto.randomUUID();
  return "cov_" + Date.now() + "_" + Math.floor(Math.random() * 100000);
}

function hideDrawPanelForDrawing() {
  if (!isDrawing) return;
  const panel = document.getElementById("drawPanel");
  if (panel) panel.classList.add("hidden");
}

function showDrawPanelAfterStroke() {
  if (!isDrawing) return;
  const panel = document.getElementById("drawPanel");
  if (panel) panel.classList.remove("hidden");
}

function hideDrawPanelDone() {
  const panel = document.getElementById("drawPanel");
  if (panel) panel.classList.add("hidden");
}

function startFreehandDrawing() {
  if (!currentUser && supabaseClient) {
    alert("Please sign in before drawing shared coverage areas.");
    return;
  }

  isDrawing = true;
  isPointerDrawing = false;
  drawingPoints = [];
  hideDrawPanelForDrawing();
  document.body.classList.add("drawing-active");
  map.dragging.disable();
  map.touchZoom.disable();
  map.scrollWheelZoom.disable();
  map.doubleClickZoom.disable();
  map.getContainer().style.touchAction = "none";
  showDrawHint("Drawing mode: drag your finger over the worked area, then tap Finish. Everyone can see and edit saved drawings.");
}

function cancelFreehandDrawing() {
  hideDrawPanelDone();
  isDrawing = false;
  isPointerDrawing = false;
  editingCoverageId = null;
  drawingPoints = [];
  document.body.classList.remove("drawing-active");
  map.dragging.enable();
  map.touchZoom.enable();
  map.scrollWheelZoom.enable();
  map.doubleClickZoom.enable();
  map.getContainer().style.touchAction = "";
  if (activeDrawingLayer) {
    map.removeLayer(activeDrawingLayer);
    activeDrawingLayer = null;
  }
  hideDrawHint();
}

async function finishFreehandDrawing() {
  if (!isDrawing || drawingPoints.length < 3) {
    alert("Draw at least a small shape first.");
    return;
  }

  const closed = [...drawingPoints, drawingPoints[0]];
  const existing = editingCoverageId ? state.coverageAreas[editingCoverageId] : null;

  const area = {
    id: editingCoverageId || makeCoverageId(),
    zip: existing?.zip || nearestSelectedZip(),
    user_id: existing?.user_id || currentUser?.id || "local",
    user_email: existing?.user_email || currentUser?.email || userDisplayName(),
    user_tag: existing?.user_tag || state.settings.userTag || currentUser?.email || userDisplayName(),
    color: existing?.color || state.settings.userColor || "#22c55e",
    last_worked: existing?.last_worked || new Date().toISOString().slice(0,10),
    geometry: {
      type: "Polygon",
      coordinates: [closed.map(p => [p.lng, p.lat])]
    }
  };

  editingCoverageId = null;
  cancelFreehandDrawing();
  hideDrawPanelDone();
  await saveCoverageArea(area);
}

function showDrawHint(text) {
  let el = document.getElementById("drawHint");
  if (!el) {
    el = document.createElement("div");
    el.id = "drawHint";
    el.className = "drawHint";
    document.body.appendChild(el);
  }
  el.textContent = text;
}

function hideDrawHint() {
  const el = document.getElementById("drawHint");
  if (el) el.remove();
}


function latLngFromPointerEvent(ev) {
  const source = ev.touches && ev.touches[0] ? ev.touches[0] : ev;
  const rect = map.getContainer().getBoundingClientRect();
  const point = L.point(source.clientX - rect.left, source.clientY - rect.top);
  return map.containerPointToLatLng(point);
}

function addDrawingPointFromEvent(ev) {
  if (!isDrawing || !isPointerDrawing) return;
  ev.preventDefault();

  const latlng = latLngFromPointerEvent(ev);
  const last = drawingPoints[drawingPoints.length - 1];

  if (last && map.latLngToLayerPoint(last).distanceTo(map.latLngToLayerPoint(latlng)) < 4) return;

  drawingPoints.push(latlng);

  if (activeDrawingLayer) map.removeLayer(activeDrawingLayer);
  activeDrawingLayer = L.polygon(drawingPoints, {
    color: state.settings.userColor || "#22c55e",
    weight: 2,
    fillColor: state.settings.userColor || "#22c55e",
    fillOpacity: 0.32
  }).addTo(map);
}

function onDrawPointerDown(ev) {
  if (!isDrawing) return;
  hideDrawPanelForDrawing();
  ev.preventDefault();
  ev.stopPropagation();
  isPointerDrawing = true;
  drawingPoints = [];
  addDrawingPointFromEvent(ev);
  try { map.getContainer().setPointerCapture(ev.pointerId); } catch {}
}

function onDrawPointerMove(ev) {
  if (!isDrawing || !isPointerDrawing) return;
  ev.preventDefault();
  ev.stopPropagation();
  addDrawingPointFromEvent(ev);
}

function onDrawPointerUp(ev) {
  if (!isDrawing) return;
  ev.preventDefault();
  ev.stopPropagation();
  isPointerDrawing = false;
  try { map.getContainer().releasePointerCapture(ev.pointerId); } catch {}
  showDrawPanelAfterStroke();
}

const mapElForDrawing = map.getContainer();
mapElForDrawing.addEventListener("pointerdown", onDrawPointerDown, { passive:false });
mapElForDrawing.addEventListener("pointermove", onDrawPointerMove, { passive:false });
mapElForDrawing.addEventListener("pointerup", onDrawPointerUp, { passive:false });
mapElForDrawing.addEventListener("pointercancel", onDrawPointerUp, { passive:false });
mapElForDrawing.addEventListener("touchstart", onDrawPointerDown, { passive:false });
mapElForDrawing.addEventListener("touchmove", onDrawPointerMove, { passive:false });
mapElForDrawing.addEventListener("touchend", onDrawPointerUp, { passive:false });
mapElForDrawing.addEventListener("touchcancel", onDrawPointerUp, { passive:false });

function drawPointFromEvent(e) {
  if (!isDrawing) return;
  const latlng = e.latlng || map.mouseEventToLatLng(e.originalEvent || e);
  drawingPoints.push(latlng);

  if (activeDrawingLayer) map.removeLayer(activeDrawingLayer);
  activeDrawingLayer = L.polygon(drawingPoints, {
    color: state.settings.userColor || "#22c55e",
    weight: 2,
    fillColor: state.settings.userColor || "#22c55e",
    fillOpacity: 0.32
  }).addTo(map);
}


// Auth
async function refreshAuth() {
  if (!supabaseClient) {
    document.getElementById("authStatus").textContent = "Local-only mode: add Supabase URL/key in config.js for login.";
    document.getElementById("adminBtn").classList.add("hidden");
    return;
  }

  const { data } = await supabaseClient.auth.getUser();
  currentUser = data?.user || null;

  if (currentUser) {
    await checkAdminStatus();
    await loadUserProfile();
  } else {
    isAdmin = false;
    syncProfileInputs();
  }

  document.getElementById("loginBtn").textContent = currentUser ? "Account" : "Login";
  document.getElementById("adminBtn").classList.toggle("hidden", !isAdmin);
  document.getElementById("signOutBtn").classList.toggle("hidden", !currentUser);
  document.getElementById("authStatus").textContent = currentUser
    ? `Signed in: ${currentUser.email}${isAdmin ? " — Admin" : ""}`
    : "Not signed in";

  if (currentUser) {
    await loadCloudData();
    subscribeRealtime();
    startTeamLocationRefresh();
    startCoverageSyncRefresh();
  }
}
document.getElementById("signInBtn").onclick = async () => {
  if (!supabaseClient) return refreshAuth();
  const email = document.getElementById("emailInput").value.trim();
  const password = document.getElementById("passwordInput").value;
  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  document.getElementById("authStatus").textContent = error ? error.message : "Signed in.";
  await refreshAuth();
};
document.getElementById("signUpBtn").onclick = async () => {
  if (!supabaseClient) return refreshAuth();
  const email = document.getElementById("emailInput").value.trim();
  const password = document.getElementById("passwordInput").value;
  const { error } = await supabaseClient.auth.signUp({ email, password });
  document.getElementById("authStatus").textContent = error ? error.message : "Account created. Check email if confirmation is enabled.";
};
document.getElementById("signOutBtn").onclick = async () => {
  if (supabaseClient) await supabaseClient.auth.signOut();
  currentUser = null;
  await refreshAuth();
};

// Admin team editor
function renderTeamsEditor() {
  document.getElementById("teamCountInput").value = state.teams.length;
  document.getElementById("teamsEditor").innerHTML = state.teams.map((t, i) => `
    <div class="teamRow">
      <input id="team_name_${i}" value="${t.name}" />
      <input id="team_color_${i}" type="color" value="${t.color}" />
    </div>
  `).join("");
}
document.getElementById("applyTeamCountBtn").onclick = () => {
  if (!isAdmin) {
    alert("Only the admin can change team count.");
    return;
  }
  const n = Math.max(1, Math.min(12, Number(document.getElementById("teamCountInput").value || 6)));
  while (state.teams.length < n) {
    const i = state.teams.length + 1;
    state.teams.push({ id:`team${i}`, name:`Team ${i}`, color:["#2563eb","#9333ea","#ec4899","#0f766e","#f59e0b","#22c55e"][state.teams.length % 6] });
  }
  state.teams = state.teams.slice(0, n);
  renderTeamsEditor();
  saveLocal();
};
document.getElementById("saveTeamsBtn").onclick = async () => {
  if (!isAdmin) {
    alert("Only the admin can save team settings.");
    return;
  }
  state.teams = state.teams.map((t, i) => ({
    id: t.id,
    name: document.getElementById(`team_name_${i}`).value.trim() || `Team ${i+1}`,
    color: document.getElementById(`team_color_${i}`).value,
  }));
  saveLocal();
  renderTeamsEditor();
  refreshMap();
  if (supabaseClient && currentUser) {
    await supabaseClient.from("teams").upsert(state.teams.map((t,i) => ({
      id:t.id, name:t.name, color:t.color, sort_order:i
    })));
  }
};

// UI
function toggle(id) { document.getElementById(id).classList.toggle("hidden"); }
document.getElementById("loginBtn").onclick = () => toggle("authPanel");
document.getElementById("closeAuthBtn").onclick = () => toggle("authPanel");
document.getElementById("adminBtn").onclick = () => {
  if (!isAdmin) {
    alert("Admin controls are only available to the approved admin account.");
    return;
  }
  renderTeamsEditor();
  toggle("adminPanel");
};
document.getElementById("closeAdminBtn").onclick = () => toggle("adminPanel");
document.getElementById("menuBtn").onclick = () => toggle("menuPanel");
document.getElementById("closeMenuBtn").onclick = () => toggle("menuPanel");
document.getElementById("applyPerfBtn").onclick = () => {
  state.settings.boundaryMode = document.getElementById("zipBoundaryMode").value;
  state.settings.labelsMode = document.getElementById("zipLabelsMode").value;
  state.settings.zipZoom = Number(document.getElementById("zipZoomInput").value || 9);
  saveLocal();
  scheduleRender();
  updateSelectedInfo();
};
document.getElementById("saveTimerBtn").onclick = async () => {
  if (!isAdmin) {
    alert("Only the admin can change timer settings.");
    return;
  }

  state.settings.timeMode = document.getElementById("timeMode").value;
  state.settings.threshold = Number(document.getElementById("thresholdInput").value || 3);
  saveLocal();
  refreshMap();

  if (supabaseClient && currentUser) {
    const { error } = await supabaseClient.from("app_settings").upsert({
      id: "global",
      time_mode: state.settings.timeMode,
      threshold: state.settings.threshold,
      updated_by: currentUser.id,
      updated_at: new Date().toISOString()
    });
    if (error) alert("Could not save timer settings: " + error.message);
  }
};

if (document.getElementById("saveUserColorBtn")) document.getElementById("saveUserColorBtn").onclick = () => {
  state.settings.userColor = document.getElementById("userColorInput").value || "#22c55e";
  saveLocal();
};

if (document.getElementById("startDrawBtn")) document.getElementById("startDrawBtn").onclick = startFreehandDrawing;
if (document.getElementById("finishDrawBtn")) document.getElementById("finishDrawBtn").onclick = finishFreehandDrawing;
if (document.getElementById("cancelDrawBtn")) document.getElementById("cancelDrawBtn").onclick = cancelFreehandDrawing;

const drawFab = document.getElementById("drawFab");
const drawPanel = document.getElementById("drawPanel");
if (drawFab && drawPanel) {
  drawFab.onclick = () => drawPanel.classList.toggle("hidden");
}
const closeDrawPanelBtn = document.getElementById("closeDrawPanelBtn");
if (closeDrawPanelBtn) closeDrawPanelBtn.onclick = () => drawPanel.classList.add("hidden");

const saveUserIdentityBtn = document.getElementById("saveUserIdentityBtn");
if (saveUserIdentityBtn) {
  saveUserIdentityBtn.onclick = saveUserProfile;
}

const saveProfileBtn = document.getElementById("saveProfileBtn");
if (saveProfileBtn) {
  saveProfileBtn.onclick = saveUserProfile;
}

const applyCoverageFilterBtn = document.getElementById("applyCoverageFilterBtn");
if (applyCoverageFilterBtn) {
  applyCoverageFilterBtn.onclick = () => {
    state.settings.coverageFilterMode = document.getElementById("coverageFilterMode").value;
    state.settings.coverageFilterTag = document.getElementById("coverageFilterTag").value.trim();
    saveLocal();
    renderCoverageAreas();
  };
}

const clearCoverageFilterBtn = document.getElementById("clearCoverageFilterBtn");
if (clearCoverageFilterBtn) {
  clearCoverageFilterBtn.onclick = () => {
    state.settings.coverageFilterMode = "all";
    state.settings.coverageFilterTag = "";
    document.getElementById("coverageFilterMode").value = "all";
    document.getElementById("coverageFilterTag").value = "";
    saveLocal();
    renderCoverageAreas();
  };
}
const startDrawBtnFab = document.getElementById("startDrawBtnFab");
if (startDrawBtnFab) startDrawBtnFab.onclick = startFreehandDrawing;
const finishDrawBtnFab = document.getElementById("finishDrawBtnFab");
if (finishDrawBtnFab) finishDrawBtnFab.onclick = finishFreehandDrawing;
const cancelDrawBtnFab = document.getElementById("cancelDrawBtnFab");
if (cancelDrawBtnFab) cancelDrawBtnFab.onclick = cancelFreehandDrawing;


function initControls() {
  ensureCoverageState();
  const colorInput = document.getElementById("userColorInput");
  if (colorInput) colorInput.value = state.settings.userColor || "#22c55e";
  const fabColorInput = document.getElementById("userColorInputFab");
  if (fabColorInput) fabColorInput.value = state.settings.userColor || "#22c55e";
  syncProfileInputs();
  const filterMode = document.getElementById("coverageFilterMode");
  if (filterMode) filterMode.value = state.settings.coverageFilterMode || "all";
  const filterTag = document.getElementById("coverageFilterTag");
  if (filterTag) filterTag.value = state.settings.coverageFilterTag || "";
  document.getElementById("zipBoundaryMode").value = state.settings.boundaryMode === "on" ? "auto" : state.settings.boundaryMode;
  document.getElementById("zipLabelsMode").value = state.settings.labelsMode;
  document.getElementById("zipZoomInput").value = state.settings.zipZoom;
  document.getElementById("timeMode").value = state.settings.timeMode;
  document.getElementById("thresholdInput").value = state.settings.threshold;
  renderTeamsEditor();
}
map.on("popupclose", () => { zipPopupOpen = false; });
map.on("moveend zoomend", () => {
  if (!shouldShowMapWorkLayers()) {
    if (zipLayer) {
      map.removeLayer(zipLayer);
      zipLayer = null;
    }
    if (coverageLayer) {
      map.removeLayer(coverageLayer);
      coverageLayer = null;
    }
    if (coverageTagLayer) {
      map.removeLayer(coverageTagLayer);
      coverageTagLayer = null;
    }
    updateSelectedInfo();
    return;
  }

  scheduleRender();
  renderCoverageAreas();
});
initControls();
renderCoverageAreas();
refreshAuth();
loadZipData();


(function setupMovableDrawFab(){
  const fab = document.getElementById("drawFab");
  if (!fab) return;
  let dragging = false, moved = false, startX = 0, startY = 0, right = 18, bottom = 22;
  fab.addEventListener("pointerdown", ev => {
    dragging = true; moved = false; startX = ev.clientX; startY = ev.clientY;
    fab.setPointerCapture?.(ev.pointerId);
  });
  fab.addEventListener("pointermove", ev => {
    if (!dragging) return;
    const dx = ev.clientX - startX, dy = ev.clientY - startY;
    if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
    startX = ev.clientX; startY = ev.clientY;
    const rect = fab.getBoundingClientRect();
    right = Math.max(8, Math.min(window.innerWidth - 66, window.innerWidth - rect.right - dx));
    bottom = Math.max(8, Math.min(window.innerHeight - 66, window.innerHeight - rect.bottom - dy));
    fab.style.right = right + "px";
    fab.style.bottom = bottom + "px";
  });
  fab.addEventListener("pointerup", ev => {
    dragging = false;
    if (moved) ev.preventDefault();
  });
})();


// Mobile UI stability: keep app chrome fixed and prevent panels from riding with map zoom.
function closeLeafletPopupOnZoom() {
  try { map.closePopup(); } catch {}
}
map.on("zoomstart", closeLeafletPopupOnZoom);

function stableMobileViewportRefresh() {
  setTimeout(() => {
    try { map.invalidateSize(false); } catch {}
  }, 120);
}
window.addEventListener("resize", stableMobileViewportRefresh);
window.addEventListener("orientationchange", stableMobileViewportRefresh);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) stableMobileViewportRefresh();
});

// Prevent menu panels and floating drawing menu from dragging/zooming the map underneath.
["authPanel", "adminPanel", "menuPanel", "drawPanel"].forEach(id => {
  const el = document.getElementById(id);
  if (!el) return;
  ["touchstart", "touchmove", "pointerdown", "pointermove", "wheel"].forEach(evt => {
    el.addEventListener(evt, e => e.stopPropagation(), { passive: true });
  });
});
