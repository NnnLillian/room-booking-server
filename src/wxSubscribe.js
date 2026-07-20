/**
 * WeChat mini program subscribe message helpers.
 * Sends after booking status changes; never throws to callers (best-effort).
 */

const TOKEN_URL = 'https://api.weixin.qq.com/cgi-bin/token';
const SEND_URL = 'https://api.weixin.qq.com/cgi-bin/message/subscribe/send';

let cachedToken = null;
let cachedTokenExpiresAt = 0;

function truncate(str, max) {
  const s = String(str || '');
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

function shouldSkipSend({ mockWx, openid }) {
  if (mockWx) return 'DEV_MOCK_WX / 无 AppID，跳过订阅消息';
  if (!process.env.WX_APPID || !process.env.WX_SECRET) {
    return '缺少 WX_APPID / WX_SECRET，跳过订阅消息';
  }
  if (!process.env.WX_SUBSCRIBE_TMPL_ID) {
    return '缺少 WX_SUBSCRIBE_TMPL_ID，跳过订阅消息';
  }
  if (!openid || String(openid).startsWith('dev-')) {
    return '无真实 openid，跳过订阅消息';
  }
  return null;
}

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && now < cachedTokenExpiresAt - 60_000) {
    return cachedToken;
  }

  const params = new URLSearchParams({
    grant_type: 'client_credential',
    appid: process.env.WX_APPID,
    secret: process.env.WX_SECRET,
  });
  const res = await fetch(`${TOKEN_URL}?${params}`);
  const data = await res.json();
  if (!data.access_token) {
    throw new Error(data.errmsg || '获取 access_token 失败');
  }
  cachedToken = data.access_token;
  cachedTokenExpiresAt = now + (data.expires_in || 7200) * 1000;
  return cachedToken;
}

/** Build template data; field names overridable via env to match 微信后台模板. */
function buildTemplateData(booking, status) {
  const resultField = process.env.WX_SUBSCRIBE_FIELD_RESULT || 'phrase1';
  const datesField = process.env.WX_SUBSCRIBE_FIELD_DATES || 'thing2';
  const reasonField = process.env.WX_SUBSCRIBE_FIELD_REASON || 'thing3';

  const resultText = status === 'approved' ? '已通过' : '已拒绝';
  const datesText = truncate(`${booking.checkIn}至${booking.checkOut}`, 20);
  const reasonText =
    status === 'rejected'
      ? truncate(booking.rejectReason || '房主已拒绝', 20)
      : truncate('请打开行程查看详情', 20);

  return {
    [resultField]: { value: resultText },
    [datesField]: { value: datesText },
    [reasonField]: { value: reasonText },
  };
}

/**
 * Best-effort subscribe message after status change to approved|rejected.
 * @param {{ booking: object, status: string, mockWx: boolean }} opts
 */
export async function notifyBookingStatusChange({ booking, status, mockWx }) {
  if (status !== 'approved' && status !== 'rejected') return;

  const skip = shouldSkipSend({ mockWx, openid: booking.openid });
  if (skip) {
    console.log('[wxSubscribe]', skip, { bookingId: booking.id, status });
    return;
  }

  try {
    const accessToken = await getAccessToken();
    const body = {
      touser: booking.openid,
      template_id: process.env.WX_SUBSCRIBE_TMPL_ID,
      page: process.env.WX_SUBSCRIBE_PAGE || 'pages/orders/orders',
      miniprogram_state: process.env.WX_SUBSCRIBE_MINIPROGRAM_STATE || 'formal',
      lang: 'zh_CN',
      data: buildTemplateData(booking, status),
    };

    const res = await fetch(`${SEND_URL}?access_token=${accessToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.errcode && data.errcode !== 0) {
      console.error('[wxSubscribe] send failed', data, { bookingId: booking.id });
      return;
    }
    console.log('[wxSubscribe] sent', { bookingId: booking.id, status });
  } catch (err) {
    console.error('[wxSubscribe] error', err.message || err, { bookingId: booking.id });
  }
}
