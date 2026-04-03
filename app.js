const SOUTH_LAT = 38.068333333333335; // roughly Angels Camp
const STORAGE_KEY = 'norcalTerritoryState_v4';
const ZIPS_URL = 'https://gis.data.ca.gov/api/download/v1/items/f7afe55481244706903fbe6be5e986d3/geojson?layers=0';
const INCORP_URL = 'https://gis.data.cnra.ca.gov/api/download/v1/items/8322505e8f1741c7b0de85684594e32a/geojson?layers=0';
const CDP_URL = 'https://gis.data.ca.gov/api/download/v1/items/d1a79f9faea241ab9a3f9ef549a19fd7/geojson?layers=1';

const map = L.map('map', { zoomControl: true }).setView([39.2, -121.5], 7);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

let state = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {
  zipFillMode: 'lightgray',
  towns: {}
};

let selected = null;
let zipLayer = null;
let townLayer = null;
let currentZipGeojson = null;
let currentTownGeojson = null;

const els = {
  status: document.getElementById('status'),
  zipFillMode: document.getElementById('zipFillMode'),
  selectedInfo: document.getElementById('selectedInfo'),
  visitDate: document.getElementById('visitDate'),
  notesInput: document.getElementById('notesInput'),
  searchInput: document.getElementById('searchInput'),
};

function setStatus(text) {
  els.status.textContent = text;
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function weeksSince(dateStr) {
  if (!dateStr) return null;
  const then = new Date(dateStr + 'T00:00:00');
  const diff = Date.now() - then.getTime();
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24 * 7)));
}

function recencyColor(dateStr) {
  const w = weeksSince(dateStr);
  if (w === null) return '#d1d5db';
  if (w <= 1) return '#991b1b';
  if (w <= 2) return '#dc2626';
  if (w <= 3) return '#ef4444';
  if (w <= 5) return '#f97316';
  if (w <= 7) return '#facc15';
  if (w <= 10) return '#bef264';
  return '#bbf7d0';
}

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function featureLabel(feature) {
  const p = feature.properties || {};
  return p.NAME || p.name || p.ZIP_CODE || p.ZCTA5 || p.ZCTA5CE10 || p.zip || 'Unnamed area';
}

function featureId(feature, type) {
  const p = feature.properties || {};
  if (type === 'zip') return String(p.ZIP_CODE || p.ZCTA5 || p.ZCTA5CE10 || p.GEOID || p.zip || featureLabel(feature));
  return String(p.NAME || p.name || p.GEOID || p.PLACE || p.OBJECTID || featureLabel(feature));
}

function getTownRecord(id) {
  if (!state.towns[id]) {
    state.towns[id] = { lastVisited: null, notes: '' };
  }
  return state.towns[id];
}

function zipStyle() {
  return {
    color: '#374151',
    weight: 2.5,
    fillColor: state.zipFillMode === 'lightgray' ? '#d1d5db' : 'transparent',
    fillOpacity: state.zipFillMode === 'lightgray' ? 0.24 : 0
  };
}

function townStyle(feature) {
  const id = featureId(feature, 'town');
  const rec = getTownRecord(id);
  return {
    color: '#111827',
    weight: 1,
    fillColor: recencyColor(rec.lastVisited),
    fillOpacity: 0.63
  };
}

function applySelectionStyle(layer, type, feature) {
  if (type === 'zip') {
    layer.setStyle({ weight: 4, color: '#000' });
  } else {
    layer.setStyle({ ...townStyle(feature), weight: 3, color: '#000' });
  }
}

function clearSelectionStyle() {
  if (!selected) return;
  if (selected.type === 'zip') {
    selected.layer.setStyle(zipStyle());
  } else {
    selected.layer.setStyle(townStyle(selected.feature));
  }
}

function updateSelectionInfo() {
  if (!selected) {
    els.selectedInfo.innerHTML = 'Nothing selected yet.';
    els.visitDate.value = '';
    els.notesInput.value = '';
    return;
  }
  const label = featureLabel(selected.feature);
  if (selected.type === 'zip') {
    els.selectedInfo.innerHTML = `<strong>${label}</strong><br>Type: ZIP<br>ZIP fill: ${state.zipFillMode}`;
    els.visitDate.value = '';
    els.notesInput.value = '';
    return;
  }
  const rec = getTownRecord(selected.id);
  const weeks = weeksSince(rec.lastVisited);
  els.selectedInfo.innerHTML = `<strong>${label}</strong><br>Type: Town<br>Last visited: ${rec.lastVisited || 'Not set'}<br>Weeks since: ${weeks === null ? 'N/A' : weeks}<br>Notes: ${rec.notes || 'None'}`;
  els.visitDate.value = rec.lastVisited || '';
  els.notesInput.value = rec.notes || '';
}

function selectFeature(type, feature, layer) {
  clearSelectionStyle();
  selected = { type, feature, layer, id: featureId(feature, type) };
  applySelectionStyle(layer, type, feature);
  updateSelectionInfo();
}

function bindLayerEvents(type) {
  return (feature, layer) => {
    layer.on('click', () => selectFeature(type, feature, layer));
    layer.on('mouseover', () => {
      layer.setStyle({ weight: type === 'zip' ? 3.5 : 2 });
    });
    layer.on('mouseout', () => {
      if (selected && selected.layer === layer) {
        applySelectionStyle(layer, type, feature);
      } else {
        layer.setStyle(type === 'zip' ? zipStyle() : townStyle(feature));
      }
    });
  };
}

function bboxNorthEnough(feature) {
  try {
    const bbox = turf.bbox(feature);
    return bbox[3] >= SOUTH_LAT;
  } catch {
    return true;
  }
}

function clipNorthOfAngelsCamp(fc) {
  const clipPoly = turf.bboxPolygon([-125, SOUTH_LAT, -116, 43]);
  const out = [];
  for (const f of fc.features) {
    if (!bboxNorthEnough(f)) continue;
    try {
      const inter = turf.intersect(turf.featureCollection([f, clipPoly]));
      if (inter) {
        inter.properties = { ...f.properties };
        out.push(inter);
      }
    } catch {
      out.push(f);
    }
  }
  return { type: 'FeatureCollection', features: out };
}

function normalizeTownProperties(fc, sourceName) {
  return {
    type: 'FeatureCollection',
    features: fc.features.map(f => ({
      type: 'Feature',
      geometry: f.geometry,
      properties: {
        ...f.properties,
        NAME: f.properties.NAME || f.properties.name || f.properties.CITY || 'Unnamed town',
        SOURCE: sourceName
      }
    }))
  };
}

function dedupeByName(fc) {
  const seen = new Set();
  const features = [];
  for (const f of fc.features) {
    const name = (featureLabel(f) || '').toLowerCase();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    features.push(f);
  }
  return { type: 'FeatureCollection', features };
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}`);
  return res.json();
}

async function loadOfficialData() {
  setStatus('Downloading ZIP boundaries…');
  const zipsRaw = await fetchJson(ZIPS_URL);
  setStatus('Filtering ZIP boundaries to north of Angels Camp…');
  const zips = clipNorthOfAngelsCamp(zipsRaw);
  currentZipGeojson = zips;

  setStatus('Downloading incorporated cities…');
  const citiesRaw = await fetchJson(INCORP_URL);
  setStatus('Downloading census-designated places…');
  const cdpRaw = await fetchJson(CDP_URL);

  setStatus('Combining towns…');
  const townsMerged = {
    type: 'FeatureCollection',
    features: [
      ...normalizeTownProperties(citiesRaw, 'Incorporated city').features,
      ...normalizeTownProperties(cdpRaw, 'CDP').features,
    ]
  };
  const clippedTowns = dedupeByName(clipNorthOfAngelsCamp(townsMerged));
  currentTownGeojson = clippedTowns;

  renderLayers();
  setStatus(`Loaded ${currentZipGeojson.features.length} ZIP areas and ${currentTownGeojson.features.length} towns.`);
}

function renderLayers() {
  clearSelectionStyle();
  selected = null;
  updateSelectionInfo();

  if (zipLayer) map.removeLayer(zipLayer);
  if (townLayer) map.removeLayer(townLayer);

  if (currentZipGeojson) {
    zipLayer = L.geoJSON(currentZipGeojson, {
      style: zipStyle,
      onEachFeature: bindLayerEvents('zip')
    }).addTo(map);
  }

  if (currentTownGeojson) {
    townLayer = L.geoJSON(currentTownGeojson, {
      style: townStyle,
      onEachFeature: bindLayerEvents('town')
    }).addTo(map);
  }

  const group = L.featureGroup([].concat(zipLayer ? [zipLayer] : [], townLayer ? [townLayer] : []));
  try { map.fitBounds(group.getBounds(), { padding: [20, 20] }); } catch {}
}

function markSelectedDate(dateStr) {
  if (!selected || selected.type !== 'town') return;
  const rec = getTownRecord(selected.id);
  rec.lastVisited = dateStr;
  selected.layer.setStyle(townStyle(selected.feature));
  applySelectionStyle(selected.layer, 'town', selected.feature);
  saveState();
  updateSelectionInfo();
}

function saveSelectedNotes() {
  if (!selected || selected.type !== 'town') return;
  const rec = getTownRecord(selected.id);
  rec.notes = els.notesInput.value.trim();
  saveState();
  updateSelectionInfo();
}

function searchAndZoom(term) {
  const q = term.trim().toLowerCase();
  if (!q) return;
  let found = false;
  [townLayer, zipLayer].forEach(layerGroup => {
    if (!layerGroup || found) return;
    layerGroup.eachLayer(layer => {
      if (found) return;
      const text = JSON.stringify(layer.feature.properties).toLowerCase();
      if (text.includes(q)) {
        found = true;
        map.fitBounds(layer.getBounds(), { padding: [30, 30] });
        selectFeature(layerGroup === townLayer ? 'town' : 'zip', layer.feature, layer);
      }
    });
  });
}

function downloadJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportState() {
  downloadJson(state, 'norcal-territory-activity-backup.json');
}

function exportGeojson() {
  if (!currentZipGeojson || !currentTownGeojson) {
    alert('Load the official data first.');
    return;
  }
  downloadJson(currentZipGeojson, 'norcal-zip-boundaries-north-of-angels-camp.geojson');
  setTimeout(() => downloadJson(currentTownGeojson, 'norcal-towns-north-of-angels-camp.geojson'), 400);
}

function importState(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      state = JSON.parse(reader.result);
      saveState();
      renderLayers();
      setStatus('Activity backup imported.');
    } catch {
      alert('Could not import that backup file.');
    }
  };
  reader.readAsText(file);
}

document.getElementById('loadOfficialBtn').addEventListener('click', async () => {
  try {
    await loadOfficialData();
  } catch (err) {
    console.error(err);
    setStatus('Could not load the remote data. If this happens on GitHub Pages, try again in a minute.');
  }
});

document.getElementById('markTodayBtn').addEventListener('click', () => markSelectedDate(todayStr()));
document.getElementById('setDateBtn').addEventListener('click', () => {
  if (!els.visitDate.value) return alert('Choose a date first.');
  markSelectedDate(els.visitDate.value);
});
document.getElementById('saveNotesBtn').addEventListener('click', saveSelectedNotes);
document.getElementById('saveBtn').addEventListener('click', () => { saveState(); setStatus('Saved on this device.'); });
document.getElementById('exportStateBtn').addEventListener('click', exportState);
document.getElementById('exportGeojsonBtn').addEventListener('click', exportGeojson);
document.getElementById('importStateFile').addEventListener('change', e => { if (e.target.files[0]) importState(e.target.files[0]); });
document.getElementById('searchBtn').addEventListener('click', () => searchAndZoom(els.searchInput.value));
els.searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') searchAndZoom(els.searchInput.value); });
els.zipFillMode.value = state.zipFillMode || 'lightgray';
els.zipFillMode.addEventListener('change', e => {
  state.zipFillMode = e.target.value;
  saveState();
  if (zipLayer) zipLayer.setStyle(zipStyle);
  if (selected && selected.type === 'zip') applySelectionStyle(selected.layer, 'zip', selected.feature);
  updateSelectionInfo();
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

updateSelectionInfo();
