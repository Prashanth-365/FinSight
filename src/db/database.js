import Dexie from 'dexie';

export const db = new Dexie('finsight');

db.version(1).stores({
  users: '++id, username, email',
  profiles: '++id, name, isDefault, createdAt',
  accounts: '++id, name, type, isActive, *profileIds, *aliases',
  categories: '++id, name, parentId, type',
  transactions: '++id, slNo, dateTime, profileId, accountId, categoryId, subCategoryId, txnType, amount',
  investments: '++id, profileId, platform, name, identifier',
  chitFunds: '++id, investmentId',
  smsQueue: '++id, status, dateTime',
  settings: 'key'
});

db.version(2).stores({
  users: '++id, username, email, googleSub'
});

db.version(3).stores({
  transactions: '++id, slNo, dateTime, profileId, accountId, categoryId, subCategoryId, txnType, amount, investmentId'
});

db.version(4).stores({
  transactions: '++id, slNo, dateTime, profileId, accountId, categoryId, subCategoryId, txnType, amount, investmentId, splitGroupId, importFingerprint, source',
  statements: '++id, accountId, importedAt, status'
});

db.version(5).stores({
  // smsQueue doubles as the unified inbox of pending items: SMS-parsed AND
  // statement-extracted rows. `kind` ('sms' | 'statement') distinguishes them;
  // `accountId` is the resolved/known account (always set for statement rows).
  smsQueue: '++id, status, dateTime, kind, accountId'
});

// re-number slNo across all transactions in chronological order.
// Call after any insert/update/delete of transactions whose dateTime is non-trivial.
export async function reindexSlNo() {
  await db.transaction('rw', db.transactions, async () => {
    const all = await db.transactions.orderBy('dateTime').toArray();
    for (let i = 0; i < all.length; i++) {
      const expected = i + 1;
      if (all[i].slNo !== expected) {
        await db.transactions.update(all[i].id, { slNo: expected });
      }
    }
  });
}

// helper: read or default a settings entry
export async function getSetting(key, fallback = undefined) {
  const row = await db.settings.get(key);
  return row ? row.value : fallback;
}

export async function setSetting(key, value) {
  await db.settings.put({ key, value });
}
