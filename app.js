const NORCAL_BOUNDS = [[37.45, -124.8],[41.99, -119.2]];
const DEFAULT_VIEW = [39.4, -121.6];
const STORAGE_KEY = 'norcalMapProV2';

const map = L.map('map', { zoomControl: true }).setView(DEFAULT_VIEW, 7);
map.fitBounds(NORCAL_BOUNDS);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

const els = {
  sidebar: document.getElementById('sidebar'),
  openSidebarBtn: document.getElementById('openSidebarBtn'),
  toggleSidebarBtn: document.getElementById('toggleSidebarBtn'),
  zipFile: document.getElementById('zipFile'),
  townFile: document.getElementById('townFile'),
  townshipFile: document.getElementById('townshipFile'),
  loadDemoBtn: document.getElementById('loadDemoBtn'),
  clearLayersBtn: document.getElementById('clearLayersBtn'),
  modeSelect: document.getElementById('modeSelect'),
  colorPicker: document.getElementById('colorPicker'),
  markTodayBtn: document.getElementById('markTodayBtn'),
  setDateBtn: document.getElementById('setDateBtn'),
  dateInput: document.getElementById('dateInput'),
  searchInput: document.getElementById('searchInput'),
  countyFilter: document.getElementById('countyFilter'),
  clearSearchBtn: document.getElementById('clearSearchBtn'),
  zoomRegionBtn: document.getElementById('zoomRegionBtn'),
  zipVisible: document.getElementById('zipVisible'),
  townVisible: document.getElementById('townVisible'),
  townshipVisible: document.getElementById('townshipVisible'),
  selectedInfo: document.getElementById('selectedInfo'),
  repInput: document.getElementById('repInput'),
  notesInput: document.getElementById('notesInput'),
  saveNotesBtn: document.getElementById('saveNotesBtn'),
  clearSelectionBtn: document.getElementById('clearSelectionBtn'),
  statsGrid: document.getElementById('statsGrid'),
  saveLocalBtn: document.getElementById('saveLocalBtn'),
  loadLocalBtn: document.getElementById('loadLocalBtn'),
  exportProjectBtn: document.getElementById('exportProjectBtn'),
  importProjectFile: document.getElementById('importProjectFile'),
};

const state = {
  mode: 'zip',
  datasets: { zip: null, town: null, township: null },
  styles: { zip: {}, town: {} },
  townshipActivity: {},
  details: {},
  selected: null,
  filters: { county: '', search: '' },
  visibility: { zip: true, town: true, township: true }
};

const layers = { zip: null, town: null, township: null };

function clone(obj){ return JSON.parse(JSON.stringify(obj)); }

function featureKey(feature) {
  const p = feature.properties || {};
  return String(p.id || p.ZCTA5CE20 || p.GEOID || p.PLACEFP || p.NAME || p.name || p.zip || Math.random());
}

function featureName(feature) {
  const p = feature.properties || {};
  return p.NAME || p.name || p.town || p.city || p.zip || p.ZCTA5CE20 || featureKey(feature);
}

function featureCounty(feature) {
  const p = feature.properties || {};
  return p.COUNTY || p.county || p.COUNTYFP || '';
}

function ensureDetails(key) {
  if (!state.details[key]) state.details[key] = { notes: '', rep: '' };
  return state.details[key];
}

function weeksSince(dateStr) {
  if (!dateStr) return null;
  const then = new Date(dateStr + 'T00:00:00');
  const diff = Date.now() - then.getTime();
  return Math.max(0, Math.floor(diff / (1000*60*60*24*7)));
}

function townshipColor(dateStr) {
  const w = weeksSince(dateStr);
  if (w === null) return '#d1d5db';
  if (w < 1) return '#991b1b';
  if (w < 2) return '#dc2626';
  if (w < 4) return '#f87171';
  if (w < 8) return '#fde68a';
  if (w < 12) return '#d9f99d';
  return '#86efac';
}

function passesFilters(feature) {
  const countyPass = !state.filters.county || String(featureCounty(feature)).toLowerCase() === state.filters.county.toLowerCase();
  const q = state.filters.search.trim().toLowerCase();
  if (!q) return countyPass;
  const p = feature.properties || {};
  const haystack = [p.NAME, p.name, p.GEOID, p.ZCTA5CE20, p.id, p.zip, p.city, p.town, p.COUNTY, p.county].filter(Boolean).join(' ').toLowerCase();
  return countyPass && haystack.includes(q);
}

function featureStyle(feature, type) {
  const key = featureKey(feature);
  let fillColor = '#bfdbfe';
  if (type === 'zip') fillColor = state.styles.zip[key]?.color || '#bfdbfe';
  if (type === 'town') fillColor = state.styles.town[key]?.color || '#c4b5fd';
  if (type === 'township') fillColor = townshipColor(state.townshipActivity[key]?.date);
  const selected = state.selected && state.selected.type === type && state.selected.key === key;
  const visible = passesFilters(feature) && state.visibility[type];
  return {
    color: selected ? '#0f172a' : '#334155',
    weight: selected ? 3 : 1,
    fillColor,
    fillOpacity: visible ? 0.72 : 0.08,
    opacity: visible ? 1 : 0.15
  };
}

function popupHtml(feature, type) {
  const key = featureKey(feature);
  const d = ensureDetails(key);
  const last = state.townshipActivity[key]?.date || 'none';
  const age = state.townshipActivity[key]?.date ? `${weeksSince(state.townshipActivity[key].date)} weeks` : 'n/a';
  return `
    <strong>${featureName(feature)}</strong><br>
    Type: ${type}<br>
    Key: ${key}<br>
    County: ${featureCounty(feature) || 'n/a'}<br>
    ${type === 'township' ? `Last interaction: ${last}<br>Age: ${age}<br>` : ''}
    Rep: ${d.rep || 'n/a'}<br>
    Notes: ${d.notes || 'none'}
  `;
}

function selectFeature(type, feature, layer) {
  state.selected = { type, key: featureKey(feature) };
  updateAllStyles();
  const key = featureKey(feature);
  const details = ensureDetails(key);
  const last = state.townshipActivity[key]?.date || 'none';
  const html = `
    <div class="selected-box">
      <strong>${featureName(feature)}</strong><br>
      Type: ${type}<br>
      Key: ${key}<br>
      County: ${featureCounty(feature) || 'n/a'}<br>
      ${type === 'township' ? `Last interaction: ${last}<br>Weeks since: ${state.townshipActivity[key]?.date ? weeksSince(state.townshipActivity[key].date) : 'n/a'}<br>` : ''}
    </div>`;
  els.selectedInfo.innerHTML = html;
  els.repInput.value = details.rep || '';
  els.notesInput.value = details.notes || '';
  if (layer?.getBounds) map.fitBounds(layer.getBounds(), { maxZoom: 11, padding: [20,20] });
}

function clearSelection() {
  state.selected = null;
  els.selectedInfo.innerHTML = 'Nothing selected yet.';
  els.repInput.value = '';
  els.notesInput.value = '';
  updateAllStyles();
}

function attachFeatureEvents(type, feature, layer) {
  layer.on('click', () => {
    const key = featureKey(feature);
    selectFeature(type, feature, layer);
    if (state.mode === type && type !== 'township') {
      state.styles[type][key] = { color: els.colorPicker.value };
      updateAllStyles();
    }
    layer.bindPopup(popupHtml(feature, type)).openPopup();
  });
}

function drawDataset(type, geojson) {
  state.datasets[type] = clone(geojson);
  if (layers[type]) map.removeLayer(layers[type]);
  layers[type] = L.geoJSON(geojson, {
    style: (feature) => featureStyle(feature, type),
    onEachFeature: (feature, layer) => attachFeatureEvents(type, feature, layer)
  });
  if (state.visibility[type]) layers[type].addTo(map);
  refreshCountyOptions();
  updateAllStyles();
  refreshStats();
}

function updateAllStyles() {
  for (const [type, layer] of Object.entries(layers)) {
    if (!layer) continue;
    layer.setStyle((feature) => featureStyle(feature, type));
    if (state.visibility[type]) {
      if (!map.hasLayer(layer)) layer.addTo(map);
    } else if (map.hasLayer(layer)) {
      map.removeLayer(layer);
    }
  }
  refreshStats();
}

function refreshCountyOptions() {
  const counties = new Set(['']);
  Object.values(state.datasets).forEach(ds => {
    if (!ds?.features) return;
    ds.features.forEach(f => { const c = featureCounty(f); if (c) counties.add(String(c)); });
  });
  const current = els.countyFilter.value;
  els.countyFilter.innerHTML = '<option value="">All counties</option>' + [...counties].filter(Boolean).sort().map(c => `<option value="${c}">${c}</option>`).join('');
  els.countyFilter.value = current;
}

function refreshStats() {
  const counts = {
    zip: state.datasets.zip?.features?.length || 0,
    town: state.datasets.town?.features?.length || 0,
    township: state.datasets.township?.features?.length || 0,
    overdue: Object.values(state.townshipActivity).filter(v => (weeksSince(v.date) ?? -1) >= 8).length
  };
  els.statsGrid.innerHTML = `
    <div><strong>${counts.zip}</strong><span>ZIPs</span></div>
    <div><strong>${counts.town}</strong><span>Towns</span></div>
    <div><strong>${counts.township}</strong><span>Townships</span></div>
    <div><strong>${counts.overdue}</strong><span>Overdue 8+ wks</span></div>`;
}

async function readGeoFile(file) {
  const text = await file.text();
  return JSON.parse(text);
}

function saveLocal() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  alert('Saved on this device.');
}

function loadLocal() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return alert('No saved project found on this device yet.');
  const parsed = JSON.parse(saved);
  Object.assign(state, parsed);
  ['zip','town','township'].forEach(type => { if (state.datasets[type]) drawDataset(type, state.datasets[type]); });
  els.modeSelect.value = state.mode;
  els.searchInput.value = state.filters.search;
  els.countyFilter.value = state.filters.county;
  els.zipVisible.checked = state.visibility.zip;
  els.townVisible.checked = state.visibility.town;
  els.townshipVisible.checked = state.visibility.township;
  updateAllStyles();
}

function exportProject() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'norcal-map-project.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

async function importProject(file) {
  const text = await file.text();
  const parsed = JSON.parse(text);
  Object.assign(state, parsed);
  ['zip','town','township'].forEach(type => { if (state.datasets[type]) drawDataset(type, state.datasets[type]); else if (layers[type]) { map.removeLayer(layers[type]); layers[type] = null; } });
  els.modeSelect.value = state.mode;
  els.searchInput.value = state.filters.search || '';
  refreshCountyOptions();
  els.countyFilter.value = state.filters.county || '';
  els.zipVisible.checked = !!state.visibility.zip;
  els.townVisible.checked = !!state.visibility.town;
  els.townshipVisible.checked = !!state.visibility.township;
  updateAllStyles();
  clearSelection();
}

function square(lng, lat, size=0.18) {
  return [[[lng,lat],[lng+size,lat],[lng+size,lat+size],[lng,lat+size],[lng,lat]]];
}

function demoData() {
  return {
    zip: { type:'FeatureCollection', features:[
      { type:'Feature', properties:{ id:'95926', name:'Chico 95926', COUNTY:'Butte', ZCTA5CE20:'95926' }, geometry:{ type:'Polygon', coordinates:square(-121.89,39.68,0.12) } },
      { type:'Feature', properties:{ id:'96001', name:'Redding 96001', COUNTY:'Shasta', ZCTA5CE20:'96001' }, geometry:{ type:'Polygon', coordinates:square(-122.45,40.53,0.14) } },
      { type:'Feature', properties:{ id:'95222', name:'Angels Camp 95222', COUNTY:'Calaveras', ZCTA5CE20:'95222' }, geometry:{ type:'Polygon', coordinates:square(-120.55,38.06,0.12) } }
    ]},
    town: { type:'FeatureCollection', features:[
      { type:'Feature', properties:{ id:'town_chico', name:'Chico', COUNTY:'Butte' }, geometry:{ type:'Polygon', coordinates:square(-121.90,39.70,0.09) } },
      { type:'Feature', properties:{ id:'town_redding', name:'Redding', COUNTY:'Shasta' }, geometry:{ type:'Polygon', coordinates:square(-122.42,40.56,0.1) } },
      { type:'Feature', properties:{ id:'town_angels', name:'Angels Camp', COUNTY:'Calaveras' }, geometry:{ type:'Polygon', coordinates:square(-120.54,38.07,0.08) } }
    ]},
    township: { type:'FeatureCollection', features:[
      { type:'Feature', properties:{ id:'ts_chico_n', name:'Chico North', COUNTY:'Butte' }, geometry:{ type:'Polygon', coordinates:square(-121.88,39.78,0.16) } },
      { type:'Feature', properties:{ id:'ts_redding_w', name:'Redding West', COUNTY:'Shasta' }, geometry:{ type:'Polygon', coordinates:square(-122.57,40.55,0.16) } },
      { type:'Feature', properties:{ id:'ts_angels', name:'Angels Territory', COUNTY:'Calaveras' }, geometry:{ type:'Polygon', coordinates:square(-120.65,38.02,0.16) } }
    ]}
  };
}

els.openSidebarBtn.addEventListener('click', () => els.sidebar.classList.remove('hidden'));
els.toggleSidebarBtn.addEventListener('click', () => els.sidebar.classList.add('hidden'));
els.modeSelect.addEventListener('change', e => state.mode = e.target.value);
els.markTodayBtn.addEventListener('click', () => {
  if (!state.selected || state.selected.type !== 'township') return alert('Select a township first.');
  state.townshipActivity[state.selected.key] = { date: new Date().toISOString().split('T')[0] };
  updateAllStyles();
});
els.setDateBtn.addEventListener('click', () => {
  if (!state.selected || state.selected.type !== 'township') return alert('Select a township first.');
  if (!els.dateInput.value) return alert('Pick a date first.');
  state.townshipActivity[state.selected.key] = { date: els.dateInput.value };
  updateAllStyles();
});
els.countyFilter.addEventListener('change', e => { state.filters.county = e.target.value; updateAllStyles(); });
els.searchInput.addEventListener('input', e => {
  state.filters.search = e.target.value;
  updateAllStyles();
  if (!e.target.value.trim()) return;
  for (const [type, layer] of Object.entries(layers)) {
    if (!layer) continue;
    let found = null;
    layer.eachLayer(l => {
      if (found) return;
      if (passesFilters(l.feature)) found = l;
    });
    if (found) { map.fitBounds(found.getBounds(), { maxZoom: 11, padding:[20,20] }); break; }
  }
});
els.clearSearchBtn.addEventListener('click', () => { els.searchInput.value = ''; state.filters.search = ''; els.countyFilter.value = ''; state.filters.county = ''; updateAllStyles(); });
els.zoomRegionBtn.addEventListener('click', () => map.fitBounds(NORCAL_BOUNDS));
els.zipVisible.addEventListener('change', e => { state.visibility.zip = e.target.checked; updateAllStyles(); });
els.townVisible.addEventListener('change', e => { state.visibility.town = e.target.checked; updateAllStyles(); });
els.townshipVisible.addEventListener('change', e => { state.visibility.township = e.target.checked; updateAllStyles(); });
els.saveNotesBtn.addEventListener('click', () => {
  if (!state.selected) return alert('Select an area first.');
  const d = ensureDetails(state.selected.key);
  d.rep = els.repInput.value.trim();
  d.notes = els.notesInput.value.trim();
  alert('Area details saved.');
  updateAllStyles();
});
els.clearSelectionBtn.addEventListener('click', clearSelection);
els.saveLocalBtn.addEventListener('click', saveLocal);
els.loadLocalBtn.addEventListener('click', loadLocal);
els.exportProjectBtn.addEventListener('click', exportProject);
els.importProjectFile.addEventListener('change', async e => { if (e.target.files[0]) await importProject(e.target.files[0]); e.target.value = ''; });
els.loadDemoBtn.addEventListener('click', () => {
  const d = demoData();
  drawDataset('zip', d.zip);
  drawDataset('town', d.town);
  drawDataset('township', d.township);
  state.townshipActivity['ts_chico_n'] = { date: new Date().toISOString().split('T')[0] };
  const dt = new Date(); dt.setDate(dt.getDate()-36); state.townshipActivity['ts_redding_w'] = { date: dt.toISOString().split('T')[0] };
  const dt2 = new Date(); dt2.setDate(dt2.getDate()-92); state.townshipActivity['ts_angels'] = { date: dt2.toISOString().split('T')[0] };
  updateAllStyles();
});
els.clearLayersBtn.addEventListener('click', () => {
  ['zip','town','township'].forEach(type => { if (layers[type]) { map.removeLayer(layers[type]); layers[type] = null; state.datasets[type] = null; }});
  refreshCountyOptions(); refreshStats(); clearSelection();
});

[['zipFile','zip'],['townFile','town'],['townshipFile','township']].forEach(([id,type]) => {
  els[id].addEventListener('change', async e => {
    if (!e.target.files[0]) return;
    try { drawDataset(type, await readGeoFile(e.target.files[0])); }
    catch(err){ alert('Could not read that GeoJSON file.'); console.error(err); }
    e.target.value = '';
  });
});

if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(()=>{}));
refreshStats();
