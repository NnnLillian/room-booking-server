import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { readDb, writeDb, getRoomById, sanitizeRoom } from './db.js';
import {
  getDateRange,
  datesOverlap,
  parseDate,
  startOfToday,
  expirePastBookings,
} from './utils.js';

const app = express();
const PORT = process.env.PORT || 9876;
const DEV_MOCK_WX = process.env.DEV_MOCK_WX === 'true' || !process.env.WX_APPID;

app.use(cors());
app.use(express.json());

const adminSessions = new Map();
const guestSessions = new Map();

function adminAuthMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token || !adminSessions.has(token)) {
    return res.status(401).json({ error: '未授权，请先登录' });
  }
  req.admin = adminSessions.get(token);
  next();
}

function guestAuthMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token || !guestSessions.has(token)) {
    return res.status(401).json({ error: '请先登录' });
  }
  req.guest = guestSessions.get(token);
  next();
}

function withExpiredBookings(db) {
  if (expirePastBookings(db)) {
    writeDb(db);
  }
  return db;
}

function getBookingOccupiedDates(roomId, excludeBookingId) {
  const db = withExpiredBookings(readDb());
  const occupied = new Set();

  for (const booking of db.bookings) {
    if (booking.roomId !== roomId) continue;
    if (booking.id === excludeBookingId) continue;
    if (!['pending', 'approved'].includes(booking.status)) continue;

    getDateRange(booking.checkIn, booking.checkOut).forEach((d) => occupied.add(d));
  }

  return occupied;
}

function getBlockedDates(roomId) {
  const db = readDb();
  const room = getRoomById(db, roomId);
  return new Set(room?.blockedDates || []);
}

function getUnavailableDates(roomId, excludeBookingId) {
  const bookingDates = getBookingOccupiedDates(roomId, excludeBookingId);
  const blocked = getBlockedDates(roomId);
  return { bookingDates, blocked, all: new Set([...bookingDates, ...blocked]) };
}

function getDateReason(dateStr, bookingDates, blocked) {
  const date = parseDate(dateStr);
  if (date && date < startOfToday()) return 'past';
  if (blocked.has(dateStr)) return 'blocked';
  if (bookingDates.has(dateStr)) return 'booking';
  return null;
}

function enrichBooking(booking, db, includeAddress = false) {
  const room = getRoomById(db, booking.roomId);
  const result = {
    ...booking,
    room: room ? sanitizeRoom(room) : null,
  };

  if (includeAddress && booking.status === 'approved' && room?.fullAddress) {
    result.fullAddress = room.fullAddress;
  }

  return result;
}

// --- WeChat Auth ---

app.post('/api/auth/wx', async (req, res) => {
  const { code } = req.body;
  if (!code) {
    return res.status(400).json({ error: '缺少 code' });
  }

  let openid;

  if (DEV_MOCK_WX) {
    openid = 'dev-' + crypto.createHash('sha256').update(code).digest('hex').slice(0, 16);
  } else {
    try {
      const params = new URLSearchParams({
        appid: process.env.WX_APPID,
        secret: process.env.WX_SECRET,
        js_code: code,
        grant_type: 'authorization_code',
      });
      const wxRes = await fetch(`https://api.weixin.qq.com/sns/jscode2session?${params}`);
      const data = await wxRes.json();
      if (data.errcode || !data.openid) {
        return res.status(401).json({ error: '微信登录失败', detail: data.errmsg });
      }
      openid = data.openid;
    } catch {
      return res.status(502).json({ error: '微信服务不可用' });
    }
  }

  const token = uuidv4();
  guestSessions.set(token, { openid });
  res.json({ token, openid });
});

// --- Rooms ---

app.get('/api/rooms', (_req, res) => {
  const db = readDb();
  res.json(db.rooms.map(sanitizeRoom));
});

app.get('/api/rooms/:id', (req, res) => {
  const db = readDb();
  const room = getRoomById(db, req.params.id);
  if (!room) return res.status(404).json({ error: '房间不存在' });
  res.json(sanitizeRoom(room));
});

app.get('/api/rooms/:id/availability', (req, res) => {
  const { startDate, endDate } = req.query;
  const db = withExpiredBookings(readDb());
  const room = getRoomById(db, req.params.id);
  if (!room) return res.status(404).json({ error: '房间不存在' });

  if (!startDate || !endDate) {
    return res.status(400).json({ error: '请选择 入住日期 与 离开日期' });
  }

  const start = parseDate(String(startDate));
  const end = parseDate(String(endDate));
  if (!start || !end || start >= end) {
    return res.status(400).json({ error: '日期区间无效' });
  }

  const { bookingDates, blocked, all: unavailable } = getUnavailableDates(room.id);
  const today = startOfToday();
  const rangeDates = getDateRange(String(startDate), String(endDate));

  const dates = rangeDates.map((dateStr) => {
    const date = parseDate(dateStr);
    const isPast = date < today;
    const isUnavailable = unavailable.has(dateStr);
    return {
      date: dateStr,
      available: !isPast && !isUnavailable,
      occupied: isUnavailable,
      blocked: blocked.has(dateStr),
      expired: isPast,
      reason: getDateReason(dateStr, bookingDates, blocked),
    };
  });

  res.json({
    roomId: room.id,
    startDate: String(startDate),
    endDate: String(endDate),
    dates,
  });
});

app.get('/api/rooms/:id/blocked-dates', adminAuthMiddleware, (req, res) => {
  const db = readDb();
  const room = getRoomById(db, req.params.id);
  if (!room) return res.status(404).json({ error: '房间不存在' });
  res.json({ roomId: room.id, blockedDates: room.blockedDates || [] });
});

app.post('/api/rooms/:id/blocked-dates', adminAuthMiddleware, (req, res) => {
  const { dates } = req.body;
  if (!Array.isArray(dates) || dates.length === 0) {
    return res.status(400).json({ error: '请提供 dates 数组' });
  }

  const today = startOfToday();
  const pastDates = dates.filter((d) => {
    const date = parseDate(d);
    return !date || date < today;
  });
  if (pastDates.length > 0) {
    return res.status(400).json({ error: '不能封禁今天之前的日期', pastDates });
  }

  const db = readDb();
  const room = getRoomById(db, req.params.id);
  if (!room) return res.status(404).json({ error: '房间不存在' });

  const set = new Set(room.blockedDates || []);
  dates.forEach((d) => set.add(d));
  room.blockedDates = [...set].sort();
  writeDb(db);

  res.json({ roomId: room.id, blockedDates: room.blockedDates });
});

app.delete('/api/rooms/:id/blocked-dates', adminAuthMiddleware, (req, res) => {
  const { dates } = req.body;
  if (!Array.isArray(dates) || dates.length === 0) {
    return res.status(400).json({ error: '请提供 dates 数组' });
  }

  const db = readDb();
  const room = getRoomById(db, req.params.id);
  if (!room) return res.status(404).json({ error: '房间不存在' });

  const remove = new Set(dates);
  room.blockedDates = (room.blockedDates || []).filter((d) => !remove.has(d));
  writeDb(db);

  res.json({ roomId: room.id, blockedDates: room.blockedDates });
});

// --- Bookings ---

app.get('/api/bookings', (req, res) => {
  const db = withExpiredBookings(readDb());
  const { openid, roomId, status } = req.query;
  const guestToken = req.headers.authorization?.replace('Bearer ', '');
  const isGuest = guestToken && guestSessions.has(guestToken);
  const isAdmin = guestToken && adminSessions.has(guestToken);

  let bookings = [...db.bookings];

  if (isGuest && !isAdmin) {
    bookings = bookings.filter((b) => b.openid === guestSessions.get(guestToken).openid);
  } else if (openid) {
    bookings = bookings.filter((b) => b.openid === openid);
  }

  if (roomId) bookings = bookings.filter((b) => b.roomId === roomId);
  if (status) bookings = bookings.filter((b) => b.status === status);

  bookings.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const includeAddress = isGuest && !isAdmin;
  res.json(bookings.map((b) => enrichBooking(b, db, includeAddress)));
});

app.post('/api/bookings', guestAuthMiddleware, (req, res) => {
  const { roomId, checkIn, checkOut, guestName, guestPhone, remark } = req.body;

  if (!roomId || !checkIn || !checkOut || !guestName || !guestPhone) {
    return res.status(400).json({ error: '请填写完整预订信息' });
  }

  const checkInDate = parseDate(checkIn);
  const checkOutDate = parseDate(checkOut);
  if (!checkInDate || !checkOutDate || checkInDate >= checkOutDate) {
    return res.status(400).json({ error: '入住/退房日期无效' });
  }

  if (checkInDate < startOfToday()) {
    return res.status(400).json({ error: '今天之前的行程不能预订' });
  }

  const db = withExpiredBookings(readDb());
  const room = getRoomById(db, roomId);
  if (!room) return res.status(404).json({ error: '房间不存在' });

  const requestedDates = getDateRange(checkIn, checkOut);
  const { all: unavailable } = getUnavailableDates(roomId);
  const conflictDates = requestedDates.filter((d) => unavailable.has(d));

  if (conflictDates.length > 0) {
    return res.status(409).json({
      error: '所选日期不可预订',
      conflictDates,
    });
  }

  const booking = {
    id: uuidv4(),
    roomId,
    checkIn,
    checkOut,
    guestName,
    guestPhone,
    openid: req.guest.openid,
    remark: remark || '',
    status: 'pending',
    nights: requestedDates.length,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  db.bookings.push(booking);
  writeDb(db);

  res.status(201).json(booking);
});

app.patch('/api/bookings/:id/status', adminAuthMiddleware, (req, res) => {
  const { status, rejectReason } = req.body;
  const allowed = ['approved', 'rejected', 'cancelled'];

  if (!allowed.includes(status)) {
    return res.status(400).json({ error: '无效的状态' });
  }

  const db = withExpiredBookings(readDb());
  const booking = db.bookings.find((b) => b.id === req.params.id);
  if (!booking) return res.status(404).json({ error: '订单不存在' });

  if (booking.status === 'expired') {
    return res.status(400).json({ error: '已过期订单不可操作' });
  }

  if (status === 'approved') {
    const checkInDate = parseDate(booking.checkIn);
    if (checkInDate && checkInDate < startOfToday()) {
      booking.status = 'expired';
      booking.updatedAt = new Date().toISOString();
      writeDb(db);
      return res.status(400).json({ error: '入住日期已过，订单已过期，无法通过' });
    }

    const requestedDates = getDateRange(booking.checkIn, booking.checkOut);
    const { all: unavailable } = getUnavailableDates(booking.roomId, booking.id);
    if (datesOverlap(requestedDates, [...unavailable])) {
      return res.status(409).json({ error: '该日期不可预订，无法通过' });
    }
  }

  booking.status = status;
  booking.rejectReason = status === 'rejected' ? rejectReason || '房主已拒绝' : undefined;
  booking.updatedAt = new Date().toISOString();

  writeDb(db);
  res.json(enrichBooking(booking, db, false));
});

// --- Admin Auth ---

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  const db = readDb();

  if (username !== db.admin.username || password !== db.admin.password) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }

  const token = uuidv4();
  adminSessions.set(token, { username });
  res.json({ token, username });
});

app.get('/api/admin/me', adminAuthMiddleware, (req, res) => {
  res.json(req.admin);
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), devMockWx: DEV_MOCK_WX });
});

const server = app.listen(PORT, () => {
  console.log(`Room booking API running at http://localhost:${PORT}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n端口 ${PORT} 已被占用。请先结束旧进程：`);
    console.error(`  lsof -i :${PORT}`);
    console.error(`  kill <PID>\n`);
    process.exit(1);
  }
  throw err;
});
