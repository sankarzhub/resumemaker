import multer from 'multer';
import type { RequestHandler } from 'express';
import { AppError } from '../utils/AppError.js';

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_UPLOAD_FILES = 4;

// Images are accepted so scanned resumes/photos can be read when AI is on; the parser explains otherwise.
const ALLOWED_EXTENSIONS = /\.(pdf|docx|txt|md|png|jpe?g|webp|doc)$/i;

// Files stay in memory and are never written to disk: we only need the extracted text.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: MAX_UPLOAD_FILES, fields: 10 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_EXTENSIONS.test(file.originalname)) {
      cb(new AppError(400, 'UNSUPPORTED_FILE', `"${file.originalname}" is not supported. Upload a PDF, DOCX, TXT or an image (PNG/JPG).`));
      return;
    }
    cb(null, true);
  },
});

/** Accepts one or more files under "files" (or a single legacy "file"); exposes them as req.files. */
export const resumeFiles: RequestHandler = (req, res, next) => {
  upload.fields([
    { name: 'files', maxCount: MAX_UPLOAD_FILES },
    { name: 'file', maxCount: 1 },
  ])(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(new AppError(413, 'FILE_TOO_LARGE', 'A file is too large. The maximum size is 5 MB per file.'));
      }
      if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
        return next(new AppError(400, 'TOO_MANY_FILES', `Upload at most ${MAX_UPLOAD_FILES} files.`));
      }
      return next(new AppError(400, 'UPLOAD_ERROR', 'The files could not be uploaded.'));
    }
    if (err) return next(err);
    const grouped = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
    const all = [...(grouped.files ?? []), ...(grouped.file ?? [])];
    if (all.length === 0) return next(new AppError(400, 'NO_FILE', 'Please choose a file to upload.'));
    if (all.length > MAX_UPLOAD_FILES) return next(new AppError(400, 'TOO_MANY_FILES', `Upload at most ${MAX_UPLOAD_FILES} files.`));
    req.files = all;
    next();
  });
};
