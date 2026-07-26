// js/app.js
// Versión estable y simplificada: sin lógica de imágenes locales compleja.
// - Imágenes: API (imageUrl/image) -> displayObj.image -> assets/silhouette.svg
// - Logs en openPackFlow para depuración del problema "abrir sobre".
// - Mantiene la vista por selección, duplicados y reconciliación.

import { allStickers } from './mockData.js';
import { api, mockIdToApiCode } from './api.js';
// ----------------- IMAGE GENERATION & CACHE HELPERS -----------------

// Deterministic color picker por string
function pickColorFromString(s) {
  if (!s) return '#0b6efd';
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
  const colors = ['#0b6efd','#7c3aed','#059669','#f97316','#ef4444','#0ea5e9','#efb24a','#06b6d4','#8b5cf6'];
  return colors[Math.abs(h) % colors.length];
}

// Genera data-URL SVG para un jugador (iniciales + nombre + país)
function generatePlayerSVGDataUrl(fullName, country, mockId, width = 512, height = 512) {
  const initials = (() => {
    if (!fullName) return '';
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  })();
  const bg = pickColorFromString(country || mockId || fullName);
  const safeName = (fullName || '').replace(/&/g, '&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const safeCountry = (country || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <rect width="100%" height="100%" fill="${bg}" rx="20" ry="20"/>
      <circle cx="${width*0.5}" cy="${height*0.34}" r="${Math.floor(width*0.22)}" fill="rgba(255,255,255,0.12)"/>
      <text x="50%" y="${Math.floor(height*0.46)}" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="${Math.floor(width*0.18)}" fill="#ffffff" font-weight="700">${initials}</text>
      <text x="50%" y="${Math.floor(height*0.78)}" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="${Math.floor(width*0.06)}" fill="rgba(255,255,255,0.95)">${safeName}</text>
      <text x="50%" y="${Math.floor(height*0.9)}" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="${Math.floor(width*0.045)}" fill="rgba(255,255,255,0.82)">${safeCountry}</text>
    </svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

// Genera data-URL SVG para escudo simple (usa countryName y texto "ESCUDO")
function generateShieldSVGDataUrl(countryName, mockId, width = 512, height = 512) {
  const bg = pickColorFromString(countryName || mockId);
  const safeCountry = (countryName || '').replace(/&/g, '&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <rect width="100%" height="100%" fill="${bg}" rx="12" ry="12"/>
      <path d="M ${width*0.2} ${height*0.28} L ${width*0.5} ${height*0.12} L ${width*0.8} ${height*0.28} L ${width*0.8} ${height*0.6} C ${width*0.8} ${height*0.76} ${width*0.6} ${height*0.92} ${width*0.5} ${height*0.98} C ${width*0.4} ${height*0.92} ${width*0.2} ${height*0.76} ${width*0.2} ${height*0.6} Z" fill="rgba(255,255,255,0.12)" />
      <text x="50%" y="${Math.floor(height*0.55)}" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="${Math.floor(width*0.07)}" fill="#fff" font-weight="700">${safeCountry}</text>
      <text x="50%" y="${Math.floor(height*0.72)}" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="${Math.floor(width*0.045)}" fill="rgba(255,255,255,0.9)">ESCUDO</text>
    </svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

// Cache simple en localStorage para los SVG generados
const GEN_CACHE_KEY = 'album_generated_images_v1';
function readGenCache(){ try { return JSON.parse(localStorage.getItem(GEN_CACHE_KEY) || '{}'); } catch (e) { return {}; } }
function writeGenCache(m){ try { localStorage.setItem(GEN_CACHE_KEY, JSON.stringify(m)); } catch (e) {} }
function getGeneratedImage(mockId){ const m = readGenCache(); const e = m[mockId]; if(!e) return null; return e.url; }
function setGeneratedImage(mockId, url){ const m = readGenCache(); m[mockId] = { url, ts: Date.now() }; writeGenCache(m); }

// ----------------- end helpers -----------------

/* ---------- Elementos del DOM ---------- */
const albumGrid = document.getElementById('album-grid');
const btnAlbum = document.getElementById('btn-album');
const btnOpenPack = document.getElementById('btn-open-pack');
const btnDuplicates = document.getElementById('btn-duplicates');
const btnTrades = document.getElementById('btn-trades');
const dupCountSpan = document.getElementById('dup-count');

const packModal = document.getElementById('pack-modal');
const packItems = document.getElementById('pack-items');
const acceptPackBtn = document.getElementById('accept-pack');
const discardPackBtn = document.getElementById('discard-pack');
const openPackBtn = document.getElementById('open-pack-btn');

const duplicatesList = document.getElementById('duplicates-list');
const myDuplicateSelect = document.getElementById('my-duplicate-select');
const desiredSelect = document.getElementById('desired-select');
const sendOfferBtn = document.getElementById('send-offer');
const incomingOffers = document.getElementById('incoming-offers');
const outgoingOffers = document.getElementById('outgoing-offers');
const historyOffers = document.getElementById('history-offers');
const refreshTradesBtn = document.getElementById('refresh-trades');
const tradeTabs = Array.from(document.querySelectorAll('.trade-tab'));

const toastContainer = document.getElementById('toast-container');

const countryView = document.getElementById('country-view');
const countryGrid = document.getElementById('country-grid');
const countryTitle = document.getElementById('country-detail-title');
const backToAlbumBtn = document.getElementById('btn-back-to-album');

/* ---------- Estado ---------- */
let state = null;
let currentPack = [];
let catalogByApiCountry = {};
let catalogCardByMockId = {};
let pendingOutgoing = []; // locally tracked outgoing offers created by this client

/* ---------- Helpers ---------- */
function showToast(msg, opts = {}) {
  const t = document.createElement('div');
  t.className = 'toast';
  const kind = opts.type || (opts.success ? 'success' : 'info');
  if (kind === 'danger') t.style.background = 'linear-gradient(90deg,#ef4444,#dc2626)';
  if (kind === 'success') t.style.background = 'linear-gradient(90deg,#16a34a,#059669)';
  t.textContent = msg;
  toastContainer && toastContainer.appendChild(t);
  setTimeout(() => t.remove(), opts.duration || 2200);
}

function apiCodeToMockId(apiCode) {
  if (!apiCode || typeof apiCode !== 'string') return apiCode;
  const parts = apiCode.split('-');
  const country = parts[0];
  const num = parseInt(parts[1], 10);
  if (Number.isNaN(num)) return apiCode;
  if (num === 1) return `${country}-00`;
  return `${country}-${String(num - 1).padStart(2, '0')}`;
}
function getFullName(card) {
  if (!card && card !== 0) return '';
  if (typeof card === 'string') return card;
  if (typeof card === 'number') return String(card);
  if (card.fullName) return card.fullName;
  if (card.playerName) return card.playerName;
  if (card.name) return card.name;
  if (card.title) return card.title;
  if (card.label) return card.label;
  if (card.card) return getTradeLabel(card.card);
  if (card.player) return getTradeLabel(card.player);
  if (card.sticker) return getTradeLabel(card.sticker);
  if (card.source) return getTradeLabel(card.source);
  if (card.target) return getTradeLabel(card.target);
  if (card.firstName || card.lastName) return `${card.firstName || ''}${card.firstName && card.lastName ? ' ' : ''}${card.lastName || ''}`.trim();
  if (card.code || card.id) return String(card.code || card.id);
  try { return JSON.stringify(card); } catch (e) { return String(card); }
}

/* ---------- Funciones que deben existir pronto ---------- */
function showView(id, btn) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const view = document.getElementById(id);
  if (view) view.classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => b.setAttribute('aria-pressed', 'false'));
  if (btn) btn.setAttribute('aria-pressed', 'true');
  if (id === 'album-view') renderAlbum();
  if (id === 'duplicates-view') renderDuplicates();
}
function updateDupCount() {
  const total = Object.values(state && state.duplicates ? state.duplicates : {}).reduce((a, b) => a + b, 0);
  if (dupCountSpan) dupCountSpan.textContent = String(total);
}

// ----------------- REEMPLAZAR makeStickerElement por esta versión -----------------
function makeStickerElement(displayObj, opts = {}) {
  const tmpl = document.getElementById('sticker-template');
  const apiCard = catalogCardByMockId[displayObj.id] || (displayObj.raw || null);
  const name = (apiCard && (apiCard.fullName || apiCard.playerName || apiCard.name)) || displayObj.nombre || (allStickers[displayObj.id] && allStickers[displayObj.id].nombre) || displayObj.id;
  const role = (apiCard && apiCard.role) || displayObj.role || displayObj.rol || (allStickers[displayObj.id] && allStickers[displayObj.id].rol) || '';

  // 1) construir candidates inicial (local assets first, then API, then display.image)
  const candidates = [];
  if (displayObj.id) {
    candidates.push(`assets/cards/${displayObj.id}.svg`);
    candidates.push(`assets/cards/${displayObj.id}.webp`);
    candidates.push(`assets/cards/${displayObj.id}.png`);
    candidates.push(`assets/cards/${displayObj.id}.jpg`);
  }
  if (apiCard) {
    if (apiCard.imageUrl) candidates.push(apiCard.imageUrl);
    if (apiCard.image) candidates.push(apiCard.image);
  }
  if (displayObj.image) candidates.push(displayObj.image);

  // 2) si existe una imagen generada en cache, ponerla al frente
  const genCached = getGeneratedImage(displayObj.id);
  if (genCached) candidates.unshift(genCached);

  // 3) siempre dejar el fallback final
  candidates.push('assets/silhouette.svg');

  function setImgWithFallback(imgEl, list) {
    let i = 0;
    imgEl.loading = 'lazy';
    imgEl.decoding = 'async';
    imgEl.onerror = () => {
      i++;
      if (i < list.length) imgEl.src = list[i];
      else imgEl.onerror = null;
    };
    imgEl.src = list[i];
  }

  // Si no había cache generada y no hay API image y no hay local asset comprobado -> generamos uno y cacheamos
  // Decisión simple: si mockId endsWith '-00' => ESCUDO, sino => JUGADOR
  async function ensureGeneratedImageIfNeeded(mockId) {
    if (!mockId) return;
    if (getGeneratedImage(mockId)) return; // ya cacheado
    // If there is an API image or a local file likely present, don't auto-generate now
    const hasApiImage = apiCard && (apiCard.imageUrl || apiCard.image);
    // We won't test file existence sync; instead we'll generate only when no api image and no cached generated
    if (hasApiImage) return;
    // Generate SVG (player or shield)
    const isShield = mockId.endsWith('-00');
    const playerName = apiCard ? (apiCard.fullName || apiCard.playerName || apiCard.name) : (displayObj.nombre || '');
    // countryName: try catalog -> allStickers
    let countryName = '';
    if (apiCard && (apiCard.country || apiCard.countryName)) countryName = apiCard.country || apiCard.countryName;
    else if (allStickers[mockId] && allStickers[mockId].country) {
      countryName = allStickers[mockId].country;
    } else {
      // try to find catalog entry
      for (const apiC of Object.keys(catalogByApiCountry || {})) {
        const cards = catalogByApiCountry[apiC].cards || [];
        if (cards.find(cd => apiCodeToMockId(cd.code || cd.id) === mockId)) {
          countryName = catalogByApiCountry[apiC].name || catalogByApiCountry[apiC].country || apiC;
          break;
        }
      }
    }
    const genUrl = isShield ? generateShieldSVGDataUrl(countryName, mockId) : generatePlayerSVGDataUrl(playerName, countryName, mockId);
    setGeneratedImage(mockId, genUrl);
  }

  // If template absent (edge-case) create DOM nodes manually
  if (!tmpl) {
    const wrap = document.createElement('div');
    wrap.className = 'sticker-card';
    if (opts.large) wrap.classList.add('large');
    if (opts.small) wrap.classList.add('small');

    const img = document.createElement('img');
    img.className = 'sticker-img';
    img.dataset.mockId = displayObj.id || '';
    setImgWithFallback(img, candidates);
    img.alt = name;
    wrap.appendChild(img);

    const cap = document.createElement('div');
    cap.className = 'sticker-caption';
    cap.textContent = name;
    cap.title = name;
    wrap.appendChild(cap);

    const meta = document.createElement('div');
    meta.className = 'sticker-meta';
    const idSpan = document.createElement('small'); idSpan.className = 'sticker-id'; idSpan.textContent = displayObj.id || '';
    const roleSpan = document.createElement('span'); roleSpan.className = 'sticker-role'; roleSpan.textContent = role;
    meta.appendChild(idSpan); meta.appendChild(roleSpan); wrap.appendChild(meta);

    // try generate in background if needed
    if (displayObj.id) ensureGeneratedImageIfNeeded(displayObj.id);

    return wrap;
  }

  // Template path
  const node = tmpl.content.firstElementChild.cloneNode(true);
  const img = node.querySelector('.sticker-img');
  img.dataset.mockId = displayObj.id || '';
  setImgWithFallback(img, candidates);
  img.alt = name;
  const caption = node.querySelector('.sticker-caption');
  caption.textContent = name;
  caption.title = name;
  node.querySelector('.sticker-id').textContent = displayObj.id || '';
  node.querySelector('.sticker-role').textContent = role || '';

  if (opts.large) node.classList.add('large');
  if (opts.small) node.classList.add('small');

  // ensure generation in background if needed (non-blocking)
  if (displayObj.id) {
    // fire-and-forget
    ensureGeneratedImageIfNeeded(displayObj.id).then(() => {
      // if we generated a new url, update any <img> in DOM that matches data-mockId
      const newUrl = getGeneratedImage(displayObj.id);
      if (newUrl) {
        document.querySelectorAll(`img[data-mock-id="${displayObj.id}"]`).forEach(el => { try { el.src = newUrl; } catch (e) {} });
        document.querySelectorAll(`img[data-mockid="${displayObj.id}"]`).forEach(el => { try { el.src = newUrl; } catch (e) {} });
      }
    }).catch(()=>{});
  }

  return node;
}
// ----------------- end makeStickerElement replacement -----------------
/* ---------- Render album ---------- */
function renderAlbum() {
  if (!albumGrid) return;
  albumGrid.innerHTML = '';

  const countryKeys = Object.keys(state.album || {});
  countryKeys.sort((a, b) => {
    const an = (catalogByApiCountry[a] && (catalogByApiCountry[a].name || catalogByApiCountry[a].country)) || a;
    const bn = (catalogByApiCountry[b] && (catalogByApiCountry[b].name || catalogByApiCountry[b].country)) || b;
    return an.localeCompare(bn);
  });

  for (const apiC of countryKeys) {
    const apiCountryObj = catalogByApiCountry[apiC] || {};
    const displayName = apiCountryObj.name || apiCountryObj.country || apiC;
    const card = document.createElement('section'); card.className = 'country-card';

    const header = document.createElement('h3');
    header.innerHTML = `${displayName} <small class="api-code">(${apiC})</small>`;
    header.classList.add('country-card-header');
    const viewBtn = document.createElement('button'); viewBtn.className = 'nav-btn small'; viewBtn.textContent = 'Ver selección';
    viewBtn.addEventListener('click', (ev) => { ev.stopPropagation(); showCountry(apiC); });
    header.appendChild(viewBtn);
    header.addEventListener('click', () => showCountry(apiC));
    card.appendChild(header);

    const grid = document.createElement('div'); grid.className = 'stickers-grid';
    const apiCards = (apiCountryObj.cards && Array.isArray(apiCountryObj.cards) && apiCountryObj.cards.length) ? apiCountryObj.cards : null;

    if (apiCards) {
      for (const cardInfo of apiCards) {
        const apiCode = cardInfo.code || cardInfo.id;
        const mockId = apiCodeToMockId(apiCode);
        const slot = document.createElement('div'); slot.className = 'sticker-slot';
        const placed = (state.album[apiC] && state.album[apiC].placed && state.album[apiC].placed.includes(mockId));
        const copies = state.duplicates && state.duplicates[mockId] ? state.duplicates[mockId] : 0;
        if (placed) {
          slot.classList.add('sticker-placed');
          const displayObj = { id: mockId, raw: cardInfo, image: cardInfo.imageUrl || cardInfo.image };
          const node = makeStickerElement(displayObj);
          slot.appendChild(node);
        } else {
          const img = document.createElement('img'); img.src = cardInfo.imageUrl || cardInfo.image || 'assets/silhouette.svg'; img.className = 'sticker-empty';
          slot.appendChild(img);
          const cap = document.createElement('div'); cap.className = 'sticker-caption'; cap.textContent = '';
          slot.appendChild(cap);
        }
        if (copies > 0) {
          const badge = document.createElement('div'); badge.className = 'dup-badge'; badge.textContent = `x${copies}`;
          badge.style.position = 'absolute'; badge.style.bottom = '6px'; badge.style.right = '6px';
          slot.appendChild(badge);
        }
        grid.appendChild(slot);
      }
    } else {
      const albumCountry = state.album[apiC] || { placed: [], missing: [] };
      const combined = albumCountry.placed.concat(albumCountry.missing);
      for (const mockId of combined) {
        const slot = document.createElement('div'); slot.className = 'sticker-slot';
        const placed = albumCountry.placed.includes(mockId);
        const copies = state.duplicates && state.duplicates[mockId] ? state.duplicates[mockId] : 0;
        if (placed) {
          slot.classList.add('sticker-placed');
          const displayObj = { id: mockId };
          if (catalogCardByMockId[mockId]) displayObj.raw = catalogCardByMockId[mockId];
          else displayObj.nombre = (allStickers[mockId] && allStickers[mockId].nombre) || mockId;
          const node = makeStickerElement(displayObj);
          slot.appendChild(node);
        } else {
          const img = document.createElement('img'); img.src = (allStickers[mockId] && allStickers[mockId].image) || 'assets/silhouette.svg'; img.className = 'sticker-empty';
          slot.appendChild(img);
          const cap = document.createElement('div'); cap.className = 'sticker-caption'; cap.textContent = '';
          slot.appendChild(cap);
        }
        if (copies > 0) {
          const badge = document.createElement('div'); badge.className = 'dup-badge'; badge.textContent = `x${copies}`;
          badge.style.position = 'absolute'; badge.style.bottom = '6px'; badge.style.right = '6px';
          slot.appendChild(badge);
        }
        grid.appendChild(slot);
      }
    }

    card.appendChild(grid);
    albumGrid.appendChild(card);
  }
}

/* ---------- Vista por selección ---------- */
function showCountry(apiCode) {
  const apiCountryObj = catalogByApiCountry[apiCode] || {};
  const displayName = apiCountryObj.name || apiCountryObj.country || apiCode;
  countryTitle.textContent = `${displayName} — ${apiCode}`;
  countryGrid.innerHTML = '';

  const cards = (apiCountryObj.cards && Array.isArray(apiCountryObj.cards) && apiCountryObj.cards.length) ? apiCountryObj.cards : (state.album[apiCode] ? state.album[apiCode].placed.concat(state.album[apiCode].missing) : []);
  if (cards.length && typeof cards[0] === 'object') {
    for (const cardInfo of cards) {
      const apiCodeCard = cardInfo.code || cardInfo.id;
      const mockId = apiCodeToMockId(apiCodeCard);
      const slot = document.createElement('div'); slot.className = 'sticker-slot large-slot';
      const placed = state.album[apiCode] && state.album[apiCode].placed && state.album[apiCode].placed.includes(mockId);
      const copies = state.duplicates && state.duplicates[mockId] ? state.duplicates[mockId] : 0;
      if (placed) {
        slot.classList.add('sticker-placed');
        const displayObj = { id: mockId, raw: cardInfo, image: cardInfo.imageUrl || cardInfo.image };
        const node = makeStickerElement(displayObj, { large: true });
        slot.appendChild(node);
      } else {
        const img = document.createElement('img'); img.src = cardInfo.imageUrl || cardInfo.image || 'assets/silhouette.svg'; img.className = 'sticker-empty';
        slot.appendChild(img);
        const cap = document.createElement('div'); cap.className = 'sticker-caption'; cap.textContent = '';
        slot.appendChild(cap);
      }
      if (copies > 0) {
        const badge = document.createElement('div'); badge.className = 'dup-badge'; badge.textContent = `x${copies}`;
        badge.style.position = 'absolute'; badge.style.bottom = '6px'; badge.style.right = '6px';
        slot.appendChild(badge);
      }
      countryGrid.appendChild(slot);
    }
  } else {
    for (const mockId of cards) {
      const slot = document.createElement('div'); slot.className = 'sticker-slot large-slot';
      const placed = state.album[apiCode] && state.album[apiCode].placed && state.album[apiCode].placed.includes(mockId);
      const copies = state.duplicates && state.duplicates[mockId] ? state.duplicates[mockId] : 0;
      if (placed) {
        slot.classList.add('sticker-placed');
        const displayObj = { id: mockId };
        if (catalogCardByMockId[mockId]) displayObj.raw = catalogCardByMockId[mockId];
        else displayObj.nombre = (allStickers[mockId] && allStickers[mockId].nombre) || mockId;
        const node = makeStickerElement(displayObj, { large: true });
        slot.appendChild(node);
      } else {
        const img = document.createElement('img'); img.src = (allStickers[mockId] && allStickers[mockId].image) || 'assets/silhouette.svg'; img.className = 'sticker-empty';
        slot.appendChild(img);
        const cap = document.createElement('div'); cap.className = 'sticker-caption'; cap.textContent = '';
        slot.appendChild(cap);
      }
      if (copies > 0) {
        const badge = document.createElement('div'); badge.className = 'dup-badge'; badge.textContent = `x${copies}`;
        badge.style.position = 'absolute'; badge.style.bottom = '6px'; badge.style.right = '6px';
        slot.appendChild(badge);
      }
      countryGrid.appendChild(slot);
    }
  }

  showView('country-view');
  try { backToAlbumBtn && backToAlbumBtn.focus && backToAlbumBtn.focus(); } catch (e) {}
}
backToAlbumBtn && backToAlbumBtn.addEventListener('click', () => showView('album-view', btnAlbum));

/* ---------- Repetidas ---------- */
function renderDuplicates() {
  if (!duplicatesList) return;
  duplicatesList.innerHTML = '';
  duplicatesList.classList.add('stickers-grid');
  let total = 0;
  const dupMap = (state && state.duplicates) ? state.duplicates : {};
  for (const id of Object.keys(dupMap)) {
    const count = dupMap[id] || 0;
    if (count <= 0) continue;
    total += count;
    const info = { id };
    if (catalogCardByMockId[id]) info.raw = catalogCardByMockId[id];
    else info.nombre = (allStickers[id] && allStickers[id].nombre) || id;
    const card = makeStickerElement(info, { small: true });
    const meta = card.querySelector('.sticker-meta') || document.createElement('div');
    const badge = document.createElement('div'); badge.textContent = `Repetidas: ${count}`; badge.style.fontSize = '0.75rem'; badge.style.marginTop = '6px';
    meta.appendChild(badge); card.appendChild(meta);
    duplicatesList.appendChild(card);
  }
  if (dupCountSpan) dupCountSpan.textContent = String(total);
}

function getTradeLabel(card) {
  if (card === null || card === undefined) return '';
  if (typeof card === 'string' || typeof card === 'number') return String(card);
  if (Array.isArray(card) && card.length) return getTradeLabel(card[0]);
  if (typeof card === 'object') {
    const candidate = card.fullName || card.playerName || card.name || card.title || card.label || card.displayName || card.groupName || card.description || card.value;
    if (candidate) return String(candidate);
    if (card.code || card.id) return String(card.code || card.id);
    if (card.card || card.sticker || card.player || card.source || card.target) return getTradeLabel(card.card || card.sticker || card.player || card.source || card.target);
    const stringKey = Object.keys(card).find(k => typeof card[k] === 'string' && card[k].trim());
    if (stringKey) return String(card[stringKey]);
    const numberKey = Object.keys(card).find(k => typeof card[k] === 'number');
    if (numberKey) return String(card[numberKey]);
    try { return JSON.stringify(card); } catch (e) { return String(card); }
  }
  return String(card);
}

function getGroupLabel(group) {
  if (group === null || group === undefined) return '';
  if (typeof group === 'string' || typeof group === 'number') return String(group);
  if (Array.isArray(group) && group.length) return getGroupLabel(group[0]);
  if (typeof group === 'object') {
    if (group.name) return String(group.name);
    if (group.groupName) return String(group.groupName);
    if (group.displayName) return String(group.displayName);
    if (group.code) return String(group.code);
    if (group.id && typeof group.id !== 'object') return String(group.id);
    if (group.id && typeof group.id === 'object') return getGroupLabel(group.id);
    if (group.label) return String(group.label);
    return getTradeLabel(group);
  }
  return String(group);
}

function getGroupId(group) {
  if (group === null || group === undefined) return '';
  if (typeof group === 'string' || typeof group === 'number') return String(group);
  if (Array.isArray(group) && group.length) return getGroupId(group[0]);
  if (typeof group === 'object') {
    if (group._id && (typeof group._id === 'string' || typeof group._id === 'number')) return String(group._id);
    if (group.id && typeof group.id !== 'object') return String(group.id);
    if (group.id) return getGroupId(group.id);
    if (group.groupId && typeof group.groupId !== 'object') return String(group.groupId);
    if (group.groupId) return getGroupId(group.groupId);
    if (group.group_id && (typeof group.group_id === 'string' || typeof group.group_id === 'number')) return String(group.group_id);
    if (group.code && typeof group.code !== 'object') return String(group.code);
    if (group.name && typeof group.name !== 'object') return String(group.name);
    return '';
  }
  return '';
}

function getTradeCardInfo(card) {
  if (!card && card !== 0) return { label: '', code: '' };
  if (typeof card === 'string' || typeof card === 'number') {
    const s = String(card);
    // If it's an API code like ARG-1, try to map to catalog name
    if (s.match(/^[A-Za-z]{2,4}-\d+$/)) {
      const mockId = apiCodeToMockId(s);
      const apiCard = catalogCardByMockId[mockId];
      const name = (apiCard && getFullName(apiCard)) || (allStickers[mockId] && allStickers[mockId].nombre);
      return { label: name || s, code: s };
    }
    return { label: s, code: s };
  }
  const label = getTradeLabel(card);
  let code = '';
  if (typeof card === 'object' && card !== null) {
    code = card.code || card.id || (card.card && (card.card.code || card.card.id)) || (card.sticker && (card.sticker.code || card.sticker.id)) || (card.player && (card.player.code || card.player.id)) || '';
    // If code present, try to map to catalog name
    if (code && typeof code === 'string' && code.match(/^[A-Za-z]{2,4}-\d+$/)) {
      const mockId = apiCodeToMockId(code);
      const apiCard = catalogCardByMockId[mockId];
      const name = (apiCard && getFullName(apiCard)) || (allStickers[mockId] && allStickers[mockId].nombre);
      return { label: name || getTradeLabel(card) || code, code: String(code) };
    }
  }
  return { label, code: code ? String(code) : '' };
}

function buildOfferCard(offer, kind) {
  const card = document.createElement('article');
  card.className = 'offer-card';

  const offered = offer.offeredCard || offer.offeredSticker || offer.giveCard || offer.givenCard || offer.offerCard || offer.cardOffered || offer.fromCard || offer.offered || offer.give || offer.offer || null;
  const wanted = offer.requestedCard || offer.requestedSticker || offer.wantCard || offer.wantedCard || offer.cardRequested || offer.toCard || offer.requested || offer.want || offer.desired || null;
  const group = offer.group || offer.groupName || offer.fromGroup || offer.senderGroup || offer.sourceGroup || '';
  const toGroup = offer.toGroup || offer.targetGroup || offer.receivingGroup || offer.destinationGroup || offer.target || '';
  const status = (offer.status || offer.state || '').toString().toUpperCase();

  const offeredInfo = getTradeCardInfo(offered);
  const wantedInfo = getTradeCardInfo(wanted);
  const groupLabel = getGroupLabel(group);
  const toGroupLabel = getGroupLabel(toGroup);
  // If server didn't provide origin group but this is an outgoing trade we sent, show our group as origin
  let finalGroupLabel = groupLabel;
  if (!finalGroupLabel && kind === 'outgoing') {
    finalGroupLabel = getGroupLabel(state.groupInfo) || finalGroupLabel;
  }

  const heading = document.createElement('header');
  const title = document.createElement('strong');
  title.textContent = `${groupLabel || toGroupLabel || 'Intercambio'} · ${status || 'PENDIENTE'}`;
  const badge = document.createElement('span');
  badge.className = 'offer-status';
  badge.textContent = status || 'PENDING';
  heading.append(title, badge);

  const meta = document.createElement('div');
  meta.className = 'offer-meta';
  const groupRow = document.createElement('div');
  groupRow.innerHTML = `<strong>Grupo origen:</strong> ${finalGroupLabel || 'Sin grupo'}`;
  const toGroupRow = document.createElement('div');
  if (toGroupLabel) toGroupRow.innerHTML = `<strong>Grupo destino:</strong> ${toGroupLabel}`;
  const wantRow = document.createElement('div');
  wantRow.innerHTML = `<strong>Quieren:</strong> ${wantedInfo.label || 'Sin información'}${wantedInfo.code ? ` (${wantedInfo.code})` : ''}`;
  const offerRow = document.createElement('div');
  offerRow.innerHTML = `<strong>Ofrecen:</strong> ${offeredInfo.label || 'Sin información'}${offeredInfo.code ? ` (${offeredInfo.code})` : ''}`;
  meta.append(groupRow, toGroupRow, wantRow, offerRow);

  const actions = document.createElement('div');
  actions.className = 'offer-actions';

  if (kind === 'incoming') {
    const acceptBtn = document.createElement('button');
    acceptBtn.className = 'accept-btn';
    acceptBtn.textContent = 'Aceptar';
    acceptBtn.addEventListener('click', async () => {
      await handleTradeAction(offer, 'accept');
    });

    const rejectBtn = document.createElement('button');
    rejectBtn.className = 'reject-btn';
    rejectBtn.textContent = 'Rechazar';
    rejectBtn.addEventListener('click', async () => {
      await handleTradeAction(offer, 'reject');
    });

    actions.append(acceptBtn, rejectBtn);
  } else if (kind === 'outgoing') {
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'cancel-btn';
    cancelBtn.textContent = 'Cancelar';
    cancelBtn.addEventListener('click', async () => {
      await handleTradeAction(offer, 'cancel');
    });
    actions.append(cancelBtn);
  }

  card.append(heading, meta, actions);
  return card;
}

function renderTradeList(listEl, offers, kind) {
  listEl.innerHTML = '';
  if (!offers || !offers.length) {
    const empty = document.createElement('div');
    empty.className = 'offer-empty';
    empty.textContent = kind === 'incoming' ? 'No tienes ofertas entrantes pendientes.' : (kind === 'outgoing' ? 'No tienes ofertas salientes.' : 'No hay historial todavía.');
    listEl.appendChild(empty);
    return;
  }

  offers.forEach((offer) => {
    listEl.appendChild(buildOfferCard(offer, kind));
  });
}

function normalizeStatus(offer) {
  return String(offer.status || offer.state || '').toUpperCase();
}

function isIncomingTrade(offer) {
  if (!offer) return false;
  const direction = String(offer.direction || offer.type || '').toLowerCase();
  if (['incoming', 'received', 'inbound'].includes(direction)) return true;
  if (['outgoing', 'sent', 'outbound'].includes(direction)) return false;
  const myGroupId = getGroupId(state.groupInfo) || '';
  const toGroupRaw = offer.toGroup || offer.targetGroup || offer.group || offer.receivingGroup || offer.target || offer.destinationGroup || offer.to || null;
  const fromGroupRaw = offer.fromGroup || offer.senderGroup || offer.sourceGroup || offer.origin || offer.from || null;
  const toGroup = String(getGroupId(toGroupRaw) || '').toLowerCase();
  const fromGroup = String(getGroupId(fromGroupRaw) || '').toLowerCase();
  if (myGroupId) {
    const own = String(myGroupId).toLowerCase();
    if (toGroup === own && fromGroup !== own) return true;
    if (fromGroup === own && toGroup !== own) return false;
  }
  return !['ACCEPTED', 'REJECTED', 'CANCELLED', 'CANCELED'].includes(normalizeStatus(offer));
}

function isOutgoingTrade(offer) {
  if (!offer) return false;
  const direction = String(offer.direction || offer.type || '').toLowerCase();
  if (['outgoing', 'sent', 'outbound'].includes(direction)) return true;
  if (['incoming', 'received', 'inbound'].includes(direction)) return false;
  const myGroupId = getGroupId(state.groupInfo) || '';
  const toGroupRaw = offer.toGroup || offer.targetGroup || offer.group || offer.receivingGroup || offer.target || offer.destinationGroup || offer.to || null;
  const fromGroupRaw = offer.fromGroup || offer.senderGroup || offer.sourceGroup || offer.origin || offer.from || null;
  const toGroup = String(getGroupId(toGroupRaw) || '').toLowerCase();
  const fromGroup = String(getGroupId(fromGroupRaw) || '').toLowerCase();
  if (myGroupId) {
    const own = String(myGroupId).toLowerCase();
    if (fromGroup === own && toGroup !== own) return true;
    if (toGroup === own && fromGroup !== own) return false;
  }
  return false;
}

async function loadTrades(force = false) {
  if (!incomingOffers || !outgoingOffers || !historyOffers) return;

  const toRender = async (container, kind) => {
    container.innerHTML = '<div class="offer-empty">Cargando ofertas…</div>';
    if (!api.isRemote()) {
      container.innerHTML = '<div class="offer-empty">Introduce tu API key para cargar ofertas reales del backend.</div>';
      return;
    }
    const result = await api.listTrades();
    if (!result.ok) {
      container.innerHTML = `<div class="offer-empty">${result.error || 'No se pudieron cargar las ofertas.'}</div>`;
      return;
    }
    const offers = Array.isArray(result.offers) ? result.offers : [];
    const filtered = offers.filter((offer) => {
      const status = normalizeStatus(offer);
      if (kind === 'incoming') {
        return isIncomingTrade(offer) && !['ACCEPTED', 'REJECTED', 'CANCELLED', 'CANCELED'].includes(status);
      }
      if (kind === 'outgoing') {
        return isOutgoingTrade(offer) && !['ACCEPTED', 'REJECTED', 'CANCELLED', 'CANCELED'].includes(status);
      }
      return ['ACCEPTED', 'REJECTED', 'CANCELLED', 'CANCELED'].includes(status);
    });
    // append any locally pending outgoing offers so they appear immediately
    let merged = filtered;
    if (kind === 'outgoing' && pendingOutgoing && pendingOutgoing.length) {
      // only add those not present in server list (by comparing a tuple of codes+target)
      const existingKeys = new Set(filtered.map(o => {
        const of = (o.offeredCardCode || o.offeredCard || (o.offered && (o.offered.code || o.offered.id)) || '').toString();
        const req = (o.requestedCardCode || o.requestedCard || (o.requested && (o.requested.code || o.requested.id)) || '').toString();
        const tgt = String(getGroupId(o.toGroup || o.targetGroup || o.to || o.target || o.group || o.receivingGroup) || '');
        return `${of}::${req}::${tgt}`;
      }));
      const toAdd = pendingOutgoing.filter(p => {
        const key = `${p.offeredCardCode || ''}::${p.requestedCardCode || ''}::${p.targetGroupId || ''}`;
        return !existingKeys.has(key);
      });
      merged = filtered.concat(toAdd.map(p => p));
    }
    renderTradeList(container, filtered, kind);
  };

  await Promise.all([
    toRender(incomingOffers, 'incoming'),
    toRender(outgoingOffers, 'outgoing'),
    toRender(historyOffers, 'history')
  ]);
}

async function loadGroups() {
  if (!api.isRemote()) {
    state.allGroups = [];
    populateTradeSelectors();
    return;
  }
  const result = await api.listGroups();
  if (!result.ok) {
    console.warn('[groups] failed to load groups', result.error);
    state.allGroups = [];
    populateTradeSelectors();
    return;
  }
  state.allGroups = result.groups || [];
  try { console.info('[groups] loaded', JSON.stringify(state.allGroups)); } catch (e) { console.info('[groups] loaded (unserializable)', state.allGroups); }
  populateTradeSelectors();
}

async function handleTradeAction(offer, action) {
  const tradeId = offer.id || offer.tradeId || offer.offerId || offer._id;
  if (!tradeId) {
    showToast('Esta oferta no tiene un identificador válido.', { type: 'danger' });
    return;
  }

  try {
    const result = await api.updateTrade(tradeId, action);
    if (!result || result.ok === false) {
      const msg = result && result.error ? result.error : 'No se pudo actualizar la oferta.';
      throw new Error(msg);
    }
    showToast(`Oferta ${action === 'accept' ? 'aceptada' : action === 'reject' ? 'rechazada' : 'cancelada'} correctamente.`, { success: true });
    await loadTrades(true);
  } catch (err) {
    showToast(err && err.message ? err.message : 'No se pudo actualizar la oferta.', { type: 'danger' });
  }
}

async function submitTradeOffer() {
  const myDuplicate = myDuplicateSelect && myDuplicateSelect.value;
  const desired = desiredSelect && desiredSelect.value;
  const targetGroup = document.getElementById('target-group')?.value || '';
  if (!myDuplicate || !desired || !targetGroup) {
    showToast('Selecciona una repetida, una carta deseada y un grupo destino.', { type: 'danger' });
    return;
  }

  try {
    // Resolve the actual backend id from the selected option (we store the whole group object as option.value)
    let targetGroupIdValue = targetGroup;
    try {
      const parsed = JSON.parse(targetGroup);
      const resolved = getGroupId(parsed) || parsed.groupId || parsed.id || parsed._id || parsed.group_id || parsed.name || parsed.code || '';
      targetGroupIdValue = String(resolved || '');
    } catch (e) {
      targetGroupIdValue = String(targetGroup || '');
    }

    const payload = {
      offeredCardCode: mockIdToApiCode(myDuplicate),
      requestedCardCode: mockIdToApiCode(desired),
      targetGroupId: targetGroupIdValue
    };
    try { console.info('[trade] sending payload to api.createTrade', JSON.stringify(payload)); } catch (e) { console.info('[trade] sending payload to api.createTrade', payload, { myDuplicate, desired, targetGroup }); }
    if (!payload.offeredCardCode || !payload.requestedCardCode || !payload.targetGroupId) {
      console.error('[trade] missing payload field', payload);
      showToast('Faltan campos obligatorios para crear la oferta.', { type: 'danger' });
      return;
    }
    const result = await api.createTrade(payload);
    if (!result || result.ok === false) {
      const message = result && result.error ? result.error : 'No se pudo crear la oferta.';
      console.error('[trade] failed payload', payload, result);
      throw new Error(message);
    }
    // optimistic: add to pendingOutgoing so it appears under 'Ofertas que envío' immediately
    try {
      const myGroup = state.groupInfo || {};
      const toGroupObj = (() => {
        try { return JSON.parse(targetGroup); } catch (e) { return null; }
      })();
      const pending = {
        id: result.result && result.result.id ? result.result.id : `local-${Date.now()}`,
        offeredCardCode: payload.offeredCardCode,
        requestedCardCode: payload.requestedCardCode,
        targetGroupId: payload.targetGroupId,
        fromGroup: myGroup,
        toGroup: toGroupObj || payload.targetGroupId,
        offeredCard: { code: payload.offeredCardCode },
        requestedCard: { code: payload.requestedCardCode },
        status: 'PENDING',
        direction: 'outgoing'
      };
      pendingOutgoing.push(pending);
    } catch (e) { console.warn('pending outgoing push failed', e); }
    showToast('Oferta enviada correctamente.', { type: 'success' });
    await loadTrades(true);
  } catch (err) {
    showToast(err && err.message ? err.message : 'No se pudo crear la oferta.', { type: 'danger' });
  }
}

function switchTradeTab(tabName) {
  tradeTabs.forEach((tab) => {
    const active = tab.dataset.tab === tabName;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  });

  const panels = [incomingOffers, outgoingOffers, historyOffers];
  panels.forEach((panel) => {
    if (!panel) return;
    panel.classList.toggle('hidden', true);
  });

  const activePanel = tabName === 'outgoing' ? outgoingOffers : (tabName === 'history' ? historyOffers : incomingOffers);
  if (activePanel) activePanel.classList.remove('hidden');
}

/* ---------- open pack (con logs) ---------- */
async function openPackFlow(buttonElement) {
  if (buttonElement) buttonElement.disabled = true;
  console.info('[app] openPackFlow started');
  try {
    const res = await api.requestPack();
    console.info('[app] requestPack response', res);
    currentPack = res.pack || [];
    showPackModal(currentPack);
  } catch (err) {
    console.error('[app] openPack error', err);
    showToast('Error al abrir sobre: ' + (err && err.message ? err.message : ''), { type: 'danger' });
  } finally {
    if (buttonElement) buttonElement.disabled = false;
  }
}

/* ---------- Pack modal handlers & rest (identicos) ---------- */
function showPackModal(pack) {
  if (!packModal || !packItems) return;
  packItems.innerHTML = '';
  for (let i = 0; i < pack.length; i++) {
    const p = pack[i];
    const base = { id: p.id, raw: p.raw, image: p.image || (p.raw && (p.raw.imageUrl || p.raw.image)) || (allStickers[p.id] && allStickers[p.id].image) };
    const el = makeStickerElement(base);
    el.classList.add('pack-item');
    el.style.animationDelay = `${i * 70}ms`;
    packItems.appendChild(el);
  }
  packModal.classList.remove('hidden');
  packModal.setAttribute('aria-hidden', 'false');
  try { acceptPackBtn && acceptPackBtn.focus && acceptPackBtn.focus(); } catch (e) {}
}
discardPackBtn && discardPackBtn.addEventListener('click', () => {
  try { document.activeElement && document.activeElement.blur && document.activeElement.blur(); } catch (e) {}
  packModal.classList.add('hidden');
  packModal.setAttribute('aria-hidden', 'true');
  const from = document.getElementById('open-pack-btn') || document.getElementById('btn-open-pack');
  try { from && from.focus && from.focus(); } catch (e) {}
});
acceptPackBtn && acceptPackBtn.addEventListener('click', () => {
  for (const p of currentPack) {
    let mockId = p.id || null;
    if (!mockId && p.raw && p.raw.code) mockId = apiCodeToMockId(p.raw.code);
    if (!mockId) continue;
    let placedCountry = null;
    for (const apiCode of Object.keys(catalogByApiCountry || {})) {
      const cards = catalogByApiCountry[apiCode].cards || [];
      if (cards.find(cd => apiCodeToMockId(cd.code || cd.id) === mockId)) { placedCountry = apiCode; break; }
    }
    if (!placedCountry && allStickers[mockId] && allStickers[mockId].country) {
      const maybe = allStickers[mockId].country; if (state.album[maybe]) placedCountry = maybe;
    }
    if (!placedCountry) continue;
    state.album[placedCountry] = state.album[placedCountry] || { placed: [], missing: [] };
    const albumCountry = state.album[placedCountry];
    if (!albumCountry.placed.includes(mockId)) {
      albumCountry.placed.push(mockId);
      const idx = albumCountry.missing.indexOf(mockId); if (idx >= 0) albumCountry.missing.splice(idx, 1);
    } else {
      state.duplicates[mockId] = (state.duplicates[mockId] || 0) + 1;
    }
  }

  api.saveState(state);
  renderAlbum(); renderDuplicates(); updateDupCount();

  try { acceptPackBtn.blur(); } catch (e) {}
  packModal.classList.add('hidden'); packModal.setAttribute('aria-hidden', 'true');
  const from = document.getElementById('open-pack-btn') || document.getElementById('btn-open-pack');
  try { from && from.focus && from.focus(); } catch (e) {}
  showToast('Sobre agregado al álbum', { duration: 1500 });
});

/* ---------- Duplicates reconcile (unchanged) ---------- */
function checkDuplicates() {
  const duplicates = state.duplicates || {};
  const dupKeys = Object.keys(duplicates);
  const placedSet = new Set();
  for (const apiC of Object.keys(state.album || {})) (state.album[apiC].placed || []).forEach(id => placedSet.add(id));
  const trueRepeats = dupKeys.filter(k => placedSet.has(k)).map(k => ({ id: k, count: duplicates[k], name: (catalogCardByMockId[k] && getFullName(catalogCardByMockId[k])) || (allStickers[k] && allStickers[k].nombre) || k }));
  const orphan = dupKeys.filter(k => !placedSet.has(k)).map(k => ({ id: k, count: duplicates[k], name: (catalogCardByMockId[k] && getFullName(catalogCardByMockId[k])) || (allStickers[k] && allStickers[k].nombre) || k }));
  return { trueRepeats, orphanDuplicates: orphan };
}
function reconcileDuplicates() {
  const before = checkDuplicates();
  const moved = []; const errors = [];
  for (const entry of before.orphanDuplicates) {
    const key = entry.id;
    let foundApi = null;
    for (const apiC of Object.keys(catalogByApiCountry || {})) {
      const cards = catalogByApiCountry[apiC].cards || [];
      if (cards.find(cd => apiCodeToMockId(cd.code || cd.id) === key)) { foundApi = apiC; break; }
    }
    if (!foundApi && allStickers[key] && allStickers[key].country) {
      if (state.album[allStickers[key].country]) foundApi = allStickers[key].country;
    }
    if (!foundApi) { errors.push({ key, reason: 'no mapping' }); continue; }
    state.album[foundApi] = state.album[foundApi] || { placed: [], missing: [] };
    if (!state.album[foundApi].placed.includes(key)) {
      state.album[foundApi].placed.push(key);
      const idx = state.album[foundApi].missing.indexOf(key); if (idx >= 0) state.album[foundApi].missing.splice(idx, 1);
      state.duplicates[key] = Math.max(0, (state.duplicates[key] || 1) - 1);
      if (state.duplicates[key] === 0) delete state.duplicates[key];
      moved.push({ id: key, to: foundApi });
    }
  }
  if (moved.length) api.saveState(state);
  renderAlbum(); renderDuplicates(); updateDupCount();
  return { before, moved, errors, after: checkDuplicates() };
}

/* ---------- Boot ---------- */
async function boot() {
  const savedKey = localStorage.getItem('album_api_key'); if (savedKey) api.setApiKey(savedKey);

  btnAlbum && btnAlbum.addEventListener('click', () => showView('album-view', btnAlbum));
  btnOpenPack && btnOpenPack.addEventListener('click', () => showView('pack-view', btnOpenPack));
  // Attach internal open-pack button to call openPackFlow
  openPackBtn && openPackBtn.addEventListener('click', () => openPackFlow(openPackBtn));
  btnDuplicates && btnDuplicates.addEventListener('click', () => { showView('duplicates-view', btnDuplicates); renderDuplicates(); });
  btnTrades && btnTrades.addEventListener('click', () => { showView('trades-view', btnTrades); loadTrades(true); });

  state = await api.getInitialState();

  await loadGroups();

  catalogByApiCountry = {}; catalogCardByMockId = {};
  try {
    if (state.rawCatalog && Array.isArray(state.rawCatalog.countries)) {
      for (const apiCountry of state.rawCatalog.countries) {
        const apiCode = (apiCountry.countryCode || apiCountry.code || '').toString().toUpperCase();
        if (!apiCode) continue;
        catalogByApiCountry[apiCode] = apiCountry;
        const cards = apiCountry.cards || apiCountry.cardsList || apiCountry.cards || [];
        for (const card of cards) {
          const code = card.code || card.id;
          if (!code) continue;
          const mockId = apiCodeToMockId(code);
          catalogCardByMockId[mockId] = card;
        }
      }
    }
  } catch (e) { console.warn('catalog map failed', e); catalogByApiCountry = {}; catalogCardByMockId = {}; }

  const repair = reconcileDuplicates();
  if (repair.moved && repair.moved.length) showToast(`${repair.moved.length} repetida(s) pegada(s) automáticamente`, { duration: 2200 });

  updateDupCount(); renderAlbum(); renderDuplicates(); populateTradeSelectors();
  await loadTrades(true);
  switchTradeTab('incoming');

  if (typeof window !== 'undefined') {
    window.appState = () => state;
    window.apiCatalogByApiCountry = () => catalogByApiCountry;
    window.apiCatalogCards = () => catalogCardByMockId;
    window.checkDuplicates = () => checkDuplicates();
    window.reconcileDuplicates = () => reconcileDuplicates();
  }

  if (api.isRemote()) showToast('Conectado a API remota', { duration: 1200 });
}
boot();

/* ---------- populateTradeSelectors (al final) ---------- */
function populateTradeSelectors() {
  if (myDuplicateSelect) {
    myDuplicateSelect.innerHTML = '';
    for (const id of Object.keys(state.duplicates || {})) {
      const count = state.duplicates[id];
      if (count > 0) {
        const display = (catalogCardByMockId[id] && getFullName(catalogCardByMockId[id])) || (allStickers[id] && allStickers[id].nombre) || id;
        const opt = document.createElement('option'); opt.value = id; opt.textContent = `${id} — ${display} (x${count})`;
        myDuplicateSelect.appendChild(opt);
      }
    }
    if (!myDuplicateSelect.children.length) {
      const opt = document.createElement('option'); opt.value = ''; opt.textContent = '(No tienes repetidas)'; myDuplicateSelect.appendChild(opt);
    }
  }

  if (desiredSelect) {
    desiredSelect.innerHTML = '';
    for (const apiC of Object.keys(state.album || {})) {
      const albumCountry = state.album[apiC] || { missing: [] };
      for (const id of albumCountry.missing) {
        const display = (catalogCardByMockId[id] && getFullName(catalogCardByMockId[id])) || (allStickers[id] && allStickers[id].nombre) || id;
        const opt = document.createElement('option'); opt.value = id; opt.textContent = `${id} — ${apiC} / ${display}`;
        desiredSelect.appendChild(opt);
      }
    }
  }

  // attach change listener to targetGroup to filter desiredSelect by group's duplicates
  const targetGroupEl = document.getElementById('target-group');
  if (targetGroupEl) {
    targetGroupEl.removeEventListener('change', onTargetGroupChange);
    targetGroupEl.addEventListener('change', onTargetGroupChange);
  }


async function onTargetGroupChange(e) {
  const val = e.target.value || '';
  let groupId = '';
  try { const parsed = JSON.parse(val); groupId = getGroupId(parsed) || parsed.id || parsed._id || parsed.groupId || parsed.group_id || parsed.code || ''; } catch (err) { groupId = val; }
  await updateDesiredSelectForGroup(String(groupId || ''));
}

async function updateDesiredSelectForGroup(groupId) {
  if (!desiredSelect) return;
  if (!groupId) {
    // repopulate full list
    populateTradeSelectors();
    return;
  }
  if (!api.isRemote()) return;
  const res = await api.getGroupDuplicates(groupId);
  if (!res || res.ok === false) {
    console.warn('[groups] duplicates fetch failed', res && res.error);
    // show message and keep full list
    showToast('No se pudo comprobar duplicadas del grupo destino.', { type: 'danger' });
    return;
  }
  const codes = new Set((res.codes || []).map(c => String(c).toUpperCase()));
  desiredSelect.innerHTML = '';
  for (const apiC of Object.keys(state.album || {})) {
    const albumCountry = state.album[apiC] || { missing: [] };
    for (const id of albumCountry.missing) {
      const apiCode = mockIdToApiCode(id);
      if (!apiCode) continue;
      if (!codes.has(String(apiCode).toUpperCase())) continue; // only those the group has
      const display = (catalogCardByMockId[id] && getFullName(catalogCardByMockId[id])) || (allStickers[id] && allStickers[id].nombre) || id;
      const opt = document.createElement('option'); opt.value = id; opt.textContent = `${id} — ${apiC} / ${display}`;
      desiredSelect.appendChild(opt);
    }
  }
  if (!desiredSelect.children.length) {
    const opt = document.createElement('option'); opt.value = ''; opt.textContent = '(El grupo destino no tiene repetidas disponibles)'; desiredSelect.appendChild(opt);
  }
}
  const targetGroup = document.getElementById('target-group');
  if (targetGroup) {
    targetGroup.innerHTML = '';
    if (!api.isRemote()) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'Introduce tu API key para cargar grupos del backend';
      targetGroup.appendChild(opt);
      return;
    }
    const allGroups = state.allGroups || [];
    const ownId = getGroupId(state.groupInfo);
    const groups = allGroups.filter(g => {
      const gid = getGroupId(g).trim().toLowerCase();
      return gid && gid !== ownId.trim().toLowerCase();
    });
    if (!groups.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '(No hay grupos disponibles)';
      targetGroup.appendChild(opt);
    } else {
      for (const group of groups) {
        const gid = getGroupId(group);
        const name = getGroupLabel(group);
        const opt = document.createElement('option');
        // store the whole group object in the option value so we can extract the real id at submit time
        try { opt.value = JSON.stringify(group); } catch (e) { opt.value = String(gid || name || ''); }
        opt.textContent = name || String(gid);
        // store normalized id for quick access too
        opt.dataset.groupId = String(gid || '');
        targetGroup.appendChild(opt);
      }
    }
  }
}

if (sendOfferBtn) sendOfferBtn.addEventListener('click', submitTradeOffer);
if (refreshTradesBtn) refreshTradesBtn.addEventListener('click', () => loadTrades(true));
tradeTabs.forEach((tab) => tab.addEventListener('click', () => switchTradeTab(tab.dataset.tab)));
