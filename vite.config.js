import { defineConfig } from 'vite';
import { copyFileSync, existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import http from 'http';
import https from 'https';

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8'));

function webosAssets() {
  const files = ['appinfo.json', 'icon.png', 'largeIcon.png', 'THIRD-PARTY-NOTICES.txt'];
  return {
    name: 'webos-assets',
    closeBundle() {
      for (const f of files) {
        const src = resolve(__dirname, f);
        if (existsSync(src)) {
          copyFileSync(src, resolve(__dirname, 'dist', f));
        }
      }
    }
  };
}

function classicScript() {
  return {
    name: 'classic-script',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml(html) {
      let src = '';
      html = html.replace(/\s*<script type="module"[^>]*\ssrc="([^"]+)"[^>]*><\/script>/, (m, s) => {
        src = s;
        return '';
      });
      if (!src) throw new Error('classic-script: module entry script not found');
      html = html.replace(/(<link\b[^>]*?)\s+crossorigin(?:="[^"]*")?/g, '$1');
      return html.replace('</body>', `  <script src="${src}"></script>\n  </body>`);
    }
  };
}

function devProxy() {
  const UA =
    'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79 Safari/537.36';

  function proxyUrl(abs) {
    return '/__proxy__?u=' + encodeURIComponent(abs);
  }

  function rewriteM3u8(text, baseUrl) {
    return text
      .split(/\r?\n/)
      .map((line) => {
        const t = line.trim();
        if (!t) return line;
        if (t.startsWith('#')) {
          if (/URI="[^"]+"/i.test(t)) {
            return t.replace(/URI="([^"]+)"/i, (m, uri) => {
              try {
                return 'URI="' + proxyUrl(new URL(uri, baseUrl).href) + '"';
              } catch (e) {
                return m;
              }
            });
          }
          return line;
        }
        try {
          return proxyUrl(new URL(t, baseUrl).href);
        } catch (e) {
          return line;
        }
      })
      .join('\n');
  }

  return {
    name: 'dev-proxy',
    configureServer(server) {
      server.middlewares.use('/__proxy__', (req, res) => {
        const q = new URL(req.url, 'http://localhost');
        const target = q.searchParams.get('u');
        if (!target) {
          res.statusCode = 400;
          res.end('missing u');
          return;
        }
        let targetUrl;
        try {
          targetUrl = new URL(target);
          if (!['http:', 'https:'].includes(targetUrl.protocol)) throw new Error('bad protocol');
        } catch (e) {
          res.statusCode = 400;
          res.end('bad url');
          return;
        }
        const mod = targetUrl.protocol === 'https:' ? https : http;
        const options = {
          method: 'GET',
          rejectUnauthorized: process.env.VITE_PROXY_ALLOW_SELF_SIGNED === '1',
          headers: {
            'User-Agent': UA,
            Accept: '*/*',
            Referer: targetUrl.origin + '/'
          }
        };
        for (const header of ['range', 'if-range']) {
          if (req.headers[header] !== undefined) options.headers[header] = req.headers[header];
        }

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', '*');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length');

        let upstream;
        let upstreamResponse;
        let done = false;
        const chunks = [];

        function cleanupClient() {
          req.removeListener('aborted', onClientDone);
          res.removeListener('close', onClientDone);
          res.removeListener('error', onClientDone);
          res.removeListener('finish', onClientDone);
          chunks.length = 0;
        }

        function destroyUpstream() {
          upstreamResponse?.unpipe(res);
          upstreamResponse?.destroy();
          upstream?.destroy();
        }

        function onClientDone() {
          if (done) return;
          done = true;
          cleanupClient();
          destroyUpstream();
        }

        function fail(message) {
          if (done) return;
          done = true;
          cleanupClient();
          destroyUpstream();
          if (res.destroyed || res.writableEnded) return;
          if (res.headersSent) {
            res.destroy();
            return;
          }
          for (const header of ['Content-Length', 'Content-Range', 'Accept-Ranges', 'Location']) {
            res.removeHeader(header);
          }
          res.statusCode = 502;
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end(message);
        }

        function onRequestError() { fail('proxy error'); }
        function onResponseError() { fail('upstream error'); }
        function onTimeout() { fail('proxy timeout'); }
        function onPlaylistData(chunk) { chunks.push(chunk); }
        function onPlaylistEnd() {
          if (done || res.destroyed || res.writableEnded) return;
          const out = rewriteM3u8(Buffer.concat(chunks).toString('utf8'), targetUrl.href);
          chunks.length = 0;
          res.end(out);
        }

        req.once('aborted', onClientDone);
        res.once('close', onClientDone);
        res.once('error', onClientDone);
        res.once('finish', onClientDone);
        if (req.aborted || res.destroyed) {
          onClientDone();
          return;
        }

        try {
          upstream = mod.request(targetUrl, options, (up) => {
            upstreamResponse = up;
            up.on('error', onResponseError);
            up.once('aborted', onResponseError);
            up.once('close', () => {
              if (!up.complete) onResponseError();
              up.removeListener('error', onResponseError);
              up.removeListener('aborted', onResponseError);
              up.removeListener('data', onPlaylistData);
              up.removeListener('end', onPlaylistEnd);
            });
            if (done) {
              up.destroy();
              return;
            }

            res.statusCode = up.statusCode || 502;
            if (up.statusCode >= 300 && up.statusCode < 400 && up.headers.location) {
              let redirected;
              try {
                redirected = new URL(up.headers.location, targetUrl).href;
              } catch (e) {
                fail('bad redirect');
                return;
              }
              res.setHeader('Location', proxyUrl(redirected));
              res.end();
              return;
            }

            const ct = (up.headers['content-type'] || '').toLowerCase();
            const isM3u8 =
              ct.includes('mpegurl') ||
              /\.m3u8(\?|$)/i.test(targetUrl.pathname + targetUrl.search);

            if (isM3u8 && up.statusCode === 200) {
              res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
              up.on('data', onPlaylistData);
              up.once('end', onPlaylistEnd);
            } else {
              for (const header of ['content-type', 'content-range', 'accept-ranges', 'content-length']) {
                if (up.headers[header] !== undefined) res.setHeader(header, up.headers[header]);
              }
              up.pipe(res);
            }
          });
          upstream.on('error', onRequestError);
          upstream.once('close', () => {
            upstream.removeListener('error', onRequestError);
            upstream.removeListener('timeout', onTimeout);
          });
          upstream.setTimeout(30000, onTimeout);
          upstream.end();
        } catch (e) {
          onRequestError();
        }
      });
    }
  };
}

export default defineConfig({
  base: './',
  publicDir: false,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version)
  },
  build: {
    outDir: 'dist',
    target: 'chrome79',
    emptyOutDir: true,
    modulePreload: false,
    cssCodeSplit: false,
    rollupOptions: {
      output: { format: 'iife', inlineDynamicImports: true }
    }
  },
  server: {
    port: 5173,
    host: process.env.VITE_DEV_HOST || '127.0.0.1'
  },
  plugins: [webosAssets(), devProxy(), classicScript()]
});
