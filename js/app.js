// js/app.js
// Versión estable y simplificada: sin lógica de imágenes locales compleja.
// - Imágenes: API (imageUrl/image) -> displayObj.image -> assets/silhouette.svg
// - Logs en openPackFlow para depuración del problema "abrir sobre".
// - Mantiene la vista por selección, duplicados y reconciliación.

import { allStickers } from './mockData.js';
import { api } from './api.js';
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

/* ---------- Helpers ---------- */
function showToast(msg, opts = {}) {
  const t = document.createElement('div');
  t.className = 'toast';
  if (opts.type === 'danger') t.style.background = 'linear-gradient(90deg,#ef4444,#dc2626)';
  if (opts.type === 'success') t.style.background = 'linear-gradient(90deg,#16a34a,#059669)';
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
  if (!card) return null;
  if (card.fullName) return card.fullName;
  if (card.playerName) return card.playerName;
  if (card.name) return card.name;
  if (card.firstName || card.lastName) return `${card.firstName || ''}${card.firstName && card.lastName ? ' ' : ''}${card.lastName || ''}`.trim();
  return card.code || card.id || '';
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
  for (const id of Object.keys(state.duplicates || {})) {
    const count = state.duplicates[id] || 0;
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
  btnTrades && btnTrades.addEventListener('click', () => showView('trades-view', btnTrades));

  state = await api.getInitialState();

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
}