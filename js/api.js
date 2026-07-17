// Punto central para integrar la API real en el futuro.
// Actualmente devuelve promesas que usan datos mock (localStorage + mockData).
// Reemplazar las implementaciones por fetch(...) y la conexión con Socket.IO cuando la API esté disponible.

import { countries, allStickers } from './mockData.js';

const STORAGE_KEY = 'album_state_v1';

// Simular delay
function delay(ms=400){ return new Promise(r=>setTimeout(r,ms)); }

export const api = {
  // Devuelve estado inicial (album, inventario, repetidas) desde localStorage o crea uno nuevo.
  async getInitialState(){
    await delay(200);
    const raw = localStorage.getItem(STORAGE_KEY);
    if(raw) return JSON.parse(raw);
    // crear estado base: album vacío (sin pegadas) y sin repetidas
    const album = {};
    for(const c of countries){
      album[c.code] = { placed: [], missing: c.stickers.map(s=>s.id) };
    }
    const state = { album, inventory: {}, duplicates: {}, apiKey: 'MOCK-API-KEY' };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return state;
  },

  async saveState(state){
    await delay(120);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return { ok:true };
  },

  // Solicitar un sobre: 7 barajitas aleatorias (muestra ids)
  async requestPack(){
    await delay(400);
    const allIds = Object.keys(allStickers);
    const pack = [];
    for(let i=0;i<7;i++){
      const id = allIds[Math.floor(Math.random()*allIds.length)];
      pack.push(allStickers[id]);
    }
    return { pack };
  },

  // Enviar oferta de intercambio (mock)
  async sendOffer({ fromApiKey, toGroup, offeredId, desiredId }){
    await delay(200);
    // En un backend real devolvería la oferta creada/resultado
    return { ok:true, offer:{ id: `OF-${Date.now()}`, from: fromApiKey||'MOCK', to: toGroup, offeredId, desiredId, status:'pending' } };
  }
};

// Nota: reemplaza la implementación por llamadas HTTP reales y envía la apiKey en headers.