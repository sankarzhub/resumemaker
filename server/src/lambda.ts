// Netlify Functions entry. The same Express app as server.ts, served under /api/* via netlify.toml.
// Written as a v2 function (Fetch Request in, Response out) because Netlify only keeps v2 functions as
// native ES modules; the request is bridged to Express through serverless-http's Lambda adapter.
import serverless from 'serverless-http';

type LambdaHandler = ReturnType<typeof serverless>;

interface LambdaResult {
  statusCode: number;
  headers?: Record<string, string | number | boolean>;
  multiValueHeaders?: Record<string, Array<string | number | boolean>>;
  body: string;
  isBase64Encoded?: boolean;
}

// Netlify's synchronous functions accept ~6 MB request bodies, and uploads arrive base64-encoded.
const UPLOAD_TOTAL_MB = 4;
const FUNCTION_PREFIX = '/.netlify/functions/api';

let ready: Promise<LambdaHandler> | undefined;

async function init(): Promise<LambdaHandler> {
  process.env.NODE_ENV ??= 'production';
  // Netlify sets URL to the site's primary address; the client calls the API on the same origin.
  process.env.CLIENT_URL ??= process.env.URL;

  // Imported after the defaults above so env validation sees them.
  const [{ env }, { connectDatabase }, { createApp }, { ClaudeResumeService }] = await Promise.all([
    import('./config/env.js'),
    import('./config/database.js'),
    import('./app.js'),
    import('./services/aiResume.service.js'),
  ]);
  await connectDatabase(env.MONGODB_URI);

  const app = createApp({
    clientUrl: env.CLIENT_URL,
    jwtSecret: env.JWT_SECRET,
    secureCookies: true,
    rateLimits: true,
    ai: new ClaudeResumeService(env.ANTHROPIC_API_KEY, env.ANTHROPIC_MODEL),
    uploadTotalMb: UPLOAD_TOTAL_MB,
  });

  return serverless(app, {
    binary: ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    request(req: { url?: string }) {
      // Requests rewritten to the function path map back onto the app's /api routes.
      if (req.url?.startsWith(FUNCTION_PREFIX)) req.url = '/api' + req.url.slice(FUNCTION_PREFIX.length);
    },
  });
}

export default async function handler(req: Request, context: { ip?: string } = {}): Promise<Response> {
  ready ??= init().catch((err: unknown) => {
    ready = undefined; // retry on the next request (e.g. Atlas briefly unreachable)
    throw err;
  });
  const lambda = await ready;

  const url = new URL(req.url);
  const query: Record<string, string> = {};
  const multiQuery: Record<string, string[]> = {};
  for (const [k, v] of url.searchParams) {
    query[k] = v;
    (multiQuery[k] ??= []).push(v);
  }
  const body = Buffer.from(await req.arrayBuffer());
  const event = {
    httpMethod: req.method,
    path: url.pathname,
    headers: Object.fromEntries(req.headers),
    multiValueHeaders: {},
    queryStringParameters: query,
    multiValueQueryStringParameters: multiQuery,
    body: body.length ? body.toString('base64') : null,
    isBase64Encoded: true,
    // Express and the rate limiter read the client IP from the socket address.
    requestContext: { identity: { sourceIp: context.ip ?? req.headers.get('x-nf-client-connection-ip') ?? '0.0.0.0' } },
  };

  const res = (await lambda(event, {})) as LambdaResult;
  const headers = new Headers();
  for (const [k, v] of Object.entries(res.headers ?? {})) headers.set(k, String(v));
  for (const [k, values] of Object.entries(res.multiValueHeaders ?? {})) {
    headers.delete(k);
    for (const v of values) headers.append(k, String(v));
  }
  const payload = res.isBase64Encoded ? Buffer.from(res.body, 'base64') : res.body;
  return new Response(res.statusCode === 204 || res.statusCode === 304 ? null : payload, { status: res.statusCode, headers });
}
