/**
 * MAPA INTERACTIVO DE CÓDIGOS POSTALES DE MADRID
 * Lógica principal con Leaflet.js
 * Soporta búsqueda de CP, Callejero, CPs Vecinos y Búsqueda por Dirección con Detección de Frontera
 */

document.addEventListener('DOMContentLoaded', () => {
  try {
    initApp();
  } catch (err) {
    showFatalError('Error en inicialización: ' + err.message + '\n' + err.stack);
  }
});

function showFatalError(msg) {
  const div = document.createElement('div');
  div.style = 'position:fixed;top:0;left:0;right:0;z-index:999999;background:#b91c1c;color:#fff;padding:20px;font-size:16px;white-space:pre-wrap;box-shadow:0 10px 30px rgba(0,0,0,0.8);';
  div.innerHTML = '<b>ERROR FATAL:</b><br>' + msg;
  document.body.appendChild(div);
  console.error(msg);
}

function initApp() {
  // Paleta de colores armónicos para diferenciar códigos postales
  const COLOR_PALETTE = [
    '#38bdf8', '#818cf8', '#a78bfa', '#c084fc', '#e879f9',
    '#f472b6', '#fb7185', '#f87171', '#fb923c', '#fbbf24',
    '#facc15', '#a3e635', '#4ade80', '#34d399', '#2dd4bf',
    '#22d3ee', '#60a5fa', '#6366f1', '#4f46e5', '#0284c7'
  ];

  function getCpColor(cp) {
    let hash = 0;
    const str = String(cp);
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const idx = Math.abs(hash) % COLOR_PALETTE.length;
    return COLOR_PALETTE[idx];
  }

  // --- Capas Base de Mapas (100% libres, sin API Key ni marcas de agua) ---
  const tileLayers = {
    dark: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ',
      maxNativeZoom: 16,
      maxZoom: 19
    }),
    light: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ',
      maxNativeZoom: 16,
      maxZoom: 19
    }),
    streets: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Tiles &copy; Esri &mdash; Callejero',
      maxNativeZoom: 18,
      maxZoom: 19
    }),
    satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Tiles &copy; Esri &mdash; Ortofoto',
      maxNativeZoom: 18,
      maxZoom: 19
    }),
    ign: L.tileLayer('https://www.ign.es/wmts/ign-base?service=WMTS&request=GetTile&version=1.0.0&Format=image/png&layer=IGNBaseTodo&style=default&tilematrixset=GoogleMapsCompatible&TileMatrix={z}&TileRow={y}&TileCol={x}', {
      attribution: '&copy; Instituto Geográfico Nacional de España',
      maxNativeZoom: 18,
      maxZoom: 19
    })
  };

  // Inicializar mapa centrado en Madrid (Puerta del Sol)
  const MADRID_CENTER = [40.4168, -3.7038];
  const map = L.map('map', {
    center: MADRID_CENTER,
    zoom: 12,
    layers: [tileLayers.dark],
    zoomControl: false
  });

  // Reubicar zoom control abajo a la derecha
  L.control.zoom({ position: 'bottomright' }).addTo(map);

  // Estado global de la aplicación
  let currentScope = 'capital'; // 'capital' | 'comunidad'
  let allFeatures = [];
  let capitalFeatures = [];
  let activeGeoJsonLayer = null;
  let cpLayerIndex = {};     // cp -> array de capas L.Polygon
  let cpDataIndex = {};      // cp -> objeto con metadatos
  let cpNeighbors = {};      // cp -> array de CPs vecinos
  let activeTenueLayers = []; // Capas que están alumbradas tenuemente (frontera)
  let activeAddressMarker = null; // Marcador en el mapa para direcciones encontradas
  let hoveredCp = null;
  let lockedCp = null;
  let activeSearchDebounce = null;

  // NUESTRAS 3 COCINAS OPERATIVAS (Ubicaciones fijas solicitadas)
  const COCINAS = [
    {
      id: 'norte',
      name: 'Cocina Norte',
      address: 'Av. de 25 de Septiembre, 8',
      cp: '28027',
      lat: 40.44456,
      lon: -3.62530,
      scope: 'capital',
      zona: 'San Blas-Canillejas (Salvador)',
      municipio: 'Madrid'
    },
    {
      id: 'fuencarral',
      name: 'Cocina Fuencarral',
      address: 'C/ Sangenjo, 29',
      cp: '28034',
      lat: 40.48554,
      lon: -3.69990,
      scope: 'capital',
      zona: 'Fuencarral-El Pardo (La Paz)',
      municipio: 'Madrid'
    },
    {
      id: 'alcorcon',
      name: 'Cocina Alcorcón',
      address: 'Plaza Príncipes de España, 2',
      cp: '28924',
      lat: 40.35099,
      lon: -3.81835,
      scope: 'comunidad',
      zona: 'Alcorcón (Parque Lisboa)',
      municipio: 'Alcorcón'
    }
  ];
  const cocinasLayerGroup = L.layerGroup().addTo(map);
  const kitchenMarkers = {};

  // Flota de Repartidores
  const driversLayerGroup = L.layerGroup().addTo(map);
  const driverMarkers = {};
  let currentOptimalDriver = null;

  // Elementos DOM
  const giantHud = document.getElementById('giant-cp-hud');
  const giantCpNumber = document.getElementById('giant-cp-number');
  const hudZoneName = document.getElementById('hud-zone-name');
  const hudMunicipality = document.getElementById('hud-municipality');
  const hudZoneType = document.getElementById('hud-zone-type');
  const hudStatusDot = document.getElementById('hud-status-dot');
  const hudFrontierBanner = document.getElementById('hud-frontier-banner');
  const hudFrontierText = document.getElementById('hud-frontier-text');
  const hudKitchenCard = document.getElementById('hud-kitchen-card');
  const hudKitchenName = document.getElementById('hud-kitchen-name');
  const hudKitchenDistBadge = document.getElementById('hud-kitchen-dist-badge');
  const hudKitchenAddress = document.getElementById('hud-kitchen-address');
  const hudKitchenGotoBtn = document.getElementById('hud-kitchen-goto-btn');
  const hudShowStreetsBtn = document.getElementById('hud-show-streets-btn');
  const hudShowStreetsText = document.getElementById('hud-show-streets-text');
  const hudShowStreetsBadge = document.getElementById('hud-show-streets-badge');
  const closeHudBtn = document.getElementById('close-hud-btn');
  const reopenHudBtn = document.getElementById('reopen-hud-btn');
  const reopenHudText = document.getElementById('reopen-hud-text');
  const toggleHudBtn = document.getElementById('toggle-hud-btn');
  const cursorTooltip = document.getElementById('cursor-cp-tooltip');
  const cursorCpLabel = document.getElementById('cursor-cp-label');
  const cursorZoneLabel = document.getElementById('cursor-zone-label');
  const copyCpBtn = document.getElementById('copy-cp-btn');
  const zoomToCpBtn = document.getElementById('zoom-to-cp-btn');
  const openStreetsBtn = document.getElementById('open-streets-btn');
  const toastMsg = document.getElementById('toast-msg');

  // Search DOM
  const searchInput = document.getElementById('search-cp-input');
  const searchDropdown = document.getElementById('search-dropdown');
  const clearSearchBtn = document.getElementById('clear-search-btn');

  // Sidebar DOM (Directorio de Códigos Postales)
  const sidebarDrawer = document.getElementById('sidebar-drawer');
  const sidebarList = document.getElementById('sidebar-list');
  const sidebarFilterInput = document.getElementById('sidebar-filter-input');
  const sidebarCountBadge = document.getElementById('sidebar-count-badge');
  const toggleSidebarBtn = document.getElementById('toggle-sidebar-btn');
  const closeSidebarBtn = document.getElementById('close-sidebar-btn');

  // Streets & Neighbors Drawer DOM
  const streetsDrawer = document.getElementById('streets-drawer');
  const streetsDrawerTitle = document.getElementById('streets-drawer-title');
  const closeStreetsBtn = document.getElementById('close-streets-btn');
  const toggleStreetsNavBtn = document.getElementById('toggle-streets-nav-btn');
  const tabStreetsBtn = document.getElementById('tab-streets-btn');
  const tabNeighborsBtn = document.getElementById('tab-neighbors-btn');
  const tabStreetsCount = document.getElementById('tab-streets-count');
  const tabNeighborsCount = document.getElementById('tab-neighbors-count');
  const tabStreetsContent = document.getElementById('tab-streets-content');
  const tabNeighborsContent = document.getElementById('tab-neighbors-content');
  const streetsFilterInput = document.getElementById('streets-filter-input');
  const streetsList = document.getElementById('streets-list');
  const neighborsList = document.getElementById('neighbors-list');
  const tabCocinasBtn = document.getElementById('tab-cocinas-btn');
  const tabCocinasContent = document.getElementById('tab-cocinas-content');
  const kitchensRankingList = document.getElementById('kitchens-ranking-list');
  let optimalRouteLine = null;

  // Scope Buttons
  const scopeCapitalBtn = document.getElementById('scope-capital-btn');
  const scopeComunidadBtn = document.getElementById('scope-comunidad-btn');

  // Cocinas Nav DOM
  const toggleCocinasBtn = document.getElementById('toggle-cocinas-btn');
  const cocinasDropdown = document.getElementById('cocinas-dropdown');

  // Repartidores DOM
  const toggleDriversBtn = document.getElementById('toggle-drivers-btn');
  const navDriversCount = document.getElementById('nav-drivers-count');
  const driversDrawer = document.getElementById('drivers-drawer');
  const closeDriversBtn = document.getElementById('close-drivers-btn');
  const driversCountBadge = document.getElementById('drivers-count-badge');
  const driversList = document.getElementById('drivers-list');
  const toggleAddDriverForm = document.getElementById('toggle-add-driver-form');
  const addDriverForm = document.getElementById('add-driver-form');
  const driverInputName = document.getElementById('driver-input-name');
  const driverInputVehicle = document.getElementById('driver-input-vehicle');
  const driverInputKitchen = document.getElementById('driver-input-kitchen');
  const driverInputPhone = document.getElementById('driver-input-phone');
  const countFilterAll = document.getElementById('count-filter-all');
  const countFilterDisponible = document.getElementById('count-filter-disponible');
  const countFilterReparto = document.getElementById('count-filter-reparto');
  const countFilterCocina = document.getElementById('count-filter-cocina');
  let currentDriverFilter = 'all';

  // HUD Driver DOM
  const hudDriverCard = document.getElementById('hud-driver-card');
  const hudDriverStatusBadge = document.getElementById('hud-driver-status-badge');
  const hudDriverName = document.getElementById('hud-driver-name');
  const hudDriverDist = document.getElementById('hud-driver-dist');
  const hudDriverInfo = document.getElementById('hud-driver-info');
  const hudAssignDriverBtn = document.getElementById('hud-assign-driver-btn');
  const hudLocateDriverBtn = document.getElementById('hud-locate-driver-btn');

  // Layer Picker Modal
  const layerPickerBtn = document.getElementById('layer-picker-btn');
  const layerPickerModal = document.getElementById('layer-picker-modal');

  // Status bottom bar
  const statsCpCount = document.getElementById('stats-cp-count');
  const statsHovered = document.getElementById('stats-hovered');

  // --- Normalizador de coordenadas GeoJSON (evita array flattening) ---
  function fixFeatureCoordinates(feature) {
    if (!feature || !feature.geometry || !feature.geometry.coordinates) return;
    const geom = feature.geometry;
    if (geom.type === 'Polygon') {
      if (Array.isArray(geom.coordinates[0]) && typeof geom.coordinates[0][0] === 'number') {
        geom.coordinates = [geom.coordinates];
      }
    } else if (geom.type === 'MultiPolygon') {
      geom.coordinates = geom.coordinates.map(poly => {
        if (Array.isArray(poly) && Array.isArray(poly[0]) && typeof poly[0][0] === 'number') {
          return [poly];
        }
        return poly;
      });
    }
  }

  // --- Carga de Datos GeoJSON ---
  function loadData() {
    if (window.MADRID_GEOJSON && window.MADRID_GEOJSON.features) {
      allFeatures = window.MADRID_GEOJSON.features;
      allFeatures.forEach(fixFeatureCoordinates);
    }
    if (window.MADRID_CAPITAL_GEOJSON && window.MADRID_CAPITAL_GEOJSON.features) {
      capitalFeatures = window.MADRID_CAPITAL_GEOJSON.features;
      capitalFeatures.forEach(fixFeatureCoordinates);
    } else {
      capitalFeatures = allFeatures.filter(f => f.properties && f.properties.es_capital);
    }

    renderCurrentScope();
  }

  // --- Algoritmo de Detección de Vecinos / Zonas Limítrofes ---
  function computeCpNeighbors(features) {
    const neighbors = {};
    const cpPoints = {};
    const cpBBoxes = {};

    features.forEach(f => {
      const cp = f.properties.cp;
      if (!cpPoints[cp]) {
        cpPoints[cp] = [];
        cpBBoxes[cp] = { minX: 999, maxX: -999, minY: 999, maxY: -999 };
        neighbors[cp] = new Set();
      }

      function collectPoints(arr) {
        if (Array.isArray(arr[0])) {
          arr.forEach(collectPoints);
        } else {
          const x = arr[0], y = arr[1]; // [lon, lat]
          cpPoints[cp].push([x, y]);
          const bb = cpBBoxes[cp];
          if (x < bb.minX) bb.minX = x;
          if (x > bb.maxX) bb.maxX = x;
          if (y < bb.minY) bb.minY = y;
          if (y > bb.maxY) bb.maxY = y;
        }
      }
      collectPoints(f.geometry.coordinates);
    });

    const cps = Object.keys(cpPoints);
    for (let i = 0; i < cps.length; i++) {
      const cp1 = cps[i];
      const bb1 = cpBBoxes[cp1];
      const pts1 = cpPoints[cp1];

      for (let j = i + 1; j < cps.length; j++) {
        const cp2 = cps[j];
        const bb2 = cpBBoxes[cp2];

        // Verificar solapamiento de bounding boxes con margen de ~150 metros (0.0015 deg)
        const margin = 0.0015;
        if (bb1.maxX + margin < bb2.minX || bb1.minX - margin > bb2.maxX ||
            bb1.maxY + margin < bb2.minY || bb1.minY - margin > bb2.maxY) {
          continue;
        }

        let isNeighbor = false;
        const pts2 = cpPoints[cp2];
        const step1 = Math.max(1, Math.floor(pts1.length / 40));
        const step2 = Math.max(1, Math.floor(pts2.length / 40));

        for (let a = 0; a < pts1.length; a += step1) {
          const p1 = pts1[a];
          for (let b = 0; b < pts2.length; b += step2) {
            const p2 = pts2[b];
            const dx = p1[0] - p2[0];
            const dy = p1[1] - p2[1];
            if ((dx * dx + dy * dy) < 0.000006) { // ~240m de proximidad
              isNeighbor = true;
              break;
            }
          }
          if (isNeighbor) break;
        }

        if (isNeighbor) {
          neighbors[cp1].add(cp2);
          neighbors[cp2].add(cp1);
        }
      }
    }

    const result = {};
    for (const cp in neighbors) {
      result[cp] = Array.from(neighbors[cp]).sort();
    }
    return result;
  }

  // --- Estilos de Polígonos ---
  function getStyle(feature) {
    const cp = feature.properties.cp;
    const baseColor = getCpColor(cp);
    return {
      fillColor: baseColor,
      weight: 1.5,
      opacity: 0.9,
      color: '#ffffff',
      dashArray: '',
      fillOpacity: 0.42
    };
  }

  const HOVER_STYLE = {
    weight: 3.5,
    color: '#ffffff',
    fillOpacity: 0.85
  };

  const DIMMED_STYLE = {
    fillOpacity: 0.12,
    weight: 1,
    opacity: 0.35
  };

  const LOCKED_STYLE = {
    weight: 4,
    color: '#facc15',
    fillOpacity: 0.92
  };

  // ESTILO TENUE PARA ZONAS FRONTERIZAS O VECINAS
  const TENUE_BORDER_STYLE = {
    fillColor: '#f59e0b',
    fillOpacity: 0.28,
    color: '#fbbf24',
    weight: 3,
    dashArray: '6, 6'
  };

  // --- Renderizar Capa en el Mapa ---
  function renderCurrentScope() {
    if (activeGeoJsonLayer) {
      map.removeLayer(activeGeoJsonLayer);
    }
    clearTenueHighlights();

    cpLayerIndex = {};
    cpDataIndex = {};

    const featuresToRender = currentScope === 'capital' ? capitalFeatures : allFeatures;
    const geojsonData = {
      type: 'FeatureCollection',
      features: featuresToRender
    };

    // Calcular vecinos para este alcance
    cpNeighbors = computeCpNeighbors(featuresToRender);

    activeGeoJsonLayer = L.geoJSON(geojsonData, {
      style: getStyle,
      onEachFeature: (feature, layer) => {
        const cp = feature.properties.cp;
        if (!cpLayerIndex[cp]) {
          cpLayerIndex[cp] = [];
          cpDataIndex[cp] = feature.properties;
        }
        cpLayerIndex[cp].push(layer);

        // Eventos interactivos del mouse
        layer.on({
          mouseover: (e) => onPolygonMouseOver(cp, e),
          mouseout: (e) => onPolygonMouseOut(cp, e),
          mousemove: (e) => onPolygonMouseMove(e),
          click: (e) => onPolygonClick(cp, e)
        });
      }
    }).addTo(map);

    if (currentScope === 'capital') {
      map.flyTo(MADRID_CENTER, 12, { duration: 1 });
      if (statsCpCount) statsCpCount.textContent = '55 Códigos Postales (Madrid Capital)';
    } else {
      const bounds = activeGeoJsonLayer.getBounds();
      map.flyToBounds(bounds, { padding: [20, 20], duration: 1.2 });
      if (statsCpCount) statsCpCount.textContent = `${Object.keys(cpDataIndex).length} Códigos Postales (Comunidad de Madrid)`;
    }

    populateSidebar();
    resetHud();
    renderKitchenMarkers();
    renderDriverMarkers();
    renderDriversDrawer(currentDriverFilter);
  }

  // --- Manejadores de Eventos del Ratón ---

  function onPolygonMouseOver(cp, e) {
    if (hoveredCp === cp) return;
    hoveredCp = cp;

    const data = cpDataIndex[cp];
    if (!data) return;

    highlightCp(cp);
    updateGiantHud(data, false);

    cursorCpLabel.textContent = cp;
    cursorZoneLabel.textContent = data.zona.split('(')[0].trim() || data.municipio;
    cursorTooltip.classList.add('active');

    if (statsHovered) statsHovered.innerHTML = `Zona actual: <b>CP ${cp}</b>`;
  }

  function onPolygonMouseOut(cp, e) {
    if (hoveredCp === cp) {
      hoveredCp = null;
    }
    cursorTooltip.classList.remove('active');

    if (lockedCp) {
      highlightCp(lockedCp);
      updateGiantHud(cpDataIndex[lockedCp], true);
      if (statsHovered) statsHovered.innerHTML = `Seleccionado: <b>CP ${lockedCp}</b>`;
    } else {
      resetAllStyles();
      resetHud();
      if (statsHovered) statsHovered.innerHTML = 'Pasa el ratón sobre el mapa';
    }
  }

  function onPolygonMouseMove(e) {
    cursorTooltip.style.left = `${e.originalEvent.pageX + 15}px`;
    cursorTooltip.style.top = `${e.originalEvent.pageY - 20}px`;
  }

  function onPolygonClick(cp, e) {
    if (lockedCp === cp) {
      lockedCp = null;
      resetAllStyles();
      streetsDrawer.classList.add('collapsed');
      if (hoveredCp) {
        highlightCp(hoveredCp);
        updateGiantHud(cpDataIndex[hoveredCp], false);
      } else {
        resetHud();
      }
      return;
    }

    selectAndFocusCp(cp, true);
  }

  // --- Destacar Código Postal y Limpiar Resaltados Tenues ---
  function clearTenueHighlights() {
    activeTenueLayers.forEach(l => {
      if (activeGeoJsonLayer) activeGeoJsonLayer.resetStyle(l);
    });
    activeTenueLayers = [];
    if (hudFrontierBanner) hudFrontierBanner.classList.remove('visible');
  }

  function highlightCp(cp) {
    clearTenueHighlights();

    activeGeoJsonLayer.eachLayer(l => {
      l.setStyle(DIMMED_STYLE);
    });

    const targetLayers = cpLayerIndex[cp] || [];
    const isLocked = lockedCp === cp;
    const styleToUse = isLocked ? LOCKED_STYLE : HOVER_STYLE;

    targetLayers.forEach(layer => {
      layer.setStyle({
        ...styleToUse,
        fillColor: getCpColor(cp)
      });
      if (!L.Browser.ie && !L.Browser.opera && !L.Browser.edge) {
        layer.bringToFront();
      }
    });

    syncSidebarSelection(cp);
  }

  // Alumbrar tenuemente un código postal vecino / fronterizo
  function highlightNeighborTenue(neighborCp) {
    const layers = cpLayerIndex[neighborCp];
    if (!layers) return;

    layers.forEach(l => {
      l.setStyle(TENUE_BORDER_STYLE);
      l.bringToFront();
      activeTenueLayers.push(l);
    });
  }

  function resetAllStyles() {
    clearTenueHighlights();
    activeGeoJsonLayer.eachLayer(layer => {
      activeGeoJsonLayer.resetStyle(layer);
    });
    syncSidebarSelection(null);
  }

  // =========================================================================
  // CÁLCULO DE COCINA MÁS CERCANA Y ÓPTIMA EN DISTANCIA
  // =========================================================================

  function getCpCenter(cp) {
    const layers = cpLayerIndex[cp];
    if (layers && layers.length > 0) {
      const group = L.featureGroup(layers);
      const center = group.getBounds().getCenter();
      return [center.lat, center.lng];
    }
    return null;
  }

  function calculateKitchenRankings(fromLat, fromLon) {
    const fromPoint = L.latLng(fromLat, fromLon);
    return COCINAS.map(cocina => {
      const kPoint = L.latLng(cocina.lat, cocina.lon);
      const meters = fromPoint.distanceTo(kPoint);
      const km = meters / 1000;
      return {
        ...cocina,
        meters: Math.round(meters),
        kmText: km < 1 ? `${Math.round(meters)} m` : `${km.toFixed(1)} km`,
        rawKm: km
      };
    }).sort((a, b) => a.meters - b.meters);
  }

  function clearOptimalRouteLine() {
    if (optimalRouteLine) {
      map.removeLayer(optimalRouteLine);
      optimalRouteLine = null;
    }
  }

  function updateOptimalKitchenDisplay(fromLat, fromLon, cp, drawLine = false) {
    const rankings = calculateKitchenRankings(fromLat, fromLon);
    const optimal = rankings[0];

    if (hudKitchenCard) {
      hudKitchenCard.style.display = 'flex';
      if (hudKitchenName) hudKitchenName.textContent = optimal.name;
      if (hudKitchenDistBadge) hudKitchenDistBadge.textContent = optimal.kmText;
      if (hudKitchenAddress) hudKitchenAddress.textContent = `${optimal.address} • CP ${optimal.cp}`;
      if (hudKitchenGotoBtn) {
        hudKitchenGotoBtn.onclick = (e) => {
          e.stopPropagation();
          selectCocina(optimal.id);
        };
      }
    }

    // Dibujar o actualizar línea de ruta directa en el mapa
    if (drawLine) {
      clearOptimalRouteLine();
      optimalRouteLine = L.polyline([[fromLat, fromLon], [optimal.lat, optimal.lon]], {
        color: '#f59e0b',
        weight: 3.5,
        dashArray: '8, 8',
        opacity: 0.9,
        lineCap: 'round',
        className: 'optimal-route-polyline'
      }).addTo(map);

      optimalRouteLine.bindTooltip(
        `🍳 Cocina más cercana y óptima: <b>${optimal.name}</b> a <b>${optimal.kmText}</b>`,
        { sticky: true }
      );
    }

    // Actualizar el ranking de las 3 cocinas en la pestaña del Drawer
    renderKitchensRankingDrawer(rankings, cp);

    return optimal;
  }

  function renderKitchensRankingDrawer(rankings, currentCp) {
    if (!kitchensRankingList) return;
    kitchensRankingList.innerHTML = '';

    rankings.forEach((k, idx) => {
      const isOptimal = idx === 0;
      const card = document.createElement('div');
      card.className = `kitchen-ranking-card ${isOptimal ? 'optimal' : ''}`;

      const medal = idx === 0 ? '🥇' : (idx === 1 ? '🥈' : '🥉');

      card.innerHTML = `
        <div class="kitchen-ranking-top">
          <div class="kitchen-rank-tag ${isOptimal ? 'gold' : ''}">
            <span>${medal}</span>
            <span>${k.name}</span>
            ${isOptimal ? '<span style="font-size:10px; background:#f59e0b; color:#0f172a; padding:1px 6px; border-radius:10px; font-weight:800;">ÓPTIMA</span>' : ''}
          </div>
          <span class="kitchen-rank-dist">${k.kmText}</span>
        </div>
        <div class="kitchen-ranking-meta">
          📍 ${k.address} • CP ${k.cp} (${k.zona})
        </div>
        <button class="kitchen-ranking-btn">
          Navegar a esta cocina ➔
        </button>
      `;

      card.addEventListener('click', () => {
        selectCocina(k.id);
      });

      kitchensRankingList.appendChild(card);
    });
  }

  // --- Actualizar HUD Gigante ---
  function updateGiantHud(data, isLocked) {
    giantHud.classList.remove('idle');
    giantCpNumber.textContent = data.cp;
    hudZoneName.textContent = data.zona;
    hudMunicipality.textContent = data.municipio;
    hudZoneType.textContent = data.es_capital ? 'Madrid Capital' : 'Comunidad de Madrid';

    hudStatusDot.style.background = isLocked ? '#facc15' : '#38bdf8';
    hudStatusDot.style.boxShadow = isLocked ? '0 0 10px #facc15' : '0 0 10px #38bdf8';

    // Calcular cocina más cercana y óptima y repartidor más cercano
    let optimal = null;
    const center = getCpCenter(data.cp);
    if (center) {
      optimal = updateOptimalKitchenDisplay(center[0], center[1], data.cp, isLocked);
      updateOptimalDriverDisplay(center[0], center[1], data.cp);
    }

    // Actualizar píldora minimizada si la tarjeta está cerrada
    if (reopenHudText) {
      const shortName = data.zona.split('(')[0].trim() || data.municipio;
      const optText = optimal ? ` • 🍳 <b>${optimal.name}</b> (${optimal.kmText})` : '';
      reopenHudText.innerHTML = `Código Postal: <b class="pill-cp">${data.cp}</b> (${shortName})${optText}`;
    }

    // Actualizar botón para consultar direcciones a demanda
    const numStreets = (window.MADRID_STREETS && window.MADRID_STREETS[data.cp]) ? window.MADRID_STREETS[data.cp].length : 0;
    if (hudShowStreetsBadge) {
      hudShowStreetsBadge.textContent = numStreets > 0 ? `${numStreets} calles ▾` : 'Ver calles ▾';
    }
  }

  function resetHud() {
    giantHud.classList.add('idle');
    giantCpNumber.textContent = '-----';
    hudZoneName.textContent = 'Pasa el cursor sobre cualquier zona para ver su código postal y distrito';
    hudMunicipality.textContent = 'Comunidad de Madrid';
    hudZoneType.textContent = currentScope === 'capital' ? '55 CPs Capital' : '298 CPs Comunidad';
    hudStatusDot.style.background = '#64748b';
    hudStatusDot.style.boxShadow = 'none';
    if (hudKitchenCard) hudKitchenCard.style.display = 'none';
    if (hudDriverCard) hudDriverCard.style.display = 'none';
    clearOptimalRouteLine();
    clearTenueHighlights();
  }

  // --- Seleccionar y Enfocar un CP ---
  function selectAndFocusCp(cp, zoomIn = true) {
    if (!cpLayerIndex[cp]) {
      if (allFeatures.some(f => f.properties.cp === cp)) {
        setScope('comunidad');
      } else {
        showToast(`Código postal ${cp} no encontrado en Madrid.`);
        return;
      }
    }

    lockedCp = cp;
    highlightCp(cp);
    updateGiantHud(cpDataIndex[cp], true);

    const center = getCpCenter(cp);
    if (center) {
      const optimal = updateOptimalKitchenDisplay(center[0], center[1], cp, true);
      showToast(`📍 CP ${cp} — Cocina más cercana: 🍳 ${optimal.name} a ${optimal.kmText}`);
    }

    if (zoomIn) {
      const layers = cpLayerIndex[cp];
      if (layers && layers.length > 0) {
        const group = L.featureGroup(layers);
        map.fitBounds(group.getBounds(), {
          padding: [80, 80],
          maxZoom: 15,
          duration: 0.8
        });
      }
    }

    if (statsHovered) statsHovered.innerHTML = `Seleccionado: <b>CP ${cp}</b>`;
    // Actualizar datos de calles solo si el panel ya estaba abierto voluntariamente
    if (!streetsDrawer.classList.contains('collapsed')) {
      updateStreetsDrawerData(cp);
    }
  }

  // =========================================================================
  // DETECCIÓN DE PUNTOS GEOGRÁFICOS, POLÍGONOS Y DISTANCIAS A LA FRONTERA
  // =========================================================================

  // Algoritmo Ray-Casting para saber si un punto está dentro de un anillo
  function isPointInsidePolygon(lat, lon, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1]; // lon, lat
      const xj = ring[j][0], yj = ring[j][1];
      const intersect = ((yi > lat) !== (yj > lat)) &&
                        (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function findCpContainingPoint(lat, lon) {
    const list = currentScope === 'capital' ? capitalFeatures : allFeatures;
    for (const feat of list) {
      const geom = feat.geometry;
      if (geom.type === 'Polygon') {
        if (isPointInsidePolygon(lat, lon, geom.coordinates[0])) {
          return feat.properties.cp;
        }
      } else if (geom.type === 'MultiPolygon') {
        for (const poly of geom.coordinates) {
          if (isPointInsidePolygon(lat, lon, poly[0])) {
            return feat.properties.cp;
          }
        }
      }
    }
    return null;
  }

  // Distancia perpendicular de un punto a un segmento (en metros)
  function distanceToSegmentMeters(lat, lon, lat1, lon1, lat2, lon2) {
    const latMid = ((lat1 + lat2) / 2) * (Math.PI / 180);
    const mPerDegLat = 111132.95;
    const mPerDegLon = 111412.84 * Math.cos(latMid);

    const x = lon * mPerDegLon;
    const y = lat * mPerDegLat;
    const x1 = lon1 * mPerDegLon;
    const y1 = lat1 * mPerDegLat;
    const x2 = lon2 * mPerDegLon;
    const y2 = lat2 * mPerDegLat;

    const dx = x2 - x1;
    const dy = y2 - y1;
    const l2 = dx * dx + dy * dy;
    if (l2 === 0) return Math.sqrt((x - x1) * (x - x1) + (y - y1) * (y - y1));

    let t = ((x - x1) * dx + (y - y1) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    const px = x1 + t * dx;
    const py = y1 + t * dy;

    return Math.sqrt((x - px) * (x - px) + (y - py) * (y - py));
  }

  // Encuentra la frontera más cercana a un punto y el CP vecino
  function checkBoundaryProximity(lat, lon, primaryCp) {
    const neighbors = cpNeighbors[primaryCp] || [];
    let minDistance = 999999;
    let closestNeighbor = null;

    // Obtener anillos de los vecinos para medir distancia al límite compartido
    neighbors.forEach(nCp => {
      const layers = cpLayerIndex[nCp] || [];
      layers.forEach(layer => {
        const latlngs = layer.getLatLngs();
        function checkRings(rings) {
          if (!Array.isArray(rings) || rings.length === 0) return;
          if (rings[0] instanceof L.LatLng) {
            for (let i = 0; i < rings.length - 1; i++) {
              const d = distanceToSegmentMeters(lat, lon, rings[i].lat, rings[i].lng, rings[i + 1].lat, rings[i + 1].lng);
              if (d < minDistance) {
                minDistance = d;
                closestNeighbor = nCp;
              }
            }
          } else {
            rings.forEach(checkRings);
          }
        }
        checkRings(latlngs);
      });
    });

    return {
      distanceMeters: Math.round(minDistance),
      isFrontier: minDistance <= 250, // Si está a menos de 250 metros de la frontera
      closestNeighbor: closestNeighbor
    };
  }

  // =========================================================================
  // MARCADOR DE DIRECCIÓN Y NAVEGACIÓN
  // =========================================================================

  function placeAddressMarker(lat, lon, addressName, cp, frontierInfo, optimal) {
    if (activeAddressMarker) {
      map.removeLayer(activeAddressMarker);
    }

    const customIcon = L.divIcon({
      className: 'custom-address-marker',
      html: `
        <div class="marker-pin-body">
          <span class="marker-pin-inner">📍</span>
        </div>
        <div class="marker-pin-pulse"></div>
      `,
      iconSize: [36, 48],
      iconAnchor: [18, 48],
      popupAnchor: [0, -48]
    });

    activeAddressMarker = L.marker([lat, lon], { icon: customIcon }).addTo(map);

    let popupHtml = `
      <div class="address-popup-content">
        <div class="address-popup-title">
          <span>📍</span> <b>${addressName}</b>
        </div>
        <div>Código Postal asignado: <span class="address-popup-cp">${cp}</span></div>
        ${optimal ? `<div style="margin-top:4px; font-size:12px; color:#facc15;">🍳 <b>Cocina óptima:</b> ${optimal.name} (${optimal.kmText})</div>` : ''}
    `;

    if (frontierInfo && frontierInfo.isFrontier && frontierInfo.closestNeighbor) {
      const nData = cpDataIndex[frontierInfo.closestNeighbor];
      const nName = nData ? nData.zona.split('(')[0].trim() : 'Zona vecina';
      popupHtml += `
        <div class="address-popup-frontier">
          ⚠️ <b>Zona Fronteriza:</b> A ${frontierInfo.distanceMeters} m del límite con el <b>CP ${frontierInfo.closestNeighbor}</b> (${nName}).
        </div>
      `;
    }

    popupHtml += `</div>`;
    activeAddressMarker.bindPopup(popupHtml).openPopup();
  }

  // =========================================================================
  // GESTIÓN DE MARCADORES Y NAVEGACIÓN DE NUESTRAS 3 COCINAS
  // =========================================================================

  function renderKitchenMarkers() {
    cocinasLayerGroup.clearLayers();

    COCINAS.forEach(cocina => {
      const customIcon = L.divIcon({
        className: 'kitchen-custom-marker',
        html: `
          <div class="kitchen-marker-container">
            <div class="kitchen-marker-pulse"></div>
            <div class="kitchen-marker-pin" title="${cocina.name} • CP ${cocina.cp}">
              <span class="kitchen-marker-icon">🍳</span>
            </div>
            <div class="kitchen-marker-label">${cocina.name}</div>
          </div>
        `,
        iconSize: [40, 52],
        iconAnchor: [20, 36],
        popupAnchor: [0, -36]
      });

      const marker = L.marker([cocina.lat, cocina.lon], {
        icon: customIcon,
        zIndexOffset: 1200
      });

      const popupHtml = `
        <div class="address-popup-content">
          <div class="address-popup-title" style="color: #f59e0b; display:flex; align-items:center; gap:6px;">
            <span style="font-size:16px;">🍳</span> <b>${cocina.name}</b>
          </div>
          <div style="font-size:12px; color:#f1f5f9; margin: 4px 0;">
            📍 <b>Dirección:</b> ${cocina.address}
          </div>
          <div style="font-size:12px; color:#94a3b8; margin-bottom: 6px;">
            📮 <b>Código Postal:</b> <span class="address-popup-cp">${cocina.cp}</span> (${cocina.zona})
          </div>
          <div style="display:inline-flex; align-items:center; gap:5px; padding:3px 8px; border-radius:6px; background:rgba(245, 158, 11, 0.2); border:1px solid rgba(245,158,11,0.5); font-size:11px; color:#fef08a; font-weight:700;">
            <span>🔥</span> Ubicación Fija Operativa
          </div>
        </div>
      `;
      marker.bindPopup(popupHtml);

      marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        selectCocina(cocina.id);
      });

      marker.addTo(cocinasLayerGroup);
      kitchenMarkers[cocina.id] = marker;
    });
  }

  function selectCocina(cocinaId) {
    const cocina = COCINAS.find(c => c.id === cocinaId);
    if (!cocina) return;

    // Si la cocina es de Alcorcón y estamos en alcance capital, cambiar a comunidad
    if (cocina.scope === 'comunidad' && currentScope === 'capital') {
      setScope('comunidad');
    }

    // Limpiar marcador de dirección previa si lo hubiere
    if (activeAddressMarker) {
      map.removeLayer(activeAddressMarker);
      activeAddressMarker = null;
    }

    // Centrar mapa en la cocina con animación
    map.flyTo([cocina.lat, cocina.lon], 16, { duration: 0.9 });

    // Seleccionar y resaltar el código postal correspondiente
    selectAndFocusCp(cocina.cp, false);

    // Comprobar cercanía a la frontera de otro CP
    const frontierInfo = checkBoundaryProximity(cocina.lat, cocina.lon, cocina.cp);
    if (frontierInfo.isFrontier && frontierInfo.closestNeighbor) {
      const neighborCp = frontierInfo.closestNeighbor;
      const nData = cpDataIndex[neighborCp];
      const nZoneName = nData ? nData.zona.split('(')[0].trim() : 'Zona limítrofe';

      highlightNeighborTenue(neighborCp);

      hudFrontierBanner.classList.add('visible');
      hudFrontierText.innerHTML = `⚠️ <b>Zona Fronteriza:</b> ${cocina.name} está a <b>${frontierInfo.distanceMeters} m</b> del límite con <b>CP ${neighborCp}</b> (${nZoneName}). <i>Zona limítrofe alumbrada en tenue.</i>`;

      showToast(`🍳 ${cocina.name} (CP ${cocina.cp}) — ¡A ${frontierInfo.distanceMeters}m de la frontera con CP ${neighborCp}!`);
    } else {
      hudFrontierBanner.classList.remove('visible');
      showToast(`🍳 ${cocina.name} seleccionada en CP ${cocina.cp} (${cocina.address})`);
    }

    // Abrir el popup del marcador
    const marker = kitchenMarkers[cocina.id];
    if (marker) {
      setTimeout(() => {
        marker.openPopup();
      }, 350);
    }

    // Actualizar input de búsqueda con el nombre de la cocina
    searchInput.value = `${cocina.name} (${cocina.address})`;
    clearSearchBtn.classList.add('visible');

    // Actualizar panel de calles solo si el usuario ya lo tenía abierto
    if (!streetsDrawer.classList.contains('collapsed')) {
      updateStreetsDrawerData(cocina.cp);
    }
  }

  // =========================================================================
  // GESTIÓN DE FLOTA Y REPARTIDORES (CONTROL Y ASIGNACIÓN)
  // =========================================================================

  const STORAGE_KEY_DRIVERS = 'madrid_delivery_drivers_v1';

  const DEFAULT_DRIVERS = [
    {
      id: 'd1',
      name: 'Carlos Mendoza',
      vehicle: 'Moto 🛵',
      status: 'disponible',
      kitchenId: 'norte',
      lat: 40.44310,
      lon: -3.62850,
      phone: '+34 612 345 678',
      currentOrder: null
    },
    {
      id: 'd2',
      name: 'Laura Sánchez',
      vehicle: 'Bici 🚴',
      status: 'disponible',
      kitchenId: 'fuencarral',
      lat: 40.48350,
      lon: -3.70200,
      phone: '+34 623 456 789',
      currentOrder: null
    },
    {
      id: 'd3',
      name: 'Miguel Ángel Ruiz',
      vehicle: 'Moto 🛵',
      status: 'en_reparto',
      kitchenId: 'alcorcon',
      lat: 40.35400,
      lon: -3.81200,
      phone: '+34 634 567 890',
      currentOrder: { cp: '28924', address: 'Plaza Príncipes de España', time: '14:15' }
    },
    {
      id: 'd4',
      name: 'Daniel Ortega',
      vehicle: 'Coche 🚗',
      status: 'en_cocina',
      kitchenId: 'norte',
      lat: 40.44490,
      lon: -3.62480,
      phone: '+34 645 678 901',
      currentOrder: null
    }
  ];

  let drivers = loadDrivers();

  function loadDrivers() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_DRIVERS);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch (e) {
      console.warn('Error loading drivers:', e);
    }
    return JSON.parse(JSON.stringify(DEFAULT_DRIVERS));
  }

  function saveDrivers() {
    try {
      localStorage.setItem(STORAGE_KEY_DRIVERS, JSON.stringify(drivers));
    } catch (e) {
      console.warn('Error saving drivers:', e);
    }
    updateDriverBadges();
  }

  function getStatusLabel(status) {
    switch (status) {
      case 'disponible': return '🟢 Libre';
      case 'en_reparto': return '🟡 En ruta';
      case 'en_cocina': return '🔵 En cocina';
      case 'inactivo': return '⚪ Inactivo';
      default: return status;
    }
  }

  function getVehicleIcon(vehicle) {
    if (!vehicle) return '🛵';
    if (vehicle.includes('Bici')) return '🚴';
    if (vehicle.includes('Coche')) return '🚗';
    if (vehicle.includes('Patinete')) return '🛴';
    return '🛵';
  }

  function updateDriverBadges() {
    const total = drivers.length;
    const disponibles = drivers.filter(d => d.status === 'disponible').length;
    const enReparto = drivers.filter(d => d.status === 'en_reparto').length;
    const enCocina = drivers.filter(d => d.status === 'en_cocina').length;

    if (navDriversCount) navDriversCount.textContent = total;
    if (driversCountBadge) driversCountBadge.textContent = total;
    if (countFilterAll) countFilterAll.textContent = total;
    if (countFilterDisponible) countFilterDisponible.textContent = disponibles;
    if (countFilterReparto) countFilterReparto.textContent = enReparto;
    if (countFilterCocina) countFilterCocina.textContent = enCocina;
  }

  function renderDriverMarkers() {
    driversLayerGroup.clearLayers();
    Object.keys(driverMarkers).forEach(k => delete driverMarkers[k]);

    drivers.forEach(driver => {
      const vehicleEmoji = getVehicleIcon(driver.vehicle);
      const firstName = driver.name.split(' ')[0];

      const markerHtml = `
        <div class="driver-marker-container">
          <div class="driver-marker-pin status-${driver.status}" title="${driver.name} (${driver.vehicle}) • ${getStatusLabel(driver.status)}">
            <span>${vehicleEmoji}</span>
          </div>
          <div class="driver-marker-label">${firstName}</div>
        </div>
      `;

      const customIcon = L.divIcon({
        className: 'driver-custom-marker',
        html: markerHtml,
        iconSize: [36, 48],
        iconAnchor: [18, 40],
        popupAnchor: [0, -38]
      });

      const marker = L.marker([driver.lat, driver.lon], {
        icon: customIcon,
        draggable: true,
        title: `${driver.name} (${driver.vehicle}) - Arrastra para mover`
      });

      marker.on('dragend', (e) => {
        const newLatLng = e.target.getLatLng();
        driver.lat = newLatLng.lat;
        driver.lon = newLatLng.lng;
        saveDrivers();

        const insideCp = findCpContainingPoint(driver.lat, driver.lon);
        const cpInfo = insideCp ? ` (en CP ${insideCp})` : '';

        showToast(`📍 Posición de ${driver.name} actualizada${cpInfo}`);

        const active = lockedCp || hoveredCp;
        if (active) {
          const center = getCpCenter(active);
          if (center) {
            updateOptimalDriverDisplay(center[0], center[1], active);
          }
        }
        renderDriversDrawer(currentDriverFilter);
      });

      marker.bindPopup(() => {
        const baseKitchen = COCINAS.find(c => c.id === driver.kitchenId);
        const baseName = baseKitchen ? baseKitchen.name : 'Central';
        const orderInfo = driver.currentOrder
          ? `<div style="margin-top:6px; padding:5px 8px; background:rgba(245,158,11,0.2); border:1px solid rgba(245,158,11,0.4); border-radius:6px; font-size:11px; color:#facc15;">
               📦 <b>Pedido en curso:</b> CP ${driver.currentOrder.cp} (${driver.currentOrder.address || 'Entrega'})
             </div>`
          : '';

        return `
          <div style="min-width: 210px; color:#fff; font-family: 'Inter', sans-serif;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; gap:8px;">
              <b style="font-size:14px;">${driver.name}</b>
              <span class="driver-status-pill status-${driver.status}">${getStatusLabel(driver.status)}</span>
            </div>
            <div style="font-size:12px; color:#cbd5e1; line-height:1.6;">
              <div>🛵 <b>Vehículo:</b> ${driver.vehicle}</div>
              <div>🍳 <b>Base:</b> ${baseName}</div>
              ${driver.phone ? `<div>📞 <b>Teléfono:</b> <a href="tel:${driver.phone}" style="color:#38bdf8; text-decoration:none;">${driver.phone}</a></div>` : ''}
              ${orderInfo}
            </div>
            <div style="margin-top:10px; display:flex; gap:6px;">
              <button onclick="window.cycleDriverStatus('${driver.id}')" style="flex:1; background:#22c55e; color:#052e16; border:none; padding:6px 10px; border-radius:5px; font-size:11px; font-weight:700; cursor:pointer;">
                🔄 Cambiar Estado
              </button>
            </div>
          </div>
        `;
      }, {
        className: 'glass-popup',
        closeButton: true
      });

      marker.addTo(driversLayerGroup);
      driverMarkers[driver.id] = marker;
    });
  }

  window.cycleDriverStatus = function(driverId) {
    const driver = drivers.find(d => d.id === driverId);
    if (!driver) return;

    if (driver.status === 'disponible') {
      driver.status = 'en_reparto';
    } else if (driver.status === 'en_reparto') {
      driver.status = 'en_cocina';
      driver.currentOrder = null;
    } else if (driver.status === 'en_cocina') {
      driver.status = 'disponible';
      driver.currentOrder = null;
    } else {
      driver.status = 'disponible';
    }

    saveDrivers();
    renderDriverMarkers();
    renderDriversDrawer(currentDriverFilter);

    const active = lockedCp || hoveredCp;
    if (active) {
      const center = getCpCenter(active);
      if (center) {
        updateOptimalDriverDisplay(center[0], center[1], active);
      }
    }

    showToast(`Estado de ${driver.name}: ${getStatusLabel(driver.status)}`);
  };

  function calculateDriverDistances(targetLat, targetLon) {
    const targetPoint = L.latLng(targetLat, targetLon);

    return drivers.map(driver => {
      const driverPoint = L.latLng(driver.lat, driver.lon);
      const meters = targetPoint.distanceTo(driverPoint);
      const km = meters / 1000;

      let penalty = 1.0;
      if (driver.status === 'en_cocina') penalty = 1.2;
      else if (driver.status === 'en_reparto') penalty = 2.5;
      else if (driver.status === 'inactivo') penalty = 10.0;

      const score = meters * penalty;

      return {
        ...driver,
        meters: Math.round(meters),
        kmText: km < 1 ? `${Math.round(meters)} m` : `${km.toFixed(1)} km`,
        score
      };
    }).sort((a, b) => a.score - b.score);
  }

  function getOptimalDriver(targetLat, targetLon) {
    const ranked = calculateDriverDistances(targetLat, targetLon);
    return ranked.length > 0 ? ranked[0] : null;
  }

  function updateOptimalDriverDisplay(lat, lon, cp) {
    if (!hudDriverCard) return null;

    const optimal = getOptimalDriver(lat, lon);
    currentOptimalDriver = optimal;

    if (!optimal) {
      hudDriverCard.style.display = 'none';
      return null;
    }

    hudDriverCard.style.display = 'flex';
    if (hudDriverName) hudDriverName.textContent = optimal.name;
    if (hudDriverDist) hudDriverDist.textContent = optimal.kmText;

    if (hudDriverStatusBadge) {
      hudDriverStatusBadge.className = `driver-status-pill status-${optimal.status}`;
      hudDriverStatusBadge.textContent = getStatusLabel(optimal.status);
    }

    if (hudDriverInfo) {
      const baseKitchen = COCINAS.find(c => c.id === optimal.kitchenId);
      const baseName = baseKitchen ? baseKitchen.name : 'Central';
      hudDriverInfo.textContent = `${optimal.vehicle} • Base: ${baseName}`;
    }

    if (hudAssignDriverBtn) {
      if (optimal.status === 'en_reparto') {
        hudAssignDriverBtn.innerHTML = '<span>⚠️ En Reparto (Reasignar)</span>';
      } else {
        hudAssignDriverBtn.innerHTML = '<span>✅ Asignar Pedido</span>';
      }
      hudAssignDriverBtn.onclick = (e) => {
        e.stopPropagation();
        assignDriverToOrder(optimal.id, cp);
      };
    }

    if (hudLocateDriverBtn) {
      hudLocateDriverBtn.onclick = (e) => {
        e.stopPropagation();
        locateDriver(optimal.id);
      };
    }

    return optimal;
  }

  function assignDriverToOrder(driverId, cp) {
    const driver = drivers.find(d => d.id === driverId);
    if (!driver) return;

    const data = cpDataIndex[cp];
    const zoneName = data ? data.zona.split('(')[0].trim() : `CP ${cp}`;

    driver.status = 'en_reparto';
    driver.currentOrder = {
      cp: cp,
      address: zoneName,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    saveDrivers();
    renderDriverMarkers();
    renderDriversDrawer(currentDriverFilter);

    const center = getCpCenter(cp);
    if (center) {
      updateOptimalDriverDisplay(center[0], center[1], cp);
    }

    showToast(`🛵 ¡Pedido en CP ${cp} asignado a ${driver.name}!`);
  }

  function locateDriver(driverId) {
    const driver = drivers.find(d => d.id === driverId);
    if (!driver) return;

    map.flyTo([driver.lat, driver.lon], 16, { duration: 0.8 });

    setTimeout(() => {
      if (driverMarkers[driver.id]) {
        driverMarkers[driver.id].openPopup();
      }
    }, 850);
  }

  function renderDriversDrawer(filter = 'all') {
    currentDriverFilter = filter;
    if (!driversList) return;

    updateDriverBadges();

    document.querySelectorAll('.driver-filter-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.filter === filter);
    });

    const filtered = drivers.filter(d => {
      if (filter === 'all') return true;
      return d.status === filter;
    });

    if (filtered.length === 0) {
      driversList.innerHTML = `
        <div style="padding: 24px; text-align: center; color: var(--text-muted); font-size: 13px;">
          No hay repartidores con estado "${getStatusLabel(filter)}"
        </div>
      `;
      return;
    }

    driversList.innerHTML = filtered.map(driver => {
      const baseKitchen = COCINAS.find(c => c.id === driver.kitchenId);
      const baseName = baseKitchen ? baseKitchen.name : 'Central';
      const orderHtml = driver.currentOrder
        ? `<div style="background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.3); padding: 5px 8px; border-radius: 6px; font-size: 11px; color: #facc15; margin-top: 4px;">
             📦 <b>En ruta:</b> CP ${driver.currentOrder.cp} (${driver.currentOrder.address}) • ${driver.currentOrder.time}
           </div>`
        : '';

      return `
        <div class="driver-card" data-driver-id="${driver.id}">
          <div class="driver-card-top">
            <div class="driver-name-title">
              <span>${getVehicleIcon(driver.vehicle)}</span>
              <span>${driver.name}</span>
            </div>
            <span class="driver-status-pill status-${driver.status}">
              ${getStatusLabel(driver.status)}
            </span>
          </div>

          <div class="driver-card-meta">
            <div>🛵 <b>Vehículo:</b> ${driver.vehicle}</div>
            <div>🍳 <b>Base:</b> ${baseName}</div>
            ${driver.phone ? `<div>📞 <b>Teléfono:</b> <a href="tel:${driver.phone}" style="color: #38bdf8; text-decoration:none;">${driver.phone}</a></div>` : ''}
            ${orderHtml}
          </div>

          <div class="driver-card-actions">
            <button class="driver-cycle-status-btn" onclick="window.cycleDriverStatus('${driver.id}')" title="Cambiar disponibilidad">
              🔄 Cambiar Estado
            </button>
            <div style="display:flex; align-items:center; gap:8px;">
              <button class="driver-locate-btn" onclick="window.locateDriverFromList('${driver.id}')" title="Ver en el mapa">
                📍 Localizar
              </button>
              ${driver.isCustom ? `
                <button onclick="window.deleteDriver('${driver.id}')" style="background:transparent; border:none; color:#ef4444; font-size:13px; cursor:pointer;" title="Eliminar de la flota">
                  🗑️
                </button>
              ` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  window.locateDriverFromList = function(driverId) {
    locateDriver(driverId);
  };

  window.deleteDriver = function(driverId) {
    drivers = drivers.filter(d => d.id !== driverId);
    saveDrivers();
    renderDriverMarkers();
    renderDriversDrawer(currentDriverFilter);
    showToast('Repartidor retirado de la flota');
  };

  // =========================================================================
  // GESTIÓN DEL PANEL DE DIRECCIONES Y CÓDIGOS POSTALES VECINOS
  // =========================================================================

  function updateStreetsDrawerData(cp) {
    const data = cpDataIndex[cp];
    if (!data) return;

    streetsDrawerTitle.textContent = `CP ${cp} • ${data.zona.split('(')[0].trim()}`;

    // 1. Cargar calles de este CP
    const streets = (window.MADRID_STREETS && window.MADRID_STREETS[cp]) || [
      `Avenida principal de ${data.municipio}`,
      `Plaza Mayor / Centro urbano`,
      `Paseo de la zona`,
      `Calle de la Iglesia`
    ];

    tabStreetsCount.textContent = streets.length;
    renderStreetsList(streets, cp);

    // 2. Cargar CPs vecinos
    const neighbors = cpNeighbors[cp] || [];
    tabNeighborsCount.textContent = neighbors.length;
    renderNeighborsList(neighbors, cp);

    // 3. Cargar ranking de las 3 cocinas
    const center = getCpCenter(cp);
    if (center) {
      const rankings = calculateKitchenRankings(center[0], center[1]);
      renderKitchensRankingDrawer(rankings, cp);
    }
  }

  function openStreetsDrawer(cp) {
    const active = cp || lockedCp || hoveredCp || '28001';
    updateStreetsDrawerData(active);
    streetsDrawer.classList.remove('collapsed');
    if (toggleStreetsNavBtn) toggleStreetsNavBtn.classList.add('active');
    activateTab('streets');
  }

  function closeStreetsDrawer() {
    streetsDrawer.classList.add('collapsed');
    if (toggleStreetsNavBtn) toggleStreetsNavBtn.classList.remove('active');
  }

  function toggleStreetsDrawer(cp) {
    if (streetsDrawer.classList.contains('collapsed')) {
      openStreetsDrawer(cp);
    } else {
      closeStreetsDrawer();
    }
  }

  function renderStreetsList(streets, cp) {
    streetsList.innerHTML = '';
    streetsFilterInput.value = '';

    streets.forEach(street => {
      const item = document.createElement('div');
      item.className = 'street-item';
      item.innerHTML = `
        <span>${street}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
          <circle cx="11" cy="11" r="8"></circle>
          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
        </svg>
      `;

      item.addEventListener('click', () => {
        // Al hacer clic en una calle, geocodificar o centrar con marcador
        geocodeAndFocusAddress(`${street}, Madrid, España`, cp);
      });

      streetsList.appendChild(item);
    });
  }

  streetsFilterInput.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase().trim();
    document.querySelectorAll('#streets-list .street-item').forEach(el => {
      const text = el.textContent.toLowerCase();
      el.style.display = text.includes(q) ? 'flex' : 'none';
    });
  });

  function renderNeighborsList(neighbors, currentCp) {
    neighborsList.innerHTML = '';

    if (neighbors.length === 0) {
      neighborsList.innerHTML = `<div style="padding:15px; font-size:12px; color:#94a3b8; text-align:center;">No se detectaron zonas limítrofes directas.</div>`;
      return;
    }

    neighbors.forEach(nCp => {
      const nData = cpDataIndex[nCp];
      if (!nData) return;

      const nStreets = (window.MADRID_STREETS && window.MADRID_STREETS[nCp]) || [];
      const sampleStreets = nStreets.slice(0, 3).join(', ') || nData.zona;

      const card = document.createElement('div');
      card.className = 'neighbor-card';
      card.innerHTML = `
        <div class="neighbor-card-header">
          <span class="neighbor-cp-badge">CP ${nCp}</span>
          <span class="neighbor-tag">Limítrofe</span>
        </div>
        <div class="neighbor-card-name">${nData.zona}</div>
        <div class="neighbor-streets-sample">🛣️ ${sampleStreets}</div>
      `;

      // Al pasar el ratón por la tarjeta del vecino, alumbrar tenuemente en el mapa
      card.addEventListener('mouseenter', () => {
        highlightNeighborTenue(nCp);
      });

      card.addEventListener('mouseleave', () => {
        clearTenueHighlights();
      });

      // Al hacer clic, cambiar a ese CP
      card.addEventListener('click', () => {
        selectAndFocusCp(nCp, true);
      });

      neighborsList.appendChild(card);
    });
  }

  function activateTab(tabName) {
    tabStreetsBtn.classList.toggle('active', tabName === 'streets');
    tabNeighborsBtn.classList.toggle('active', tabName === 'neighbors');
    if (tabCocinasBtn) tabCocinasBtn.classList.toggle('active', tabName === 'cocinas');

    tabStreetsContent.classList.toggle('active', tabName === 'streets');
    tabNeighborsContent.classList.toggle('active', tabName === 'neighbors');
    if (tabCocinasContent) tabCocinasContent.classList.toggle('active', tabName === 'cocinas');
  }

  tabStreetsBtn.addEventListener('click', () => activateTab('streets'));
  tabNeighborsBtn.addEventListener('click', () => activateTab('neighbors'));
  if (tabCocinasBtn) tabCocinasBtn.addEventListener('click', () => activateTab('cocinas'));
  closeStreetsBtn.addEventListener('click', () => streetsDrawer.classList.add('collapsed'));
  openStreetsBtn.addEventListener('click', () => {
    const active = lockedCp || hoveredCp;
    if (active) openStreetsDrawer(active);
    else showToast('Selecciona o posa el ratón sobre un código postal para ver sus calles.');
  });

  if (hudShowStreetsBtn) {
    hudShowStreetsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const active = lockedCp || hoveredCp;
      if (active) {
        toggleStreetsDrawer(active);
      } else {
        showToast('Selecciona o posa el ratón sobre un código postal para ver sus direcciones.');
      }
    });
  }

  // =========================================================================
  // BÚSQUEDA AVANZADA: CÓDIGO POSTAL + CALLES + DIRECCIÓN EXACTA
  // =========================================================================

  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    clearSearchBtn.classList.toggle('visible', query.length > 0);

    if (!query) {
      searchDropdown.classList.remove('open');
      searchDropdown.innerHTML = '';
      return;
    }

    if (activeSearchDebounce) clearTimeout(activeSearchDebounce);

    // Si comienza con dígitos, buscar inmediatamente en códigos postales
    if (/^\d+/.test(query)) {
      renderCpSearchResults(query);
    } else {
      // Buscar en calles locales y luego geocodificar en Nominatim
      renderAddressSearchResults(query);
    }
  });

  function getKitchenMatches(query) {
    const q = query.toLowerCase().trim();
    if (!q) return [];
    return COCINAS.filter(c => {
      return c.name.toLowerCase().includes(q) ||
             c.address.toLowerCase().includes(q) ||
             c.cp.includes(q) ||
             c.zona.toLowerCase().includes(q) ||
             c.municipio.toLowerCase().includes(q) ||
             'cocinas'.includes(q) ||
             q.includes('cocina') ||
             (q.includes('norte') && c.id === 'norte') ||
             (q.includes('fuencarral') && c.id === 'fuencarral') ||
             (q.includes('alcorcon') && c.id === 'alcorcon') ||
             (q.includes('sangenjo') && c.id === 'fuencarral') ||
             (q.includes('septiembre') && c.id === 'norte') ||
             (q.includes('setiembre') && c.id === 'norte') ||
             (q.includes('principes') && c.id === 'alcorcon');
    });
  }

  function formatKitchenSearchResults(kitchens) {
    if (!kitchens || kitchens.length === 0) return '';
    return `
      <div class="search-section-title" style="color:#f59e0b; display:flex; align-items:center; gap:6px;">
        <span>🍳</span> Nuestras Cocinas (${kitchens.length})
      </div>
      ${kitchens.map(k => `
        <div class="search-item" data-type="cocina" data-kitchen-id="${k.id}" style="border-left: 3px solid #f59e0b; background: rgba(245, 158, 11, 0.08);">
          <span class="search-item-cp">🍳 ${k.name}</span>
          <span class="search-item-info">${k.address} • CP ${k.cp}</span>
        </div>
      `).join('')}
    `;
  }

  function getDriverMatches(query) {
    const q = query.toLowerCase().trim();
    if (!q) return [];
    return drivers.filter(d => {
      return d.name.toLowerCase().includes(q) ||
             d.vehicle.toLowerCase().includes(q) ||
             d.status.toLowerCase().includes(q) ||
             'repartidores'.includes(q) ||
             q.includes('repartidor') ||
             q.includes('moto') ||
             q.includes('bici') ||
             q.includes('flota') ||
             (d.phone && d.phone.includes(q));
    });
  }

  function formatDriverSearchResults(driverMatches) {
    if (!driverMatches || driverMatches.length === 0) return '';
    return `
      <div class="search-section-title" style="color:#4ade80; display:flex; align-items:center; gap:6px;">
        <span>🛵</span> Repartidores (${driverMatches.length})
      </div>
      ${driverMatches.map(d => `
        <div class="search-item" data-type="driver" data-driver-id="${d.id}" style="border-left: 3px solid #22c55e; background: rgba(34, 197, 94, 0.08);">
          <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
            <span class="search-item-cp">🛵 ${d.name} (${d.vehicle})</span>
            <span class="driver-status-pill status-${d.status}">${getStatusLabel(d.status)}</span>
          </div>
        </div>
      `).join('')}
    `;
  }

  function renderCpSearchResults(query) {
    const kitchenMatches = getKitchenMatches(query);
    const driverMatches = getDriverMatches(query);

    const matches = Object.values(cpDataIndex).filter(item => {
      return item.cp.toLowerCase().includes(query.toLowerCase()) ||
             item.zona.toLowerCase().includes(query.toLowerCase());
    }).slice(0, 6);

    if (matches.length === 0 && kitchenMatches.length === 0 && driverMatches.length === 0) {
      searchDropdown.innerHTML = `<div style="padding: 10px; font-size: 12px; color: #94a3b8; text-align: center;">Sin resultados para "${query}"</div>`;
      searchDropdown.classList.add('open');
      return;
    }

    let html = '';
    if (kitchenMatches.length > 0) {
      html += formatKitchenSearchResults(kitchenMatches);
    }

    if (driverMatches.length > 0) {
      html += formatDriverSearchResults(driverMatches);
    }

    if (matches.length > 0) {
      html += `
        <div class="search-section-title">Códigos Postales (con Cocina Óptima)</div>
        ${matches.map(item => {
          const center = getCpCenter(item.cp);
          let kitchenText = '';
          if (center) {
            const rankings = calculateKitchenRankings(center[0], center[1]);
            const opt = rankings[0];
            kitchenText = `
              <div style="font-size:11px; color:#facc15; font-weight:600; display:flex; align-items:center; gap:5px; margin-top:2px;">
                <span>🍳</span> Cocina más cercana: <b>${opt.name}</b> (${opt.kmText})
              </div>
            `;
          }
          return `
            <div class="search-item" data-type="cp" data-cp="${item.cp}">
              <div style="display:flex; flex-direction:column; width:100%; gap:2px;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                  <span class="search-item-cp">📮 CP ${item.cp}</span>
                  <span class="search-item-info">${item.zona.split('(')[0].trim() || item.municipio}</span>
                </div>
                ${kitchenText}
              </div>
            </div>
          `;
        }).join('')}
      `;
    }

    searchDropdown.innerHTML = html;
    searchDropdown.classList.add('open');
  }

  function renderAddressSearchResults(query) {
    const kitchenMatches = getKitchenMatches(query);
    const driverMatches = getDriverMatches(query);

    // 1. Coincidencias rápidas en la base de datos de calles de Madrid
    const localStreetMatches = [];
    if (window.MADRID_STREETS) {
      for (const cp in window.MADRID_STREETS) {
        const streets = window.MADRID_STREETS[cp];
        streets.forEach(st => {
          if (st.toLowerCase().includes(query.toLowerCase()) && localStreetMatches.length < 5) {
            localStreetMatches.push({
              name: st,
              cp: cp,
              zona: cpDataIndex[cp] ? cpDataIndex[cp].zona.split('(')[0].trim() : 'Madrid'
            });
          }
        });
      }
    }

    let html = '';
    if (kitchenMatches.length > 0) {
      html += formatKitchenSearchResults(kitchenMatches);
    }

    if (driverMatches.length > 0) {
      html += formatDriverSearchResults(driverMatches);
    }

    if (localStreetMatches.length > 0) {
      html += `<div class="search-section-title">Calles en Códigos Postales</div>`;
      html += localStreetMatches.map(m => `
        <div class="search-item" data-type="local-street" data-street="${m.name}" data-cp="${m.cp}">
          <span class="search-item-cp">🛣️ ${m.name}</span>
          <span class="search-item-info">CP ${m.cp} (${m.zona})</span>
        </div>
      `).join('');
    }

    searchDropdown.innerHTML = html || `<div style="padding: 10px; font-size: 12px; color: #94a3b8; text-align: center;">Buscando dirección...</div>`;
    searchDropdown.classList.add('open');

    // 2. Geocodificación online en Nominatim (con debounce de 350ms)
    activeSearchDebounce = setTimeout(() => {
      fetchOnlineAddress(query, localStreetMatches, kitchenMatches);
    }, 350);
  }

  function fetchOnlineAddress(query, existingMatches, kitchenMatches) {
    const encoded = encodeURIComponent(`${query}, Madrid, España`);
    // Delimitar vista a la Comunidad de Madrid
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encoded}&addressdetails=1&limit=4&viewbox=-4.2,40.8,-3.2,40.0&bounded=1`;

    fetch(url, { headers: { 'Accept': 'application/json' } })
      .then(res => res.json())
      .then(data => {
        let itemsHtml = '';

        if (kitchenMatches && kitchenMatches.length > 0) {
          itemsHtml += formatKitchenSearchResults(kitchenMatches);
        }

        if (existingMatches && existingMatches.length > 0) {
          itemsHtml += `<div class="search-section-title">Calles en Códigos Postales</div>`;
          itemsHtml += existingMatches.map(m => `
            <div class="search-item" data-type="local-street" data-street="${m.name}" data-cp="${m.cp}">
              <span class="search-item-cp">🛣️ ${m.name}</span>
              <span class="search-item-info">CP ${m.cp} (${m.zona})</span>
            </div>
          `).join('');
        }

        if (data && data.length > 0) {
          itemsHtml += `<div class="search-section-title">Direcciones Exactas Encontradas</div>`;
          itemsHtml += data.map(item => {
            const road = item.address.road || item.name || query;
            const num = item.address.house_number ? `, ${item.address.house_number}` : '';
            const pc = item.address.postcode || '';
            const district = item.address.city_district || item.address.suburb || item.address.city || 'Madrid';

            return `
              <div class="search-item" data-type="online-address" data-lat="${item.lat}" data-lon="${item.lon}" data-title="${road}${num}" data-postcode="${pc}">
                <span class="search-item-cp">📍 ${road}${num}</span>
                <span class="search-item-info">${pc ? 'CP ' + pc : ''} ${district}</span>
              </div>
            `;
          }).join('');
        }

        if (!itemsHtml) {
          itemsHtml = `<div style="padding: 10px; font-size: 12px; color: #94a3b8; text-align: center;">No se encontraron direcciones para "${query}"</div>`;
        }

        searchDropdown.innerHTML = itemsHtml;
      })
      .catch(() => {
        // Si falla la red, mantener los resultados locales
      });
  }

  searchDropdown.addEventListener('click', (e) => {
    const item = e.target.closest('.search-item');
    if (!item) return;

    const type = item.dataset.type;

    if (type === 'cocina') {
      const kid = item.dataset.kitchenId;
      selectCocina(kid);
    } else if (type === 'driver') {
      const did = item.dataset.driverId;
      locateDriver(did);
      if (driversDrawer) {
        driversDrawer.classList.remove('collapsed');
        renderDriversDrawer('all');
      }
    } else if (type === 'cp') {
      const cp = item.dataset.cp;
      selectAndFocusCp(cp, true);
      searchInput.value = cp;
    } else if (type === 'local-street') {
      const street = item.dataset.street;
      const cp = item.dataset.cp;
      selectAndFocusCp(cp, true);
      searchInput.value = street;
      geocodeAndFocusAddress(`${street}, Madrid, España`, cp);
    } else if (type === 'online-address') {
      const lat = parseFloat(item.dataset.lat);
      const lon = parseFloat(item.dataset.lon);
      const title = item.dataset.title;
      let pc = item.dataset.postcode;

      handleAddressFound(lat, lon, title, pc);
      searchInput.value = title;
    }

    searchDropdown.classList.remove('open');
    clearSearchBtn.classList.add('visible');
  });

  // Geocodificar una calle local y centrar
  function geocodeAndFocusAddress(addressQuery, targetCp) {
    const encoded = encodeURIComponent(addressQuery);
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encoded}&addressdetails=1&limit=1&viewbox=-4.2,40.8,-3.2,40.0&bounded=1`;

    fetch(url)
      .then(r => r.json())
      .then(res => {
        if (res && res.length > 0) {
          const lat = parseFloat(res[0].lat);
          const lon = parseFloat(res[0].lon);
          const pc = res[0].address.postcode || targetCp;
          handleAddressFound(lat, lon, addressQuery.split(',')[0], pc);
        } else {
          // Si no geocodifica, enfocar el código postal directamente
          selectAndFocusCp(targetCp, true);
        }
      })
      .catch(() => {
        selectAndFocusCp(targetCp, true);
      });
  }

  // Manejar dirección encontrada: colocar marcador, detectar frontera y alumbrar tenue
  function handleAddressFound(lat, lon, title, givenPostcode) {
    // 1. Determinar el código postal que contiene el punto
    let matchedCp = findCpContainingPoint(lat, lon);
    if (!matchedCp && givenPostcode && cpDataIndex[givenPostcode]) {
      matchedCp = givenPostcode;
    }

    if (!matchedCp) {
      matchedCp = '28001'; // Fallback
    }

    // 2. Seleccionar y resaltar el código postal principal
    selectAndFocusCp(matchedCp, false);

    // Calcular cocina optima desde el punto exacto de la dirección
    const optimal = updateOptimalKitchenDisplay(lat, lon, matchedCp, true);
    updateOptimalDriverDisplay(lat, lon, matchedCp);

    // 3. Comprobar proximidad a la frontera de otro código postal
    const frontierInfo = checkBoundaryProximity(lat, lon, matchedCp);

    // 4. Colocar el marcador en el mapa
    placeAddressMarker(lat, lon, title, matchedCp, frontierInfo, optimal);

    // 5. Centrar el mapa con zoom de calle
    map.flyTo([lat, lon], 16, { duration: 0.9 });

    // 6. Si está cerca o en la frontera con otro CP: ¡Alumbrar con algo tenue la zona frontera!
    if (frontierInfo.isFrontier && frontierInfo.closestNeighbor) {
      const neighborCp = frontierInfo.closestNeighbor;
      const nData = cpDataIndex[neighborCp];
      const nZoneName = nData ? nData.zona.split('(')[0].trim() : 'Zona limítrofe';

      highlightNeighborTenue(neighborCp);

      // Mostrar alerta en el HUD
      hudFrontierBanner.classList.add('visible');
      hudFrontierText.innerHTML = `⚠️ <b>Zona Fronteriza:</b> Esta dirección está a <b>${frontierInfo.distanceMeters} m</b> del límite con <b>CP ${neighborCp}</b> (${nZoneName}). <i>Zona limítrofe alumbrada en tenue.</i>`;

      showToast(`📍 Dirección en CP ${matchedCp}. ¡A ${frontierInfo.distanceMeters}m de la frontera con CP ${neighborCp}!`);
    } else {
      hudFrontierBanner.classList.remove('visible');
      showToast(`📍 Dirección ubicada en CP ${matchedCp} (${cpDataIndex[matchedCp] ? cpDataIndex[matchedCp].zona.split('(')[0] : 'Madrid'})`);
    }

    if (!streetsDrawer.classList.contains('collapsed')) {
      updateStreetsDrawerData(matchedCp);
    }
  }

  clearSearchBtn.addEventListener('click', () => {
    searchInput.value = '';
    searchDropdown.classList.remove('open');
    clearSearchBtn.classList.remove('visible');
    if (activeAddressMarker) {
      map.removeLayer(activeAddressMarker);
      activeAddressMarker = null;
    }
    clearOptimalRouteLine();
    clearTenueHighlights();
    searchInput.focus();
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-container')) {
      searchDropdown.classList.remove('open');
    }
  });

  // --- Selector de Alcance (Capital vs Comunidad) ---
  function setScope(scope) {
    if (currentScope === scope) return;
    currentScope = scope;

    scopeCapitalBtn.classList.toggle('active', scope === 'capital');
    scopeComunidadBtn.classList.toggle('active', scope === 'comunidad');

    lockedCp = null;
    hoveredCp = null;
    clearOptimalRouteLine();
    streetsDrawer.classList.add('collapsed');
    if (activeAddressMarker) {
      map.removeLayer(activeAddressMarker);
      activeAddressMarker = null;
    }
    renderCurrentScope();
  }

  scopeCapitalBtn.addEventListener('click', () => setScope('capital'));
  scopeComunidadBtn.addEventListener('click', () => setScope('comunidad'));

  // --- Directorio Lateral (Sidebar Drawer) ---
  function populateSidebar(filterText = '') {
    sidebarList.innerHTML = '';
    const cps = Object.keys(cpDataIndex).sort();

    const filtered = cps.filter(cp => {
      if (!filterText) return true;
      const data = cpDataIndex[cp];
      return cp.includes(filterText) ||
             data.zona.toLowerCase().includes(filterText.toLowerCase()) ||
             data.municipio.toLowerCase().includes(filterText.toLowerCase());
    });

    sidebarCountBadge.textContent = filtered.length;

    filtered.forEach(cp => {
      const data = cpDataIndex[cp];
      const div = document.createElement('div');
      div.className = 'sidebar-item';
      div.id = `sidebar-item-${cp}`;
      div.dataset.cp = cp;
      div.innerHTML = `
        <span class="sidebar-item-cp" style="color: ${getCpColor(cp)}">${cp}</span>
        <div class="sidebar-item-text">
          <span class="sidebar-item-zona">${data.zona.split('(')[0].trim() || data.municipio}</span>
          <span class="sidebar-item-mun">${data.municipio}</span>
        </div>
      `;

      div.addEventListener('mouseenter', () => {
        if (!lockedCp) onPolygonMouseOver(cp, { originalEvent: { pageX: 0, pageY: 0 } });
      });

      div.addEventListener('mouseleave', () => {
        if (!lockedCp) onPolygonMouseOut(cp, {});
      });

      div.addEventListener('click', () => {
        selectAndFocusCp(cp, true);
      });

      sidebarList.appendChild(div);
    });
  }

  function syncSidebarSelection(cp) {
    const prev = sidebarList.querySelector('.sidebar-item.active');
    if (prev) prev.classList.remove('active');

    if (cp) {
      const curr = document.getElementById(`sidebar-item-${cp}`);
      if (curr) {
        curr.classList.add('active');
        curr.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }

  sidebarFilterInput.addEventListener('input', (e) => {
    populateSidebar(e.target.value.trim());
  });

  // =========================================================================
  // CONTROL DE APERTURA Y CIERRE DE VENTANAS (HUD, DIRECTORIO Y CALLES)
  // =========================================================================

  // 1. Ventana HUD de Código Postal en Grande
  function closeHud() {
    giantHud.classList.add('collapsed');
    reopenHudBtn.classList.add('visible');
    if (toggleHudBtn) toggleHudBtn.classList.remove('active');
  }

  function openHud() {
    giantHud.classList.remove('collapsed');
    reopenHudBtn.classList.remove('visible');
    if (toggleHudBtn) toggleHudBtn.classList.add('active');
  }

  function toggleHud() {
    if (giantHud.classList.contains('collapsed')) {
      openHud();
    } else {
      closeHud();
    }
  }

  if (closeHudBtn) {
    closeHudBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeHud();
    });
  }

  if (reopenHudBtn) {
    reopenHudBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openHud();
    });
  }

  if (toggleHudBtn) {
    toggleHudBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleHud();
    });
  }

  // 2. Ventana / Directorio de Todos los Códigos Postales
  function closeSidebar() {
    sidebarDrawer.classList.add('collapsed');
    if (toggleSidebarBtn) toggleSidebarBtn.classList.remove('active');
  }

  function openSidebar() {
    sidebarDrawer.classList.remove('collapsed');
    if (toggleSidebarBtn) toggleSidebarBtn.classList.add('active');
  }

  function toggleSidebar() {
    if (sidebarDrawer.classList.contains('collapsed')) {
      openSidebar();
    } else {
      closeSidebar();
    }
  }

  toggleSidebarBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleSidebar();
  });

  if (closeSidebarBtn) {
    closeSidebarBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeSidebar();
    });
  }

  // 3. Ventana de Calles y CPs Vecinos
  function closeStreetsDrawer() {
    streetsDrawer.classList.add('collapsed');
    if (toggleStreetsNavBtn) toggleStreetsNavBtn.classList.remove('active');
  }

  closeStreetsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeStreetsDrawer();
  });

  if (toggleStreetsNavBtn) {
    toggleStreetsNavBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (streetsDrawer.classList.contains('collapsed')) {
        const active = lockedCp || hoveredCp || '28001';
        openStreetsDrawer(active);
        toggleStreetsNavBtn.classList.add('active');
      } else {
        closeStreetsDrawer();
      }
    });
  }

  // 4. Menú Desplegable de Nuestras Cocinas (Acceso Directo)
  if (toggleCocinasBtn && cocinasDropdown) {
    toggleCocinasBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      cocinasDropdown.classList.toggle('open');
    });

    document.querySelectorAll('.cocina-option-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const cid = btn.dataset.id;
        selectCocina(cid);
        cocinasDropdown.classList.remove('open');
      });
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('#toggle-cocinas-btn') && !e.target.closest('#cocinas-dropdown')) {
        cocinasDropdown.classList.remove('open');
      }
    });
  }

  // 5. Panel de Flota de Repartidores
  if (toggleDriversBtn && driversDrawer) {
    toggleDriversBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      driversDrawer.classList.toggle('collapsed');
      if (!driversDrawer.classList.contains('collapsed')) {
        renderDriversDrawer(currentDriverFilter);
      }
    });
  }

  if (closeDriversBtn && driversDrawer) {
    closeDriversBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      driversDrawer.classList.add('collapsed');
    });
  }

  // Filtros de estado de repartidores
  document.querySelectorAll('.driver-filter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const filter = btn.dataset.filter;
      renderDriversDrawer(filter);
    });
  });

  // Formulario para añadir repartidores
  if (toggleAddDriverForm && addDriverForm) {
    toggleAddDriverForm.addEventListener('click', (e) => {
      e.stopPropagation();
      const isHidden = addDriverForm.style.display === 'none';
      addDriverForm.style.display = isHidden ? 'flex' : 'none';
      toggleAddDriverForm.querySelector('b').textContent = isHidden ? 'Cerrar Formulario' : 'Añadir Nuevo Repartidor';
    });

    addDriverForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = driverInputName.value.trim();
      if (!name) return;

      const vehicle = driverInputVehicle.value;
      const kitchenId = driverInputKitchen.value;
      const phone = driverInputPhone ? driverInputPhone.value.trim() : '';

      const base = COCINAS.find(c => c.id === kitchenId) || COCINAS[0];
      const jitterLat = (Math.random() - 0.5) * 0.008;
      const jitterLon = (Math.random() - 0.5) * 0.008;

      const newDriver = {
        id: 'd_' + Date.now(),
        name: name,
        vehicle: vehicle,
        status: 'disponible',
        kitchenId: kitchenId,
        lat: base.lat + jitterLat,
        lon: base.lon + jitterLon,
        phone: phone,
        currentOrder: null,
        isCustom: true
      };

      drivers.push(newDriver);
      saveDrivers();
      renderDriverMarkers();
      renderDriversDrawer(currentDriverFilter);

      addDriverForm.reset();
      addDriverForm.style.display = 'none';
      toggleAddDriverForm.querySelector('b').textContent = 'Añadir Nuevo Repartidor';

      showToast(`✅ ${name} añadido a la flota con éxito`);
      locateDriver(newDriver.id);
    });
  }

  // --- Selector de Capa Base (Dark / Light / OSM / Satélite) ---
  layerPickerBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    layerPickerModal.classList.toggle('open');
  });

  document.querySelectorAll('.layer-option-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const layerKey = btn.dataset.layer;
      Object.keys(tileLayers).forEach(k => map.removeLayer(tileLayers[k]));
      tileLayers[layerKey].addTo(map);

      if (activeGeoJsonLayer) {
        activeGeoJsonLayer.bringToFront();
      }

      document.querySelectorAll('.layer-option-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      layerPickerModal.classList.remove('open');
    });
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#layer-picker-modal') && !e.target.closest('#layer-picker-btn')) {
      layerPickerModal.classList.remove('open');
    }
  });

  // Botón Copiar CP
  copyCpBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const active = lockedCp || hoveredCp;
    if (!active) {
      showToast('Selecciona o posa el ratón sobre un código postal para copiarlo');
      return;
    }
    navigator.clipboard.writeText(active).then(() => {
      showToast(`¡Código postal ${active} copiado al portapapeles!`);
    }).catch(() => {
      showToast(`CP: ${active}`);
    });
  });

  // Botón Zoom al CP
  zoomToCpBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const active = lockedCp || hoveredCp;
    if (active && cpLayerIndex[active]) {
      const group = L.featureGroup(cpLayerIndex[active]);
      map.fitBounds(group.getBounds(), { padding: [80, 80], maxZoom: 15 });
    }
  });

  // Centrar inicial
  document.getElementById('center-madrid-btn').addEventListener('click', () => {
    if (currentScope === 'capital') {
      map.flyTo(MADRID_CENTER, 12, { duration: 0.8 });
    } else {
      map.flyToBounds(activeGeoJsonLayer.getBounds(), { padding: [20, 20], duration: 0.8 });
    }
  });

  function showToast(text) {
    toastMsg.textContent = text;
    toastMsg.classList.add('show');
    setTimeout(() => {
      toastMsg.classList.remove('show');
    }, 3200);
  }

  // Iniciar carga
  loadData();
}
