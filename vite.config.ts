import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

const API_MODULES: Record<string, string> = {
  '/api/transcribe': '/api/transcribe.ts',
  '/api/translate': '/api/translate.ts',
  '/api/translate-ui': '/api/translate-ui.ts',
  '/api/tts': '/api/tts.ts',
  '/api/analyze-image': '/api/analyze-image.ts',
  '/api/chat': '/api/chat.ts',
  '/api/youtube-transcript': '/api/youtube-transcript.ts',
  '/api/voice-clone': '/api/voice-clone.ts',
};

async function readJsonBody(req: any): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/** Wraps a raw Node http.ServerResponse to mimic VercelResponse (res.status().json()) */
function wrapResponse(raw: any) {
  if (typeof raw.json === 'function') return raw;
  raw.status = (code: number) => { raw.statusCode = code; return raw; };
  raw.json = (data: any) => {
    if (!raw.headersSent) {
      raw.setHeader('Content-Type', 'application/json');
      raw.end(JSON.stringify(data));
    }
    return raw;
  };
  raw.send = (body: any) => {
    if (!raw.headersSent) {
      if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
        // Binary data (e.g. TTS audio) — send raw, keep existing Content-Type header
        raw.end(body);
      } else if (typeof body === 'string') {
        raw.end(body);
      } else {
        raw.setHeader('Content-Type', 'application/json');
        raw.end(JSON.stringify(body));
      }
    }
    return raw;
  };
  return raw;
}

function localApiPlugin() {
  return {
    name: 'local-api-plugin',
    configureServer(server: any) {
      server.middlewares.use(async (req: any, res: any, next: any) => {
        const urlPath = String(req.url || '').split('?')[0];
        if (!urlPath.startsWith('/api/')) return next();

        const modulePath = API_MODULES[urlPath];
        if (!modulePath) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Not found' }));
          return;
        }

        try {
          // Only parse JSON body; multipart is left as raw stream
          // because each handler (transcribe, etc.) does its own multipart parsing.
          const contentType = String(req.headers['content-type'] || '').toLowerCase();
          if (!contentType.includes('multipart/form-data') && req.method === 'POST') {
            req.body = await readJsonBody(req);
          }

          const wrapped = wrapResponse(res);
          const mod = await server.ssrLoadModule(path.resolve(process.cwd(), `.${modulePath}`));
          const handler = mod?.default;

          if (typeof handler !== 'function') {
            throw new Error(`Invalid API handler for ${urlPath}`);
          }

          await handler(req, wrapped);
        } catch (error) {
          console.error(`[local-api] ${urlPath} failed`, error);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            const msg = error instanceof Error ? error.message : 'Internal Server Error';
            res.end(JSON.stringify({ error: msg }));
          }
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  for (const [key, value] of Object.entries(env)) {
    if (!(key in process.env)) process.env[key] = value;
  }

  return {
    plugins: [
      react(),
      tailwindcss(),
      localApiPlugin(),
      VitePWA({
        registerType: 'autoUpdate',
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
              handler: 'CacheFirst',
              options: { cacheName: 'google-fonts', expiration: { maxEntries: 20, maxAgeSeconds: 365 * 24 * 60 * 60 } },
            },
          ],
        },
        manifest: false, // We already have public/manifest.json
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify — file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
