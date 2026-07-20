import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../data');
const DB_FILE = path.join(DATA_DIR, 'store.json');

const DEFAULT_DATA = {
  rooms: [
    {
      id: 'room-001',
      name: '温馨客房',
      description: '30平米，独立卫浴，可住2人',
      area: '四川省 · 成都市',
      fullAddress: '四川省成都市成华区 朗诗·绿色街区 7号楼 1单元 305',
      blockedDates: [],
    },
  ],
  bookings: [],
  admin: {
    username: 'admin',
    password: 'admin123',
  },
};

/** Normalize legacy `string[]` or mixed entries to `{ date, reason? }[]`. */
export function normalizeBlockedDates(blockedDates) {
  if (!Array.isArray(blockedDates)) return [];

  const byDate = new Map();
  for (const entry of blockedDates) {
    if (typeof entry === 'string') {
      if (!entry) continue;
      if (!byDate.has(entry)) byDate.set(entry, { date: entry });
      continue;
    }
    if (entry && typeof entry === 'object' && typeof entry.date === 'string' && entry.date) {
      const next = { date: entry.date };
      if (typeof entry.reason === 'string' && entry.reason) {
        next.reason = entry.reason;
      }
      byDate.set(entry.date, next);
    }
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function blockedDateSet(blockedDates) {
  return new Set(normalizeBlockedDates(blockedDates).map((e) => e.date));
}

export function blockedReasonMap(blockedDates) {
  const map = new Map();
  for (const entry of normalizeBlockedDates(blockedDates)) {
    if (entry.reason) map.set(entry.date, entry.reason);
  }
  return map;
}

function ensureDb() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(DEFAULT_DATA, null, 2));
    return;
  }

  const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
  let changed = false;

  for (const room of data.rooms || []) {
    if (!room.area) {
      room.area = '四川省 · 成都市';
      changed = true;
    }
    if (!room.fullAddress) {
      room.fullAddress = '四川省成都市成华区 朗诗·绿色街区 7号楼 1单元 305';
      changed = true;
    }
    if (!Array.isArray(room.blockedDates)) {
      room.blockedDates = [];
      changed = true;
    } else {
      const normalized = normalizeBlockedDates(room.blockedDates);
      const before = JSON.stringify(room.blockedDates);
      const after = JSON.stringify(normalized);
      if (before !== after) {
        room.blockedDates = normalized;
        changed = true;
      }
    }
  }

  if (changed) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  }
}

export function readDb() {
  ensureDb();
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
}

export function writeDb(data) {
  ensureDb();
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

export function getRoomById(db, roomId) {
  return db.rooms.find((r) => r.id === roomId);
}

export function sanitizeRoom(room) {
  const { fullAddress, blockedDates, price, image, ...publicRoom } = room;
  return publicRoom;
}
