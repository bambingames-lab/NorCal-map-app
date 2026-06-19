/* Territory Manager Community Starter
   GitHub Pages frontend + optional Supabase backend.
*/
const ZIP_URL = "https://raw.githubusercontent.com/OpenDataDE/State-zip-code-GeoJSON/master/ca_california_zip_codes_geo.min.json";
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
    coverageFilterTag: ""
  }
};

let state = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") || structuredClone(defaultState);
let currentUser = null;
let isAdmin = false;
let supabaseClient = null;
let zipData = null;
let zipLayer = null;
let coverageLayer = null;
let activeDrawingLayer = null;
let selectedZip = null;
let renderTimer = null;
let isDrawing = false;
let drawingPoints = [];
let editingCoverageId = null;
let isPointerDrawing = false;

const hasSupabase = Boolean(window.TM_SUPABASE_URL && window.TM_SUPABASE_ANON_KEY);

if (hasSupabase && window.supabase) {
  supabaseClient = window.supabase.createClient(window.TM_SUPABASE_URL, window.TM_SUPABASE_ANON_KEY);
}

const map = L.map("map", { preferCanvas: true }).setView([38.8, -121.3], 7);
const canvasRenderer = L.canvas({ padding: 0.5 });
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

function saveLocal() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

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
  // As the area ages, it fades toward the app green so it follows the same timer idea.
  return mix(base, "#9DE600", pct);
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

  if (supabaseClient && currentUser) {
    await supabaseClient.from("user_profiles").upsert({
      user_id: currentUser.id,
      email: currentUser.email,
      display_name: state.settings.userTag,
      color: state.settings.userColor,
      updated_at: new Date().toISOString()
    });
  }

  alert("Profile saved.");
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
function shouldShowZips() {
  if (state.settings.boundaryMode === "off") return false;
  if (state.settings.boundaryMode === "on") return true;
  return map.getZoom() >= Number(state.settings.zipZoom || 9);
}
function zipStyle(feature) {
  const zip = zipCode(feature);
  const zoom = map.getZoom();
  const selected = selectedZip === zip;
  let weight = zoom <= 7 ? 0.35 : zoom <= 8 ? 0.65 : zoom <= 9 ? 1.1 : 1.8;
  return {
    renderer: canvasRenderer,
    color: selected ? "#2563eb" : "#111",
    weight: selected ? weight + 1.2 : weight,
    opacity: 0.95,
    fillColor: territoryColor(zip),
    fillOpacity: state.territories[zip]?.last_worked ? 0.55 : 0.02
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
  if (!zipData) return;
  if (zipLayer) {
    map.removeLayer(zipLayer);
    zipLayer = null;
  }
  if (!shouldShowZips()) return;

  const b = map.getBounds().pad(0.25);
  const features = (zipData.features || []).filter(f => featureInBounds(f, b)).slice(0, 600);

  zipLayer = L.geoJSON({ type:"FeatureCollection", features }, {
    renderer: canvasRenderer,
    style: zipStyle,
    onEachFeature: (f, layer) => {
      bindTooltip(layer, f);
      layer.on("click", () => {
        selectedZip = zipCode(f);
        openZipPopup(layer, selectedZip);
        updateSelectedInfo();
      });
    }
  }).addTo(map);
  updateLabels();
}
function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderVisibleZips, 160);
}
async function loadZipData() {
  document.getElementById("selectedInfo").innerHTML = "Loading ZIP data…";
  const cached = localStorage.getItem("tm_zip_geojson_cache");
  if (cached) {
    try { zipData = JSON.parse(cached); scheduleRender(); } catch {}
  }
  try {
    const res = await fetch(ZIP_URL, { cache: "force-cache" });
    zipData = await res.json();
    try { localStorage.setItem("tm_zip_geojson_cache", JSON.stringify(zipData)); } catch {}
    scheduleRender();
    updateSelectedInfo();
  } catch (err) {
    document.getElementById("selectedInfo").innerHTML = "Could not load ZIP boundaries. Check internet connection.";
  }
}
function teamOptions(selectedId) {
  return state.teams.map(t => `<option value="${t.id}" ${selectedId === t.id ? "selected" : ""}>${t.name}</option>`).join("");
}
function openZipPopup(layer, zip) {
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
};

window.saveTeamsForZip = async function(zip) {
  state.territories[zip] = state.territories[zip] || {};
  state.territories[zip].owner_team_id = document.getElementById("owner_"+zip).value;
  state.territories[zip].handoff_team_id = document.getElementById("handoff_"+zip).value;
  await saveTerritory(zip);
  refreshMap();
};
window.saveNotesForZip = async function(zip) {
  state.territories[zip] = state.territories[zip] || {};
  state.territories[zip].notes = document.getElementById("notes_"+zip).value.trim();
  await saveTerritory(zip);
  refreshMap();
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
  saveLocal();
  if (zipLayer) zipLayer.setStyle(zipStyle);
  renderCoverageAreas();
  updateSelectedInfo();
}

function renderCoverageAreas() {
  ensureCoverageState();
  if (coverageLayer) {
    map.removeLayer(coverageLayer);
    coverageLayer = null;
  }

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
    renderer: canvasRenderer,
    style: feature => {
      const a = state.coverageAreas[feature.properties.id];
      return {
        color: a.color || "#22c55e",
        weight: 2,
        opacity: 0.95,
        fillColor: coverageColor(a),
        fillOpacity: coverageOpacity(a)
      };
    },
    onEachFeature: (feature, layer) => {
      const a = state.coverageAreas[feature.properties.id];
      const tagText = a.user_tag || a.user_email || "Coverage";
      layer.bindTooltip(tagText, {
        permanent: true,
        direction: "center",
        className: "coverage-tag-label"
      });
      layer.bindPopup(`
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
      `);
    }
  }).addTo(map);

  if (zipLayer) zipLayer.bringToFront();
  coverageLayer.bringToBack();
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
    state.coverageAreas = {};
    coverage.data.forEach(a => {
      state.coverageAreas[a.id] = {
        id: a.id,
        zip: a.zip,
        user_id: a.user_id,
        user_email: a.user_email,
        user_tag: a.user_tag || "",
        color: a.color,
        last_worked: a.last_worked,
        geometry: a.geometry
      };
    });
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
      if (payload.eventType === "DELETE") delete state.coverageAreas[row.id];
      else state.coverageAreas[row.id] = {
        id: row.id,
        zip: row.zip,
        user_id: row.user_id,
        user_email: row.user_email,
        user_tag: row.user_tag || "",
        color: row.color,
        last_worked: row.last_worked,
        geometry: row.geometry
      };
      refreshMap();
    })
    .subscribe();
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
  state.coverageAreas[area.id] = area;
  saveLocal();

  if (!supabaseClient || !currentUser) {
    refreshMap();
    return;
  }

  const { error } = await supabaseClient.from("coverage_areas").upsert({
    id: area.id,
    zip: area.zip || null,
    user_id: currentUser.id,
    user_email: currentUser.email,
    user_tag: area.user_tag || state.settings.userTag || currentUser.email,
    color: area.color,
    last_worked: area.last_worked,
    geometry: area.geometry,
    updated_at: new Date().toISOString()
  });

  if (error) {
    alert("Could not save coverage area: " + error.message);
  }
  refreshMap();
}

window.deleteCoverageArea = async function(id) {
  if (!state.coverageAreas[id]) return;
  delete state.coverageAreas[id];

  if (supabaseClient && currentUser) {
    await supabaseClient.from("coverage_areas").delete().eq("id", id);
  }

  refreshMap();
};

window.saveCoverageDetails = async function(id) {
  const area = state.coverageAreas[id];
  if (!area) return;

  const tagEl = document.getElementById("coverageTag_" + id);
  const colorEl = document.getElementById("coverageColor_" + id);
  const dateEl = document.getElementById("coverageDate_" + id);

  area.user_tag = tagEl ? tagEl.value.trim() : area.user_tag;
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

function startFreehandDrawing() {
  if (!currentUser && supabaseClient) {
    alert("Please sign in before drawing shared coverage areas.");
    return;
  }

  isDrawing = true;
  isPointerDrawing = false;
  drawingPoints = [];
  document.body.classList.add("drawing-active");
  map.dragging.disable();
  map.touchZoom.disable();
  map.scrollWheelZoom.disable();
  map.doubleClickZoom.disable();
  map.getContainer().style.touchAction = "none";
  showDrawHint("Drawing mode: drag your finger over the worked area, then tap Finish. Everyone can see and edit saved drawings.");
}

function cancelFreehandDrawing() {
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
    user_email: existing?.user_email || userDisplayName(),
    user_tag: existing?.user_tag || state.settings.userTag || userDisplayName(),
    color: existing?.color || state.settings.userColor || "#22c55e",
    last_worked: existing?.last_worked || new Date().toISOString().slice(0,10),
    geometry: {
      type: "Polygon",
      coordinates: [closed.map(p => [p.lng, p.lat])]
    }
  };

  editingCoverageId = null;
  cancelFreehandDrawing();
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
document.getElementById("saveTimerBtn").onclick = () => {
  state.settings.timeMode = document.getElementById("timeMode").value;
  state.settings.threshold = Number(document.getElementById("thresholdInput").value || 3);
  saveLocal();
  refreshMap();
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
  document.getElementById("zipBoundaryMode").value = state.settings.boundaryMode;
  document.getElementById("zipLabelsMode").value = state.settings.labelsMode;
  document.getElementById("zipZoomInput").value = state.settings.zipZoom;
  document.getElementById("timeMode").value = state.settings.timeMode;
  document.getElementById("thresholdInput").value = state.settings.threshold;
  renderTeamsEditor();
}
map.on("moveend zoomend", scheduleRender);
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
