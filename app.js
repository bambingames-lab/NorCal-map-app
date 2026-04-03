const STORAGE_KEY = 'norcal-area-manager-v4';

let state = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {
  settings: {
    zipFillMode: 'transparent',
    zipWeight: 4.5
  },
  towns: {}
};

let layers = {
  zips: null,
  towns: null
};

let selectedFeature = null; // { type, id, feature, layer }

const map = L.map('map', { zoomControl: true }).setView([39.4, -121.6], 7);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

const panel = document.getElementById('panel');
const showPanelBtn = document.getElementById('showPanelBtn');
const togglePanelBtn = document.getElementById('togglePanelBtn');

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function featureId(feature) {
  const p = feature.properties || {};
  return p.id || p.ZCTA5CE20 || p.GEOID || p.NAME || p.name || String(Math.random());
}

function featureLabel(feature) {
  const p = feature.properties || {};
  return p.NAME || p.name || p.ZCTA5CE20 || p.GEOID || 'Unnamed area';
}

function weeksSince(dateStr) {
  if (!dateStr) return null;
  const then = new Date(dateStr + 'T00:00:00');
  const now = new Date();
  const ms = now - then;
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24 * 7)));
}

// Turns fully green at about 12 weeks / 3 months out.
function townRecencyColor(dateStr) {
  const w = weeksSince(dateStr);
  if (w === null) return '#d1d5db';
  if (w <= 1) return '#b91c1c';
  if (w <= 3) return '#ef4444';
  if (w <= 5) return '#f97316';
  if (w <= 8) return '#facc15';
  if (w <= 11) return '#a3e635';
  return '#86efac';
}

function zipStyle() {
  const fillMode = state.settings.zipFillMode;
  return {
    color: '#1f2937',
    weight: Number(state.settings.zipWeight || 4.5),
    opacity: 1,
    fillColor: fillMode === 'lightgray' ? '#d1d5db' : 'transparent',
    fillOpacity: fillMode === 'lightgray' ? 0.18 : 0
  };
}

function townStyle(feature) {
  const id = featureId(feature);
  const record = state.towns[id] || {};
  return {
    color: '#111827',
    weight: 1.4,
    opacity: 0.9,
    fillColor: townRecencyColor(record.lastVisited),
    fillOpacity: 0.62
  };
}

function updateSelectedInfo() {
  const box = document.getElementById('selectedInfo');
  const notes = document.getElementById('notesInput');

  if (!selectedFeature) {
    box.innerHTML = '<strong>No selection</strong><br>Tap a town to update the last-checked date.';
    notes.value = '';
    return;
  }

  const { type, id, feature } = selectedFeature;
  const label = featureLabel(feature);

  if (type === 'zips') {
    box.innerHTML = `<strong>${label}</strong><br>Type: ZIP<br>ZIP fill: ${state.settings.zipFillMode}<br>ZIP line weight: ${state.settings.zipWeight}`;
    notes.value = '';
    return;
  }

  const rec = state.towns[id] || {};
  const weeks = weeksSince(rec.lastVisited);
  box.innerHTML = `<strong>${label}</strong><br>Type: Town<br>Last checked: ${rec.lastVisited || 'Not set'}<br>Weeks out: ${weeks === null ? 'N/A' : weeks}<br>Notes: ${rec.notes || 'None'}`;
  notes.value = rec.notes || '';
}

function resetLayerLook(type, layer, feature) {
  if (type === 'zips') layer.setStyle(zipStyle());
  if (type === 'towns') layer.setStyle(townStyle(feature));
}

function applySelectedLook(type, layer, feature) {
  resetLayerLook(type, layer, feature);
  layer.setStyle({
    weight: type === 'zips' ? Number(state.settings.zipWeight || 4.5) + 1.8 : 3,
    color: '#000000'
  });
  if (layer.bringToFront) layer.bringToFront();
}

function selectFeature(type, feature, layer) {
  if (selectedFeature) {
    resetLayerLook(selectedFeature.type, selectedFeature.layer, selectedFeature.feature);
  }
  selectedFeature = { type, id: featureId(feature), feature, layer };
  applySelectedLook(type, layer, feature);
  updateSelectedInfo();
}

function bindFeature(type) {
  return function(feature, layer) {
    layer.on('click', () => selectFeature(type, feature, layer));
    layer.on('mouseover', () => {
      layer.setStyle({ weight: type === 'zips' ? Number(state.settings.zipWeight || 4.5) + 0.8 : 2.2 });
    });
    layer.on('mouseout', () => {
      if (selectedFeature && selectedFeature.layer === layer) {
        applySelectedLook(type, layer, feature);
      } else {
        resetLayerLook(type, layer, feature);
      }
    });
  };
}

function loadGeoJsonText(text, type) {
  const data = JSON.parse(text);
  if (layers[type]) map.removeLayer(layers[type]);

  layers[type] = L.geoJSON(data, {
    style: (feature) => type === 'zips' ? zipStyle() : townStyle(feature),
    onEachFeature: bindFeature(type)
  }).addTo(map);

  try {
    map.fitBounds(layers[type].getBounds(), { padding: [20, 20] });
  } catch (e) {}
}

function setSelectedTownDate(dateStr) {
  if (!selectedFeature || selectedFeature.type !== 'towns') return;
  state.towns[selectedFeature.id] = state.towns[selectedFeature.id] || {};
  state.towns[selectedFeature.id].lastVisited = dateStr;
  applySelectedLook('towns', selectedFeature.layer, selectedFeature.feature);
  saveState();
  updateSelectedInfo();
}

function setSelectedTownNotes(text) {
  if (!selectedFeature || selectedFeature.type !== 'towns') return;
  state.towns[selectedFeature.id] = state.towns[selectedFeature.id] || {};
  state.towns[selectedFeature.id].notes = text;
  saveState();
  updateSelectedInfo();
}

function exportBackup() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'norcal-area-manager-backup.json';
  a.click();
  URL.revokeObjectURL(url);
}

function importBackup(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      state = JSON.parse(reader.result);
      saveState();
      document.getElementById('zipFillMode').value = state.settings.zipFillMode || 'transparent';
      document.getElementById('zipWeight').value = state.settings.zipWeight || 4.5;
      if (layers.zips) layers.zips.setStyle(() => zipStyle());
      if (layers.towns) layers.towns.setStyle((f) => townStyle(f));
      selectedFeature = null;
      updateSelectedInfo();
      alert('Backup loaded.');
    } catch {
      alert('Backup file could not be read.');
    }
  };
  reader.readAsText(file);
}

function searchMap(term) {
  const q = (term || '').toLowerCase().trim();
  if (!q) return;

  ['towns', 'zips'].forEach(type => {
    const group = layers[type];
    if (!group) return;

    group.eachLayer(layer => {
      const props = layer.feature.properties || {};
      const haystack = [
        props.NAME, props.name, props.ZCTA5CE20, props.GEOID, props.id
      ].filter(Boolean).join(' ').toLowerCase();

      if (haystack.includes(q)) {
        map.fitBounds(layer.getBounds(), { padding: [25, 25] });
        selectFeature(type, layer.feature, layer);
      }
    });
  });
}

document.getElementById('zipFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  loadGeoJsonText(await file.text(), 'zips');
});

document.getElementById('townFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  loadGeoJsonText(await file.text(), 'towns');
});

document.getElementById('zipFillMode').addEventListener('change', (e) => {
  state.settings.zipFillMode = e.target.value;
  saveState();
  if (layers.zips) layers.zips.setStyle(() => zipStyle());
  updateSelectedInfo();
});

document.getElementById('zipWeight').addEventListener('input', (e) => {
  state.settings.zipWeight = Number(e.target.value);
  saveState();
  if (layers.zips) layers.zips.setStyle(() => zipStyle());
  if (selectedFeature && selectedFeature.type === 'zips') {
    applySelectedLook('zips', selectedFeature.layer, selectedFeature.feature);
  }
  updateSelectedInfo();
});

document.getElementById('markTodayBtn').addEventListener('click', () => {
  const today = new Date().toISOString().split('T')[0];
  setSelectedTownDate(today);
});

document.getElementById('setDateBtn').addEventListener('click', () => {
  const d = document.getElementById('visitDate').value;
  if (!d) return alert('Choose a date first.');
  setSelectedTownDate(d);
});

document.getElementById('saveNotesBtn').addEventListener('click', () => {
  setSelectedTownNotes(document.getElementById('notesInput').value.trim());
});

document.getElementById('saveBtn').addEventListener('click', () => {
  saveState();
  alert('Saved on this device.');
});

document.getElementById('exportBtn').addEventListener('click', exportBackup);

document.getElementById('backupFile').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) importBackup(file);
});

document.getElementById('searchBtn').addEventListener('click', () => {
  searchMap(document.getElementById('searchInput').value);
});

document.getElementById('searchInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') searchMap(e.target.value);
});

showPanelBtn.addEventListener('click', () => panel.classList.remove('hidden'));
togglePanelBtn.addEventListener('click', () => panel.classList.add('hidden'));

document.getElementById('zipFillMode').value = state.settings.zipFillMode || 'transparent';
document.getElementById('zipWeight').value = state.settings.zipWeight || 4.5;
updateSelectedInfo();
