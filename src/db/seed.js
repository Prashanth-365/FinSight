import { db } from './database.js';

const DEFAULT_CATEGORIES = [
  { name: 'Food & Dining', icon: '🍽️', color: '#f97316', type: 'expense', subs: ['Groceries', 'Restaurants', 'Snacks', 'Beverages'] },
  { name: 'Transport', icon: '🚗', color: '#3b82f6', type: 'expense', subs: ['Fuel', 'Cab', 'Auto', 'Metro', 'Bus', 'Parking'] },
  { name: 'Bills & Utilities', icon: '🧾', color: '#eab308', type: 'expense', subs: ['Electricity', 'Water', 'Gas', 'Internet', 'Mobile', 'DTH'] },
  { name: 'Shopping', icon: '🛍️', color: '#ec4899', type: 'expense', subs: ['Clothing', 'Electronics', 'Home', 'Personal Care'] },
  { name: 'Health', icon: '💊', color: '#ef4444', type: 'expense', subs: ['Pharmacy', 'Doctor', 'Hospital', 'Insurance'] },
  { name: 'Entertainment', icon: '🎬', color: '#a855f7', type: 'expense', subs: ['Movies', 'Streaming', 'Games', 'Outings'] },
  { name: 'Education', icon: '📚', color: '#0ea5e9', type: 'expense', subs: ['Tuition', 'Books', 'Courses'] },
  { name: 'Rent & EMI', icon: '🏠', color: '#64748b', type: 'expense', subs: ['Rent', 'Home Loan', 'Car Loan', 'Personal Loan'] },
  { name: 'Salary', icon: '💼', color: '#10b981', type: 'income', subs: ['Primary', 'Bonus', 'Reimbursement'] },
  { name: 'Other Income', icon: '💰', color: '#22c55e', type: 'income', subs: ['Interest', 'Dividend', 'Refund', 'Gift'] },
  { name: 'Investment', icon: '📈', color: '#06b6d4', type: 'investment', subs: ['Mutual Fund', 'Stocks', 'FD', 'PPF', 'EPF', 'Gold', 'Crypto', 'Chit Fund'] },
  { name: 'Transfer', icon: '🔁', color: '#94a3b8', type: 'transfer', subs: ['Self', 'Family', 'Friends'] }
];

export async function seedIfEmpty() {
  // No default profile — the "All profiles" master view is synthetic in the UI.
  // Users add their own profile(s) from Settings → Profiles, or when first prompted.
  const catCount = await db.categories.count();
  if (catCount === 0) {
    for (const c of DEFAULT_CATEGORIES) {
      const parentId = await db.categories.add({
        name: c.name, parentId: null, icon: c.icon, color: c.color, type: c.type
      });
      for (const sub of c.subs) {
        await db.categories.add({
          name: sub, parentId, icon: c.icon, color: c.color, type: c.type
        });
      }
    }
  }
}
