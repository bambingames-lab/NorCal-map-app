
const map = L.map('map', { zoomControl: true }).setView([39.2, -121.6], 7);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

const STORAGE_KEY = 'norcalMapBundleV1';

let state = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {
  zipFillMode: 'lightgray',
  towns: {}
};

let layers = {
  zips: null,
  towns: null
};

let selected = null;

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  refreshSelectedInfo();
}

function todayString() {
  return new Date().toISOString().split('T')[0];
}

function weeksSince(dateStr) {
  if (!dateStr) return null;
  const start = new Date(dateStr + 'T00:00:00');
  const now = new Date();
  const diffMs = now - start;
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24 * 7)));
}

function visitColor(dateStr) {
  const weeks = weeksSince(dateStr);
  if (weeks === null) return '#d1d5db';
  if (weeks <= 1) return '#b91c1c';
  if (weeks <= 2) return '#dc2626';
  if (weeks <= 3) return '#ef4444';
  if (weeks <= 5) return '#f97316';
  if (weeks <= 7) return '#facc15';
  if (weeks <= 10) return '#d9f99d';
  return '#bbf7d0';
}

function featureId(feature) {
  const p = feature.properties || {};
  return p.id || p.ZIP || p.ZCTA5CE20 || p.NAME || p.name;
}

function featureLabel(feature) {
  const p = feature.properties || {};
  return p.name || p.NAME || p.ZIP || p.ZCTA5CE20 || 'Unnamed area';
}

function getTownRecord(id) {
  if (!state.towns[id]) {
    state.towns[id] = { lastVisited: null, notes: '' };
  }
  return state.towns[id];
}

function zipStyle() {
  return {
    color: '#1f2937',
    weight: 3,
    fillColor: '#d1d5db',
    fillOpacity: state.zipFillMode === 'lightgray' ? 0.25 : 0
  };
}

function townStyle(feature) {
  const record = getTownRecord(featureId(feature));
  return {
    color: '#111827',
    weight: 1.2,
    fillColor: visitColor(record.lastVisited),
    fillOpacity: 0.65
  };
}

function applySelectedStyle(layer, baseWeight) {
  layer.setStyle({ color: '#000', weight: baseWeight + 2 });
}

function resetSelectedStyle() {
  if (!selected) return;
  if (selected.type === 'zip') {
    selected.layer.setStyle(zipStyle());
  } else {
    selected.layer.setStyle(townStyle(selected.feature));
  }
}

function refreshSelectedInfo() {
  const box = document.getElementById('selectedInfo');
  if (!selected) {
    box.innerHTML = 'Nothing selected yet.';
    return;
  }

  const label = featureLabel(selected.feature);
  const id = featureId(selected.feature);

  if (selected.type === 'zip') {
    box.innerHTML = `<strong>${label}</strong><br>Type: ZIP<br>ZIP fill: ${state.zipFillMode}`;
    return;
  }

  const record = getTownRecord(id);
  const weeks = weeksSince(record.lastVisited);
  document.getElementById('visitDate').value = record.lastVisited || '';
  document.getElementById('notesInput').value = record.notes || '';

  box.innerHTML = `
    <strong>${label}</strong><br>
    Type: Town<br>
    Last visited: ${record.lastVisited || 'Not set'}<br>
    Weeks since: ${weeks === null ? 'N/A' : weeks}<br>
    Notes: ${record.notes || 'None'}
  `;
}

function setSelected(type, feature, layer) {
  resetSelectedStyle();
  selected = { type, feature, layer };
  if (type === 'zip') {
    applySelectedStyle(layer, 3);
  } else {
    applySelectedStyle(layer, 1.2);
  }
  refreshSelectedInfo();
}

function bindFeatureEvents(type) {
  return function(feature, layer) {
    layer.on('click', () => setSelected(type, feature, layer));
    layer.on('mouseover', () => layer.setStyle({ weight: type === 'zip' ? 4 : 2.2 }));
    layer.on('mouseout', () => {
      if (selected && selected.layer === layer) {
        if (type === 'zip') {
          layer.setStyle(zipStyle());
          applySelectedStyle(layer, 3);
        } else {
          layer.setStyle(townStyle(feature));
          applySelectedStyle(layer, 1.2);
        }
      } else {
        if (type === 'zip') layer.setStyle(zipStyle());
        else layer.setStyle(townStyle(feature));
      }
    });
  };
}

function loadGeoJsonObject(data, type) {
  if (type === 'zip' && layers.zips) map.removeLayer(layers.zips);
  if (type === 'town' && layers.towns) map.removeLayer(layers.towns);

  const layer = L.geoJSON(data, {
    style: (feature) => type === 'zip' ? zipStyle() : townStyle(feature),
    onEachFeature: bindFeatureEvents(type)
  }).addTo(map);

  if (type === 'zip') layers.zips = layer;
  else layers.towns = layer;

  try {
    map.fitBounds(layer.getBounds(), { padding: [20, 20] });
  } catch (e) {}
}

async function loadBundledData() {
  const [zips, towns] = await Promise.all([
    fetch('./data/norcal-zips.geojson').then(r => r.json()),
    fetch('./data/norcal-towns.geojson').then(r => r.json())
  ]);
  loadGeoJsonObject(zips, 'zip');
  loadGeoJsonObject(towns, 'town');
}

function handleFileInput(elementId, type) {
  document.getElementById(elementId).addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    loadGeoJsonObject(JSON.parse(text), type);
  });
}

function markSelectedToday() {
  if (!selected || selected.type !== 'town') return alert('Select a town first.');
  const record = getTownRecord(featureId(selected.feature));
  record.lastVisited = todayString();
  selected.layer.setStyle(townStyle(selected.feature));
  applySelectedStyle(selected.layer, 1.2);
  saveState();
}

function applyVisitDate() {
  if (!selected || selected.type !== 'town') return alert('Select a town first.');
  const value = document.getElementById('visitDate').value;
  if (!value) return alert('Choose a date first.');
  const record = getTownRecord(featureId(selected.feature));
  record.lastVisited = value;
  selected.layer.setStyle(townStyle(selected.feature));
  applySelectedStyle(selected.layer, 1.2);
  saveState();
}

function saveNotes() {
  if (!selected || selected.type !== 'town') return alert('Select a town first.');
  const record = getTownRecord(featureId(selected.feature));
  record.notes = document.getElementById('notesInput').value.trim();
  saveState();
}

function exportBackup() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'norcal-map-backup.json';
  a.click();
  URL.revokeObjectURL(url);
}

function importBackup(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      state = JSON.parse(reader.result);
      saveState();
      if (layers.zips) layers.zips.setStyle(zipStyle());
      if (layers.towns) layers.towns.setStyle(townStyle);
      resetSelectedStyle();
      refreshSelectedInfo();
      alert('Backup loaded.');
    } catch (e) {
      alert('Could not load backup.');
    }
  };
  reader.readAsText(file);
}

function searchMap() {
  const q = document.getElementById('searchInput').value.trim().toLowerCase();
  if (!q) return;

  [layers.towns, layers.zips].forEach(group => {
    if (!group) return;
    group.eachLayer(layer => {
      const props = layer.feature.properties || {};
      const text = [props.name, props.NAME, props.id, props.ZIP, props.ZCTA5CE20]
        .filter(Boolean).join(' ').toLowerCase();
      if (text.includes(q)) {
        map.fitBounds(layer.getBounds(), { padding: [30, 30] });
        setSelected(group === layers.towns ? 'town' : 'zip', layer.feature, layer);
      }
    });
  });
}

document.getElementById('loadDemoBtn').addEventListener('click', loadBundledData);
document.getElementById('zipFillMode').addEventListener('change', (e) => {
  state.zipFillMode = e.target.value;
  saveState();
  if (layers.zips) layers.zips.setStyle(zipStyle());
});
document.getElementById('markTodayBtn').addEventListener('click', markSelectedToday);
document.getElementById('setDateBtn').addEventListener('click', applyVisitDate);
document.getElementById('notesSaveBtn').addEventListener('click', saveNotes);
document.getElementById('saveBtn').addEventListener('click', () => {
  saveState();
  alert('Saved on this device.');
});
document.getElementById('exportBtn').addEventListener('click', exportBackup);
document.getElementById('backupFile').addEventListener('change', (e) => {
  if (e.target.files[0]) importBackup(e.target.files[0]);
});
document.getElementById('searchBtn').addEventListener('click', searchMap);
document.getElementById('searchInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') searchMap();
});

handleFileInput('zipFile', 'zip');
handleFileInput('townFile', 'town');

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
