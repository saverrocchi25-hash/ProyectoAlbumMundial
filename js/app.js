// Entrada principal de la SPA.
// Usa módulos: mockData.js y api.js
import { countries, allStickers } from './mockData.js';
import { api } from './api.js';

// Elementos UI
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
const lastPack = document.getElementById('last-pack');

const duplicatesList = document.getElementById('duplicates-list');
const myDuplicateSelect = document.getElementById('my-duplicate-select');
const desiredSelect = document.getElementById('desired-select');
const sendOfferBtn = document.getElementById('send-offer');
const incomingOffers = document.getElementById('incoming-offers');

let state = null;
let currentPack = [];

// Navigation
btnAlbum.addEventListener('click', ()=>showView('album-view', btnAlbum));
btnOpenPack.addEventListener('click', ()=>showView('pack-view', btnOpenPack));
btnDuplicates.addEventListener('click', ()=>showView('duplicates-view', btnDuplicates));
btnTrades.addEventListener('click', ()=>showView('trades-view', btnTrades));

function showView(id, btn){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b=>b.setAttribute('aria-pressed','false'));
  if(btn) btn.setAttribute('aria-pressed','true');
}

// Template helpers
function makeStickerElement(sticker, opts={}){
  const tmpl = document.getElementById('sticker-template');
  const node = tmpl.content.firstElementChild.cloneNode(true);
  const img = node.querySelector('.sticker-img');
  img.src = sticker.image;
  img.alt = sticker.nombre;
  node.querySelector('.sticker-caption').textContent = sticker.nombre;
  node.querySelector('.sticker-id').textContent = sticker.id;
  node.querySelector('.sticker-role').textContent = sticker.rol || '';
  if(opts.small) node.classList.add('small');
  return node;
}

// Render album grid (country cards)
function renderAlbum(){
  albumGrid.innerHTML = '';
  for(const c of countries){
    const card = document.createElement('section');
    card.className = 'country-card';
    const header = document.createElement('h3');
    header.textContent = `${c.name} (${c.code})`;
    card.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'stickers-grid';
    // for each sticker slot
    for(const s of c.stickers){
      const slot = document.createElement('div');
      slot.className = 'sticker-slot';
      const owned = state.album[c.code].placed.includes(s.id);
      const copies = state.duplicates[s.id] || 0;
      if(owned){
        slot.classList.add('sticker-placed');
        const img = document.createElement('img');
        img.src = s.image;
        img.alt = s.nombre;
        slot.appendChild(img);
      } else {
        const img = document.createElement('img');
        img.src = s.image;
        img.alt = 'vacía';
        img.className = 'sticker-empty';
        slot.appendChild(img);
      }
      if(copies>0){
        const badge = document.createElement('div');
        badge.className = 'dup-badge';
        badge.textContent = `x${copies}`;
        badge.style.position='absolute';
        badge.style.bottom='6px';
        badge.style.right='6px';
        badge.style.background='rgba(0,0,0,0.6)';
        badge.style.color='white';
        badge.style.fontSize='0.7rem';
        badge.style.padding='2px 6px';
        badge.style.borderRadius='999px';
        slot.appendChild(badge);
      }
      grid.appendChild(slot);
    }

    card.appendChild(grid);
    albumGrid.appendChild(card);
  }
}

// Load state from API (mock)
async function boot(){
  state = await api.getInitialState();
  updateDupCount();
  renderAlbum();
  renderDuplicates();
  populateTradeSelectors();
  startFakeSocket();
}
boot();

// Pack flow
openPackBtn.addEventListener('click', async ()=>{
  openPackBtn.disabled = true;
  const res = await api.requestPack();
  currentPack = res.pack;
  showPackModal(currentPack);
  openPackBtn.disabled = false;
});

document.getElementById('open-pack-btn').addEventListener('click', ()=>openPackBtn.click());

function showPackModal(pack){
  packItems.innerHTML='';
  for(const s of pack){
    const el = makeStickerElement(s);
    packItems.appendChild(el);
  }
  packModal.classList.remove('hidden');
  packModal.setAttribute('aria-hidden','false');
}

discardPackBtn.addEventListener('click', ()=>{
  packModal.classList.add('hidden');
  packModal.setAttribute('aria-hidden','true');
});

acceptPackBtn.addEventListener('click', ()=>{
  // Agregar pack al inventario/album: si no existe en placed -> pegarlo (primera copia); si ya existe -> duplicada
  for(const p of currentPack){
    const albumCountry = state.album[p.country];
    if(!albumCountry) continue;
    const already = albumCountry.placed.includes(p.id);
    if(!already){
      albumCountry.placed.push(p.id);
      // remove from missing
      const idx = albumCountry.missing.indexOf(p.id);
      if(idx>=0) albumCountry.missing.splice(idx,1);
    } else {
      state.duplicates[p.id] = (state.duplicates[p.id]||0)+1;
    }
  }
  api.saveState(state);
  renderAlbum();
  renderDuplicates();
  populateTradeSelectors();
  packModal.classList.add('hidden');
  packModal.setAttribute('aria-hidden','true');
});

// Duplicates view
function renderDuplicates(){
  duplicatesList.innerHTML='';
  duplicatesList.classList.add('stickers-grid');
  for(const id of Object.keys(state.duplicates)){
    const count = state.duplicates[id];
    if(count<=0) continue;
    const s = allStickers[id];
    const card = makeStickerElement(s,{small:true});
    const meta = card.querySelector('.sticker-meta');
    const badge = document.createElement('div');
    badge.textContent = `Repetidas: ${count}`;
    badge.style.fontSize='0.75rem';
    badge.style.color='var(--muted)';
    meta.appendChild(badge);
    duplicatesList.appendChild(card);
  }
  updateDupCount();
}

// Update duplicates counter in header
function updateDupCount(){
  const total = Object.values(state.duplicates||{}).reduce((a,b)=>a+b,0);
  dupCountSpan.textContent = String(total);
}

// Trade UI: selectors
function populateTradeSelectors(){
  // my duplicates
  myDuplicateSelect.innerHTML='';
  for(const id of Object.keys(state.duplicates)){
    const count = state.duplicates[id];
    if(count>0){
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = `${id} — ${allStickers[id].nombre} (x${count})`;
      myDuplicateSelect.appendChild(opt);
    }
  }
  if(!myDuplicateSelect.children.length){
    const opt = document.createElement('option'); opt.value=''; opt.textContent='(No tienes repetidas)';
    myDuplicateSelect.appendChild(opt);
  }

  // desired: mostrar faltantes de todo el álbum
  desiredSelect.innerHTML='';
  for(const c of countries){
    const missing = state.album[c.code].missing;
    for(const id of missing){
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = `${id} — ${c.name} / ${allStickers[id].nombre}`;
      desiredSelect.appendChild(opt);
    }
  }
}

sendOfferBtn.addEventListener('click', async ()=>{
  const offeredId = myDuplicateSelect.value;
  const desiredId = desiredSelect.value;
  const toGroup = document.getElementById('target-group').value;
  if(!offeredId || !desiredId){ alert('Selecciona ofrecida y deseada'); return; }
  const res = await api.sendOffer({ fromApiKey: state.apiKey, toGroup, offeredId, desiredId });
  // Simular que la oferta se envía y se consume localmente
  appendIncomingOffer(res.offer); // en mock lo veremos como entrada también
  state.duplicates[offeredId] = Math.max(0,(state.duplicates[offeredId]||1)-1);
  api.saveState(state);
  renderDuplicates();
  populateTradeSelectors();
});

// Incoming offers list (mock)
function appendIncomingOffer(offer){
  const item = document.createElement('div');
  item.className = 'offer';
  item.innerHTML = `<div>
    <strong>${offer.from}</strong> ofrece <em>${offer.offeredId}</em> por <em>${offer.desiredId}</em>
  </div>`;
  const actions = document.createElement('div');
  const accept = document.createElement('button'); accept.textContent='Aceptar'; accept.className='primary';
  const reject = document.createElement('button'); reject.textContent='Rechazar';
  actions.appendChild(accept); actions.appendChild(reject);
  item.appendChild(actions);
  incomingOffers.prepend(item);

  accept.addEventListener('click', ()=>{
    // Simular aceptar: intercambiar si posible
    if(!state.duplicates[offer.offeredId] || state.duplicates[offer.offeredId]<=0){
      alert('No tienes esa repetida para aceptar (mock).');
      return;
    }
    // hacer swap: restar repetida, marcar desiredId como placed (si no está)
    state.duplicates[offer.offeredId] = Math.max(0, state.duplicates[offer.offeredId]-1);
    // colocar desiredId en album
    const targetSticker = allStickers[offer.desiredId];
    if(targetSticker){
      const albumCountry = state.album[targetSticker.country];
      if(albumCountry && !albumCountry.placed.includes(offer.desiredId)){
        albumCountry.placed.push(offer.desiredId);
        const idx = albumCountry.missing.indexOf(offer.desiredId);
        if(idx>=0) albumCountry.missing.splice(idx,1);
      }
    }
    api.saveState(state);
    renderAlbum();
    renderDuplicates();
    item.remove();
    alert('Intercambio aceptado (mock).');
  });

  reject.addEventListener('click', ()=>{
    item.remove();
  });
}

/* ---------- Fake Socket (simulación de eventos en vivo) ---------- */
/* Cuando tengas Socket.IO real, reemplaza esta lógica por:
   import { io } from "socket.io-client";
   const socket = io(API_URL, { auth: { apiKey: state.apiKey } });
   socket.on('offer', handleOffer);
*/
function startFakeSocket(){
  // cada 20-45s simula una oferta entrante hacia este usuario
  setInterval(()=>{
    // crear offer mock
    const allIds = Object.keys(allStickers);
    const offeredId = allIds[Math.floor(Math.random()*allIds.length)];
    // desired: intenta elegir una faltante real
    const missingList = [];
    for(const c of countries) missingList.push(...state.album[c.code].missing);
    const desiredId = missingList.length ? missingList[Math.floor(Math.random()*missingList.length)] : allIds[Math.floor(Math.random()*allIds.length)];
    const offer = { id:`IN-${Date.now()}`, from:'Grupo-Mock', to:state.apiKey, offeredId, desiredId, status:'pending' };
    appendIncomingOffer(offer);
  }, 30000 + Math.random()*15000);
}

/* ---------- Utilities (pequeñas helpers extra) ---------- */
window.appState = () => state; // para debugging desde consola