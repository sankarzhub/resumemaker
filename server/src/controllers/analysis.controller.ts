import type { Request, Response } from 'express';
import { isValidObjectId } from 'mongoose';
import { Analysis } from '../models/Analysis.js';
import { AppError } from '../utils/AppError.js';
import { getUserId } from '../middleware/auth.middleware.js';

export async function getAnalysis(req: Request, res: Response) {
  const id = String(req.params.id);
  if (!isValidObjectId(id)) throw AppError.notFound('Analysis not found.');
  const analysis = await Analysis.findOne({ _id: id, userId: getUserId(req) });
  if (!analysis) throw AppError.notFound('Analysis not found.');
  res.json({ success: true, data: analysis.toJSON() });
}
