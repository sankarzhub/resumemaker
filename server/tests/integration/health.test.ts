import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { makeApp } from '../helpers.js';

const app = makeApp();

describe('GET /api/health', () => {
  it('reports degraded when the database is not connected', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(503);
    expect(res.body.data.database).toBe('disconnected');
  });

  describe('with database', () => {
    beforeAll(async () => {
      await mongoose.connect('mongodb://127.0.0.1:27017/resumecraft_test_health', { serverSelectionTimeoutMS: 5000 });
    });
    afterAll(async () => {
      await mongoose.disconnect();
    });

    it('reports ok', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true, data: { status: 'ok', database: 'connected' } });
    });
  });

  it('returns the standard error shape for unknown routes', async () => {
    const res = await request(app).get('/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
  });

  it('rejects malformed JSON with 400', async () => {
    const res = await request(app).post('/api/health').set('Content-Type', 'application/json').send('{bad');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });
});
