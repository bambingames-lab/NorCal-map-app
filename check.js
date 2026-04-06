
    // Clear any old service workers and caches so stale UI stops appearing.
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(reg => reg.unregister()));
    }
    if ('caches' in window) {
      caches.keys().then(keys => keys.forEach(k => caches.delete(k)));
    }

    const STORAGE_KEY = "territory-manager-live-v1";
    const ZIP_URL = "https://raw.githubusercontent.com/OpenDataDE/State-zip-code-GeoJSON/master/ca_california_zip_codes_geo.min.json";
    const CITY_URL = "https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/California_Cities/FeatureServer/0/query?where=1=1&outFields=*&outSR=4326&f=geojson";
    const SOUTH_LIMIT = 38.05;
    const CITY_CACHE_KEY = "cityGeoJSONNorth";
    const DB_NAME = "territoryManagerDB";
    const STORE_NAME = "cache";

    const map = L.map("map", { preferCanvas: true }).setView([39.1, -121.4], 7);
    const canvasRenderer = L.canvas({ padding: 0.5 });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(map);

    let state = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!state) {
      state = {
        settings: {
          zipFill: "none",
          zipWeight: 3.5,
          timeMode: "weeks",
          thresholdValue: 12,
          showZipLabels: false,
          teamColors: {
            team1: "#2563eb",
            team2: "#9333ea",
            team3: "#ec4899",
            team4: "#0f766e"
          },
          teamNames: {
            team1: "Team 1",
            team2: "Team 2",
            team3: "Team 3",
            team4: "Team 4"
          },
          teamGradient: {
            startTeam: "team1",
            endTeam: "team4"
          }
        },
        zips: {},
        cities: {},
        zipTeams: {},
        cityTeams: {},
        zipGradientTeams: {},
        cityGradientTeams: {}
      };
    } else {
      state.settings = state.settings || {};
      if (!state.settings.timeMode) state.settings.timeMode = "weeks";
      if (!state.settings.thresholdValue) state.settings.thresholdValue = 12;
      if (!state.settings.zipFill) state.settings.zipFill = "none";
      if (!state.settings.zipWeight) state.settings.zipWeight = 3.5;
      if (state.settings.showZipLabels === undefined) state.settings.showZipLabels = false;
      state.settings.teamColors = state.settings.teamColors || {
        team1: "#2563eb",
        team2: "#9333ea",
        team3: "#ec4899",
        team4: "#0f766e"
      };
      state.settings.teamNames = state.settings.teamNames || {
        team1: "Team 1",
        team2: "Team 2",
        team3: "Team 3",
        team4: "Team 4"
      };
      state.settings.teamGradient = state.settings.teamGradient || {
        startTeam: "team1",
        endTeam: "team4"
      };
      state.zips = state.zips || {};
      state.cities = state.cities || {};
      state.zipTeams = state.zipTeams || {};
      state.cityTeams = state.cityTeams || {};
      state.zipGradientTeams = state.zipGradientTeams || {};
      state.cityGradientTeams = state.cityGradientTeams || {};
    }

    let zipLayer = null;
    let cityLayer = null;
    let selected = null;
    let selectedType = "zip";

    function saveState() {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }

    function getMode() {
      if (state.settings.timeMode === "days") return "days";
      if (state.settings.timeMode === "months") return "months";
      return "weeks";
    }

    function getThreshold() {
      const raw = Number(state.settings.thresholdValue);
      const mode = getMode();
      if (!Number.isFinite(raw)) {
        if (mode === "days") return 30;
        if (mode === "months") return 3;
        return 12;
      }
      const max = mode === "days" ? 365 : mode === "months" ? 24 : 52;
      return Math.max(1, Math.min(max, raw));
    }

    function elapsedUnits(dateStr) {
      if (!dateStr) return null;
      const then = new Date(dateStr + "T00:00:00");
      const diffDays = Math.max(0, (Date.now() - then.getTime()) / (1000 * 60 * 60 * 24));
      const mode = getMode();
      if (mode === "days") return diffDays;
      if (mode === "months") return diffDays / 30.4375;
      return diffDays / 7;
    }

    function getTeamColors() {
      return state.settings.teamColors || {
        team1: "#2563eb",
        team2: "#9333ea",
        team3: "#ec4899",
        team4: "#0f766e"
      };
    }

    function getTeamNames() {
      return state.settings.teamNames || {
        team1: "Team 1",
        team2: "Team 2",
        team3: "Team 3",
        team4: "Team 4"
      };
    }

    function teamDisplayName(teamKey) {
      return getTeamNames()[teamKey] || String(teamKey || "");
    }

    function hexToRgb(hex) {
      const clean = String(hex || "").replace("#", "");
      const full = clean.length === 3 ? clean.split("").map(c => c + c).join("") : clean;
      const num = parseInt(full, 16);
      return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
    }

    function rgbToHex(r, g, b) {
      const toHex = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
      return "#" + toHex(r) + toHex(g) + toHex(b);
    }

    function mixColors(a, b, t) {
      const ca = hexToRgb(a);
      const cb = hexToRgb(b);
      return rgbToHex(
        ca.r + (cb.r - ca.r) * t,
        ca.g + (cb.g - ca.g) * t,
        ca.b + (cb.b - ca.b) * t
      );
    }

    function getAreaGradient(type, key) {
      if (!key) return null;
      if (type === "zip") return (state.zipGradientTeams || {})[key] || null;
      return (state.cityGradientTeams || {})[key] || null;
    }

    function gradientEndpoints(type, key) {
      const colors = getTeamColors();
      const perArea = getAreaGradient(type, key);
      const grad = perArea || state.settings.teamGradient || {};
      return {
        start: colors[grad.startTeam || "team1"] || "#2563eb",
        end: colors[grad.endTeam || "team4"] || "#0f766e"
      };
    }

    function gradientLabel(type, key) {
      const perArea = getAreaGradient(type, key);
      const grad = perArea || state.settings.teamGradient || {};
      const start = teamDisplayName(grad.startTeam || "team1");
      const end = teamDisplayName(grad.endTeam || "team4");
      return start + " → " + end;
    }

    function zoneColor(dateStr, type, key) {
      if (!dateStr) {
        return state.settings.zipFill === "gray" ? "#d1d5db" : "transparent";
      }
      const elapsed = elapsedUnits(dateStr);
      const target = getThreshold();
      const pct = Math.max(0, Math.min(1, elapsed / target));
      const endpoints = gradientEndpoints(type, key);
      return mixColors(endpoints.start, endpoints.end, pct);
    }

    function zipCodeFromFeature(feature) {
      const p = feature.properties || {};
      return String(
        p.ZCTA5CE10 || p.ZCTA5CE20 || p.zip_code || p.ZIP_CODE || p.zip || p.name || ""
      );
    }

    function cityNameFromFeature(feature) {
      const p = feature.properties || {};
      return String(p.NAME || p.name || p.CITY || p.city || "");
    }

    function getAreaTeam(type, key) {
      if (type === "zip") return (state.zipTeams || {})[key] || "";
      return (state.cityTeams || {})[key] || "";
    }

    function teamBorderColor(type, key, fallback) {
      const team = getAreaTeam(type, key);
      const colors = getTeamColors();
      return colors[team] || fallback;
    }

    function zipStyle(feature) {
      const zip = zipCodeFromFeature(feature);
      const isSelected = selectedType === "zip" && selected === zip;
      const zoom = map.getZoom();

      let sliderWeight = Number(state.settings.zipWeight || 3.5);
      let baseWeight = sliderWeight;
      if (zoom <= 6) baseWeight = Math.max(0.35, sliderWeight * 0.18);
      else if (zoom <= 7) baseWeight = Math.max(0.55, sliderWeight * 0.28);
      else if (zoom <= 8) baseWeight = Math.max(0.85, sliderWeight * 0.42);
      else if (zoom <= 9) baseWeight = Math.max(1.2, sliderWeight * 0.62);

      const last = state.zips[zip];

      return {
        renderer: canvasRenderer,
        color: teamBorderColor("zip", zip, isSelected ? "#2563eb" : "#111827"),
        weight: isSelected ? baseWeight + 1.1 : baseWeight,
        opacity: 0.92,
        fillColor: zoneColor(last, "zip", zip),
        fillOpacity: last ? 0.50 : (state.settings.zipFill === "gray" ? 0.12 : 0)
      };
    }

    function cityStyle(feature) {
      const city = cityNameFromFeature(feature);
      const isSelected = selectedType === "city" && selected === city;
      const last = state.cities[city];
      return {
        renderer: canvasRenderer,
        color: teamBorderColor("city", city, isSelected ? "#2563eb" : "#ffffff"),
        weight: isSelected ? 2.5 : 1.2,
        opacity: 1,
        fillColor: zoneColor(last, "city", city),
        fillOpacity: last ? 0.68 : 0.18
      };
    }

    function bindZipTooltip(layer, feature) {
      const zip = zipCodeFromFeature(feature);
      layer.bindTooltip(zip, {
        permanent: true,
        direction: "center",
        className: "zip-code-label"
      });
      updateZipTooltips();
    }

    function updateZipTooltips() {
      if (!zipLayer) return;
      const show = !!state.settings.showZipLabels;
      zipLayer.eachLayer(layer => {
        if (show) {
          try { layer.openTooltip(); } catch (e) {}
        } else {
          try { layer.closeTooltip(); } catch (e) {}
        }
      });
    }

    function updateLegend() {
      document.getElementById("legendTarget").textContent = "~ " + getThreshold() + " " + getMode();
      const endpoints = gradientEndpoints();
      document.getElementById("legend1").style.background = mixColors(endpoints.start, endpoints.end, 0.0);
      document.getElementById("legend2").style.background = mixColors(endpoints.start, endpoints.end, 0.25);
      document.getElementById("legend3").style.background = mixColors(endpoints.start, endpoints.end, 0.5);
      document.getElementById("legend4").style.background = mixColors(endpoints.start, endpoints.end, 0.75);
      document.getElementById("legend5").style.background = mixColors(endpoints.start, endpoints.end, 1.0);
    }

    function updateThresholdInput() {
      const mode = getMode();
      const input = document.getElementById("thresholdValue");
      input.max = mode === "days" ? "365" : mode === "months" ? "24" : "52";
      input.value = getThreshold();
    }

    function updateStats() {
      const trackedZips = Object.values(state.zips).filter(Boolean).length;
      const trackedCities = Object.values(state.cities).filter(Boolean).length;

      let selectedText = "No area selected yet.";
      if (selected) {
        if (selectedType === "zip") {
          selectedText =
            "<strong>Selected ZIP:</strong> " + selected +
            "<br><strong>Last visited:</strong> " + (state.zips[selected] || "Not set") +
            "<br><strong>Team:</strong> " + (getAreaTeam("zip", selected) || "None") +
            "<br><strong>Gradient:</strong> " + gradientLabel("zip", selected);
        } else {
          selectedText =
            "<strong>Selected city:</strong> " + selected +
            "<br><strong>Last visited:</strong> " + (state.cities[selected] || "Not set") +
            "<br><strong>Team:</strong> " + (getAreaTeam("city", selected) || "None") +
            "<br><strong>Gradient:</strong> " + gradientLabel("city", selected);
        }
      }

      document.getElementById("stats").innerHTML =
        selectedText +
        "<br><br><strong>ZIPs tracked:</strong> " + trackedZips +
        "<br><strong>Cities tracked:</strong> " + trackedCities;
    }

    function redrawAllLayers() {
      if (zipLayer) {
        zipLayer.setStyle(zipStyle);
        updateZipTooltips();
      }
      if (cityLayer) {
        cityLayer.setStyle(cityStyle);
      }
      updateThresholdInput();
      updateLegend();
      updateStats();
      saveState();
    }

    window.popupMarkToday = function () {
      if (!selected) return;
      const today = new Date().toISOString().split("T")[0];
      if (selectedType === "zip") state.zips[selected] = today;
      if (selectedType === "city") state.cities[selected] = today;
      redrawAllLayers();
      map.closePopup();
    };

    window.popupYesterday = function () {
      if (!selected) return;
      const d = new Date();
      d.setDate(d.getDate() - 1);
      const value = d.toISOString().split("T")[0];
      if (selectedType === "zip") state.zips[selected] = value;
      if (selectedType === "city") state.cities[selected] = value;
      redrawAllLayers();
      map.closePopup();
    };

    window.popupSaveDate = function () {
      if (!selected) return;
      const el = document.getElementById("popupDate");
      if (!el || !el.value) return;
      if (selectedType === "zip") state.zips[selected] = el.value;
      if (selectedType === "city") state.cities[selected] = el.value;
      redrawAllLayers();
      map.closePopup();
    };

    window.popupSaveTeamsGradient = function () {
      if (!selected) return;

      const ownerEl = document.getElementById("popupOwnerTeam");
      const handoffEl = document.getElementById("popupHandoffTeam");
      const owner = ownerEl ? ownerEl.value : "";
      const handoff = handoffEl ? handoffEl.value : "team4";

      if (selectedType === "zip") {
        if (owner) state.zipTeams[selected] = owner;
        else delete state.zipTeams[selected];
        state.zipGradientTeams[selected] = {
          startTeam: owner || "team1",
          endTeam: handoff || "team4"
        };
      }

      if (selectedType === "city") {
        if (owner) state.cityTeams[selected] = owner;
        else delete state.cityTeams[selected];
        state.cityGradientTeams[selected] = {
          startTeam: owner || "team1",
          endTeam: handoff || "team4"
        };
      }

      redrawAllLayers();
      map.closePopup();
    };

    window.popupClearDate = function () {
      if (!selected) return;
      if (selectedType === "zip") delete state.zips[selected];
      if (selectedType === "city") delete state.cities[selected];
      redrawAllLayers();
      map.closePopup();
    };

    function openDb() {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME);
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }

    async function cachePut(key, value) {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }

    async function cacheGet(key) {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const req = tx.objectStore(STORE_NAME).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }

    function popupHtml(label, last, type, key) {
      const currentTeam = getAreaTeam(type, key) || "";
      const currentGrad = getAreaGradient(type, key) || state.settings.teamGradient || { startTeam: "team1", endTeam: "team4" };
      return `
        <div style="min-width:220px">
          <strong>${label}</strong><br>
          Last visited: ${last || "Not set"}<br>
          <button onclick="popupMarkToday()">Mark Today</button>
          <button class="secondary" onclick="popupYesterday()">Mark Yesterday</button>
          <input type="date" id="popupDate">
          <button onclick="popupSaveDate()">Save Date</button>

          <label style="display:block;margin-top:8px;font-weight:700;">Owner Team</label>
          <select id="popupOwnerTeam">
            <option value="" ${currentTeam === "" ? "selected" : ""}>None</option>
            <option value="team1" ${currentTeam === "team1" ? "selected" : ""}>${teamDisplayName("team1")}</option>
            <option value="team2" ${currentTeam === "team2" ? "selected" : ""}>${teamDisplayName("team2")}</option>
            <option value="team3" ${currentTeam === "team3" ? "selected" : ""}>${teamDisplayName("team3")}</option>
            <option value="team4" ${currentTeam === "team4" ? "selected" : ""}>${teamDisplayName("team4")}</option>
          </select>

          <label style="display:block;margin-top:8px;font-weight:700;">Handoff Team</label>
          <select id="popupHandoffTeam">
            <option value="team1" ${currentGrad.endTeam === "team1" ? "selected" : ""}>${teamDisplayName("team1")}</option>
            <option value="team2" ${currentGrad.endTeam === "team2" ? "selected" : ""}>${teamDisplayName("team2")}</option>
            <option value="team3" ${currentGrad.endTeam === "team3" ? "selected" : ""}>${teamDisplayName("team3")}</option>
            <option value="team4" ${currentGrad.endTeam === "team4" ? "selected" : ""}>${teamDisplayName("team4")}</option>
          </select>
          <button class="secondary" onclick="popupSaveTeamsGradient()">Apply Teams Gradient</button>

          <button class="danger" onclick="popupClearDate()">Clear Date</button>
        </div>
      `;
    }

    function centerLat(feature) {
      const layer = L.geoJSON(feature);
      const b = layer.getBounds();
      return (b.getNorth() + b.getSouth()) / 2;
    }

    function filterNorth(data) {
      return {
        type: "FeatureCollection",
        features: (data.features || []).filter(f => {
          try { return centerLat(f) >= SOUTH_LIMIT; } catch { return false; }
        })
      };
    }

    async function renderZipData(data) {
      if (zipLayer) map.removeLayer(zipLayer);
      zipLayer = L.geoJSON(data, {
        renderer: canvasRenderer,
        style: zipStyle,
        onEachFeature: (feature, layer) => {
          bindZipTooltip(layer, feature);
          layer.on("click", () => {
            selected = zipCodeFromFeature(feature);
            selectedType = "zip";
            redrawAllLayers();
            layer.bindPopup(popupHtml("ZIP " + selected, state.zips[selected], "zip", selected)).openPopup();
          });
        }
      }).addTo(map);
      updateThresholdInput();
      updateLegend();
      updateStats();
      updateZipTooltips();
    }

    async function renderCityData(data) {
      if (cityLayer) map.removeLayer(cityLayer);
      cityLayer = L.geoJSON(data, {
        renderer: canvasRenderer,
        style: cityStyle,
        onEachFeature: (feature, layer) => {
          const city = cityNameFromFeature(feature);
          layer.on("click", () => {
            selected = city;
            selectedType = "city";
            redrawAllLayers();
            layer.bindPopup(popupHtml(city, state.cities[city], "city", city)).openPopup();
          });
        }
      }).addTo(map);
      cityLayer.bringToFront();
    }

    async function loadZipLayer(forceRefresh = false) {
      try {
        if (!forceRefresh) {
          const cached = await cacheGet("zipGeoJSONNorth");
          if (cached) await renderZipData(cached);
        }
        const res = await fetch(ZIP_URL, { cache: "no-store" });
        if (!res.ok) throw new Error("network failed");
        const data = await res.json();
        await cachePut("zipGeoJSONNorth", data);
        await renderZipData(data);
      } catch (err) {
        const cached = await cacheGet("zipGeoJSONNorth");
        if (cached) await renderZipData(cached);
      }
    }

    async function loadCityLayer(forceRefresh = false) {
      try {
        if (!forceRefresh) {
          const cached = await cacheGet(CITY_CACHE_KEY);
          if (cached) await renderCityData(cached);
        }
        const res = await fetch(CITY_URL, { cache: "no-store" });
        if (!res.ok) throw new Error("network failed");
        const data = await res.json();
        const filtered = filterNorth(data);
        await cachePut(CITY_CACHE_KEY, filtered);
        await renderCityData(filtered);
      } catch (err) {
        const cached = await cacheGet(CITY_CACHE_KEY);
        if (cached) await renderCityData(cached);
      }
    }

    const panel = document.getElementById("panel");
    const teamPanel = document.getElementById("teamPanel");
    const menuBtn = document.getElementById("menuBtn");
    const teamMenuBtn = document.getElementById("teamMenuBtn");

    function openMenu() {
      panel.classList.add("open");
      teamPanel.style.display = "none";
      menuBtn.classList.add("hidden");
      teamMenuBtn.classList.remove("hidden");
    }
    function closeMenu() {
      panel.classList.remove("open");
      menuBtn.classList.remove("hidden");
    }
    function openTeamMenu() {
      teamPanel.style.display = "block";
      panel.classList.remove("open");
      teamMenuBtn.classList.add("hidden");
      menuBtn.classList.remove("hidden");
    }
    function closeTeamMenu() {
      teamPanel.style.display = "none";
      teamMenuBtn.classList.remove("hidden");
    }

    menuBtn.addEventListener("click", openMenu);
    teamMenuBtn.addEventListener("click", openTeamMenu);
    document.getElementById("closeBtn").addEventListener("click", closeMenu);
    document.getElementById("closeTeamBtn").addEventListener("click", closeTeamMenu);

    document.getElementById("zipFill").value = state.settings.zipFill || "none";
    document.getElementById("zipWeight").value = state.settings.zipWeight || 3.5;
    document.getElementById("showZipLabels").value = state.settings.showZipLabels ? "on" : "off";
    document.getElementById("timeMode").value = getMode();
    document.getElementById("team1Color").value = (state.settings.teamColors || {}).team1 || "#2563eb";
    document.getElementById("team2Color").value = (state.settings.teamColors || {}).team2 || "#9333ea";
    document.getElementById("team3Color").value = (state.settings.teamColors || {}).team3 || "#ec4899";
    document.getElementById("team4Color").value = (state.settings.teamColors || {}).team4 || "#0f766e";
    document.getElementById("gradientStartTeam").value = (state.settings.teamGradient || {}).startTeam || "team1";
    document.getElementById("gradientEndTeam").value = (state.settings.teamGradient || {}).endTeam || "team4";
    updateThresholdInput();

    document.getElementById("zipFill").addEventListener("change", (e) => {
      state.settings.zipFill = e.target.value;
      redrawAllLayers();
    });
    document.getElementById("zipWeight").addEventListener("input", (e) => {
      state.settings.zipWeight = Number(e.target.value);
      redrawAllLayers();
    });
    document.getElementById("showZipLabels").addEventListener("change", (e) => {
      state.settings.showZipLabels = e.target.value === "on";
      redrawAllLayers();
    });

    document.getElementById("saveTeamNamesBtn").addEventListener("click", () => {
      state.settings.teamNames = {
        team1: document.getElementById("team1Name").value.trim() || "Team 1",
        team2: document.getElementById("team2Name").value.trim() || "Team 2",
        team3: document.getElementById("team3Name").value.trim() || "Team 3",
        team4: document.getElementById("team4Name").value.trim() || "Team 4"
      };
      redrawAllLayers();
    });
    document.getElementById("saveTeamColorsBtn").addEventListener("click", () => {
      state.settings.teamColors = {
        team1: document.getElementById("team1Color").value,
        team2: document.getElementById("team2Color").value,
        team3: document.getElementById("team3Color").value,
        team4: document.getElementById("team4Color").value
      };
      redrawAllLayers();
    });
    document.getElementById("saveGradientTeamsBtn").addEventListener("click", () => {
      state.settings.teamGradient = {
        startTeam: document.getElementById("gradientStartTeam").value,
        endTeam: document.getElementById("gradientEndTeam").value
      };
      redrawAllLayers();
    });

    document.getElementById("timeMode").addEventListener("change", (e) => {
      state.settings.timeMode = e.target.value === "days" ? "days" : "weeks";
      redrawAllLayers();
    });
    document.getElementById("thresholdValue").addEventListener("change", (e) => {
      const val = Number(e.target.value);
      const max = getMode() === "days" ? 365 : 52;
      state.settings.thresholdValue = Number.isFinite(val) ? Math.max(1, Math.min(max, val)) : (getMode() === "days" ? 30 : 12);
      redrawAllLayers();
    });
    document.getElementById("refreshZipBtn").addEventListener("click", () => loadZipLayer(true));
    document.getElementById("markTodayBtn").addEventListener("click", () => {
      if (!selected) return;
      const today = new Date().toISOString().split("T")[0];
      if (selectedType === "zip") state.zips[selected] = today;
      if (selectedType === "city") state.cities[selected] = today;
      redrawAllLayers();
    });
    document.getElementById("setDateBtn").addEventListener("click", () => {
      if (!selected) return;
      const d = document.getElementById("date").value;
      if (!d) return;
      if (selectedType === "zip") state.zips[selected] = d;
      if (selectedType === "city") state.cities[selected] = d;
      redrawAllLayers();
    });
    document.getElementById("clearDateBtn").addEventListener("click", () => {
      if (!selected) return;
      if (selectedType === "zip") delete state.zips[selected];
      if (selectedType === "city") delete state.cities[selected];
      redrawAllLayers();
    });

    function findZip(query) {
      return String(query || "").trim().replace(/\D/g, "");
    }

    function zoomToZip(zip) {
      if (!zipLayer) return false;
      let found = false;
      zipLayer.eachLayer(layer => {
        const code = zipCodeFromFeature(layer.feature);
        if (code === zip) {
          found = true;
          selected = zip;
          selectedType = "zip";
          redrawAllLayers();
          map.fitBounds(layer.getBounds(), { padding: [20, 20] });
          layer.bindPopup(popupHtml("ZIP " + zip, state.zips[zip], "zip", zip)).openPopup();
        }
      });
      return found;
    }

    document.getElementById("searchBtn").addEventListener("click", () => {
      const raw = document.getElementById("searchInput").value.trim();
      const zip = findZip(raw);
      let foundCity = false;

      if (cityLayer && raw) {
        cityLayer.eachLayer(layer => {
          const city = cityNameFromFeature(layer.feature).toLowerCase();
          if (!foundCity && city.includes(raw.toLowerCase())) {
            foundCity = true;
            selected = cityNameFromFeature(layer.feature);
            selectedType = "city";
            redrawAllLayers();
            map.fitBounds(layer.getBounds(), { padding: [20, 20] });
            layer.bindPopup(popupHtml(selected, state.cities[selected], "city", selected)).openPopup();
          }
        });
      }

      if (!foundCity && (!zip || !zoomToZip(zip))) {
        alert("No city or ZIP match found.");
      }
    });

    map.on("zoomend", () => {
      if (zipLayer) {
        zipLayer.setStyle(zipStyle);
        updateZipTooltips();
      }
    });

    updateThresholdInput();
    updateLegend();
    updateStats();
    loadZipLayer(false);
    loadCityLayer(false);
  