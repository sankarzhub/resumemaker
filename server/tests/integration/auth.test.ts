import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { connectTestDb, disconnectTestDb, makeApp, registerAgent } from '../helpers.js';
import { User } from '../../src/models/User.js';

const app = makeApp();

beforeAll(() => connectTestDb('auth'));
afterAll(() => disconnectTestDb());

describe('auth', () => {
  it('validates registration input', async () => {
    const res = await request(app).post('/api/auth/register').send({ name: '', email: 'not-an-email', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const paths = res.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['name', 'email', 'password']));
  });

  it('registers, stores only a hash, and sets HTTP-only session cookie', async () => {
    const res = await request(app).post('/api/auth/register').send({ name: 'Asha', email: 'Asha@Example.com', password: 'Passw0rd!' });
    expect(res.status).toBe(201);
    expect(res.body.data.user).toMatchObject({ name: 'Asha', email: 'asha@example.com' });
    expect(res.body.data.user.passwordHash).toBeUndefined();
    const cookies = ([] as string[]).concat(res.headers['set-cookie']);
    expect(cookies.find((c) => c.startsWith('rc_token='))).toMatch(/HttpOnly/i);
    const stored = await User.findOne({ email: 'asha@example.com' }).select('+passwordHash');
    expect(stored!.passwordHash).not.toContain('Passw0rd!');
    expect(stored!.passwordHash).toMatch(/^\$2[aby]\$/);
  });

  it('rejects duplicate emails (case-insensitive)', async () => {
    const res = await request(app).post('/api/auth/register').send({ name: 'Asha 2', email: 'ASHA@example.com', password: 'Passw0rd!' });
    expect(res.status).toBe(409);
  });

  it('rejects a wrong password with a generic message', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'asha@example.com', password: 'WrongPass1' });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Incorrect email or password.');
    const unknown = await request(app).post('/api/auth/login').send({ email: 'nobody@example.com', password: 'WrongPass1' });
    expect(unknown.body.error.message).toBe(res.body.error.message);
  });

  it('logs in and returns the current user', async () => {
    const agent = request.agent(app);
    const login = await agent.post('/api/auth/login').send({ email: 'asha@example.com', password: 'Passw0rd!' });
    expect(login.status).toBe(200);
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.data.user.email).toBe('asha@example.com');
  });

  it('requires authentication for private endpoints', async () => {
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
    expect((await request(app).get('/api/resumes')).status).toBe(401);
    const forged = await request(app).get('/api/resumes').set('Cookie', 'rc_token=forged.jwt.token');
    expect(forged.status).toBe(401);
  });

  it('requires a CSRF token for state-changing requests', async () => {
    const { agent, csrf } = await registerAgent(app, 'csrf@example.com');
    const without = await agent.post('/api/resumes').send({ title: 'x' });
    expect(without.status).toBe(403);
    expect(without.body.error.code).toBe('CSRF_FAILED');
    const wrong = await agent.post('/api/resumes').set('x-csrf-token', 'nope').send({ title: 'x' });
    expect(wrong.status).toBe(403);
    const ok = await agent.post('/api/resumes').set('x-csrf-token', csrf).send({ title: 'x' });
    expect(ok.status).toBe(201);
  });

  it('logs out by clearing the session', async () => {
    const { agent, csrf } = await registerAgent(app, 'logout@example.com');
    expect((await agent.post('/api/auth/logout').set('x-csrf-token', csrf)).status).toBe(200);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  it('deletes the account and all owned data', async () => {
    const { agent, csrf } = await registerAgent(app, 'delete-me@example.com');
    await agent.post('/api/resumes').set('x-csrf-token', csrf).send({ title: 'Mine' });
    expect((await agent.delete('/api/auth/me').set('x-csrf-token', csrf)).status).toBe(200);
    expect(await User.exists({ email: 'delete-me@example.com' })).toBeNull();
  });
});
