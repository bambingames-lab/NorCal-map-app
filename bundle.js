(() => {
  const ZIP_URL = "https://raw.githubusercontent.com/OpenDataDE/State-zip-code-GeoJSON/master/ca_california_zip_codes_geo.min.json";
  const STORAGE_KEY = "tm_v2_fixed_state";

  const state = loadState();
  let map, zipData, zipLayer, coverageLayer, coverageTagLayer, myLocationMarker, watchId = null;
  let drawingMode = null;
  let drawingPoints = [];
  let activeDrawLine = null;
  let editCoverageMode = false;
  let currentUser = null;
  let isAdmin = false;
  let selectedZip = null;

  const supabaseClient = window.supabase && window.TM_SUPABASE_URL && window.TM_SUPABASE_ANON_KEY
    ? window.supabase.createClient(window.TM_SUPABASE_URL, window.TM_SUPABASE_ANON_KEY)
    : null;

  function defaultState(){
    return {
      settings: {
        zipZoom: 10,
        coverageMode: "with_zips",
        shareLocation: "off"
      },
      teams: [
        { id:"team1", name:"Team 1", color:"#2563eb" },
        { id:"team2", name:"Team 2", color:"#9333ea" },
        { id:"team3", name:"Team 3", color:"#ec4899" },
        { id:"team4", name:"Team 4", color:"#0f766e" }
      ],
      territories: {},
      coverageAreas: {},
      profile: {
        display_name:"",
        color:"#22c55e",
        preferred_team_id:"team1"
      },
      users: []
    };
  }

  function loadState(){
    try {
      return { ...defaultState(), ...(JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}")) };
    } catch {
      return defaultState();
    }
  }

  function saveState(){
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function showSheet(title, html){
    document.getElementById("sheetTitle").textContent = title;
    document.getElementById("sheetBody").innerHTML = html;
    document.getElementById("sheet").classList.remove("hidden");
  }

  function closeSheet(){
    document.getElementById("sheet").classList.add("hidden");
  }

  function status(msg){
    console.log("[TM V2]", msg);
  }

  function hideLoading(){
    const el = document.getElementById("loadingBox");
    if (el) el.classList.add("hidden");
  }

  function initMap(){
    if (!window.L) {
      alert("Map library did not load. Check internet connection.");
      return;
    }

    map = L.map("map", { preferCanvas:true }).setView([38.75, -121.3], 7);
    window.TM_V2_MAP = map;

    map.createPane("zipPane");
    map.getPane("zipPane").style.zIndex = 430;
    map.getPane("zipPane").style.pointerEvents = "auto";

    map.createPane("coveragePane");
    map.getPane("coveragePane").style.zIndex = 560;
    map.getPane("coveragePane").style.pointerEvents = "none";

    map.createPane("tagPane");
    map.getPane("tagPane").style.zIndex = 700;
    map.getPane("tagPane").style.pointerEvents = "none";

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:"© OpenStreetMap contributors"
    }).addTo(map);

    map.on("moveend zoomend", refreshMap);

    // Desktop fallback: ZIP clicks still work even when layers overlap.
    map.on("click", (e) => {
      if (drawingMode || editCoverageMode) return;
      if (!zipData || map.getZoom() < Number(state.settings.zipZoom || 10)) return;
      const zip = findZipAtLatLng(e.latlng);
      if (zip) openZipMenu(zip);
    });

    setTimeout(() => map.invalidateSize(), 250);
    loadZipData();
  }

  async function loadZipData(){
    try {
      const cached = localStorage.getItem("tm_v2_zip_cache");
      if (cached) {
        zipData = JSON.parse(cached);
        refreshMap();
      }

      const res = await fetch(ZIP_URL, { cache:"force-cache" });
      if (!res.ok) throw new Error("ZIP fetch failed");
      zipData = await res.json();
      try { localStorage.setItem("tm_v2_zip_cache", JSON.stringify(zipData)); } catch {}
      refreshMap();
      hideLoading();
    } catch (err) {
      console.warn(err);
      hideLoading();
      alert("Map loaded, but ZIP boundaries could not load yet. Try refreshing.");
    }
  }

  function zipCode(feature){
    return feature.properties.ZCTA5CE10 || feature.properties.ZIP || feature.properties.zip || feature.properties.GEOID10 || "ZIP";
  }

  function featureInBounds(feature, bounds){
    const coords = feature.geometry.coordinates.flat(3);
    for (let i=0; i<coords.length; i+=2){
      const lng = coords[i];
      const lat = coords[i+1];
      if (bounds.contains([lat,lng])) return true;
    }
    return false;
  }

  function refreshMap(){
    renderZips();
    renderCoverage();
  }


  function pointInRing(point, ring){
    let inside = false;
    const x = point[0], y = point[1];
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      const intersect = ((yi > y) !== (yj > y)) &&
        (x < (xj - xi) * (y - yi) / ((yj - yi) || 0.0000001) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function pointInPolygonGeometry(latlng, geometry){
    if (!geometry) return false;
    const point = [latlng.lng, latlng.lat];
    const polys = geometry.type === "MultiPolygon" ? geometry.coordinates : [geometry.coordinates];
    for (const poly of polys) {
      if (!poly || !poly[0]) continue;
      if (pointInRing(point, poly[0])) return true;
    }
    return false;
  }

  function findZipAtLatLng(latlng){
    if (!zipData || !zipData.features) return null;
    const bounds = map.getBounds().pad(0.1);
    const candidates = zipData.features.filter(f => featureInBounds(f, bounds));
    for (const f of candidates) {
      if (pointInPolygonGeometry(latlng, f.geometry)) return zipCode(f);
    }
    return null;
  }

  function setEditCoverageMode(on){
    editCoverageMode = !!on;
    document.body.classList.toggle("coverage-edit-mode", editCoverageMode);
    refreshMap();
  }

  function renderZips(){
    if (zipLayer) {
      map.removeLayer(zipLayer);
      zipLayer = null;
    }

    if (!zipData || map.getZoom() < Number(state.settings.zipZoom || 10)) return;

    const bounds = map.getBounds().pad(0.25);
    const features = (zipData.features || []).filter(f => featureInBounds(f, bounds)).slice(0, 900);

    zipLayer = L.geoJSON({ type:"FeatureCollection", features }, {
      pane:"zipPane",
      style: f => {
        const zip = zipCode(f);
        const t = state.territories[zip];
        return {
          color: selectedZip === zip ? "#2563eb" : "#000",
          weight: selectedZip === zip ? 2.3 : (map.getZoom() >= 12 ? 1.4 : 0.85),
          opacity: 1,
          fillColor: t?.last_worked ? territoryTeamColor(zip) : "transparent",
          fillOpacity: t?.last_worked ? 0.68 : 0.01,
          interactive: true
        };
      },
      onEachFeature: (f, layer) => {
        const zip = zipCode(f);
        layer.on("click", (e) => {
          if (e && e.originalEvent) L.DomEvent.stopPropagation(e);
          openZipMenu(zip);
        });
      }
    }).addTo(map);
  }

  function coverageCenter(geometry){
    try {
      const points = [];
      const collect = (arr) => {
        if (!Array.isArray(arr)) return;
        if (typeof arr[0] === "number" && typeof arr[1] === "number") {
          points.push(arr);
          return;
        }
        arr.forEach(collect);
      };
      collect(geometry.coordinates);
      if (!points.length) return null;

      let lat = 0, lng = 0;
      points.forEach(p => {
        lng += Number(p[0]);
        lat += Number(p[1]);
      });
      return [lat / points.length, lng / points.length];
    } catch {
      return null;
    }
  }

  function coverageTagName(area){
    return area?.user_tag || area?.display_name || area?.user_name || area?.username || area?.name || area?.user_email || area?.email || area?.tag || "Coverage";
  }

  function renderCoverage(){
    if (coverageLayer) {
      map.removeLayer(coverageLayer);
      coverageLayer = null;
    }
    if (coverageTagLayer) {
      map.removeLayer(coverageTagLayer);
      coverageTagLayer = null;
    }

    const show = state.settings.coverageMode === "always" ||
      (state.settings.coverageMode === "with_zips" && map.getZoom() >= Number(state.settings.zipZoom || 10));

    if (!show) return;

    const areas = Object.values(state.coverageAreas || {}).filter(a => a.geometry);
    const features = areas.map(a => ({
      type:"Feature",
      properties:{ id:a.id },
      geometry:a.geometry
    }));

    coverageLayer = L.geoJSON({ type:"FeatureCollection", features }, {
      pane:"coveragePane",
      interactive: editCoverageMode,
      bubblingMouseEvents: false,
      style: f => {
        const a = state.coverageAreas[f.properties.id];
        return {
          color: "#000",
          weight: map.getZoom() >= 12 ? 1.4 : 0.85,
          opacity: 1,
          fillColor: coverageTeamColor(a),
          fillOpacity: 0.68
        };
      },
      onEachFeature: (f, layer) => {
        if (!editCoverageMode) return;
        layer.on("click", (e) => {
          if (e && e.originalEvent) L.DomEvent.stopPropagation(e);
          const area = state.coverageAreas[f.properties.id];
          if (!area) return;

          showSheet("Edit Freehand Area", `
            <div class="card">
              <h3>${coverageTagName(area)}</h3>
              <label>Name/tag</label>
              <input id="editCoverageTagInput" value="${coverageTagName(area)}">
              <label>Fill color</label>
              <input id="editCoverageColorInput" type="color" value="${area.color || "#22c55e"}">
              <button id="saveCoverageEditBtn">Save Changes</button>
              <button id="deleteCoverageEditBtn" class="danger">Delete Area</button>
              <button id="exitCoverageEditBtn" class="secondary">Back to ZIP Mode</button>
            </div>
          `);

          document.getElementById("saveCoverageEditBtn").onclick = async () => {
            area.user_tag = document.getElementById("editCoverageTagInput").value.trim() || area.user_tag;
            area.color = document.getElementById("editCoverageColorInput").value || area.color;
            area.updated_at = new Date().toISOString();
            state.coverageAreas[area.id] = area;
            saveState();
            if (supabaseClient && currentUser) {
              const { error } = await supabaseClient.from("coverage_areas").upsert(area);
              if (error) return alert("Could not save: " + error.message);
            }
            refreshMap();
            alert("Freehand area updated.");
          };

          document.getElementById("deleteCoverageEditBtn").onclick = async () => {
            if (!confirm("Delete this freehand area for everyone?")) return;
            delete state.coverageAreas[area.id];
            saveState();
            if (supabaseClient && currentUser) {
              const { error } = await supabaseClient.from("coverage_areas").delete().eq("id", area.id);
              if (error) return alert("Could not delete: " + error.message);
            }
            closeSheet();
            refreshMap();
          };

          document.getElementById("exitCoverageEditBtn").onclick = () => {
            setEditCoverageMode(false);
            closeSheet();
          };
        });
      }
    }).addTo(map);

    coverageTagLayer = L.layerGroup();
    if (map.getZoom() >= Math.max(8, Number(state.settings.zipZoom || 10) - 1)) {
      areas.forEach(a => {
        const center = coverageCenter(a.geometry);
        if (!center) return;
        const tag = coverageTagName(a);
        const marker = L.marker(center, {
          pane:"tagPane",
          interactive:false,
          keyboard:false,
          icon:L.divIcon({
            className:"",
            html:`<div class="coverageTag">${tag}</div>`,
            iconSize:null
          })
        });
        coverageTagLayer.addLayer(marker);
      });
    }
    coverageTagLayer.addTo(map);
  }

  async function initAuth(){
    if (!supabaseClient) return;
    const { data } = await supabaseClient.auth.getUser();
    currentUser = data?.user || null;
    if (currentUser) {
      await loadProfile();
      await checkAdmin();
      await loadCloudData();
    }
  }

  async function loadProfile(){
    const { data } = await supabaseClient
      .from("user_profiles")
      .select("*")
      .eq("user_id", currentUser.id)
      .maybeSingle();

    if (data) {
      state.profile.display_name = data.display_name || "";
      state.profile.color = data.color || "#22c55e";
      state.profile.preferred_team_id = data.preferred_team_id || state.teams[0]?.id || "team1";
      saveState();
    }
  }

  function updateAdminButtonVisibility(){
    const btn = document.getElementById("adminBtn");
    if (!btn) return;
    btn.classList.toggle("hidden", !isAdmin);
  }

  async function checkAdmin(){
    isAdmin = false;

    if (!supabaseClient || !currentUser) {
      updateAdminButtonVisibility();
      return;
    }

    const { data, error } = await supabaseClient
      .from("admins")
      .select("user_id")
      .eq("user_id", currentUser.id)
      .maybeSingle();

    isAdmin = !error && !!data;
    updateAdminButtonVisibility();
  }

  async function loadCloudData(){
    if (!supabaseClient) return;

    const teams = await supabaseClient.from("teams").select("*").order("sort_order", { ascending:true });
    if (!teams.error && teams.data?.length) {
      state.teams = teams.data.map(t => ({ id:t.id, name:t.name, color:t.color }));
    }

    const territories = await supabaseClient.from("territories").select("*");
    if (!territories.error && territories.data) {
      state.territories = {};
      territories.data.forEach(t => state.territories[t.zip] = t);
    }

    const coverage = await supabaseClient.from("coverage_areas").select("*");
    if (!coverage.error && coverage.data) {
      state.coverageAreas = {};
      coverage.data.forEach(a => state.coverageAreas[a.id] = a);
    }

    saveState();
    refreshMap();
  }

  async function saveTerritory(zip, patch){
    state.territories[zip] = { ...(state.territories[zip] || {}), zip, ...patch, updated_at:new Date().toISOString() };
    saveState();

    if (supabaseClient && currentUser) {
      await supabaseClient.from("territories").upsert({
        ...state.territories[zip],
        updated_by: currentUser.id,
        updated_at: new Date().toISOString()
      });
    }

    refreshMap();
  }

  function teamOptions(selected){
    return state.teams.map(t => `<option value="${t.id}" ${selected === t.id ? "selected" : ""}>${t.name}</option>`).join("");
  }


  function teamById(id){
    return state.teams.find(t => t.id === id) || null;
  }

  function teamColorById(id, fallback = "#9DE600"){
    const team = teamById(id);
    return team?.color || fallback;
  }

  function territoryTeamId(zip){
    const t = state.territories[zip] || {};
    return t.owner_team_id || t.team_id || t.handoff_team_id || state.teams[0]?.id || "";
  }

  function territoryTeamColor(zip){
    return teamColorById(territoryTeamId(zip), "#9DE600");
  }

  function coverageTeamId(area){
    return area?.team_id || area?.owner_team_id || area?.preferred_team_id || state.profile.preferred_team_id || state.teams[0]?.id || "";
  }

  function coverageTeamColor(area){
    return teamColorById(coverageTeamId(area), area?.team_color || area?.color || "#22c55e");
  }

  function coverageFillColor(area){
    // Fallback helper for older code/data. V2.1.2 renders freehand fill from team color.
    return area?.color || area?.user_color || state.profile.color || "#22c55e";
  }

  function coverageOutlineColor(area){
    // Fallback helper for older code/data. V2.1.2 renders freehand outline as black.
    return "#000";
  }


  function openZipMenu(zip){
    selectedZip = zip;
    const t = state.territories[zip] || {};
    showSheet("ZIP " + zip, `
      <div class="card">
        <h3>ZIP ${zip}</h3>
        <div class="status" id="zipStatus">Last worked: ${t.last_worked || "Not set"}</div>
        <div class="compactGrid">
          <button id="markTodayBtn">Today</button>
          <button id="markYesterdayBtn" class="secondary">Yesterday</button>
        </div>
        <label>Past/custom date</label>
        <div class="compactGrid">
          <input id="zipDateInput" type="date" value="${t.last_worked || ""}">
          <button id="saveZipDateBtn">Save Date</button>
        </div>

        <label>Owner team</label>
        <select id="ownerTeamInput">${teamOptions(t.owner_team_id || state.teams[0]?.id)}</select>

        <label>Pass to team</label>
        <select id="handoffTeamInput">${teamOptions(t.handoff_team_id || state.teams[1]?.id)}</select>
        <button id="saveZipTeamsBtn">Save Teams</button>

        <label>Notes</label>
        <textarea id="zipNotesInput" rows="3">${t.notes || ""}</textarea>
        <button id="saveZipNotesBtn">Save Notes</button>
      </div>
    `);

    const updateStatus = () => {
      const el = document.getElementById("zipStatus");
      if (el) el.textContent = "Last worked: " + (state.territories[zip]?.last_worked || "Not set");
    };

    document.getElementById("markTodayBtn").onclick = async () => {
      await saveTerritory(zip, { last_worked:new Date().toISOString().slice(0,10) });
      updateStatus();
    };
    document.getElementById("markYesterdayBtn").onclick = async () => {
      const d = new Date(); d.setDate(d.getDate()-1);
      await saveTerritory(zip, { last_worked:d.toISOString().slice(0,10) });
      updateStatus();
    };
    document.getElementById("saveZipDateBtn").onclick = async () => {
      await saveTerritory(zip, { last_worked:document.getElementById("zipDateInput").value || null });
      updateStatus();
    };
    document.getElementById("saveZipTeamsBtn").onclick = async () => {
      await saveTerritory(zip, {
        owner_team_id:document.getElementById("ownerTeamInput").value,
        handoff_team_id:document.getElementById("handoffTeamInput").value
      });
      alert("Teams saved.");
    };
    document.getElementById("saveZipNotesBtn").onclick = async () => {
      await saveTerritory(zip, { notes:document.getElementById("zipNotesInput").value });
      alert("Notes saved.");
    };
  }

  function openAccount(){
    showSheet("Account", `
      <div class="card">
        <h3>Login</h3>
        <label>Email</label>
        <input id="emailInput" type="email" placeholder="email@example.com">
        <label>Password</label>
        <input id="passwordInput" type="password" placeholder="password">
        <div class="row">
          <button id="signInBtn">Sign In</button>
          <button id="signUpBtn" class="secondary">Create Account</button>
        </div>
        <button id="signOutBtn" class="danger ${currentUser ? "" : "hidden"}">Sign Out</button>
        <div class="status">${currentUser ? "Signed in as " + currentUser.email : "Not signed in."}</div>
      </div>

      <div class="card">
        <h3>My Profile</h3>
        <label>Name/tag</label>
        <input id="profileNameInput" value="${state.profile.display_name || ""}" placeholder="Example: Brandon">
        <label>Drawing color</label>
        <input id="profileColorInput" type="color" value="${state.profile.color || "#22c55e"}">
        <label>Team</label>
        <select id="profileTeamInput">${teamOptions(state.profile.preferred_team_id)}</select>
        <button id="saveProfileBtn">Save Profile</button>
      </div>
    `);

    document.getElementById("signInBtn").onclick = async () => {
      const email = document.getElementById("emailInput").value.trim();
      const password = document.getElementById("passwordInput").value;
      const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) return alert(error.message);
      location.reload();
    };

    document.getElementById("signUpBtn").onclick = async () => {
      const email = document.getElementById("emailInput").value.trim();
      const password = document.getElementById("passwordInput").value;
      const { error } = await supabaseClient.auth.signUp({ email, password });
      if (error) return alert(error.message);
      alert("Account created.");
    };

    document.getElementById("signOutBtn").onclick = async () => {
      await supabaseClient.auth.signOut();
      location.reload();
    };

    document.getElementById("saveProfileBtn").onclick = async () => {
      state.profile.display_name = document.getElementById("profileNameInput").value.trim();
      state.profile.color = document.getElementById("profileColorInput").value;
      state.profile.preferred_team_id = document.getElementById("profileTeamInput").value;
      Object.values(state.coverageAreas || {}).forEach(a => {
        if (currentUser && a.user_id === currentUser.id && !a.team_id) {
          a.team_id = state.profile.preferred_team_id;
        }
      });
      saveState();

      if (supabaseClient && currentUser) {
        const { error } = await supabaseClient.from("user_profiles").upsert({
          user_id: currentUser.id,
          email: currentUser.email,
          display_name: state.profile.display_name || currentUser.email,
          color: state.profile.color,
          preferred_team_id: state.profile.preferred_team_id,
          updated_at: new Date().toISOString()
        });
        if (error) alert(error.message);
        else alert("Profile saved.");
      }
    };
  }

  function openSettings(){
    showSheet("Settings", `
      <div class="card">
        <h3>Map Display</h3>
        <label>Show ZIP/freehand starting at zoom</label>
        <input id="zipZoomInput" type="number" min="5" max="15" value="${state.settings.zipZoom}">
        <label>Freehand visibility</label>
        <select id="coverageModeInput">
          <option value="with_zips" ${state.settings.coverageMode === "with_zips" ? "selected" : ""}>With ZIP lines</option>
          <option value="always" ${state.settings.coverageMode === "always" ? "selected" : ""}>Always show</option>
          <option value="off" ${state.settings.coverageMode === "off" ? "selected" : ""}>Off</option>
        </select>
        <button id="saveDisplayBtn">Save Display Settings</button>
      </div>

      <div class="card">
        <h3>Location</h3>
        <div class="compactGrid">
          <button id="enableLocationBtn">Enable Location</button>
          <button id="startTrackingBtn" class="secondary">Start Tracking</button>
          <button id="stopTrackingBtn" class="danger">Stop Tracking</button>
        </div>
        <label>Share my location</label>
        <select id="shareLocationInput">
          <option value="off" ${state.settings.shareLocation === "off" ? "selected" : ""}>Off</option>
          <option value="on" ${state.settings.shareLocation === "on" ? "selected" : ""}>On</option>
        </select>
        <div id="locationStatus" class="status">Location not active.</div>
      </div>

      <div class="card">
        <h3>App Tools</h3>
        <button id="reloadCloudBtn" class="secondary">Reload Cloud Data</button>
        <button id="clearCacheBtn" class="danger">Clear Local Cache</button>
        <div class="status">V2 UI cleanup preview</div>
      </div>
    `);

    document.getElementById("saveDisplayBtn").onclick = () => {
      state.settings.zipZoom = Number(document.getElementById("zipZoomInput").value || 10);
      state.settings.coverageMode = document.getElementById("coverageModeInput").value;
      saveState();
      refreshMap();
      alert("Display settings saved.");
    };

    document.getElementById("shareLocationInput").onchange = e => {
      state.settings.shareLocation = e.target.value;
      saveState();
    };

    document.getElementById("enableLocationBtn").onclick = () => locateMe(true);
    document.getElementById("startTrackingBtn").onclick = startTracking;
    document.getElementById("stopTrackingBtn").onclick = stopTracking;
    document.getElementById("reloadCloudBtn").onclick = async () => {
      await loadCloudData();
      alert("Cloud data reloaded.");
    };
    document.getElementById("clearCacheBtn").onclick = () => {
      if (!confirm("Clear local cache on this device? Cloud data stays saved.")) return;
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem("tm_v2_zip_cache");
      location.reload();
    };
  }

  async function locateMe(center){
    if (!navigator.geolocation) return alert("Location not supported.");
    setLocationStatus("Finding location…");
    navigator.geolocation.getCurrentPosition(
      pos => handlePosition(pos, center),
      err => {
        setLocationStatus("Location failed: " + err.message);
        alert("Location failed: " + err.message);
      },
      { enableHighAccuracy:true, timeout:15000, maximumAge:5000 }
    );
  }

  function setLocationStatus(text){
    const el = document.getElementById("locationStatus");
    if (el) el.textContent = text;
  }

  async function handlePosition(pos, center){
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    const accuracy = pos.coords.accuracy || 0;

    if (!myLocationMarker) {
      myLocationMarker = L.marker([lat,lng], {
        pane:"tagPane",
        icon:L.divIcon({
          className:"",
          html:'<div class="myLocationDot"></div>',
          iconSize:[24,24],
          iconAnchor:[12,12]
        })
      }).addTo(map);
    } else {
      myLocationMarker.setLatLng([lat,lng]);
    }

    if (center) map.setView([lat,lng], Math.max(map.getZoom(), 14));
    setLocationStatus("Location active. Accuracy: " + Math.round(accuracy) + "m");

    if (supabaseClient && currentUser && state.settings.shareLocation === "on") {
      await supabaseClient.from("user_locations").upsert({
        user_id: currentUser.id,
        email: currentUser.email,
        display_name: state.profile.display_name || currentUser.email,
        lat,lng,accuracy,
        updated_at:new Date().toISOString()
      });
    }
  }

  function startTracking(){
    if (!navigator.geolocation) return alert("Location not supported.");
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = navigator.geolocation.watchPosition(pos => handlePosition(pos, false), err => setLocationStatus(err.message), {
      enableHighAccuracy:true, timeout:20000, maximumAge:3000
    });
    setLocationStatus("Live tracking started.");
  }

  function stopTracking(){
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    setLocationStatus("Live tracking stopped.");
  }

  async function openAdmin(){
    if (!isAdmin) {
      alert("Admin access only.");
      return;
    }
    showSheet("Admin Center", `
      <div class="miniTabs">
        <button id="adminUsersTab" class="active">Users</button>
        <button id="adminPasswordTab">Passwords</button>
        <button id="adminTeamsTab">Teams</button>
        <button id="adminReportsTab">Reports</button>
      </div>

      <div id="adminUsersSection" class="adminPanelSection active">
        <div class="card">
          <h3>Users</h3>
          <input id="userSearchInput" placeholder="Search users">
          <button id="refreshUsersBtn">Refresh Users</button>
          <div id="usersList" class="status">No users loaded.</div>
        </div>
      </div>

      <div id="adminPasswordSection" class="adminPanelSection">
        <div class="card">
          <h3>Temporary Password</h3>
          <label>User email</label>
          <input id="adminResetEmailInput" type="email" placeholder="user@email.com">
          <label>Temporary password</label>
          <input id="adminTempPasswordInput" value="Welcome123!">
          <button id="adminSetTempPasswordBtn">Set Temporary Password</button>
          <div id="adminResetStatus" class="status"></div>
        </div>
      </div>

      <div id="adminTeamsSection" class="adminPanelSection">
        <div class="card">
          <h3>Teams</h3>
          <div id="teamsEditor"></div>
          <button id="saveTeamsBtn">Save Teams</button>
          <button id="repairCoverageTeamsBtn" class="secondary">Repair Missing Coverage Teams</button>
          <div class="status">Map colors now use the current team color as the source of truth.</div>
        </div>
      </div>

      <div id="adminReportsSection" class="adminPanelSection">
        <div class="card">
          <h3>Quick Reports</h3>
          <div id="adminReportsBox" class="status">Loading report...</div>
          <button id="refreshReportsBtn" class="secondary">Refresh Report</button>
        </div>
      </div>
    `);

    const activate = (name) => {
      ["Users","Password","Teams","Reports"].forEach(n => {
        const btn = document.getElementById("admin" + n + "Tab");
        const sec = document.getElementById("admin" + n + "Section");
        if (btn) btn.classList.toggle("active", n === name);
        if (sec) sec.classList.toggle("active", n === name);
      });
    };

    document.getElementById("adminUsersTab").onclick = () => activate("Users");
    document.getElementById("adminPasswordTab").onclick = () => activate("Password");
    document.getElementById("adminTeamsTab").onclick = () => activate("Teams");
    document.getElementById("adminReportsTab").onclick = () => { activate("Reports"); renderAdminReport(); };

    document.getElementById("refreshUsersBtn").onclick = loadUsers;
    document.getElementById("userSearchInput").oninput = renderUsers;
    document.getElementById("adminSetTempPasswordBtn").onclick = setTemporaryPassword;
    document.getElementById("refreshReportsBtn").onclick = renderAdminReport;
    renderTeams();
    document.getElementById("saveTeamsBtn").onclick = saveTeams;
    state.teams.forEach(t => {
      const input = document.getElementById("teamColor_" + t.id);
      if (input) {
        input.addEventListener("input", () => {
          t.color = input.value;
          refreshMap();
        });
      }
    });
    const repairBtn = document.getElementById("repairCoverageTeamsBtn");
    if (repairBtn) repairBtn.onclick = repairCoverageTeams;
  }

  function renderAdminReport(){
    const el = document.getElementById("adminReportsBox");
    if (!el) return;
    const territories = Object.values(state.territories || {});
    const worked = territories.filter(t => t.last_worked).length;
    const coverage = Object.values(state.coverageAreas || {}).length;
    const users = (state.users || []).length;
    el.innerHTML = `
      <div><strong>Worked ZIPs:</strong> ${worked}</div>
      <div><strong>Freehand areas:</strong> ${coverage}</div>
      <div><strong>Loaded users:</strong> ${users}</div>
      <div><strong>Teams:</strong> ${state.teams.length}</div>
    `;
  }

  async function loadUsers(){
    if (!supabaseClient || !isAdmin) return alert("Admin only.");
    const { data, error } = await supabaseClient
      .from("user_profiles")
      .select("user_id,email,display_name,role,is_active,must_change_password,last_seen")
      .order("email", { ascending:true });

    if (error) return alert(error.message);
    state.users = data || [];
    renderUsers();
  }

  function renderUsers(){
    const q = (document.getElementById("userSearchInput")?.value || "").toLowerCase();
    const el = document.getElementById("usersList");
    const users = (state.users || []).filter(u => `${u.email || ""} ${u.display_name || ""}`.toLowerCase().includes(q));
    if (!users.length) {
      el.innerHTML = "No users found.";
      return;
    }
    el.innerHTML = users.map(u => `
      <div class="userRow">
        <strong>${u.display_name || u.email || "Unknown"}</strong>
        <div>${u.email || ""}</div>
        <span class="badge">${u.role || "user"}</span>
        <span class="badge">${u.is_active === false ? "Inactive" : "Active"}</span>
        ${u.must_change_password ? '<span class="badge">Must change password</span>' : ""}
        <button class="secondary" onclick="document.getElementById('adminResetEmailInput').value='${u.email || ""}';document.getElementById('adminPasswordTab').click();">Reset Password</button>
      </div>
    `).join("");
  }

  function renderTeams(){
    const el = document.getElementById("teamsEditor");
    el.innerHTML = state.teams.map(t => `
      <div class="card">
        <h3><span class="teamColorPill" style="background:${t.color}"></span>${t.name}</h3>
        <label>${t.id} name</label>
        <input id="teamName_${t.id}" value="${t.name}">
        <label>${t.id} color</label>
        <input id="teamColor_${t.id}" type="color" value="${t.color}">
      </div>
    `).join("");
  }


  async function repairCoverageTeams(){
    const fallbackTeamId = state.teams[0]?.id || "";
    let changed = 0;

    for (const area of Object.values(state.coverageAreas || {})) {
      if (!area.team_id) {
        area.team_id = area.owner_team_id || area.preferred_team_id || fallbackTeamId;
        changed++;
      }
      area.team_color = coverageTeamColor(area);
      area.color = area.color || state.profile.color || "#22c55e";
      area.updated_at = new Date().toISOString();

      if (supabaseClient && currentUser) {
        await supabaseClient.from("coverage_areas").upsert(area);
      }
    }

    saveState();
    refreshMap();
    alert("Coverage team repair complete. Updated " + changed + " areas missing team IDs.");
  }


  async function saveTeams(){
    state.teams = state.teams.map(t => ({
      ...t,
      name: document.getElementById("teamName_" + t.id).value,
      color: document.getElementById("teamColor_" + t.id).value
    }));
    saveState();

    if (supabaseClient) {
      for (let i=0; i<state.teams.length; i++) {
        const t = state.teams[i];
        await supabaseClient.from("teams").upsert({
          id:t.id,
          name:t.name,
          color:t.color,
          sort_order:i
        });
      }
    }
    refreshMap();
    renderTeams();
    alert("Teams saved. Map colors updated.");
  }

  async function setTemporaryPassword(){
    if (!supabaseClient || !isAdmin) return alert("Admin only.");
    const email = document.getElementById("adminResetEmailInput").value.trim();
    const password = document.getElementById("adminTempPasswordInput").value.trim();
    const status = document.getElementById("adminResetStatus");

    if (!email || password.length < 6) return alert("Enter email and temporary password at least 6 characters.");
    status.textContent = "Setting temporary password…";

    const { data, error } = await supabaseClient.functions.invoke("admin-reset-password", {
      body: { email, password }
    });

    if (error || data?.error) {
      const msg = data?.error || error.message;
      status.textContent = "Failed: " + msg;
      return alert(msg);
    }

    status.textContent = "Temporary password set.";
    alert("Temporary password successfully changed for " + email + ".");
  }


  function userCoverageTag(){
    return state.profile.display_name || currentUser?.email || "Coverage";
  }

  function userCoverageColor(){
    return state.profile.color || "#22c55e";
  }

  function selectedTeam(){
    return teamById(state.profile.preferred_team_id) || state.teams[0] || {};
  }

  function squareGeometry(center, meters = 700){
    const lat = center.lat, lng = center.lng;
    const dLat = meters / 111320;
    const dLng = meters / (111320 * Math.cos(lat * Math.PI / 180));
    return { type:"Polygon", coordinates:[[
      [lng - dLng, lat - dLat],
      [lng + dLng, lat - dLat],
      [lng + dLng, lat + dLat],
      [lng - dLng, lat + dLat],
      [lng - dLng, lat - dLat]
    ]]};
  }

  function circleGeometry(center, meters = 700, steps = 48){
    const lat = center.lat, lng = center.lng;
    const coords = [];
    for (let i=0; i<=steps; i++){
      const a = (Math.PI * 2 * i) / steps;
      const dLat = (Math.sin(a) * meters) / 111320;
      const dLng = (Math.cos(a) * meters) / (111320 * Math.cos(lat * Math.PI / 180));
      coords.push([lng + dLng, lat + dLat]);
    }
    return { type:"Polygon", coordinates:[coords] };
  }

  function freehandGeometry(points){
    const coords = points.map(p => [p.lng, p.lat]);
    if (coords.length < 3) return null;
    coords.push(coords[0]);
    return { type:"Polygon", coordinates:[coords] };
  }

  async function saveCoverageGeometry(geometry, shapeType){
    const id = crypto?.randomUUID ? crypto.randomUUID() : "area_" + Date.now();
    const team = selectedTeam();
    const area = {
      id,
      user_id: currentUser?.id || null,
      user_email: currentUser?.email || "",
      user_tag: userCoverageTag(),
      display_name: userCoverageTag(),
      tag: userCoverageTag(),
      user_color: userCoverageColor(),
      color: userCoverageColor(),
      team_id: team.id || state.profile.preferred_team_id || "",
      team_color: team.color || userCoverageColor(),
      shape_type: shapeType,
      last_worked: new Date().toISOString().slice(0,10),
      geometry,
      updated_at: new Date().toISOString()
    };

    state.coverageAreas[id] = area;
    saveState();
    refreshMap();

    if (supabaseClient && currentUser) {
      let { error } = await supabaseClient.from("coverage_areas").upsert(area);

      if (error) {
        console.warn("Full coverage save failed, retrying minimal row:", error.message);

        // Compatibility fallback for older coverage_areas schemas.
        // This avoids phone saves failing when optional V2 columns are missing.
        const minimalArea = {
          id: area.id,
          user_id: area.user_id,
          user_email: area.user_email,
          user_tag: area.user_tag,
          color: area.color,
          team_id: area.team_id,
          team_color: area.team_color,
          geometry: area.geometry,
          updated_at: area.updated_at
        };

        const retry = await supabaseClient.from("coverage_areas").upsert(minimalArea);
        error = retry.error;
      }

      if (error) {
        alert("Could not save drawing to the shared database: " + error.message + "\\n\\nThe drawing is saved on this device only until this is fixed.");
        return;
      }
    }

    alert("Coverage shape saved.");
  }

  function startSquareDrawing(){
    setEditCoverageMode(false);
    closeSheet();
    drawingMode = "square";
    alert("Tap the center of the square coverage area.");
    map.once("click", async e => {
      drawingMode = null;
      await saveCoverageGeometry(squareGeometry(e.latlng), "square");
    });
  }

  function startCircleDrawing(){
    setEditCoverageMode(false);
    closeSheet();
    drawingMode = "circle";
    alert("Tap the center of the circle coverage area.");
    map.once("click", async e => {
      drawingMode = null;
      await saveCoverageGeometry(circleGeometry(e.latlng), "circle");
    });
  }

  function startFreehandDrawingV2(){
    setEditCoverageMode(false);
    closeSheet();
    drawingMode = "freehand";
    drawingPoints = [];
    map.dragging.disable();
    const container = map.getContainer();
    container.style.cursor = "crosshair";
    alert("Hold and drag to draw. Release to save.");

    const cleanup = () => {
      container.removeEventListener("pointerdown", pointerDown);
      container.removeEventListener("pointermove", pointerMove);
      container.removeEventListener("pointerup", pointerUp);
      container.removeEventListener("pointercancel", pointerCancel);
      map.dragging.enable();
      container.style.cursor = "";
      drawingMode = null;
      if (activeDrawLine) {
        map.removeLayer(activeDrawLine);
        activeDrawLine = null;
      }
    };

    const pointerDown = ev => {
      if (drawingMode !== "freehand") return;
      ev.preventDefault();
      drawingPoints = [];
      const latlng = map.mouseEventToLatLng(ev);
      drawingPoints.push(latlng);
      activeDrawLine = L.polyline([latlng], { color:userCoverageColor(), weight:4 }).addTo(map);
      container.setPointerCapture?.(ev.pointerId);
    };

    const pointerMove = ev => {
      if (drawingMode !== "freehand" || !activeDrawLine) return;
      ev.preventDefault();
      const latlng = map.mouseEventToLatLng(ev);
      drawingPoints.push(latlng);
      activeDrawLine.setLatLngs(drawingPoints);
    };

    const pointerUp = async ev => {
      if (drawingMode !== "freehand") return;
      ev.preventDefault();
      const latlng = map.mouseEventToLatLng(ev);
      drawingPoints.push(latlng);
      const geometry = freehandGeometry(drawingPoints);
      cleanup();
      if (!geometry) return alert("Draw a larger area before saving.");
      await saveCoverageGeometry(geometry, "freehand");
    };

    const pointerCancel = () => cleanup();

    container.addEventListener("pointerdown", pointerDown);
    container.addEventListener("pointermove", pointerMove);
    container.addEventListener("pointerup", pointerUp);
    container.addEventListener("pointercancel", pointerCancel);
  }

  function openDrawingTools(){
    showSheet("Coverage Drawing", `
      <div class="card">
        <h3>Freehand Coverage</h3>
        <div class="status">Draw a filled freehand area. It saves with your tag and color, then stays above ZIP fill colors.</div>
        <button id="drawFreehandBtn">Start Freehand Drawing</button>
      </div>

      <div class="card">
        <h3>Edit Existing Drawings</h3>
        <button id="editCoverageModeBtn">Edit Drawings Mode</button>
        <button id="zipModeBtn" class="secondary">ZIP Select Mode</button>
        <div class="status">Edit mode makes freehand clickable. ZIP mode makes ZIPs clickable.</div>
      </div>
    `);

    document.getElementById("drawFreehandBtn").onclick = startFreehandDrawingV2;
    document.getElementById("editCoverageModeBtn").onclick = () => {
      setEditCoverageMode(true);
      closeSheet();
      alert("Edit Drawings Mode on. Tap a freehand area to edit or delete it.");
    };
    document.getElementById("zipModeBtn").onclick = () => {
      setEditCoverageMode(false);
      closeSheet();
      alert("ZIP Select Mode on. Tap ZIPs to mark dates.");
    };
  }


  function initControls(){
    document.getElementById("closeSheetBtn").onclick = closeSheet;
    document.getElementById("accountBtn").onclick = openAccount;
    document.getElementById("adminBtn").onclick = openAdmin;
    document.getElementById("settingsBtn").onclick = openSettings;
    document.getElementById("gpsFab").onclick = () => {
      openSettings();
      setTimeout(() => locateMe(true), 50);
    };
    document.getElementById("drawFab").onclick = openDrawingTools;
  }

  async function start(){
    initControls();
    updateAdminButtonVisibility();
    initMap();
    await initAuth();
    updateAdminButtonVisibility();
  }

  window.addEventListener("error", e => {
    console.error(e.error || e.message);
    const box = document.getElementById("loadingBox");
    if (box) {
      box.classList.remove("hidden");
      box.textContent = "App error. Check uploaded files.";
    }
  });

  start();
})();
