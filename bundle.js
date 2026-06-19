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
  settings: {
    boundaryMode: "auto",
    labelsMode: "off",
    zipZoom: 9,
    timeMode: "months",
    threshold: 3
  }
};

let state = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") || structuredClone(defaultState);
let currentUser = null;
let supabaseClient = null;
let zipData = null;
let zipLayer = null;
let selectedZip = null;
let renderTimer = null;

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
  saveLocal();
  if (zipLayer) zipLayer.setStyle(zipStyle);
  updateSelectedInfo();
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
}

// Auth
async function refreshAuth() {
  if (!supabaseClient) {
    document.getElementById("authStatus").textContent = "Local-only mode: add Supabase URL/key in config.js for login.";
    return;
  }
  const { data } = await supabaseClient.auth.getUser();
  currentUser = data?.user || null;
  document.getElementById("loginBtn").textContent = currentUser ? "Account" : "Login";
  document.getElementById("adminBtn").classList.toggle("hidden", !currentUser);
  document.getElementById("signOutBtn").classList.toggle("hidden", !currentUser);
  document.getElementById("authStatus").textContent = currentUser ? `Signed in: ${currentUser.email}` : "Not signed in";
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
document.getElementById("adminBtn").onclick = () => { renderTeamsEditor(); toggle("adminPanel"); };
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

function initControls() {
  document.getElementById("zipBoundaryMode").value = state.settings.boundaryMode;
  document.getElementById("zipLabelsMode").value = state.settings.labelsMode;
  document.getElementById("zipZoomInput").value = state.settings.zipZoom;
  document.getElementById("timeMode").value = state.settings.timeMode;
  document.getElementById("thresholdInput").value = state.settings.threshold;
  renderTeamsEditor();
}
map.on("moveend zoomend", scheduleRender);
initControls();
refreshAuth();
loadZipData();
