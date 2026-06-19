/* Territory Manager update:
   1) Freehand/drawn areas hide when zoomed out
   2) Live location tracking button

   Paste this file after Leaflet, after your map is created, and after drawnItems exists.
   Required globals from your app: map, drawnItems
*/

(function () {
  // Change this if you want drawings to appear sooner/later.
  const DRAW_MIN_ZOOM = 11;

  let liveLocationOn = false;
  let userMarker = null;
  let userCircle = null;
  let locationButton = null;

  function setDrawingVisibility() {
    if (!window.map || !window.drawnItems) return;

    const showDrawings = map.getZoom() >= DRAW_MIN_ZOOM;

    drawnItems.eachLayer(layer => {
      if (showDrawings) {
        if (!map.hasLayer(layer)) map.addLayer(layer);
      } else {
        if (map.hasLayer(layer)) map.removeLayer(layer);
      }
    });
  }

  function makeLocationIcon() {
    return L.divIcon({
      className: "tm-live-location-marker",
      html: '<div class="tm-live-dot"></div>',
      iconSize: [22, 22],
      iconAnchor: [11, 11]
    });
  }

  function updateLocationButton() {
    if (!locationButton) return;
    locationButton.classList.toggle("active", liveLocationOn);
    locationButton.innerHTML = liveLocationOn ? "📍 Live" : "📍";
    locationButton.title = liveLocationOn ? "Turn off live location" : "Turn on live location";
  }

  function toggleLiveLocation() {
    if (!window.map) return;

    liveLocationOn = !liveLocationOn;
    updateLocationButton();

    if (liveLocationOn) {
      map.locate({
        watch: true,
        enableHighAccuracy: true,
        setView: true,
        maxZoom: 16,
        timeout: 15000,
        maximumAge: 3000
      });
    } else {
      map.stopLocate();

      if (userMarker) map.removeLayer(userMarker);
      if (userCircle) map.removeLayer(userCircle);

      userMarker = null;
      userCircle = null;
    }
  }

  function onLocationFound(e) {
    if (!liveLocationOn) return;

    if (!userMarker) {
      userMarker = L.marker(e.latlng, { icon: makeLocationIcon(), zIndexOffset: 10000 })
        .addTo(map)
        .bindPopup("You are here");
    } else {
      userMarker.setLatLng(e.latlng);
    }

    if (!userCircle) {
      userCircle = L.circle(e.latlng, {
        radius: e.accuracy,
        weight: 2,
        opacity: 0.8,
        fillOpacity: 0.12,
        interactive: false
      }).addTo(map);
    } else {
      userCircle.setLatLng(e.latlng);
      userCircle.setRadius(e.accuracy);
    }
  }

  function onLocationError() {
    liveLocationOn = false;
    updateLocationButton();
    alert("Location is blocked or unavailable. On iPhone, allow location for this site in Safari/Chrome settings.");
  }

  function addLocationButton() {
    if (document.getElementById("tmLiveLocationBtn")) return;

    locationButton = document.createElement("button");
    locationButton.id = "tmLiveLocationBtn";
    locationButton.className = "tm-live-location-btn";
    locationButton.type = "button";
    locationButton.innerHTML = "📍";
    locationButton.title = "Turn on live location";
    locationButton.addEventListener("click", toggleLiveLocation);
    document.body.appendChild(locationButton);
  }

  function initTerritoryManagerLocationUpdate() {
    if (!window.map) {
      console.warn("Territory Manager location update: map was not found.");
      return;
    }

    addLocationButton();
    setDrawingVisibility();

    map.on("zoomend", setDrawingVisibility);
    map.on("locationfound", onLocationFound);
    map.on("locationerror", onLocationError);
  }

  // Start after page loads so existing app variables are ready.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initTerritoryManagerLocationUpdate);
  } else {
    setTimeout(initTerritoryManagerLocationUpdate, 0);
  }

  // Expose this in case your app wants to call it from another menu button.
  window.toggleLiveLocation = toggleLiveLocation;
  window.refreshDrawingZoomVisibility = setDrawingVisibility;
})();
