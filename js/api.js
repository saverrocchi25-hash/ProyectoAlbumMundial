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
export function mockIdToApiCode(mockId) {
  if (!mockId || typeof mockId !== 'string') return mockId;
  const parts = mockId.split('-');
  const country = parts[0];
  const num = parseInt(parts[1], 10);
  if (Number.isNaN(num)) return mockId;
  if (num === 0) return `${country}-1`;
  return `${country}-${num + 1}`;
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

async function requestJson(path, options = {}) {
  const res = await debugFetch(`${BASE_URL}${path}`, options);
  const text = await res.text().catch(() => '');
  let parsed = null;
  if (text) {
    try { parsed = JSON.parse(text); } catch (e) { parsed = text; }
  }
  if (!res.ok) {
    const msg = parsed && typeof parsed === 'object' && (parsed.error || parsed.message) ? (parsed.error || parsed.message) : text || `status ${res.status}`;
    throw new Error(msg);
  }
  return parsed;
}

function normalizeGroupsPayload(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.groups)) return payload.groups;
  if (Array.isArray(payload.data)) return payload.data;
  if (payload.data && Array.isArray(payload.data.groups)) return payload.data.groups;
  if (payload.result && Array.isArray(payload.result.groups)) return payload.result.groups;
  return [];
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
      if (groupRes.ok) {
        const groupBody = await groupRes.json().catch(() => null);
        groupInfo = (groupBody && (groupBody.group || groupBody.data || groupBody)) || {};
      }

      const groupsRes = await debugFetch(`${BASE_URL}/api/groups`, { method: 'GET' });
      let allGroups = [];
      if (groupsRes.ok) {
        const groupsBody = await groupsRes.json().catch(() => null);
        allGroups = normalizeGroupsPayload(groupsBody);
      }

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
        allGroups,
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

  async listTrades() {
    if (!API_KEY) return { ok: false, offers: [], error: 'Sin API key configurada' };

    try {
      const payload = await requestJson('/api/trades', { method: 'GET' });
      const offers = Array.isArray(payload)
        ? payload
        : (payload && Array.isArray(payload.trades)
          ? payload.trades
          : (payload && Array.isArray(payload.data)
            ? payload.data
            : (payload && Array.isArray(payload.offers)
              ? payload.offers
              : [])));
      return { ok: true, offers, raw: payload };
    } catch (err) {
      return { ok: false, offers: [], error: err && err.message ? err.message : 'No se pudieron cargar las ofertas' };
    }
  },

  async createTrade(payload = {}) {
    if (!API_KEY) return { ok: false, error: 'Sin API key configurada' };
    // Use a single canonical payload to avoid ambiguous server errors
    const bodyPayload = {
      offeredCardCode: payload.offeredCardCode,
      requestedCardCode: payload.requestedCardCode,
      targetGroupId: payload.targetGroupId
    };
    try { console.info('[api.createTrade] sending canonical payload', JSON.stringify(bodyPayload)); } catch (e) { console.info('[api.createTrade] sending canonical payload', bodyPayload); }
    try {
      const res = await debugFetch(`${BASE_URL}/api/trades`, { method: 'POST', body: JSON.stringify(bodyPayload) });
      let text = '';
      try { text = await res.text(); } catch (e) { text = ''; }
      if (res.ok) {
        let parsed = null;
        try { parsed = text ? JSON.parse(text) : null; } catch (e) { parsed = text; }
        return { ok: true, result: parsed, payload: bodyPayload };
      }
      const msg = text || `status ${res.status}`;
      console.error('[api.createTrade] server rejected payload', { bodyPayload, status: res.status, body: text });
      return { ok: false, error: msg };
    } catch (err) {
      console.error('[api.createTrade] network/error', err);
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  },

  async updateTrade(tradeId, action) {
    if (!tradeId) return { ok: false, error: 'Falta el id de la oferta' };
    if (!API_KEY) return { ok: false, error: 'Sin API key configurada' };

    const actionKey = String(action || '').toLowerCase();
    let endpoint;
    if (actionKey === 'accept') endpoint = `/api/trades/${tradeId}/accept`;
    else if (actionKey === 'reject') endpoint = `/api/trades/${tradeId}/reject`;
    else if (actionKey === 'cancel') endpoint = `/api/trades/${tradeId}/cancel`;
    else return { ok: false, error: 'Acción de intercambio no válida' };

    try {
      const result = await requestJson(endpoint, { method: 'POST' });
      return { ok: true, result };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : 'No se pudo actualizar la oferta' };
    }
  },

  async listGroups() {
    if (!API_KEY) return { ok: false, groups: [], error: 'Sin API key configurada' };
    try {
      const payload = await requestJson('/api/groups', { method: 'GET' });
      const groups = normalizeGroupsPayload(payload);
      return { ok: true, groups };
    } catch (err) {
      return { ok: false, groups: [], error: err && err.message ? err.message : 'No se pudieron cargar los grupos' };
    }
  },

  // Try to fetch duplicates/inventory for a given group id. Returns set of API codes.
  async getGroupDuplicates(groupId) {
    if (!API_KEY) return { ok: false, codes: [], error: 'Sin API key configurada' };
    if (!groupId) return { ok: false, codes: [], error: 'Falta groupId' };
    const tryUrls = [
      `/api/groups/${groupId}/duplicates`,
      `/api/groups/${groupId}/inventory`,
      `/api/groups/${groupId}`
    ];
    let lastErr = null;
    for (const url of tryUrls) {
      try {
        const res = await debugFetch(`${BASE_URL}${url}`, { method: 'GET' });
        if (!res.ok) {
          let t = '';
          try { t = await res.text(); } catch (e) { t = ''; }
          lastErr = new Error(t || `status ${res.status}`);
          continue;
        }
        const body = await res.json().catch(() => null);
        const codesSet = new Set();
        // recursive collector
        (function collect(o) {
          if (!o) return;
          if (typeof o === 'string') {
            // simple pattern like ARG-1
            const s = o.trim();
            if (s.match(/^[A-Za-z]{2,4}-\d+$/)) codesSet.add(s.toUpperCase());
            return;
          }
          if (Array.isArray(o)) return o.forEach(collect);
          if (typeof o === 'object') {
            // common fields
            const cands = [o.code, o.id, o.cardCode, o.card_code, o.apiCode, o.api_code, o.countryCode];
            cands.forEach(v => { if (v && typeof v === 'string' && v.trim()) { if (v.match(/^[A-Za-z]{2,4}-\d+$/)) codesSet.add(v.toUpperCase()); } });
            // dive deeper
            Object.values(o).forEach(collect);
          }
        })(body);
        return { ok: true, codes: Array.from(codesSet) };
      } catch (err) {
        lastErr = err;
      }
    }
    return { ok: false, codes: [], error: lastErr && lastErr.message ? lastErr.message : 'No se pudo obtener duplicados del grupo' };
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