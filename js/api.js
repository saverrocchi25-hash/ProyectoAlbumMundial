// js/api.js
// Capa API: usa la API como fuente de verdad y construye `state.album` indexado por el código de país que devuelve la API.
// No altera datos de mockData ni campos de la API.

import { countries as mockCountries, allStickers as mockAllStickers } from './mockData.js';

const BASE_URL = 'https://sticker-album-server-proyect-production.up.railway.app';
const STORAGE_KEY = 'album_state_v1';
const STORAGE_API_KEY = 'album_api_key';

let API_KEY = null;
function delay(ms = 200) { return new Promise(r => setTimeout(r, ms)); }

// apiCode -> mock id (mock ids are used internally to identify stickers)
function apiCodeToMockId(apiCode) {
  if (!apiCode || typeof apiCode !== 'string') return apiCode;
  const parts = apiCode.split('-');
  const country = parts[0];
  const num = parseInt(parts[1], 10);
  if (Number.isNaN(num)) return apiCode;
  if (num === 1) return `${country}-00`;
  return `${country}-${String(num - 1).padStart(2, '0')}`;
}

// headers builder
function headersJson() {
  const h = { 'Content-Type': 'application/json' };
  if (API_KEY) {
    h['Authorization'] = API_KEY;
    h['x-api-key'] = API_KEY;
  }
  return h;
}

// debug fetch forcing no-store to avoid 304 issues
async function debugFetch(url, opts = {}) {
  opts.headers = Object.assign({}, opts.headers || {}, headersJson());
  opts.cache = 'no-store';
  const method = (opts.method || 'GET').toUpperCase();
  console.info('[api] fetch ->', { url, method, headers: opts.headers, cache: opts.cache });
  try {
    const res = await fetch(url, opts);
    let text = '<no body>';
    try { text = await res.clone().text(); } catch (e) {}
    if (!res.ok) console.error('[api] fetch ERROR', { url, status: res.status, body: text });
    else console.info('[api] fetch OK', { url, status: res.status, body: text });
    return res;
  } catch (err) {
    console.error('[api] fetch exception', err);
    throw err;
  }
}

export const api = {
  setApiKey(key) {
    API_KEY = key ? String(key).trim() : null;
    if (API_KEY) localStorage.setItem(STORAGE_API_KEY, API_KEY);
    else localStorage.removeItem(STORAGE_API_KEY);
    console.info('[api] API key set:', !!API_KEY);
  },
  isRemote() { return Boolean(API_KEY); },
  debugHeaders() { return headersJson(); },

  // Build initial state. If API present, album is keyed by API country code (e.g., AUT, AUS, ARG, ALG).
  async getInitialState() {
    // fallback to local mock state if no API key
    if (!API_KEY) {
      await delay(120);
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
      const album = {};
      for (const c of mockCountries) album[c.code] = { placed: [], missing: c.stickers.map(s => s.id) };
      const st = { album, inventory: {}, duplicates: {}, apiKey: null };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(st));
      return st;
    }

    try {
      // fetch catalog and album and duplicates
      const cardsRes = await debugFetch(`${BASE_URL}/api/cards`, { method: 'GET' });
      if (!cardsRes.ok) throw new Error(`GET /api/cards ${cardsRes.status}`);
      const cardsJson = await cardsRes.json();

      const albumRes = await debugFetch(`${BASE_URL}/api/album`, { method: 'GET' });
      if (!albumRes.ok) {
        const t = await albumRes.text().catch(()=> '');
        throw new Error(`GET /api/album ${albumRes.status} - ${t}`);
      }
      const albumJson = await albumRes.json();

      const dupRes = await debugFetch(`${BASE_URL}/api/inventory/duplicates`, { method: 'GET' });
      let duplicatesMap = {};
      if (dupRes.ok) {
        const dupJson = await dupRes.json();
        (dupJson.duplicates || []).forEach(d => {
          const mockId = apiCodeToMockId(d.code || d.id);
          duplicatesMap[mockId] = d.duplicatesAvailable || d.count || 0;
        });
      }

      const groupRes = await debugFetch(`${BASE_URL}/api/groups/me`, { method: 'GET' });
      let groupInfo = null;
      if (groupRes.ok) groupInfo = (await groupRes.json()).group || {};

      // collect which mockIds are placed according to server album
      const serverPlacedSet = new Set();
      (function collectPlaced(o) {
        if (!o || typeof o !== 'object') return;
        if (Array.isArray(o)) return o.forEach(collectPlaced);
        if ((o.code || o.id) && o.status) {
          const code = o.code || o.id;
          const mockId = apiCodeToMockId(code);
          const st = String(o.status).toUpperCase();
          if (['STUCK','OWNED','PLACED','DONE','INSTALLED'].includes(st) || st.indexOf('OWN')>=0) serverPlacedSet.add(mockId);
        }
        Object.values(o).forEach(collectPlaced);
      })(albumJson);

      // Build albumState keyed by API country code using cardsJson as authoritative list of what belongs to each country.
      const albumState = {};
      if (cardsJson && Array.isArray(cardsJson.countries) && cardsJson.countries.length) {
        for (const apiCountry of cardsJson.countries) {
          const apiCode = (apiCountry.countryCode || apiCountry.code || (apiCountry.country && apiCountry.country.code) || '').toString().toUpperCase();
          if (!apiCode) continue;
          albumState[apiCode] = { placed: [], missing: [] };
          const cards = apiCountry.cards || apiCountry.cardsList || apiCountry.cards || [];
          if (Array.isArray(cards) && cards.length) {
            for (const card of cards) {
              const code = card.code || card.id;
              if (!code) continue;
              const mockId = apiCodeToMockId(code);
              if (serverPlacedSet.has(mockId)) albumState[apiCode].placed.push(mockId);
              else albumState[apiCode].missing.push(mockId);
            }
          } else {
            // if no card list present, try to assemble from mockAllStickers by matching names — omitted here to avoid false matches
            // leave empty missing array (safer)
            albumState[apiCode].missing = [];
          }
        }
      } else {
        // fallback: use mockCountries as keys (existing behavior)
        for (const c of mockCountries) {
          albumState[c.code] = { placed: [], missing: [] };
          for (const s of c.stickers) {
            if (serverPlacedSet.has(s.id)) albumState[c.code].placed.push(s.id);
            else albumState[c.code].missing.push(s.id);
          }
        }
      }

      const result = {
        album: albumState,
        duplicates: duplicatesMap,
        inventory: {},
        apiKey: API_KEY,
        groupInfo,
        rawCatalog: cardsJson,
        rawAlbum: albumJson
      };

      localStorage.setItem(STORAGE_KEY, JSON.stringify(result));
      return result;

    } catch (err) {
      console.warn('[api] getInitialState failed, falling back', err);
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
      const album = {};
      for (const c of mockCountries) album[c.code] = { placed: [], missing: c.stickers.map(s => s.id) };
      const st = { album, inventory: {}, duplicates: {}, apiKey: null };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(st));
      return st;
    }
  },

  // requestPack returns items normalized to use mockId in .id and keeps raw API card in .raw
  async requestPack() {
    if (!API_KEY) {
      await delay(300);
      const allIds = Object.keys(mockAllStickers);
      const pack = [];
      for (let i = 0; i < 7; i++) {
        const id = allIds[Math.floor(Math.random() * allIds.length)];
        pack.push(mockAllStickers[id]);
      }
      return { pack };
    }
    try {
      const res = await debugFetch(`${BASE_URL}/api/packs/open`, { method: 'GET' });
      if (!res.ok) {
        const txt = await res.text().catch(()=>'');
        throw new Error(`open pack failed: ${res.status} - ${txt}`);
      }
      const json = await res.json();
      const apiPack = json.pack || [];
      const pack = apiPack.map(card => {
        const apiCode = card.code || card.id || card.apiCode || null;
        const mockId = apiCode ? apiCodeToMockId(apiCode) : (card.id || null);
        return {
          id: mockId || (card.id || apiCode),
          apiCode: apiCode || undefined,
          nombre: card.name || card.playerName || card.fullName || null,
          role: card.role || null,
          image: card.imageUrl || card.image || (mockAllStickers[mockId] && mockAllStickers[mockId].image) || 'assets/silhouette.svg',
          raw: card
        };
      });
      return { pack, unopenedPacks: json.unopenedPacks, raw: json };
    } catch (err) {
      console.error('[api] requestPack error', err);
      throw err;
    }
  },

  async stickCard(code) {
    // convert mockId -> api code for server if needed
    let cardCode = code;
    if (cardCode && cardCode.includes('-')) {
      const parts = cardCode.split('-');
      const country = parts[0];
      const suf = parts[1];
      if (suf === '00') cardCode = `${country}-1`;
      else {
        const idx = parseInt(suf, 10);
        cardCode = `${country}-${idx + 1}`;
      }
    }
    if (!API_KEY) {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ok: false, error: 'no local state' };
      const st = JSON.parse(raw);
      return { ok: true, state: st };
    }

    try {
      const res = await debugFetch(`${BASE_URL}/api/album/stick`, { method: 'POST', body: JSON.stringify({ cardCode }) });
      const body = await res.json().catch(()=>null);
      if (!res.ok) return { ok: false, error: body || `status ${res.status}` };
      return { ok: true, body };
    } catch (err) {
      console.error('[api] stickCard error', err);
      return { ok: false, error: String(err) };
    }
  },

  async saveState(stateObj) {
    await delay(80);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stateObj));
    return { ok: true };
  },

  _STORAGE_KEY: STORAGE_KEY
};

if (typeof window !== 'undefined') {
  window.api = api;
  window.apiDebug = { debugHeaders: () => headersJson(), lastBaseUrl: BASE_URL };
}