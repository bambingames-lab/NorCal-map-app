/* Territory Manager v2 patch
   Fixes:
   - Live location uses browser GPS watchPosition directly, so it updates while moving.
   - Freehand/draw layers hide while zoomed out and reappear when zoomed in.
   - Works even if drawn layers are not stored only in drawnItems.

   Install this AFTER Leaflet and AFTER your main Territory Manager script.
*/
(function () {
  const DRAW_MIN_ZOOM = 11;       // freehand drawings show at zoom 11+
  const FOLLOW_MAX_ZOOM = 16;

  let gpsWatchId = null;
  let liveLocationOn = false;
  let followUser = true;
  let userMarker = null;
  let userCircle = null;
  let locationButton = null;
  let drawingButton = null;

  const trackedDrawLayers = new Set();
  const hiddenDrawLayers = new Set();

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else setTimeout(fn, 0);
  }

  function isMapReady() {
    return window.L && window.map && typeof map.getZoom === 'function';
  }

  function looksLikeFreehandLayer(layer) {
    if (!layer) return false;

    // Tags used by many Territory Manager builds / Leaflet Draw / Leaflet Geoman.
    if (layer.__tmFreehand || layer._tmFreehand || layer.isFreehand || layer.freehand) return true;
    if (layer.options && (
      layer.options.freehand ||
      layer.options.isFreehand ||
      layer.options.pmIgnore === false ||
      layer.options.pane === 'drawPane' ||
      layer.options.className === 'freehand-drawing' ||
      layer.options.className === 'tm-freehand' ||
      layer.options.className === 'drawn-freehand'
    )) return true;

    // User-created drawings are usually Polylines/Polygons with editable rings.
    // Avoid hiding GeoJSON boundary layers that have ZIP/city properties.
    const hasBoundaryProps = layer.feature && layer.feature.properties && (
      layer.feature.properties.ZCTA5CE10 ||
      layer.feature.properties.ZIP ||
      layer.feature.properties.zip ||
      layer.feature.properties.GEOID ||
      layer.feature.properties.NAME ||
      layer.feature.properties.name
    );
    if (hasBoundaryProps) return false;

    const hasLatLngs = typeof layer.getLatLngs === 'function';
    const isPath = window.L && layer instanceof L.Path;
    const hasDrawStyle = layer.options && (
      layer.options.color === '#1769ff' ||
      layer.options.color === 'blue' ||
      layer.options.color === '#0000ff' ||
      layer.options.weight >= 4
    );

    return Boolean(isPath && hasLatLngs && hasDrawStyle && !hasBoundaryProps);
  }

  function rememberDrawLayer(layer) {
    if (looksLikeFreehandLayer(layer)) trackedDrawLayers.add(layer);
  }

  function scanForDrawLayers() {
    if (!isMapReady()) return;

    if (window.drawnItems && typeof drawnItems.eachLayer === 'function') {
      drawnItems.eachLayer(layer => {
        layer.__tmFreehand = true;
        trackedDrawLayers.add(layer);
      });
    }

    if (map.eachLayer) {
      map.eachLayer(layer => rememberDrawLayer(layer));
    }
  }

  function setDrawingVisibility() {
    if (!isMapReady()) return;
    scanForDrawLayers();

    const show = map.getZoom() >= DRAW_MIN_ZOOM;

    trackedDrawLayers.forEach(layer => {
      if (!layer) return;
      if (show) {
        if (hiddenDrawLayers.has(layer)) {
          if (!map.hasLayer(layer)) layer.addTo(map);
          hiddenDrawLayers.delete(layer);
        }
      } else {
        if (map.hasLayer(layer)) {
          map.removeLayer(layer);
          hiddenDrawLayers.add(layer);
        }
      }
    });
  }

  function patchLeafletAddLayer() {
    if (!window.L || !L.Map || L.Map.prototype.__tmDrawPatchInstalled) return;
    L.Map.prototype.__tmDrawPatchInstalled = true;

    const originalAddLayer = L.Map.prototype.addLayer;
    L.Map.prototype.addLayer = function (layer) {
      rememberDrawLayer(layer);
      const result = originalAddLayer.call(this, layer);
      setTimeout(setDrawingVisibility, 0);
      return result;
    };
  }

  function makeLocationIcon() {
    return L.divIcon({
      className: 'tm-live-location-icon',
      html: '<div class="tm-live-location-pulse"></div>',
      iconSize: [26, 26],
      iconAnchor: [13, 13]
    });
  }

  function updateLocationButton(statusText) {
    if (!locationButton) return;
    locationButton.classList.toggle('active', liveLocationOn);
    locationButton.textContent = statusText || (liveLocationOn ? '📍 Live' : '📍');
    locationButton.title = liveLocationOn ? 'Live location on' : 'Turn on live location';
  }

  function drawUserLocation(lat, lng, accuracy) {
    const latlng = L.latLng(lat, lng);

    if (!userMarker) {
      userMarker = L.marker(latlng, { icon: makeLocationIcon(), zIndexOffset: 10000 })
        .addTo(map)
        .bindPopup('You are here');
    } else {
      userMarker.setLatLng(latlng);
    }

    if (!userCircle) {
      userCircle = L.circle(latlng, {
        radius: accuracy || 25,
        weight: 2,
        opacity: 0.9,
        fillOpacity: 0.12,
        interactive: false
      }).addTo(map);
    } else {
      userCircle.setLatLng(latlng);
      userCircle.setRadius(accuracy || 25);
    }

    if (followUser) {
      const nextZoom = Math.max(map.getZoom(), FOLLOW_MAX_ZOOM);
      map.setView(latlng, nextZoom, { animate: true });
    }
  }

  function stopLiveLocation() {
    liveLocationOn = false;

    if (gpsWatchId !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(gpsWatchId);
      gpsWatchId = null;
    }

    if (userMarker && map.hasLayer(userMarker)) map.removeLayer(userMarker);
    if (userCircle && map.hasLayer(userCircle)) map.removeLayer(userCircle);
    userMarker = null;
    userCircle = null;

    updateLocationButton();
  }

  function startLiveLocation() {
    if (!navigator.geolocation) {
      alert('This browser does not support location tracking.');
      return;
    }

    liveLocationOn = true;
    updateLocationButton('Locating…');

    gpsWatchId = navigator.geolocation.watchPosition(
      pos => {
        if (!liveLocationOn) return;
        updateLocationButton('📍 Live');
        drawUserLocation(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
      },
      err => {
        stopLiveLocation();
        let msg = 'Location did not start.';
        if (err.code === 1) msg = 'Location permission was blocked. On iPhone, open Settings > Safari or Chrome > Location, then allow it for this site.';
        if (err.code === 2) msg = 'Location is unavailable. Make sure Location Services are on.';
        if (err.code === 3) msg = 'Location timed out. Try again outside or with better signal.';
        alert(msg);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 1000,
        timeout: 20000
      }
    );
  }

  function toggleLiveLocation() {
    if (!isMapReady()) return;
    if (liveLocationOn) stopLiveLocation();
    else startLiveLocation();
  }

  function addButtons() {
    if (document.getElementById('tmLiveLocationBtn')) {
      locationButton = document.getElementById('tmLiveLocationBtn');
      return;
    }

    locationButton = document.createElement('button');
    locationButton.id = 'tmLiveLocationBtn';
    locationButton.className = 'tm-live-location-btn';
    locationButton.type = 'button';
    locationButton.textContent = '📍';
    locationButton.addEventListener('click', toggleLiveLocation);
    document.body.appendChild(locationButton);

    drawingButton = document.createElement('button');
    drawingButton.id = 'tmRefreshDrawZoomBtn';
    drawingButton.className = 'tm-refresh-draw-btn';
    drawingButton.type = 'button';
    drawingButton.textContent = '↻ Draw';
    drawingButton.title = 'Refresh drawing visibility';
    drawingButton.addEventListener('click', setDrawingVisibility);
    document.body.appendChild(drawingButton);
  }

  function init() {
    if (!isMapReady()) {
      setTimeout(init, 300);
      return;
    }

    patchLeafletAddLayer();
    addButtons();
    scanForDrawLayers();
    setDrawingVisibility();

    map.on('zoomend moveend', setDrawingVisibility);
    map.on('draw:created pm:create', function (e) {
      const layer = e.layer || e.shape || e.target;
      if (layer) {
        layer.__tmFreehand = true;
        trackedDrawLayers.add(layer);
      }
      setTimeout(setDrawingVisibility, 0);
    });
  }

  ready(init);

  window.toggleLiveLocation = toggleLiveLocation;
  window.refreshDrawingZoomVisibility = setDrawingVisibility;
  window.TM_DRAW_MIN_ZOOM = DRAW_MIN_ZOOM;
})();
