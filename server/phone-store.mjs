import { randomUUID, createHash, randomBytes } from 'node:crypto';
import { httpError } from './errors.mjs';
import { increment } from './db/mongo.mjs';
export const sessionAge = 30 * 86400000;
const hash = (token) => createHash('sha256').update(token).digest('hex');

export function openPhoneStore(db, transaction) {
  const accounts = db.collection('phone_accounts'),
    profiles = db.collection('local_signup_profiles');
  const sessions = db.collection('phone_sessions'),
    challenges = db.collection('phone_challenges');
  const restaurants = db.collection('restaurants'),
    config = db.collection('phone_auth_config');
  async function assertImported(session, required) {
    const missing = await restaurants
      .aggregate(
        [
          { $lookup: { from: 'phone_accounts', localField: 'owner', foreignField: 'uid', as: 'account' } },
          { $match: { 'account.0': { $exists: false } } },
          { $limit: 1 },
          { $project: { _id: 1 } },
        ],
        { session },
      )
      .next();
    if (missing || (required && !(await config.findOne({ _id: 'firebase-imported' }, { session }))))
      throw httpError(503, 'Sign-in will be available after the existing accounts are migrated.');
  }
  async function issue(uid, session, verified = false) {
    const token = randomBytes(32).toString('base64url');
    await sessions.insertOne(
      { _id: hash(token), uid, verified, expiresAt: new Date(Date.now() + sessionAge) },
      { session },
    );
    return token;
  }
  return {
    async accountDetails(uid) {
      const [account, profile] = await Promise.all([accounts.findOne({ uid }), profiles.findOne({ _id: uid })]);
      return { name: profile?.name || null, phone: account?._id || null };
    },
    async registerLocalPhone({ phone, name, businessName, signupNotes = [] }) {
      try {
        return await transaction(async (session) => {
          const uid = randomUUID();
          await accounts.insertOne({ _id: phone, uid, disabled: false }, { session });
          await profiles.insertOne({ _id: uid, name }, { session });
          await restaurants.insertOne(
            { _id: randomUUID(), owner: uid, name: businessName, city: '', qr: null, payee: null },
            { session },
          );
          if (signupNotes.length) await db.collection('voice_transcripts').updateMany(
            { _id: { $in: signupNotes }, owner: null, task: 'signup', expiresAt: { $gt: new Date() } },
            { $set: { owner: uid }, $unset: { expiresAt: '' } }, { session },
          );
          return issue(uid, session);
        });
      } catch (error) {
        if (error.code === 11000)
          throw httpError(409, 'That number already has an account. Sign in with it.');
        throw error;
      }
    },
    signInLocalPhone(phone) {
      return transaction(async (session) => {
        const account = await accounts.findOne({ _id: phone, disabled: false }, { session });
        if (!account || !(await profiles.findOne({ _id: account.uid }, { session })))
          throw httpError(404, 'No account found for that number. Create an account first.');
        return issue(account.uid, session);
      });
    },
    importPhoneAccounts(rows) {
      return transaction(async (session) => {
        for (const { phone, uid, disabled } of rows) {
          const match = await accounts.findOne({ $or: [{ _id: phone }, { uid }] }, { session });
          if (match && (match._id !== phone || match.uid !== uid))
            throw Error('An exported account conflicts with an existing phone or owner ID.');
          await accounts.updateOne({ _id: phone, uid }, { $set: { disabled } }, { upsert: true, session });
        }
        await assertImported(session, false);
        await config.updateOne(
          { _id: 'firebase-imported' },
          { $setOnInsert: { _id: 'firebase-imported' } },
          { upsert: true, session },
        );
        return rows.length;
      });
    },
    reservePhoneChallenge(phone, ip, required) {
      return transaction(async (session) => {
        // Serialize reservations so concurrent requests cannot bypass either limit.
        await increment(db, session, 'otp-reservations');
        await assertImported(session, required);
        const now = Date.now(),
          created = { $gte: now - 3600000 };
        if (
          (await challenges.findOne({ phone, created: { $gt: now - 30000 } }, { session })) ||
          (await challenges.countDocuments({ phone, created }, { session })) >= 5 ||
          (await challenges.countDocuments({ ip, created }, { session })) >= 25
        )
          throw httpError(429, 'Too many code requests. Wait before trying again.');
        const id = randomUUID();
        await challenges.insertOne(
          {
            _id: id,
            phone,
            ip,
            created: now,
            expiresAt: new Date(now + 3600000),
            checking: false,
            sid: null,
            attempts: 0,
          },
          { session },
        );
        return id;
      });
    },
    savePhoneChallenge: (_id, sid) => challenges.updateOne({ _id }, { $set: { sid } }),
    async claimPhoneChallenge(_id) {
      const row = await challenges.findOneAndUpdate(
        {
          _id,
          sid: { $ne: null },
          checking: false,
          attempts: { $lt: 5 },
          created: { $gte: Date.now() - 600000 },
        },
        { $set: { checking: true }, $inc: { attempts: 1 } },
      );
      if (!row) throw httpError(409, 'This code is unavailable or expired. Start over to request a new one.');
      return row;
    },
    releasePhoneChallenge: (_id) => challenges.updateOne({ _id }, { $set: { checking: false } }),
    completePhoneChallenge(_id, phone) {
      return transaction(async (session) => {
        const used = await challenges.updateOne(
          { _id, phone, checking: true, sid: { $ne: null } },
          { $set: { sid: null } },
          { session },
        );
        if (!used.modifiedCount)
          throw httpError(409, 'This code is unavailable or expired. Start over to request a new one.');
        const account = await accounts.findOneAndUpdate(
          { _id: phone },
          { $setOnInsert: { uid: randomUUID(), disabled: false } },
          { upsert: true, session, returnDocument: 'after' },
        );
        return account.disabled ? null : issue(account.uid, session, true);
      });
    },
    async phoneSessionOwner(token, requireVerified) {
      if (!/^[A-Za-z0-9_-]{43}$/.test(token || '')) return null;
      const active = await sessions.findOne({ _id: hash(token), ...(requireVerified && { verified: true }), expiresAt: { $gt: new Date() } });
      return active && (await accounts.findOne({ uid: active.uid, disabled: false })) ? active.uid : null;
    },
    revokePhoneSession: (token) => token && sessions.deleteOne({ _id: hash(token) }),
  };
}
