// JS bridge to the native SmsReader Capacitor plugin.
// On the web (no Capacitor), every method is a no-op that returns a benign default,
// so existing code paths keep working.

import { Capacitor, registerPlugin } from '@capacitor/core';

const SmsReader = registerPlugin('SmsReader', {
  web: () => ({
    checkPermissions: async () => ({ sms: 'denied' }),
    requestPermissions: async () => ({ sms: 'denied' }),
    readInbox: async () => ({ messages: [], count: 0 }),
    startListener: async () => {},
    stopListener: async () => {},
    addListener: async () => ({ remove: () => {} })
  })
});

export function isNativeAndroid() {
  return Capacitor.getPlatform() === 'android';
}

export async function checkSmsPermission() {
  const r = await SmsReader.checkPermissions();
  return r?.sms ?? 'denied';
}

export async function ensureSmsPermission() {
  const cur = await SmsReader.checkPermissions();
  if (cur.sms === 'granted') return true;
  const after = await SmsReader.requestPermissions({ permissions: ['sms'] });
  return after.sms === 'granted';
}

export async function ensureNotificationPermission() {
  // Android 13+ requires runtime POST_NOTIFICATIONS. Older versions auto-grant.
  try {
    const cur = await SmsReader.checkPermissions();
    if (cur.notifications === 'granted') return true;
    const after = await SmsReader.requestPermissions({ permissions: ['notifications'] });
    return after.notifications === 'granted';
  } catch {
    return true; // pre-Android-13 or non-native = no runtime request needed
  }
}

// Default sender substrings used to find bank/UPI SMS in the user's inbox.
// They are case-insensitive substring matches on the SMS "from" field.
// We aim wide on banks + wallets + payment apps; spam is filtered at the body
// level (see TXN_BODY_KEYWORDS / SPAM_KEYWORDS below).
export const DEFAULT_BANK_SENDERS = [
  // Major Indian banks
  'HDFC', 'ICICI', 'SBI', 'AXIS', 'KOTAK', 'YESBNK', 'IDBI', 'PNB', 'BOI', 'BOB',
  'IDFC', 'INDUS', 'CITI', 'HSBC', 'STANC', 'RBL', 'CANBNK', 'CANARA', 'UBI',
  'UNIBNK', 'INDBNK', 'INDIANBK', 'CENTBK', 'OBC', 'COSMOS', 'BANDHAN',
  'KARUR', 'KARVY', 'KARNATAKA', 'KBL', 'KVB', 'KMBL', 'KMB', 'EQUITAS',
  'AUFIN', 'AUBANK', 'ESAF', 'JANA', 'SURYODAY', 'UJJIVAN', 'FINCARE', 'UTKARSH',
  'CSB', 'CUB', 'DCB', 'DBS', 'FBL', 'FEDBNK', 'FEDERAL', 'TMB', 'JKB', 'NAINI',
  'SIB', 'SOUTHIND', 'PSB', 'SCB', 'IOBINDIA', 'IOB', 'UCO',
  // UPI / wallets / payment apps
  'PAYTM', 'PHONEPE', 'GPAY', 'BHIM', 'AMAZ', 'AMZNPY', 'AIRTEL', 'AIRPAY',
  'JIO', 'JIOPAY', 'FREECH', 'MOBIKW', 'MOBIQK', 'MBKWIK', 'OLA', 'OLAPAY',
  'RAZORP', 'RAZPAY', 'RWALL', 'RWLLT', 'JUSPAY', 'CRED', 'CREDPLUS', 'SLICE',
  'NIYO', 'FI', 'JUPITER', 'UNIORG', 'LAZYPAY', 'SIMPL', 'POSTPE',
  // Card networks / NBFCs
  'AMEX', 'VISA', 'MASTER', 'RUPAY', 'BAJFIN', 'BAJAJF', 'BAJAJ',
  // Generic substrings — last resort
  'BK', 'BNK', 'BANK', 'PAY', 'UPI', 'CARD'
];

// Body keywords that strongly indicate a transaction SMS
export const TXN_BODY_KEYWORDS = [
  'debited', 'credited', 'spent', 'paid', 'received', 'transferred', 'transfer',
  'withdrawn', 'deposit', 'purchase', 'refund', 'cashback', 'sent', 'recd',
  'a/c', 'acct', 'account', 'upi', 'imps', 'neft', 'rtgs', 'wallet', 'rwallet',
  'available bal', 'avail bal', 'balance'
];

// Strong negative markers — if the body matches any of these, it's almost
// always promotional / spam / phishing and we reject it outright.
export const SPAM_KEYWORDS = [
  'congratulations', 'pre-?approved', 'click here', 'apply now', 'hurry',
  'offer ends', 'limited offer', 'limited time', 'voucher', 'coupon',
  't&c', 'terms and conditions', 'terms apply', 'know more',
  'lifetime free', 'reward points', 'sign up', 'register now', 'verify now',
  'win ', 'won ', 'lucky', 'cashback up to', 'eligible to', 'eligibility'
];

export async function fetchSmsHistory({ sinceTs = 0, limit = 2000 } = {}) {
  if (!isNativeAndroid()) return { messages: [], count: 0 };
  return SmsReader.readInbox({
    senderFilter: DEFAULT_BANK_SENDERS,
    bodyFilter: TXN_BODY_KEYWORDS,
    sinceTs,
    limit
  });
}

export async function startSmsListener(onMessage) {
  if (!isNativeAndroid()) return () => {};
  const handle = await SmsReader.addListener('smsReceived', (m) => onMessage(m));
  await SmsReader.startListener();
  return async () => {
    try { handle.remove(); } catch {}
    try { await SmsReader.stopListener(); } catch {}
  };
}

export default SmsReader;
