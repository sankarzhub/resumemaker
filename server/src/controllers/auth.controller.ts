import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { User, toPublicUser } from '../models/User.js';
import { Resume } from '../models/Resume.js';
import { Analysis } from '../models/Analysis.js';
import { loginSchema, registerSchema } from '../validators/auth.validators.js';
import { AppError } from '../utils/AppError.js';
import { clearSession, getUserId, issueSession, type AuthConfig } from '../middleware/auth.middleware.js';

// A real bcrypt hash used to equalise timing when the email does not exist.
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser-password', 12);

export function createAuthController(cfg: AuthConfig) {
  return {
    async register(req: Request, res: Response) {
      const { name, email, password } = registerSchema.parse(req.body);
      if (await User.exists({ email })) throw AppError.conflict('An account with this email already exists.');
      const passwordHash = await bcrypt.hash(password, 12);
      let user;
      try {
        user = await User.create({ name, email, passwordHash });
      } catch (err) {
        if ((err as { code?: number }).code === 11000) throw AppError.conflict('An account with this email already exists.');
        throw err;
      }
      issueSession(res, user.id, cfg);
      res.status(201).json({ success: true, data: { user: toPublicUser(user) } });
    },

    async login(req: Request, res: Response) {
      const { email, password } = loginSchema.parse(req.body);
      const user = await User.findOne({ email }).select('+passwordHash');
      const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
      if (!user || !ok) throw new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password.');
      issueSession(res, user.id, cfg);
      res.json({ success: true, data: { user: toPublicUser(user) } });
    },

    async logout(_req: Request, res: Response) {
      clearSession(res, cfg);
      res.json({ success: true, data: null });
    },

    async me(req: Request, res: Response) {
      const user = await User.findById(getUserId(req));
      if (!user) {
        clearSession(res, cfg);
        throw AppError.unauthorized();
      }
      res.json({ success: true, data: { user: toPublicUser(user) } });
    },

    /** Permanently delete the account and everything it owns. */
    async deleteAccount(req: Request, res: Response) {
      const userId = getUserId(req);
      await Analysis.deleteMany({ userId });
      await Resume.deleteMany({ userId });
      await User.deleteOne({ _id: userId });
      clearSession(res, cfg);
      res.json({ success: true, data: null });
    },
  };
}
