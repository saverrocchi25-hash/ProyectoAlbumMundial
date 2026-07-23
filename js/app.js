// js/app.js
// UI layer with country-detail view: when clicking a country card, opens a focused view for that selection.
// Uses API data as source of truth for names/roles and does not mutate API/mock objects.

import { allStickers } from './mockData.js';
import { api } from './api.js';

/* UI elements */
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

let state = null;
let currentPack = [];
let catalogByApiCountry = {};
let catalogCardByMockId = {};

/* Helpers */
function showToast(msg, opts={}) {
  const t = document.createElement('div'); t.className='toast';
  if (opts.type==='danger') t.style.background = 'linear-gradient(90deg,#ef4444,#dc2626)';
  if (opts.type==='success') t.style.background = 'linear-gradient(90deg,#16a34a,#059669)';
  t.textContent = msg; toastContainer && toastContainer.appendChild(t);
  setTimeout(()=>t.remove(), opts.duration || 2200);
}
function apiCodeToMockId(apiCode) {
  if (!apiCode) return apiCode;
  const parts = apiCode.split('-'); const country = parts[0]; const num = parseInt(parts[1],10);
  if (Number.isNaN(num)) return apiCode;
  if (num===1) return `${country}-00`;
  return `${country}-${String(num-1).padStart(2,'0')}`;
}
function getFullName(card) {
  if (!card) return null;
  if (card.fullName) return card.fullName;
  if (card.playerName) return card.playerName;
  if (card.name) return card.name;
  if (card.firstName || card.lastName) return `${card.firstName||''}${card.firstName && card.lastName ? ' ' : ''}${card.lastName||''}`.trim();
  return card.code || card.id || '';
}

/* Early functions */
function showView(id, btn) {
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  const view = document.getElementById(id);
  if (view) view.classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b=>b.setAttribute('aria-pressed','false'));
  if (btn) btn.setAttribute('aria-pressed','true');
  if (id==='album-view') renderAlbum();
  if (id==='duplicates-view') renderDuplicates();
}
function updateDupCount(){ const total = Object.values(state.duplicates||{}).reduce((a,b)=>a+b,0); if (dupCountSpan) dupCountSpan.textContent = String(total); }

/* Template helper (uses API card if available) */
function makeStickerElement(displayObj, opts={}) {
  const tmpl = document.getElementById('sticker-template');
  const apiCard = catalogCardByMockId[displayObj.id] || (displayObj.raw) || null;
  const name = getFullName(apiCard) || displayObj.nombre || (allStickers[displayObj.id] && allStickers[displayObj.id].nombre) || displayObj.id;
  const role = apiCard && apiCard.role ? apiCard.role : (displayObj.role || displayObj.rol || (allStickers[displayObj.id] && allStickers[displayObj.id].rol) || '');
  if (!tmpl) {
    const w = document.createElement('div'); w.className='sticker-card';
    const img = document.createElement('img'); img.src = displayObj.image || (apiCard && (apiCard.imageUrl||apiCard.image)) || 'assets/silhouette.svg'; img.className='sticker-img';
    const cap = document.createElement('div'); cap.className='sticker-caption'; cap.textContent = name; cap.title = name;
    const meta = document.createElement('div'); meta.className='sticker-meta';
    const idSpan = document.createElement('small'); idSpan.className='sticker-id'; idSpan.textContent = displayObj.id || '';
    const roleSpan = document.createElement('span'); roleSpan.className='sticker-role'; roleSpan.textContent = role;
    meta.appendChild(idSpan); meta.appendChild(roleSpan);
    w.appendChild(img); w.appendChild(cap); w.appendChild(meta);
    if (opts.large) { w.classList.add('large'); }
    if (opts.small) w.classList.add('small');
    return w;
  }
  const node = tmpl.content.firstElementChild.cloneNode(true);
  node.querySelector('.sticker-img').src = displayObj.image || (apiCard && (apiCard.imageUrl||apiCard.image)) || 'assets/silhouette.svg';
  const caption = node.querySelector('.sticker-caption');
  caption.textContent = name; caption.title = name;
  node.querySelector('.sticker-id').textContent = displayObj.id || '';
  node.querySelector('.sticker-role').textContent = role || '';
  if (opts.large) node.classList.add('large');
  if (opts.small) node.classList.add('small');
  return node;
}

/* Render album: each country card header clickable -> showCountry(apiCode) */
function renderAlbum() {
  if (!albumGrid) return;
  albumGrid.innerHTML = '';

  const countryKeys = Object.keys(state.album || {});
  countryKeys.sort((a,b)=> {
    const an = (catalogByApiCountry[a] && (catalogByApiCountry[a].name||catalogByApiCountry[a].country))||a;
    const bn = (catalogByApiCountry[b] && (catalogByApiCountry[b].name||catalogByApiCountry[b].country))||b;
    return an.localeCompare(bn);
  });

  for (const apiC of countryKeys) {
    const apiCountryObj = catalogByApiCountry[apiC] || {};
    const displayName = apiCountryObj.name || apiCountryObj.country || apiC;
    const card = document.createElement('section'); card.className='country-card';
    const header = document.createElement('h3');
    header.innerHTML = `${displayName} <small class="api-code">(${apiC})</small>`;
    header.classList.add('country-card-header');
    // Add a clickable button to view selection
    const viewBtn = document.createElement('button');
    viewBtn.className = 'nav-btn small';
    viewBtn.textContent = 'Ver selección';
    viewBtn.addEventListener('click', (ev)=>{ ev.stopPropagation(); showCountry(apiC); });
    header.appendChild(viewBtn);

    // Also allow clicking header itself
    header.addEventListener('click', ()=> showCountry(apiC));

    card.appendChild(header);

    const grid = document.createElement('div'); grid.className='stickers-grid';

    const apiCards = (apiCountryObj.cards && Array.isArray(apiCountryObj.cards) && apiCountryObj.cards.length) ? apiCountryObj.cards : null;
    if (apiCards) {
      for (const cardInfo of apiCards) {
        const apiCode = cardInfo.code || cardInfo.id;
        const mockId = apiCodeToMockId(apiCode);
        const slot = document.createElement('div'); slot.className='sticker-slot';
        const placed = (state.album[apiC] && state.album[apiC].placed && state.album[apiC].placed.includes(mockId));
        const copies = state.duplicates && state.duplicates[mockId] ? state.duplicates[mockId] : 0;
        if (placed) {
          slot.classList.add('sticker-placed');
          const displayObj = { id: mockId, raw: cardInfo, image: cardInfo.imageUrl || cardInfo.image };
          const node = makeStickerElement(displayObj);
          slot.appendChild(node);
        } else {
          const img = document.createElement('img'); img.src = cardInfo.imageUrl || cardInfo.image || 'assets/silhouette.svg'; img.className='sticker-empty';
          slot.appendChild(img);
          const cap = document.createElement('div'); cap.className='sticker-caption'; cap.textContent = '';
          slot.appendChild(cap);
        }
        if (copies>0) {
          const badge = document.createElement('div'); badge.className='dup-badge'; badge.textContent = `x${copies}`;
          badge.style.position='absolute'; badge.style.bottom='6px'; badge.style.right='6px';
          slot.appendChild(badge);
        }
        grid.appendChild(slot);
      }
    } else {
      // fallback rendering using state album arrays
      const albumCountry = state.album[apiC] || { placed:[], missing:[] };
      const combined = albumCountry.placed.concat(albumCountry.missing);
      for (const mockId of combined) {
        const slot = document.createElement('div'); slot.className='sticker-slot';
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
          const img = document.createElement('img'); img.src = (allStickers[mockId] && allStickers[mockId].image) || 'assets/silhouette.svg'; img.className='sticker-empty';
          slot.appendChild(img);
          const cap = document.createElement('div'); cap.className='sticker-caption'; cap.textContent = '';
          slot.appendChild(cap);
        }
        if (copies>0) {
          const badge = document.createElement('div'); badge.className='dup-badge'; badge.textContent = `x${copies}`;
          badge.style.position='absolute'; badge.style.bottom='6px'; badge.style.right='6px';
          slot.appendChild(badge);
        }
        grid.appendChild(slot);
      }
    }

    card.appendChild(grid);
    albumGrid.appendChild(card);
  }
}

/* Show detailed view for a single API country (apiCode), larger cards for readability */
function showCountry(apiCode) {
  // populate countryTitle and countryGrid
  const apiCountryObj = catalogByApiCountry[apiCode] || {};
  const displayName = apiCountryObj.name || apiCountryObj.country || apiCode;
  countryTitle.textContent = `${displayName} — ${apiCode}`;
  countryGrid.innerHTML = '';

  // prefer API cards list
  const cards = (apiCountryObj.cards && apiCountryObj.cards.length) ? apiCountryObj.cards : (state.album[apiCode] ? state.album[apiCode].placed.concat(state.album[apiCode].missing) : []);
  // If cards are API objects, render accordingly; if they are mockIds, render based on mockAllStickers
  if (cards.length && typeof cards[0] === 'object') {
    for (const cardInfo of cards) {
      const apiCodeCard = cardInfo.code || cardInfo.id;
      const mockId = apiCodeToMockId(apiCodeCard);
      const slot = document.createElement('div'); slot.className='sticker-slot large-slot';
      const placed = state.album[apiCode] && state.album[apiCode].placed && state.album[apiCode].placed.includes(mockId);
      const copies = state.duplicates && state.duplicates[mockId] ? state.duplicates[mockId] : 0;
      if (placed) {
        slot.classList.add('sticker-placed');
        const displayObj = { id: mockId, raw: cardInfo, image: cardInfo.imageUrl || cardInfo.image };
        const node = makeStickerElement(displayObj, { large: true });
        slot.appendChild(node);
      } else {
        const img = document.createElement('img'); img.src = cardInfo.imageUrl || cardInfo.image || 'assets/silhouette.svg'; img.className='sticker-empty';
        slot.appendChild(img);
        const cap = document.createElement('div'); cap.className='sticker-caption'; cap.textContent = '';
        slot.appendChild(cap);
      }
      if (copies>0) {
        const badge = document.createElement('div'); badge.className='dup-badge'; badge.textContent = `x${copies}`;
        badge.style.position='absolute'; badge.style.bottom='6px'; badge.style.right='6px';
        slot.appendChild(badge);
      }
      countryGrid.appendChild(slot);
    }
  } else {
    // cards list is mockIds
    for (const mockId of cards) {
      const slot = document.createElement('div'); slot.className='sticker-slot large-slot';
      const placed = state.album[apiCode] && state.album[apiCode].placed && state.album[apiCode].placed.includes(mockId);
      const copies = state.duplicates && state.duplicates[mockId] ? state.duplicates[mockId] : 0;
      if (placed) {
        slot.classList.add('sticker-placed');
        const displayObj = { id: mockId };
        if (catalogCardByMockId[mockId]) displayObj.raw = catalogCardByMockId[mockId]; else displayObj.nombre = (allStickers[mockId] && allStickers[mockId].nombre) || mockId;
        const node = makeStickerElement(displayObj, { large: true });
        slot.appendChild(node);
      } else {
        const img = document.createElement('img'); img.src = (allStickers[mockId] && allStickers[mockId].image) || 'assets/silhouette.svg'; img.className='sticker-empty';
        slot.appendChild(img);
        const cap = document.createElement('div'); cap.className='sticker-caption'; cap.textContent = '';
        slot.appendChild(cap);
      }
      if (copies>0) {
        const badge = document.createElement('div'); badge.className='dup-badge'; badge.textContent = `x${copies}`;
        badge.style.position='absolute'; badge.style.bottom='6px'; badge.style.right='6px';
        slot.appendChild(badge);
      }
      countryGrid.appendChild(slot);
    }
  }

  showView('country-view');
  // focus the back button for accessibility
  try { backToAlbumBtn && backToAlbumBtn.focus && backToAlbumBtn.focus(); } catch(e){}
}

/* Back button */
backToAlbumBtn && backToAlbumBtn.addEventListener('click', ()=> showView('album-view', btnAlbum));

/* Render duplicates (unchanged) */
function renderDuplicates() {
  if (!duplicatesList) return;
  duplicatesList.innerHTML = '';
  duplicatesList.classList.add('stickers-grid');
  let total = 0;
  for (const id of Object.keys(state.duplicates || {})) {
    const count = state.duplicates[id] || 0;
    if (count<=0) continue;
    total += count;
    const info = { id };
    if (catalogCardByMockId[id]) info.raw = catalogCardByMockId[id]; else info.nombre = (allStickers[id] && allStickers[id].nombre) || id;
    const card = makeStickerElement(info, { small:true });
    const meta = card.querySelector('.sticker-meta') || document.createElement('div');
    const badge = document.createElement('div'); badge.textContent = `Repetidas: ${count}`; badge.style.fontSize='0.75rem'; badge.style.marginTop='6px';
    meta.appendChild(badge); card.appendChild(meta);
    duplicatesList.appendChild(card);
  }
  if (dupCountSpan) dupCountSpan.textContent = String(total);
}

/* Pack modal handlers (unchanged) */
function showPackModal(pack) {
  if (!packModal || !packItems) return;
  packItems.innerHTML = '';
  for (let i=0;i<pack.length;i++){
    const p = pack[i];
    const base = { id: p.id, raw: p.raw, image: p.image || (p.raw && (p.raw.imageUrl||p.raw.image)) || (allStickers[p.id] && allStickers[p.id].image) };
    const el = makeStickerElement(base);
    el.classList.add('pack-item');
    el.style.animationDelay = `${i*70}ms`;
    packItems.appendChild(el);
  }
  packModal.classList.remove('hidden'); packModal.setAttribute('aria-hidden','false');
  try{ acceptPackBtn && acceptPackBtn.focus && acceptPackBtn.focus(); }catch(e){}
}
async function openPackFlow(buttonElement) {
  if (buttonElement) buttonElement.disabled = true;
  try {
    const res = await api.requestPack();
    currentPack = res.pack || [];
    showPackModal(currentPack);
  } catch(e) { console.error(e); showToast('Error al abrir sobre',{type:'danger'}); }
  finally { if (buttonElement) buttonElement.disabled = false; }
}
discardPackBtn && discardPackBtn.addEventListener('click', ()=>{ try{document.activeElement.blur()}catch(e){}; packModal.classList.add('hidden'); packModal.setAttribute('aria-hidden','true'); (document.getElementById('open-pack-btn')||document.getElementById('btn-open-pack'))?.focus(); });

acceptPackBtn && acceptPackBtn.addEventListener('click', ()=>{
  for (const p of currentPack) {
    const mockId = p.id || (p.raw && apiCodeToMockId(p.raw.code||p.raw.id)) || null;
    if (!mockId) continue;
    // find api country
    let found = null;
    for (const apiC of Object.keys(catalogByApiCountry||{})) {
      const cards = catalogByApiCountry[apiC].cards || [];
      if (cards.find(cd => apiCodeToMockId(cd.code||cd.id) === mockId)) { found = apiC; break; }
    }
    if (!found && allStickers[mockId] && allStickers[mockId].country) {
      const maybe = allStickers[mockId].country;
      if (state.album[maybe]) found = maybe;
    }
    if (!found) continue;
    state.album[found] = state.album[found] || { placed:[], missing:[] };
    const albumCountry = state.album[found];
    if (!albumCountry.placed.includes(mockId)) {
      albumCountry.placed.push(mockId);
      const idx = albumCountry.missing.indexOf(mockId);
      if (idx>=0) albumCountry.missing.splice(idx,1);
    } else {
      state.duplicates[mockId] = (state.duplicates[mockId]||0)+1;
    }
  }
  api.saveState(state);
  renderAlbum(); renderDuplicates(); updateDupCount();
  try{ acceptPackBtn.blur() }catch(e){}
  packModal.classList.add('hidden'); packModal.setAttribute('aria-hidden','true');
  (document.getElementById('open-pack-btn')||document.getElementById('btn-open-pack'))?.focus();
  showToast('Sobre agregado al álbum',{duration:1500});
});

/* Helpers: checkDuplicates/reconcile (as before) */
function checkDuplicates() {
  const duplicates = state.duplicates || {};
  const dupKeys = Object.keys(duplicates);
  const placedSet = new Set();
  for (const apiC of Object.keys(state.album||{})) (state.album[apiC].placed||[]).forEach(id=>placedSet.add(id));
  const trueRepeats = dupKeys.filter(k=>placedSet.has(k)).map(k=>({id:k,count:duplicates[k],name:(catalogCardByMockId[k] && getFullName(catalogCardByMockId[k]))||(allStickers[k]&&allStickers[k].nombre)||k}));
  const orphan = dupKeys.filter(k=>!placedSet.has(k)).map(k=>({id:k,count:duplicates[k],name:(catalogCardByMockId[k] && getFullName(catalogCardByMockId[k]))||(allStickers[k]&&allStickers[k].nombre)||k}));
  return { trueRepeats, orphanDuplicates: orphan };
}
function reconcileDuplicates() {
  const before = checkDuplicates();
  const moved = []; const errors = [];
  for (const entry of before.orphanDuplicates) {
    const key = entry.id;
    let foundApi = null;
    for (const apiC of Object.keys(catalogByApiCountry||{})) {
      const cards = catalogByApiCountry[apiC].cards || [];
      if (cards.find(cd => apiCodeToMockId(cd.code||cd.id) === key)) { foundApi = apiC; break; }
    }
    if (!foundApi && allStickers[key] && allStickers[key].country) {
      if (state.album[allStickers[key].country]) foundApi = allStickers[key].country;
    }
    if (!foundApi) { errors.push({key,reason:'no mapping'}); continue;}
    state.album[foundApi] = state.album[foundApi] || { placed:[], missing:[] };
    if (!state.album[foundApi].placed.includes(key)) {
      state.album[foundApi].placed.push(key);
      const idx = state.album[foundApi].missing.indexOf(key); if (idx>=0) state.album[foundApi].missing.splice(idx,1);
      state.duplicates[key] = Math.max(0,(state.duplicates[key]||1)-1); if (state.duplicates[key]===0) delete state.duplicates[key];
      moved.push({id:key,to:foundApi});
    }
  }
  if (moved.length) api.saveState(state);
  renderAlbum(); renderDuplicates(); updateDupCount();
  return {before, moved, errors, after: checkDuplicates()};
}

/* Boot */
async function boot() {
  const savedKey = localStorage.getItem('album_api_key'); if (savedKey) api.setApiKey(savedKey);
  btnAlbum && btnAlbum.addEventListener('click', ()=>showView('album-view', btnAlbum));
  btnOpenPack && btnOpenPack.addEventListener('click', ()=>showView('pack-view', btnOpenPack));
  btnDuplicates && btnDuplicates.addEventListener('click', ()=>{ showView('duplicates-view', btnDuplicates); renderDuplicates(); });
  btnTrades && btnTrades.addEventListener('click', ()=>showView('trades-view', btnTrades));

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
          const code = card.code || card.id; if (!code) continue;
          const mockId = apiCodeToMockId(code); catalogCardByMockId[mockId] = card;
        }
      }
    }
  } catch(e){ console.warn('catalog map fail', e); catalogByApiCountry={}; catalogCardByMockId={}; }

  // auto reconcile
  const repair = reconcileDuplicates();
  if (repair.moved && repair.moved.length) showToast(`${repair.moved.length} repetida(s) pegada(s) automáticamente`, {duration:2200});

  updateDupCount(); renderAlbum(); renderDuplicates(); populateTradeSelectors();
  if (typeof window !== 'undefined') {
    window.appState = ()=>state;
    window.apiCatalogByApiCountry = ()=>catalogByApiCountry;
    window.apiCatalogCards = ()=>catalogCardByMockId;
    window.checkDuplicates = ()=>checkDuplicates();
    window.reconcileDuplicates = ()=>reconcileDuplicates();
  }
  if (api.isRemote()) showToast('Conectado a API remota', { duration: 1200 });
}
boot();