(function () {
  'use strict';

  const DEFAULT_CENTER = { lat: 37.5665, lon: 126.9780 };
  const SEARCH_TIMEOUT_MS = 6000;
  const OVERPASS_TIMEOUT_MS = 10000;
  const NEARBY_RADIUS_M = 1500;

  const state = {
    map: null,
    currentPosition: null,
    startPoint: null,
    destination: null,
    userMarker: null,
    startMarker: null,
    destinationMarker: null,
    nearbyLayer: null,
    nearbyLast: [],
    nearbyRadiusM: 1500,
    routeLayer: null,
    routeMode: 'driving',
  };

  const coordsEl = document.getElementById('coords-display');
  const statusEl = document.getElementById('status-message');
  const startInputEl = document.getElementById('start-input');
  const inputEl = document.getElementById('destination-input');
  const directionsBtn = document.getElementById('directions-btn');
  const mapEl = document.getElementById('map');
  const networkBadgeEl = document.getElementById('network-badge');
  const recentSearchListEl = document.getElementById('recent-search-list');
  const clearRecentBtn = document.getElementById('clear-recent-btn');
  const saveFavoriteBtn = document.getElementById('save-favorite-btn');
  const routeSummaryEl = document.getElementById('route-summary');
  const routeFareSummaryEl = document.getElementById('route-fare-summary');
  const routeModeButtons = document.querySelectorAll('[data-route-mode]');
  const routeComboSelectEl = document.getElementById('route-combo-select');
  const comboRouteBtn = document.getElementById('combo-route-btn');
  const comboSummaryEl = document.getElementById('combo-summary');
  const menuToggleBtn = document.getElementById('menu-toggle-btn');
  const menuCloseBtn = document.getElementById('menu-close-btn');
  const favoritesListEl = document.getElementById('favorites-list');
  const clearFavoritesBtn = document.getElementById('clear-favorites-btn');
  const toggleThemeBtn = document.getElementById('toggle-theme-btn');
  const resetMapBtn = document.getElementById('reset-map-btn');
  const copyCoordsBtn = document.getElementById('copy-coords-btn');
  const shareDestinationBtn = document.getElementById('share-destination-btn');
  const nearbyRadiusRange = document.getElementById('nearby-radius-range');
  const nearbyRadiusLabel = document.getElementById('nearby-radius-label');
  const exportDataBtn = document.getElementById('export-data-btn');
  const importDataBtn = document.getElementById('import-data-btn');
  const importDataInput = document.getElementById('import-data-input');

  const STORAGE_KEYS = {
    RECENT: 'lmn-recent-searches',
    FAVORITES: 'lmn-favorites',
    START: 'lmn-start-point',
    DESTINATION: 'lmn-last-destination',
    POSITION: 'lmn-last-position',
    VIEW: 'lmn-last-view',
    THEME: 'lmn-theme-mode',
    SETTINGS: 'lmn-settings',
  };

  function loadJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function saveJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Ignore storage quota errors for MVP.
    }
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function applyTheme(mode) {
    const root = document.documentElement;
    if (!root) {
      return;
    }

    const dark = mode === 'dark';
    root.classList.toggle('dark', dark);
    root.classList.toggle('light', !dark);
    saveJson(STORAGE_KEYS.THEME, mode);

    if (toggleThemeBtn) {
      toggleThemeBtn.textContent = dark ? '라이트' : '다크';
    }
  }

  function toggleTheme() {
    const current = loadJson(STORAGE_KEYS.THEME, 'light');
    applyTheme(current === 'dark' ? 'light' : 'dark');
  }

  function updateNetworkBadge() {
    if (!networkBadgeEl) {
      return;
    }

    const online = navigator.onLine;
    networkBadgeEl.textContent = online ? '온라인' : '오프라인';
    networkBadgeEl.classList.remove('bg-green-100', 'text-green-700', 'bg-amber-100', 'text-amber-700');
    networkBadgeEl.classList.add(online ? 'bg-green-100' : 'bg-amber-100');
    networkBadgeEl.classList.add(online ? 'text-green-700' : 'text-amber-700');
  }

  function renderRecentSearches() {
    if (!recentSearchListEl) {
      return;
    }

    const recents = loadJson(STORAGE_KEYS.RECENT, []);
    recentSearchListEl.innerHTML = '';

    recents.slice(0, 8).forEach(function (keyword) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'text-[11px] px-2 py-1 rounded-full border border-outline-variant whitespace-nowrap';
      button.textContent = keyword;
      button.addEventListener('click', function () {
        if (inputEl) {
          inputEl.value = keyword;
        }
        searchDestination();
      });
      recentSearchListEl.appendChild(button);
    });
  }

  function renderFavorites() {
    if (!favoritesListEl) {
      return;
    }

    const favorites = loadJson(STORAGE_KEYS.FAVORITES, []);
    favoritesListEl.innerHTML = '';

    if (favorites.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'text-[11px] text-on-surface-variant';
      empty.textContent = '저장된 목적지가 없습니다.';
      favoritesListEl.appendChild(empty);
      return;
    }

    favorites.slice(0, 6).forEach(function (item, index) {
      const row = document.createElement('div');
      row.className = 'flex items-center gap-2';

      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'flex-1 text-left text-[11px] px-2 py-1 rounded-full border border-outline-variant truncate';
      openBtn.textContent = item.label;
      openBtn.title = item.label;
      openBtn.addEventListener('click', function () {
        const lat = Number(item.lat);
        const lon = Number(item.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
          return;
        }

        state.destination = { lat: lat, lon: lon, label: item.label || '저장 목적지' };
        clearRoute();
        setRouteSummary('목적지가 변경되었습니다. 내부 길찾기를 눌러 경로를 계산하세요.');
        setFareSummary('예상 요금: -');
        setDestinationMarker(lat, lon, state.destination.label);
        updateDirectionsState();

        const map = ensureMap();
        if (map) {
          map.setView([lat, lon], Math.max(map.getZoom(), 15));
        }

        saveJson(STORAGE_KEYS.DESTINATION, state.destination);
        setStatus('저장된 목적지를 불러왔습니다.', 'success');
      });

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'text-[11px] px-2 py-1 rounded-full bg-error-container text-on-error-container';
      delBtn.textContent = '삭제';
      delBtn.addEventListener('click', function () {
        const next = loadJson(STORAGE_KEYS.FAVORITES, []).filter(function (_x, i) {
          return i !== index;
        });
        saveJson(STORAGE_KEYS.FAVORITES, next);
        renderFavorites();
      });

      row.appendChild(openBtn);
      row.appendChild(delBtn);
      favoritesListEl.appendChild(row);
    });
  }

  function pushRecentSearch(keyword) {
    if (!keyword) {
      return;
    }

    const recents = loadJson(STORAGE_KEYS.RECENT, []);
    const next = [keyword].concat(recents.filter(function (item) { return item !== keyword; })).slice(0, 20);
    saveJson(STORAGE_KEYS.RECENT, next);
    renderRecentSearches();
  }

  function setStatus(message, type) {
    if (!statusEl) {
      return;
    }

    statusEl.textContent = message;
    statusEl.classList.remove('text-red-600', 'text-blue-700', 'text-green-700', 'text-amber-700');

    if (type === 'error') {
      statusEl.classList.add('text-red-600');
    } else if (type === 'loading') {
      statusEl.classList.add('text-blue-700');
    } else if (type === 'warn') {
      statusEl.classList.add('text-amber-700');
    } else {
      statusEl.classList.add('text-green-700');
    }
  }

  function updateCoords(coords) {
    if (!coordsEl) {
      return;
    }

    coordsEl.textContent = '(' + coords.lat.toFixed(4) + ', ' + coords.lon.toFixed(4) + ')';
  }

  function updateDirectionsState() {
    if (!directionsBtn) {
      return;
    }

    const enabled = Boolean((state.startPoint || state.currentPosition) && state.destination);
    directionsBtn.disabled = !enabled;
    directionsBtn.classList.toggle('opacity-50', !enabled);
    directionsBtn.classList.toggle('cursor-not-allowed', !enabled);
  }

  async function geocodeSingle(query, cachePrefix) {
    const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1&q=' + encodeURIComponent(query);
    const cacheKey = cachePrefix + query;

    try {
      const data = await fetchJsonWithTimeout(url, {
        headers: {
          'Accept-Language': 'ko'
        }
      }, SEARCH_TIMEOUT_MS);

      saveJson(cacheKey, data);
      if (!Array.isArray(data) || data.length === 0) {
        return null;
      }
      return data[0];
    } catch {
      const cached = loadJson(cacheKey, []);
      if (Array.isArray(cached) && cached.length > 0) {
        return cached[0];
      }
      return null;
    }
  }

  function setRouteSummary(message) {
    if (!routeSummaryEl) {
      return;
    }
    routeSummaryEl.textContent = message;
  }

  function setFareSummary(message) {
    if (!routeFareSummaryEl) {
      return;
    }
    routeFareSummaryEl.textContent = message;
  }

  function setComboSummary(message) {
    if (!comboSummaryEl) {
      return;
    }
    comboSummaryEl.textContent = message;
  }

  function setMenuOpen(open) {
    document.body.classList.toggle('menu-open', Boolean(open));
  }

  function formatCurrency(krw) {
    return Math.round(krw).toLocaleString('ko-KR') + '원';
  }

  function formatDistance(distanceM) {
    if (distanceM < 1000) {
      return Math.round(distanceM) + 'm';
    }
    return (distanceM / 1000).toFixed(1) + 'km';
  }

  function formatDuration(durationSec) {
    const totalMin = Math.round(durationSec / 60);
    if (totalMin < 60) {
      return totalMin + '분';
    }

    const hour = Math.floor(totalMin / 60);
    const min = totalMin % 60;
    return hour + '시간 ' + min + '분';
  }

  function speedKmH(mode) {
    if (mode === 'walking') return 4.5;
    if (mode === 'cycling') return 15;
    if (mode === 'subway') return 32;
    if (mode === 'bus') return 24;
    if (mode === 'taxi') return 28;
    if (mode === 'flight') return 780;
    return 40;
  }

  function clearRoute() {
    if (state.routeLayer) {
      state.routeLayer.remove();
      state.routeLayer = null;
    }
  }

  function estimateFare(mode, distanceKm, durationMin) {
    const km = Math.max(0, Number(distanceKm) || 0);
    const min = Math.max(0, Number(durationMin) || 0);
    const nowHour = new Date().getHours();
    const isLateNight = nowHour >= 22 || nowHour < 4;

    if (mode === 'walking') {
      return {
        total: 0,
        breakdown: '도보는 요금이 없습니다.',
      };
    }

    if (mode === 'cycling') {
      const base = 1000;
      const extra = Math.max(0, Math.ceil(Math.max(0, min - 60) / 5) * 200);
      return {
        total: base + extra,
        breakdown: '공공자전거 기준(기본 60분 ' + formatCurrency(base) + ' + 추가 5분당 200원)',
      };
    }

    if (mode === 'subway') {
      const base = 1550;
      const firstSection = Math.max(0, Math.min(km, 50) - 10);
      const secondSection = Math.max(0, km - 50);
      const extra = Math.ceil(firstSection / 5) * 100 + Math.ceil(secondSection / 8) * 100;
      return {
        total: base + extra,
        breakdown: '수도권 지하철 성인 교통카드 기준(10km 초과 5km당 100원, 50km 초과 8km당 100원)',
      };
    }

    if (mode === 'bus') {
      const base = 1500;
      const firstSection = Math.max(0, Math.min(km, 40) - 10);
      const secondSection = Math.max(0, km - 40);
      const extra = Math.ceil(firstSection / 5) * 100 + Math.ceil(secondSection / 8) * 100;
      return {
        total: base + extra,
        breakdown: '시내/광역 버스 단순화 기준(10km 초과 5km당 100원, 40km 초과 8km당 100원)',
      };
    }

    if (mode === 'taxi') {
      const base = 4800;
      const overM = Math.max(0, km * 1000 - 1600);
      const distanceUnits = Math.ceil(overM / 131);
      const expectedDriveMin = km * 2.5;
      const delayMin = Math.max(0, min - expectedDriveMin);
      const timeUnits = Math.ceil((delayMin * 60) / 30);
      const meter = (distanceUnits + Math.max(0, timeUnits)) * 100;
      const nightSurcharge = isLateNight ? (base + meter) * 0.2 : 0;
      const total = base + meter + nightSurcharge;
      return {
        total: total,
        breakdown: '서울 중형택시 단순 추정(기본 1.6km 4,800원 + 거리/시간 병산, 심야 20% 가산 ' + (isLateNight ? '적용' : '미적용') + ')',
      };
    }

    if (mode === 'flight') {
      const base = 35000;
      const distancePart = km * 90;
      const tax = 13000;
      const service = 3000;
      return {
        total: base + distancePart + tax + service,
        breakdown: '국내선 단순 추정(운임 + 공항세/유류할증 + 발권수수료)',
      };
    }

    const fuelPricePerL = 1700;
    const fuelEfficiencyKmPerL = 12;
    const fuelCost = (km / fuelEfficiencyKmPerL) * fuelPricePerL;
    const tollCost = km * 70;
    const parkingCost = min >= 30 ? 2000 : 0;
    return {
      total: fuelCost + tollCost + parkingCost,
      breakdown: '자가용 추정(연료비 + 통행료 + 주차비 일부)',
    };
  }

  function modeLabel(mode) {
    if (mode === 'walking') return '도보';
    if (mode === 'cycling') return '자전거';
    if (mode === 'subway') return '지하철';
    if (mode === 'bus') return '버스';
    if (mode === 'taxi') return '택시';
    if (mode === 'flight') return '비행기';
    return '차량';
  }

  function updateRouteModeUI() {
    routeModeButtons.forEach(function (btn) {
      const mode = btn.getAttribute('data-route-mode');
      const active = mode === state.routeMode;
      btn.classList.toggle('bg-primary-container/30', active);
      btn.classList.toggle('text-on-surface', active);
      btn.classList.toggle('border', !active);
      btn.classList.toggle('border-outline-variant', !active);
    });
  }

  function setRouteMode(mode) {
    state.routeMode = mode || 'driving';
    updateRouteModeUI();
    clearRoute();
    setRouteSummary(modeLabel(state.routeMode) + ' 모드 선택됨. 내부 길찾기를 눌러 경로를 계산하세요.');
    setFareSummary('예상 요금: -');
  }

  function updateRadiusLabel() {
    if (!nearbyRadiusLabel) {
      return;
    }
    nearbyRadiusLabel.textContent = (state.nearbyRadiusM / 1000).toFixed(1) + 'km';
  }

  function ensureMap() {
    if (!mapEl || typeof L === 'undefined') {
      return null;
    }

    if (state.map) {
      return state.map;
    }

    state.map = L.map('map', { zoomControl: false }).setView([DEFAULT_CENTER.lat, DEFAULT_CENTER.lon], 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(state.map);

    // Allow quick destination pinning without typing.
    state.map.on('click', function (event) {
      const lat = Number(event.latlng.lat);
      const lon = Number(event.latlng.lng);
      const label = '지정한 위치 (' + lat.toFixed(4) + ', ' + lon.toFixed(4) + ')';
      state.destination = { lat: lat, lon: lon, label: label };
      clearRoute();
      setRouteSummary('목적지가 변경되었습니다. 내부 길찾기를 눌러 경로를 계산하세요.');
      setFareSummary('예상 요금: -');
      setDestinationMarker(lat, lon, label);
      updateDirectionsState();
      saveJson(STORAGE_KEYS.DESTINATION, state.destination);
      setStatus('지도를 눌러 목적지를 지정했습니다.', 'success');
    });

    state.map.on('moveend', function () {
      const center = state.map.getCenter();
      saveJson(STORAGE_KEYS.VIEW, {
        lat: center.lat,
        lon: center.lng,
        zoom: state.map.getZoom(),
      });
    });

    state.nearbyLayer = L.layerGroup().addTo(state.map);
    return state.map;
  }

  function setUserMarker(lat, lon) {
    const map = ensureMap();
    if (!map) {
      return;
    }

    const userArrowIcon = L.divIcon({
      className: 'lmn-user-arrow-icon',
      html: '<div style="width:0;height:0;border-left:9px solid transparent;border-right:9px solid transparent;border-bottom:18px solid #d32f2f;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35));transform:rotate(0deg);"></div>',
      iconSize: [18, 18],
      iconAnchor: [9, 16],
      popupAnchor: [0, -12],
    });

    if (state.userMarker) {
      state.userMarker.setLatLng([lat, lon]);
    } else {
      state.userMarker = L.marker([lat, lon], {
        icon: userArrowIcon,
        zIndexOffset: 1200,
      }).addTo(map).bindPopup('내 위치');
    }
  }

  function setStartMarker(lat, lon, label) {
    const map = ensureMap();
    if (!map) {
      return;
    }

    if (state.startMarker) {
      state.startMarker.setLatLng([lat, lon]);
      state.startMarker.setPopupContent(label || '출발지');
    } else {
      state.startMarker = L.circleMarker([lat, lon], {
        radius: 8,
        color: '#006e1c',
        fillColor: '#006e1c',
        fillOpacity: 0.9,
        weight: 2,
      }).addTo(map).bindPopup(label || '출발지');
    }
  }

  function setDestinationMarker(lat, lon, label) {
    const map = ensureMap();
    if (!map) {
      return;
    }

    if (state.destinationMarker) {
      state.destinationMarker.setLatLng([lat, lon]);
      state.destinationMarker.setPopupContent(label || '목적지');
    } else {
      state.destinationMarker = L.marker([lat, lon]).addTo(map).bindPopup(label || '목적지');
    }
  }

  function haversineKm(a, b) {
    const toRad = function (deg) { return deg * Math.PI / 180; };
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lon - a.lon);
    const s1 = Math.sin(dLat / 2);
    const s2 = Math.sin(dLon / 2);
    const x = s1 * s1 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * s2 * s2;
    return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }

  function buildGreatCirclePath(start, end, segments) {
    const count = Math.max(12, Number(segments) || 64);
    const toRad = function (deg) { return deg * Math.PI / 180; };
    const toDeg = function (rad) { return rad * 180 / Math.PI; };

    const lat1 = toRad(start.lat);
    const lon1 = toRad(start.lon);
    const lat2 = toRad(end.lat);
    const lon2 = toRad(end.lon);

    const sinLat1 = Math.sin(lat1);
    const cosLat1 = Math.cos(lat1);
    const sinLat2 = Math.sin(lat2);
    const cosLat2 = Math.cos(lat2);

    const delta = 2 * Math.asin(Math.sqrt(
      Math.pow(Math.sin((lat2 - lat1) / 2), 2) +
      cosLat1 * cosLat2 * Math.pow(Math.sin((lon2 - lon1) / 2), 2)
    ));

    if (!Number.isFinite(delta) || delta === 0) {
      return [
        [start.lat, start.lon],
        [end.lat, end.lon],
      ];
    }

    const points = [];
    for (let i = 0; i <= count; i += 1) {
      const f = i / count;
      const A = Math.sin((1 - f) * delta) / Math.sin(delta);
      const B = Math.sin(f * delta) / Math.sin(delta);

      const x = A * cosLat1 * Math.cos(lon1) + B * cosLat2 * Math.cos(lon2);
      const y = A * cosLat1 * Math.sin(lon1) + B * cosLat2 * Math.sin(lon2);
      const z = A * sinLat1 + B * sinLat2;

      const lat = Math.atan2(z, Math.sqrt(x * x + y * y));
      const lon = Math.atan2(y, x);
      points.push([toDeg(lat), toDeg(lon)]);
    }

    return points;
  }

  function interpolatePoint(a, b, ratio) {
    const r = clamp(Number(ratio) || 0.5, 0, 1);
    return {
      lat: a.lat + (b.lat - a.lat) * r,
      lon: a.lon + (b.lon - a.lon) * r,
    };
  }

  function legColor(mode) {
    if (mode === 'walking') return '#2e7d32';
    if (mode === 'subway') return '#6a1b9a';
    if (mode === 'bus') return '#ef6c00';
    if (mode === 'taxi') return '#f9a825';
    if (mode === 'flight') return '#1565c0';
    if (mode === 'cycling') return '#00838f';
    return '#546e7a';
  }

  function comboPreset(preset, origin, destination) {
    const t1 = interpolatePoint(origin, destination, 0.25);
    const t2 = interpolatePoint(origin, destination, 0.75);

    if (preset === 'walk-subway-walk') {
      return [
        { mode: 'walking', from: origin, to: t1 },
        { mode: 'subway', from: t1, to: t2 },
        { mode: 'walking', from: t2, to: destination },
      ];
    }

    if (preset === 'walk-bus-walk') {
      return [
        { mode: 'walking', from: origin, to: t1 },
        { mode: 'bus', from: t1, to: t2 },
        { mode: 'walking', from: t2, to: destination },
      ];
    }

    if (preset === 'taxi-subway-walk') {
      return [
        { mode: 'taxi', from: origin, to: t1 },
        { mode: 'subway', from: t1, to: t2 },
        { mode: 'walking', from: t2, to: destination },
      ];
    }

    if (preset === 'drive-flight-drive') {
      const a1 = interpolatePoint(origin, destination, 0.1);
      const a2 = interpolatePoint(origin, destination, 0.9);
      return [
        { mode: 'driving', from: origin, to: a1 },
        { mode: 'flight', from: a1, to: a2 },
        { mode: 'driving', from: a2, to: destination },
      ];
    }

    if (preset === 'bike-subway-walk') {
      return [
        { mode: 'cycling', from: origin, to: t1 },
        { mode: 'subway', from: t1, to: t2 },
        { mode: 'walking', from: t2, to: destination },
      ];
    }

    return [];
  }

  function linePathForLeg(leg) {
    if (leg.mode === 'flight') {
      return buildGreatCirclePath(leg.from, leg.to, 48);
    }
    return [
      [leg.from.lat, leg.from.lon],
      [leg.to.lat, leg.to.lon],
    ];
  }

  async function planCombinedRoute() {
    const preset = routeComboSelectEl ? routeComboSelectEl.value : '';
    const origin = state.startPoint || state.currentPosition;
    if (!preset) {
      setStatus('조합 경로 프리셋을 선택해 주세요.', 'warn');
      return;
    }

    if (!origin || !state.destination) {
      setStatus('출발지와 목적지를 먼저 설정해 주세요.', 'warn');
      return;
    }

    const legs = comboPreset(preset, origin, state.destination);
    if (legs.length === 0) {
      setStatus('지원하지 않는 조합 경로입니다.', 'error');
      return;
    }

    const map = ensureMap();
    if (!map) {
      return;
    }

    clearRoute();
    const group = L.layerGroup().addTo(map);
    state.routeLayer = group;

    let totalKm = 0;
    let totalMin = 0;
    let totalFare = 0;
    const parts = [];
    const boundsPoints = [];

    legs.forEach(function (leg) {
      const km = haversineKm(leg.from, leg.to) * (leg.mode === 'flight' ? 1.07 : 1);
      const min = (km / speedKmH(leg.mode)) * 60 + (leg.mode === 'subway' ? 6 : 0) + (leg.mode === 'bus' ? 4 : 0);
      const fare = estimateFare(leg.mode, km, min);

      totalKm += km;
      totalMin += min;
      totalFare += fare.total;
      parts.push(modeLabel(leg.mode) + ' ' + km.toFixed(1) + 'km');

      const path = linePathForLeg(leg);
      path.forEach(function (p) { boundsPoints.push(p); });

      L.polyline(path, {
        color: legColor(leg.mode),
        weight: leg.mode === 'flight' ? 5 : 4,
        opacity: 0.9,
        dashArray: leg.mode === 'walking' ? '5 6' : undefined,
      }).addTo(group);
    });

    if (boundsPoints.length > 1) {
      map.fitBounds(L.latLngBounds(boundsPoints), { padding: [24, 24] });
    }

    setRouteSummary('조합 경로: ' + parts.join(' → ') + ' / 총 ' + totalKm.toFixed(1) + 'km / 예상 ' + formatDuration(totalMin * 60));
    setFareSummary('예상 요금: ' + formatCurrency(totalFare));
    setComboSummary('구간별 계산 완료: ' + parts.join(' | '));
    setStatus('조합 경로를 계산해 지도에 표시했습니다.', 'success');
  }

  async function fetchJsonWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, timeoutMs);

    try {
      const response = await fetch(url, {
        method: options.method || 'GET',
        headers: options.headers || {},
        body: options.body,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error('HTTP ' + response.status);
      }

      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async function getCurrentPositionOnce() {
    if (state.currentPosition && Number.isFinite(state.currentPosition.lat) && Number.isFinite(state.currentPosition.lon)) {
      return state.currentPosition;
    }

    return await new Promise(function (resolve, reject) {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation unsupported'));
        return;
      }

      navigator.geolocation.getCurrentPosition(
        function (position) {
          const point = {
            lat: position.coords.latitude,
            lon: position.coords.longitude,
          };
          resolve(point);
        },
        function (err) {
          reject(err || new Error('Position unavailable'));
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
      );
    });
  }

  async function resolveMyLocationAddress() {
    const point = await getCurrentPositionOnce();
    const lat = Number(point.lat);
    const lon = Number(point.lon);

    state.currentPosition = { lat: lat, lon: lon };
    state.startPoint = { lat: lat, lon: lon, label: '내 위치' };
    saveJson(STORAGE_KEYS.POSITION, state.currentPosition);
    saveJson(STORAGE_KEYS.START, state.startPoint);
    updateCoords(state.currentPosition);
    setUserMarker(lat, lon);
    setStartMarker(lat, lon, '내 위치');

    const reverseUrl = 'https://nominatim.openstreetmap.org/reverse?format=json&lat=' + encodeURIComponent(String(lat)) + '&lon=' + encodeURIComponent(String(lon));
    const data = await fetchJsonWithTimeout(reverseUrl, {
      headers: {
        'Accept-Language': 'ko'
      }
    }, SEARCH_TIMEOUT_MS);

    const label = (data && (data.display_name || data.name)) ? (data.display_name || data.name) : '내 위치';
    return {
      lat: lat,
      lon: lon,
      label: label,
    };
  }

  async function locateUser() {
    if (!navigator.geolocation) {
      setStatus('이 브라우저는 위치 기능을 지원하지 않습니다.', 'error');
      return;
    }

    setStatus('내 위치를 확인 중입니다...', 'loading');

    navigator.geolocation.getCurrentPosition(
      function (position) {
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;

        state.currentPosition = { lat: lat, lon: lon };
        state.startPoint = { lat: lat, lon: lon, label: '내 위치' };
        saveJson(STORAGE_KEYS.START, state.startPoint);
        saveJson(STORAGE_KEYS.POSITION, state.currentPosition);
        updateCoords(state.currentPosition);
        setUserMarker(lat, lon);
        setStartMarker(lat, lon, '내 위치');

        const map = ensureMap();
        if (map) {
          map.setView([lat, lon], 15);
        }

        updateDirectionsState();
        setStatus('내 위치를 찾았습니다.', 'success');
      },
      function (err) {
        if (err && err.code === err.PERMISSION_DENIED) {
          setStatus('위치 권한이 필요합니다. 브라우저 설정을 확인해 주세요.', 'warn');
        } else {
          setStatus('위치 확인에 실패했습니다. 다시 시도해 주세요.', 'error');
        }
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    );
  }

  async function searchDestination() {
    const query = (inputEl ? inputEl.value : '').trim();

    if (!query) {
      setStatus('목적지를 입력해 주세요.', 'warn');
      return;
    }

    if (query.length > 80) {
      setStatus('검색어는 80자 이하로 입력해 주세요.', 'warn');
      return;
    }

    if (query === '내 위치') {
      setStatus('내 위치 주소를 확인 중입니다...', 'loading');
      try {
        const mine = await resolveMyLocationAddress();
        if (inputEl) {
          inputEl.value = mine.label;
        }

        state.destination = { lat: mine.lat, lon: mine.lon, label: mine.label };
        clearRoute();
        setRouteSummary('목적지가 변경되었습니다. 내부 길찾기를 눌러 경로를 계산하세요.');
        setFareSummary('예상 요금: -');
        setDestinationMarker(mine.lat, mine.lon, mine.label);
        pushRecentSearch('내 위치');

        const map = ensureMap();
        if (map) {
          map.setView([mine.lat, mine.lon], 15);
        }

        updateDirectionsState();
        setStatus('내 위치 주소를 목적지에 입력했습니다.', 'success');
        return;
      } catch (_error) {
        setStatus('내 위치 주소 확인에 실패했습니다. 위치 권한과 네트워크를 확인해 주세요.', 'error');
        return;
      }
    }

    setStatus('목적지를 검색 중입니다...', 'loading');

    try {
      const top = await geocodeSingle(query, 'lmn-geocode:');
      if (!top) {
        setStatus('검색 결과가 없습니다. 다른 키워드를 입력해 주세요.', 'warn');
        return;
      }
      const lat = Number(top.lat);
      const lon = Number(top.lon);
      const label = top.display_name || query;

      state.destination = { lat: lat, lon: lon, label: label };
      clearRoute();
      setRouteSummary('목적지가 변경되었습니다. 내부 길찾기를 눌러 경로를 계산하세요.');
      setFareSummary('예상 요금: -');
      setDestinationMarker(lat, lon, label);
      pushRecentSearch(query);

      const map = ensureMap();
      if (map) {
        map.setView([lat, lon], 15);
      }

      updateDirectionsState();
      setStatus('목적지를 찾았습니다.', 'success');
    } catch (error) {
      setStatus('목적지 검색에 실패했습니다. 잠시 후 다시 시도해 주세요.', 'error');
    }
  }

  async function searchStart() {
    const query = (startInputEl ? startInputEl.value : '').trim();

    if (!query) {
      setStatus('출발지를 입력해 주세요.', 'warn');
      return;
    }

    if (query.length > 80) {
      setStatus('검색어는 80자 이하로 입력해 주세요.', 'warn');
      return;
    }

    if (query === '내 위치') {
      setStatus('내 위치 주소를 확인 중입니다...', 'loading');
      try {
        const mine = await resolveMyLocationAddress();
        state.startPoint = { lat: mine.lat, lon: mine.lon, label: mine.label };
        saveJson(STORAGE_KEYS.START, state.startPoint);
        clearRoute();
        setRouteSummary('출발지가 변경되었습니다. 내부 길찾기를 눌러 경로를 계산하세요.');
        setFareSummary('예상 요금: -');
        setStartMarker(mine.lat, mine.lon, mine.label);

        if (startInputEl) {
          startInputEl.value = mine.label;
        }

        const map = ensureMap();
        if (map) {
          map.setView([mine.lat, mine.lon], 15);
        }

        updateDirectionsState();
        setStatus('내 위치 주소를 출발지에 입력했습니다.', 'success');
        return;
      } catch (_error) {
        setStatus('내 위치 주소 확인에 실패했습니다. 위치 권한과 네트워크를 확인해 주세요.', 'error');
        return;
      }
    }

    setStatus('출발지를 검색 중입니다...', 'loading');

    try {
      const top = await geocodeSingle(query, 'lmn-geocode-start:');
      if (!top) {
        setStatus('검색 결과가 없습니다. 다른 키워드를 입력해 주세요.', 'warn');
        return;
      }

      const lat = Number(top.lat);
      const lon = Number(top.lon);
      const label = top.display_name || query;

      state.startPoint = { lat: lat, lon: lon, label: label };
      saveJson(STORAGE_KEYS.START, state.startPoint);
      clearRoute();
      setRouteSummary('출발지가 변경되었습니다. 내부 길찾기를 눌러 경로를 계산하세요.');
      setFareSummary('예상 요금: -');
      setStartMarker(lat, lon, label);

      const map = ensureMap();
      if (map) {
        map.setView([lat, lon], 15);
      }

      updateDirectionsState();
      setStatus('출발지를 찾았습니다.', 'success');
    } catch (_error) {
      setStatus('출발지 검색에 실패했습니다. 잠시 후 다시 시도해 주세요.', 'error');
    }
  }

  function buildOverpassQuery(category, lat, lon, radiusM) {
    const radius = Number.isFinite(radiusM) ? radiusM : NEARBY_RADIUS_M;
    if (category === 'hospital') {
      return '[out:json][timeout:20];(node["amenity"~"hospital|clinic"](around:' + radius + ',' + lat + ',' + lon + '););out body;';
    }

    if (category === 'pharmacy') {
      return '[out:json][timeout:20];(node["amenity"="pharmacy"](around:' + radius + ',' + lat + ',' + lon + '););out body;';
    }

    return '[out:json][timeout:20];(node["shop"="convenience"](around:' + radius + ',' + lat + ',' + lon + '););out body;';
  }

  function categoryColor(category) {
    if (category === 'hospital') return '#F44336';
    if (category === 'pharmacy') return '#9C27B0';
    return '#FF5722';
  }

  async function findNearby(category) {
    if (!state.currentPosition) {
      setStatus('먼저 내 위치를 설정해 주세요.', 'warn');
      return;
    }

    setStatus('주변 시설을 조회 중입니다...', 'loading');

    const query = buildOverpassQuery(category, state.currentPosition.lat, state.currentPosition.lon, state.nearbyRadiusM);

    const cacheKey = 'lmn-nearby:' + category + ':' + state.currentPosition.lat.toFixed(3) + ':' + state.currentPosition.lon.toFixed(3);

    try {
      const data = await fetchJsonWithTimeout('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=UTF-8'
        },
        body: query,
      }, OVERPASS_TIMEOUT_MS);

      saveJson(cacheKey, data);

      const map = ensureMap();
      if (!map || !state.nearbyLayer) {
        return;
      }

      state.nearbyLayer.clearLayers();

      const elements = Array.isArray(data.elements) ? data.elements : [];
      const base = { lat: state.currentPosition.lat, lon: state.currentPosition.lon };
      elements.sort(function (a, b) {
        const da = haversineKm(base, { lat: a.lat, lon: a.lon });
        const db = haversineKm(base, { lat: b.lat, lon: b.lon });
        return da - db;
      });

      const top = elements.slice(0, 20);
      state.nearbyLast = top;
      top.forEach(function (item) {
        const name = (item.tags && item.tags.name) ? item.tags.name : '이름 없음';
        const distKm = haversineKm(base, { lat: item.lat, lon: item.lon }).toFixed(2);
        L.circleMarker([item.lat, item.lon], {
          radius: 6,
          color: categoryColor(category),
          fillColor: categoryColor(category),
          fillOpacity: 0.8,
          weight: 2,
        }).bindPopup(name + ' (' + distKm + 'km)').addTo(state.nearbyLayer);
      });

      if (top.length === 0) {
        setStatus('주변에서 시설을 찾지 못했습니다.', 'warn');
        return;
      }

      setStatus('주변 시설 ' + top.length + '개를 찾았습니다.', 'success');
    } catch (error) {
      const cached = loadJson(cacheKey, null);
      if (cached && Array.isArray(cached.elements) && cached.elements.length > 0) {
        const map = ensureMap();
        if (!map || !state.nearbyLayer) {
          return;
        }

        state.nearbyLayer.clearLayers();
        const base = { lat: state.currentPosition.lat, lon: state.currentPosition.lon };
        const top = cached.elements.slice(0, 20);
        state.nearbyLast = top;
        top.forEach(function (item) {
          const name = (item.tags && item.tags.name) ? item.tags.name : '이름 없음';
          const distKm = haversineKm(base, { lat: item.lat, lon: item.lon }).toFixed(2);
          L.circleMarker([item.lat, item.lon], {
            radius: 6,
            color: categoryColor(category),
            fillColor: categoryColor(category),
            fillOpacity: 0.8,
            weight: 2,
          }).bindPopup(name + ' (' + distKm + 'km)').addTo(state.nearbyLayer);
        });

        setStatus('오프라인 캐시에서 주변 시설을 불러왔습니다.', 'warn');
        return;
      }

      setStatus('주변 시설 조회에 실패했습니다. 잠시 후 다시 시도해 주세요.', 'error');
    }
  }

  function saveCurrentDestination() {
    if (!state.destination) {
      setStatus('저장할 목적지가 없습니다. 먼저 목적지를 검색해 주세요.', 'warn');
      return;
    }

    const favorites = loadJson(STORAGE_KEYS.FAVORITES, []);
    const exists = favorites.some(function (item) {
      return item.label === state.destination.label;
    });

    if (exists) {
      setStatus('이미 저장된 목적지입니다.', 'warn');
      return;
    }

    favorites.unshift({
      label: state.destination.label,
      lat: state.destination.lat,
      lon: state.destination.lon,
      savedAt: new Date().toISOString(),
    });

    saveJson(STORAGE_KEYS.FAVORITES, favorites.slice(0, 30));
    renderFavorites();
    setStatus('목적지를 로컬에 저장했습니다.', 'success');
  }

  function clearFavorites() {
    saveJson(STORAGE_KEYS.FAVORITES, []);
    renderFavorites();
    setStatus('저장 목적지를 모두 지웠습니다.', 'success');
  }

  async function copyCurrentCoords() {
    if (!state.currentPosition) {
      setStatus('복사할 내 위치가 없습니다. 먼저 내 위치를 찾아 주세요.', 'warn');
      return;
    }

    const text = state.currentPosition.lat.toFixed(6) + ',' + state.currentPosition.lon.toFixed(6);
    try {
      await navigator.clipboard.writeText(text);
      setStatus('좌표를 클립보드에 복사했습니다.', 'success');
    } catch {
      setStatus('클립보드 복사에 실패했습니다.', 'error');
    }
  }

  async function shareDestination() {
    if (!state.destination) {
      setStatus('공유할 목적지가 없습니다. 먼저 목적지를 설정해 주세요.', 'warn');
      return;
    }

    const lat = state.destination.lat;
    const lon = state.destination.lon;
    const link = 'https://www.openstreetmap.org/?mlat=' + lat + '&mlon=' + lon + '#map=16/' + lat + '/' + lon;

    if (navigator.share) {
      try {
        await navigator.share({
          title: 'LMN 목적지 공유',
          text: state.destination.label,
          url: link,
        });
        setStatus('목적지를 공유했습니다.', 'success');
        return;
      } catch {
        // Continue to clipboard fallback.
      }
    }

    try {
      await navigator.clipboard.writeText(link);
      setStatus('공유 링크를 클립보드에 복사했습니다.', 'success');
    } catch {
      setStatus('공유 링크 복사에 실패했습니다.', 'error');
    }
  }

  function resetMapView() {
    const map = ensureMap();
    if (!map) {
      return;
    }

    map.setView([DEFAULT_CENTER.lat, DEFAULT_CENTER.lon], 13);
    setStatus('지도를 기본 위치로 되돌렸습니다.', 'success');
  }

  function exportData() {
    const payload = {
      exportedAt: new Date().toISOString(),
      recents: loadJson(STORAGE_KEYS.RECENT, []),
      favorites: loadJson(STORAGE_KEYS.FAVORITES, []),
      lastDestination: loadJson(STORAGE_KEYS.DESTINATION, null),
      settings: loadJson(STORAGE_KEYS.SETTINGS, {}),
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'lmn-backup.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setStatus('로컬 데이터 백업 파일을 내보냈습니다.', 'success');
  }

  function importDataFromFile(file) {
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = function () {
      try {
        const parsed = JSON.parse(String(reader.result || '{}'));
        saveJson(STORAGE_KEYS.RECENT, Array.isArray(parsed.recents) ? parsed.recents : []);
        saveJson(STORAGE_KEYS.FAVORITES, Array.isArray(parsed.favorites) ? parsed.favorites : []);
        saveJson(STORAGE_KEYS.DESTINATION, parsed.lastDestination || null);
        saveJson(STORAGE_KEYS.SETTINGS, parsed.settings || {});
        renderRecentSearches();
        renderFavorites();
        restoreSessionState();
        setStatus('백업 데이터를 가져왔습니다.', 'success');
      } catch {
        setStatus('백업 파일 형식이 올바르지 않습니다.', 'error');
      }
    };

    reader.readAsText(file, 'utf-8');
  }

  function restoreSessionState() {
    const settings = loadJson(STORAGE_KEYS.SETTINGS, {});
    const themeMode = loadJson(STORAGE_KEYS.THEME, settings.theme || 'light');
    applyTheme(themeMode === 'dark' ? 'dark' : 'light');

    const radius = Number(settings.radiusM || state.nearbyRadiusM);
    state.nearbyRadiusM = clamp(Number.isFinite(radius) ? radius : 1500, 300, 3000);
    if (nearbyRadiusRange) {
      nearbyRadiusRange.value = String(state.nearbyRadiusM);
    }
    updateRadiusLabel();

    const map = ensureMap();
    const lastView = loadJson(STORAGE_KEYS.VIEW, null);
    if (map && lastView && Number.isFinite(lastView.lat) && Number.isFinite(lastView.lon)) {
      map.setView([Number(lastView.lat), Number(lastView.lon)], Number(lastView.zoom) || 13);
    }

    const savedPos = loadJson(STORAGE_KEYS.POSITION, null);
    if (savedPos && Number.isFinite(savedPos.lat) && Number.isFinite(savedPos.lon)) {
      state.currentPosition = { lat: Number(savedPos.lat), lon: Number(savedPos.lon) };
      setUserMarker(state.currentPosition.lat, state.currentPosition.lon);
      updateCoords(state.currentPosition);
    }

    const savedStart = loadJson(STORAGE_KEYS.START, null);
    if (savedStart && Number.isFinite(savedStart.lat) && Number.isFinite(savedStart.lon)) {
      state.startPoint = {
        lat: Number(savedStart.lat),
        lon: Number(savedStart.lon),
        label: savedStart.label || '최근 출발지',
      };
      setStartMarker(state.startPoint.lat, state.startPoint.lon, state.startPoint.label);
      if (startInputEl && state.startPoint.label) {
        startInputEl.value = state.startPoint.label;
      }
    }

    const savedDest = loadJson(STORAGE_KEYS.DESTINATION, null);
    if (savedDest && Number.isFinite(savedDest.lat) && Number.isFinite(savedDest.lon)) {
      state.destination = {
        lat: Number(savedDest.lat),
        lon: Number(savedDest.lon),
        label: savedDest.label || '최근 목적지',
      };
      setDestinationMarker(state.destination.lat, state.destination.lon, state.destination.label);
    }

    updateDirectionsState();
  }

  function persistSettings() {
    saveJson(STORAGE_KEYS.SETTINGS, {
      radiusM: state.nearbyRadiusM,
      theme: loadJson(STORAGE_KEYS.THEME, 'light'),
    });
  }

  async function openDirections() {
    const origin = state.startPoint || state.currentPosition;
    if (!origin || !state.destination) {
      setStatus('출발지와 목적지를 먼저 설정해 주세요.', 'warn');
      return;
    }

    setStatus('내부 길찾기 경로를 계산 중입니다...', 'loading');

    const from = origin.lon + ',' + origin.lat;
    const to = state.destination.lon + ',' + state.destination.lat;
    const osrmProfile = state.routeMode === 'walking'
      ? 'foot'
      : (state.routeMode === 'cycling' ? 'bike' : 'driving');

    if (state.routeMode === 'flight') {
      const map = ensureMap();
      if (!map) {
        return;
      }

      clearRoute();
      const arc = buildGreatCirclePath(origin, state.destination, 72);
      state.routeLayer = L.polyline(arc, {
        color: '#1565c0',
        weight: 5,
        opacity: 0.9,
      }).addTo(map);

      map.fitBounds(state.routeLayer.getBounds(), { padding: [24, 24] });

      const airDistanceKm = haversineKm(origin, state.destination) * 1.07;
      const cruiseMin = (airDistanceKm / 780) * 60;
      const groundBufferMin = 50;
      const totalMin = cruiseMin + groundBufferMin;
      setRouteSummary('비행기 기준 항로(대권항로): 거리 ' + airDistanceKm.toFixed(1) + 'km / 예상 ' + formatDuration(totalMin * 60));
      const fare = estimateFare(state.routeMode, airDistanceKm, totalMin);
      setFareSummary('예상 요금: ' + formatCurrency(fare.total) + ' · ' + fare.breakdown);
      setStatus('비행기 모드 실제 항로(대권항로)를 표시했습니다.', 'success');
      return;
    }

    if (state.routeMode === 'subway' || state.routeMode === 'bus') {
      const map = ensureMap();
      if (!map) {
        return;
      }

      clearRoute();
      state.routeLayer = L.polyline([
        [origin.lat, origin.lon],
        [state.destination.lat, state.destination.lon],
      ], {
        color: '#6f7a6b',
        weight: 4,
        opacity: 0.8,
        dashArray: '8 8',
      }).addTo(map);

      map.fitBounds(state.routeLayer.getBounds(), { padding: [24, 24] });

      const straight = haversineKm(origin, state.destination);
      setRouteSummary(modeLabel(state.routeMode) + ' 모드는 실시간 대중교통 API 연동이 필요합니다. 현재 직선 참고거리 ' + straight.toFixed(1) + 'km 표시 중');
      const fare = estimateFare(state.routeMode, straight, straight / 25 * 60);
      setFareSummary('예상 요금: ' + formatCurrency(fare.total) + ' · ' + fare.breakdown);
      setStatus(modeLabel(state.routeMode) + ' 모드는 안내형 경로(직선)로 표시했습니다.', 'warn');
      return;
    }

    const url = 'https://router.project-osrm.org/route/v1/' + osrmProfile + '/' + from + ';' + to + '?overview=full&geometries=geojson&steps=false&alternatives=false';

    try {
      const data = await fetchJsonWithTimeout(url, {}, 10000);
      if (!data || !Array.isArray(data.routes) || data.routes.length === 0) {
        setStatus('경로를 찾지 못했습니다. 목적지를 다시 확인해 주세요.', 'warn');
        return;
      }

      const route = data.routes[0];
      if (!route.geometry || !Array.isArray(route.geometry.coordinates)) {
        setStatus('경로 데이터 형식이 올바르지 않습니다.', 'error');
        return;
      }

      const map = ensureMap();
      if (!map) {
        return;
      }

      clearRoute();
      state.routeLayer = L.geoJSON(route.geometry, {
        style: {
          color: '#ff9800',
          weight: 6,
          opacity: 0.9,
        }
      }).addTo(map);

      const bounds = state.routeLayer.getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [24, 24] });
      }

      const distanceText = formatDistance(Number(route.distance || 0));
      const durationText = formatDuration(Number(route.duration || 0));
      setRouteSummary(modeLabel(state.routeMode) + ' 기준: 거리 ' + distanceText + ' / 예상 ' + durationText);
      const fare = estimateFare(state.routeMode, Number(route.distance || 0) / 1000, Number(route.duration || 0) / 60);
      setFareSummary('예상 요금: ' + formatCurrency(fare.total) + ' · ' + fare.breakdown);
      setStatus('내부 길찾기 경로를 표시했습니다.', 'success');
    } catch (_error) {
      setStatus('내부 길찾기 계산에 실패했습니다. 네트워크 상태를 확인해 주세요.', 'error');
    }
  }

  function bindEvents() {
    const locateButtons = document.querySelectorAll('[data-action="locate"]');
    locateButtons.forEach(function (btn) {
      btn.addEventListener('click', locateUser);
    });

    const searchButtons = document.querySelectorAll('[data-action="search"]');
    searchButtons.forEach(function (btn) {
      btn.addEventListener('click', searchDestination);
    });

    const searchStartButtons = document.querySelectorAll('[data-action="search-start"]');
    searchStartButtons.forEach(function (btn) {
      btn.addEventListener('click', searchStart);
    });

    if (inputEl) {
      inputEl.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
          searchDestination();
        }
      });
    }

    if (startInputEl) {
      startInputEl.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
          searchStart();
        }
      });
    }

    if (clearRecentBtn) {
      clearRecentBtn.addEventListener('click', function () {
        saveJson(STORAGE_KEYS.RECENT, []);
        renderRecentSearches();
      });
    }

    if (saveFavoriteBtn) {
      saveFavoriteBtn.addEventListener('click', saveCurrentDestination);
    }

    if (clearFavoritesBtn) {
      clearFavoritesBtn.addEventListener('click', clearFavorites);
    }

    if (toggleThemeBtn) {
      toggleThemeBtn.addEventListener('click', function () {
        toggleTheme();
        persistSettings();
      });
    }

    if (resetMapBtn) {
      resetMapBtn.addEventListener('click', resetMapView);
    }

    if (copyCoordsBtn) {
      copyCoordsBtn.addEventListener('click', copyCurrentCoords);
    }

    if (shareDestinationBtn) {
      shareDestinationBtn.addEventListener('click', shareDestination);
    }

    if (nearbyRadiusRange) {
      nearbyRadiusRange.addEventListener('input', function () {
        const parsed = Number(nearbyRadiusRange.value);
        state.nearbyRadiusM = clamp(Number.isFinite(parsed) ? parsed : 1500, 300, 3000);
        updateRadiusLabel();
        persistSettings();
      });
    }

    if (exportDataBtn) {
      exportDataBtn.addEventListener('click', exportData);
    }

    if (importDataBtn && importDataInput) {
      importDataBtn.addEventListener('click', function () {
        importDataInput.click();
      });

      importDataInput.addEventListener('change', function () {
        const file = importDataInput.files && importDataInput.files[0];
        importDataFromFile(file || null);
        importDataInput.value = '';
      });
    }

    if (directionsBtn) {
      directionsBtn.addEventListener('click', openDirections);
    }

    if (comboRouteBtn) {
      comboRouteBtn.addEventListener('click', planCombinedRoute);
    }

    if (routeComboSelectEl) {
      routeComboSelectEl.addEventListener('change', function () {
        if (!routeComboSelectEl.value) {
          setComboSummary('조합 경로를 선택하면 구간별 경로와 요금을 계산합니다.');
        } else {
          setComboSummary('선택됨: ' + routeComboSelectEl.options[routeComboSelectEl.selectedIndex].text);
        }
      });
    }

    routeModeButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        const mode = btn.getAttribute('data-route-mode') || 'driving';
        setRouteMode(mode);
      });
    });

    const categoryButtons = document.querySelectorAll('[data-category]');
    categoryButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        const category = btn.getAttribute('data-category');
        findNearby(category);
      });
    });

    const zoomIn = document.querySelector('[data-action="zoom-in"]');
    if (zoomIn) {
      zoomIn.addEventListener('click', function () {
        const map = ensureMap();
        if (map) map.zoomIn();
      });
    }

    const zoomOut = document.querySelector('[data-action="zoom-out"]');
    if (zoomOut) {
      zoomOut.addEventListener('click', function () {
        const map = ensureMap();
        if (map) map.zoomOut();
      });
    }

    const navButtons = document.querySelectorAll('[data-nav]');
    navButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        const href = btn.getAttribute('data-nav');
        if (href) {
          window.location.href = href;
        }
      });
    });

    if (menuToggleBtn) {
      menuToggleBtn.addEventListener('click', function () {
        const opening = !document.body.classList.contains('menu-open');
        setMenuOpen(opening);
      });
    }

    if (menuCloseBtn) {
      menuCloseBtn.addEventListener('click', function () {
        setMenuOpen(false);
      });
    }

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        setMenuOpen(false);
      }
    });
  }

  function init() {
    const map = ensureMap();
    if (map) {
      updateCoords(DEFAULT_CENTER);
    }

    setStatus('준비 완료: 내 위치를 찾거나 목적지를 검색해 주세요.', 'success');
    setRouteSummary('길찾기 결과가 여기에 표시됩니다.');
    setFareSummary('예상 요금: -');
    setComboSummary('조합 경로를 선택하면 구간별 경로와 요금을 계산합니다.');
    updateRouteModeUI();
    renderRecentSearches();
    renderFavorites();
    restoreSessionState();
    updateNetworkBadge();
    window.addEventListener('online', updateNetworkBadge);
    window.addEventListener('offline', updateNetworkBadge);
    bindEvents();
    updateDirectionsState();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
