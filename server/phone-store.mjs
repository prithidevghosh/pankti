import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { httpError } from './providers.mjs';

const minute = 60_000;
export const sessionAge = 30 * 24 * 60 * minute;
const hashToken = (token) => createHash('sha256').update(token).digest('hex');

export function openPhoneStore(db, transaction) {
  function assertImportComplete(requireLegacyImport) {
    const imported = db.prepare("SELECT 1 FROM phone_auth_config WHERE key = 'firebase-imported'").get();
    const unmapped = db.prepare(`
      SELECT 1 FROM restaurants WHERE NOT EXISTS (
        SELECT 1 FROM phone_accounts WHERE uid = restaurants.owner
      ) LIMIT 1
    `).get();
    if (unmapped || (requireLegacyImport && !imported)) {
      throw httpError(503, 'Sign-in will be available after the existing accounts are migrated.');
    }
  }

  function issueSession(uid) {
    const token = randomBytes(32).toString('base64url');
    db.prepare('DELETE FROM phone_sessions WHERE expires <= ?').run(Date.now());
    db.prepare('INSERT INTO phone_sessions(token_hash, uid, expires) VALUES (?, ?, ?)')
      .run(hashToken(token), uid, Date.now() + sessionAge);
    return token;
  }

  return {
    registerLocalPhone({ phone, name, businessName }) {
      return transaction(() => {
        const uid = randomUUID();
        const account = db.prepare('INSERT OR IGNORE INTO phone_accounts(phone, uid) VALUES (?, ?)')
          .run(phone, uid);
        if (!account.changes) throw httpError(409, 'That number already has an account. Sign in with it.');
        db.prepare('INSERT INTO local_signup_profiles(uid, name) VALUES (?, ?)').run(uid, name);
        db.prepare('INSERT INTO restaurants(id, owner, name, city) VALUES (?, ?, ?, ?)')
          .run(randomUUID(), uid, businessName, '');
        return issueSession(uid);
      });
    },
    signInLocalPhone(phone) {
      return transaction(() => {
        const account = db.prepare(`
          SELECT accounts.uid FROM phone_accounts accounts JOIN local_signup_profiles profiles USING (uid)
          WHERE accounts.phone = ? AND accounts.disabled = 0
        `).get(phone);
        if (!account) throw httpError(404, 'No account found for that number. Create an account first.');
        return issueSession(account.uid);
      });
    },
    importPhoneAccounts(accounts) {
      return transaction(() => {
        const byPhone = db.prepare('SELECT uid FROM phone_accounts WHERE phone = ?');
        const byUid = db.prepare('SELECT phone FROM phone_accounts WHERE uid = ?');
        const insert = db.prepare(`
          INSERT INTO phone_accounts(phone, uid, disabled) VALUES (?, ?, ?)
          ON CONFLICT(phone) DO UPDATE SET disabled = excluded.disabled
        `);
        for (const { phone, uid, disabled } of accounts) {
          const existingUser = byPhone.get(phone);
          const existingPhone = byUid.get(uid);
          if ((existingUser && existingUser.uid !== uid) || (existingPhone && existingPhone.phone !== phone)) {
            throw new Error('An exported account conflicts with an existing phone or owner ID. Import rolled back.');
          }
          insert.run(phone, uid, Number(disabled));
        }
        assertImportComplete(false);
        db.prepare("INSERT OR IGNORE INTO phone_auth_config VALUES ('firebase-imported')").run();
        return accounts.length;
      });
    },
    reservePhoneChallenge(phone, ip, requireLegacyImport) {
      return transaction(() => {
        assertImportComplete(requireLegacyImport);
        const now = Date.now();
        db.prepare('DELETE FROM phone_challenges WHERE created < ?').run(now - 60 * minute);
        const { count, latest } = db.prepare(`
          SELECT COUNT(*) AS count, MAX(created) AS latest FROM phone_challenges WHERE phone = ?
        `).get(phone);
        const ipCount = db.prepare('SELECT COUNT(*) AS count FROM phone_challenges WHERE ip = ?').get(ip).count;
        if ((latest && now - latest < 30_000) || count >= 5 || ipCount >= 25) {
          throw httpError(429, 'Too many code requests. Wait before trying again.');
        }
        const id = randomUUID();
        db.prepare('INSERT INTO phone_challenges(id, phone, ip, created) VALUES (?, ?, ?, ?)')
          .run(id, phone, ip, now);
        return id;
      });
    },
    savePhoneChallenge(id, sid) {
      db.prepare('UPDATE phone_challenges SET sid = ? WHERE id = ?').run(sid, id);
    },
    claimPhoneChallenge(id) {
      const challenge = db.prepare(`
        UPDATE phone_challenges SET checking = 1, attempts = attempts + 1
        WHERE id = ? AND sid IS NOT NULL AND checking = 0 AND attempts < 5 AND created >= ?
        RETURNING phone, sid
      `).get(id, Date.now() - 10 * minute);
      if (!challenge) throw httpError(409, 'This code is unavailable or expired. Start over to request a new one.');
      return challenge;
    },
    releasePhoneChallenge(id) {
      db.prepare('UPDATE phone_challenges SET checking = 0 WHERE id = ?').run(id);
    },
    completePhoneChallenge(id, phone) {
      return transaction(() => {
        // Keep the row for send limits and make the verification challenge single-use.
        db.prepare('UPDATE phone_challenges SET sid = NULL WHERE id = ?').run(id);
        db.prepare('INSERT OR IGNORE INTO phone_accounts(phone, uid) VALUES (?, ?)').run(phone, randomUUID());
        const account = db.prepare('SELECT uid, disabled FROM phone_accounts WHERE phone = ?').get(phone);
        if (account.disabled) return null;
        return issueSession(account.uid);
      });
    },
    phoneSessionOwner(token) {
      if (!/^[A-Za-z0-9_-]{43}$/.test(token || '')) return null;
      return db.prepare(`
        SELECT sessions.uid FROM phone_sessions sessions JOIN phone_accounts accounts USING (uid)
        WHERE sessions.token_hash = ? AND sessions.expires > ? AND accounts.disabled = 0
      `).get(hashToken(token), Date.now())?.uid ?? null;
    },
    revokePhoneSession(token) {
      if (token) db.prepare('DELETE FROM phone_sessions WHERE token_hash = ?').run(hashToken(token));
    },
  };
}
