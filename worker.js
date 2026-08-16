// Cloudflare Worker para o editor de https://yestheres.github.io/p/
// NÃO coloque senha ou token neste arquivo.
// Cadastre ADMIN_PASSWORD e GITHUB_TOKEN como Secrets no Cloudflare.

const OWNER = 'Yestheres';
const REPO = 'p';
const BRANCH = 'main';
const DEFAULT_ORIGIN = 'https://yestheres.github.io';
const API = `https://api.github.com/repos/${OWNER}/${REPO}/contents`;
const MAX_FILES = 12;
const MAX_FILE_BYTES = 3 * 1024 * 1024;

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);

    try {
      if (url.pathname === '/health' && request.method === 'GET') {
        return json({ ok: true }, 200, cors);
      }

      if (url.pathname === '/auth' && request.method === 'POST') {
        const ok = await isAuthorized(request, env);
        return ok ? json({ ok: true }, 200, cors) : json({ error: 'Senha incorreta.' }, 401, cors);
      }

      if (url.pathname === '/save' && request.method === 'POST') {
        if (!(await isAuthorized(request, env))) {
          return json({ error: 'Não autorizado.' }, 401, cors);
        }
        if (!env.GITHUB_TOKEN) return json({ error: 'GITHUB_TOKEN não configurado.' }, 500, cors);

        const body = await request.json();
        const config = sanitizeConfig(body?.config);
        const files = Array.isArray(body?.files) ? body.files : [];
        if (files.length > MAX_FILES) return json({ error: `Máximo de ${MAX_FILES} imagens por salvamento.` }, 400, cors);

        const uploaded = new Map();
        for (const file of files) {
          validateFile(file);
          const path = makeImagePath(file.name, file.type);
          await putGithubFile(path, file.data, `Adicionar imagem ${path.split('/').pop()}`, null, env);
          uploaded.set(file.id, path);
        }

        for (const item of config.gallery) {
          if (item.uploadId) {
            const path = uploaded.get(item.uploadId);
            if (!path) throw new Error('Uma imagem selecionada não chegou ao servidor.');
            item.src = path;
          }
          delete item.uploadId;
          delete item.preview;
        }

        const current = await getGithubFile('site.json', env);
        const content = utf8ToBase64(JSON.stringify(config, null, 2) + '\n');
        await putGithubFile('site.json', content, 'Atualizar site pelo editor', current.sha, env);

        return json({ ok: true, config }, 200, cors);
      }

      return json({ error: 'Rota não encontrada.' }, 404, cors);
    } catch (error) {
      console.error(error);
      return json({ error: friendlyError(error) }, 500, cors);
    }
  }
};

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = new Set([DEFAULT_ORIGIN]);
  if (env.ALLOWED_ORIGIN) allowed.add(String(env.ALLOWED_ORIGIN).replace(/\/$/, ''));
  const headers = {
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
  if (allowed.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

async function isAuthorized(request, env) {
  if (!env.ADMIN_PASSWORD) return false;
  const auth = request.headers.get('Authorization') || '';
  const prefix = 'Bearer ';
  if (!auth.startsWith(prefix)) return false;
  return secureEqual(auth.slice(prefix.length), String(env.ADMIN_PASSWORD));
}

async function secureEqual(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b))
  ]);
  const aa = new Uint8Array(ha), bb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}

function sanitizeConfig(input) {
  if (!input || typeof input !== 'object') throw new Error('Configuração inválida.');
  const text = (value, max) => String(value ?? '').slice(0, max);
  const background = /^#[0-9a-f]{6}$/i.test(input.background || '') ? input.background : '#0a0a0b';
  const gallery = (Array.isArray(input.gallery) ? input.gallery : []).slice(0, 40).map(item => ({
    src: text(item?.src, 1200),
    label: text(item?.label, 140),
    alt: text(item?.alt, 240),
    ...(item?.uploadId ? { uploadId: text(item.uploadId, 120) } : {})
  }));
  return {
    siteName: text(input.siteName, 80),
    pageTitle: text(input.pageTitle, 100),
    eyebrow: text(input.eyebrow, 120),
    heroTitle: text(input.heroTitle, 500),
    lead: text(input.lead, 1200),
    text: text(input.text, 2400),
    footer: text(input.footer, 200),
    background,
    gallery
  };
}

function validateFile(file) {
  const allowed = new Set(['image/png','image/jpeg','image/webp','image/gif']);
  if (!file || typeof file !== 'object' || !file.id || !file.data) throw new Error('Arquivo de imagem inválido.');
  if (!allowed.has(file.type)) throw new Error('Formato de imagem não permitido.');
  const approxBytes = Math.floor(String(file.data).length * 3 / 4);
  if (approxBytes > MAX_FILE_BYTES) throw new Error('Uma das imagens passa de 3 MB.');
}

function makeImagePath(name, type) {
  const extByType = { 'image/png':'png', 'image/jpeg':'jpg', 'image/webp':'webp', 'image/gif':'gif' };
  const ext = extByType[type] || 'bin';
  const base = String(name || 'imagem').replace(/\.[^.]+$/, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 45) || 'imagem';
  const random = crypto.randomUUID().slice(0, 8);
  return `images/${Date.now()}-${random}-${base}.${ext}`;
}

async function getGithubFile(path, env) {
  const res = await fetch(`${API}/${encodePath(path)}?ref=${encodeURIComponent(BRANCH)}`, { headers: githubHeaders(env) });
  if (!res.ok) throw await githubError(res);
  return res.json();
}

async function putGithubFile(path, base64Content, message, sha, env) {
  const body = { message, content: base64Content, branch: BRANCH };
  if (sha) body.sha = sha;
  const res = await fetch(`${API}/${encodePath(path)}`, {
    method: 'PUT',
    headers: { ...githubHeaders(env), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw await githubError(res);
  return res.json();
}

function githubHeaders(env) {
  return {
    'Accept': 'application/vnd.github+json',
    'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
    'X-GitHub-Api-Version': '2026-03-10',
    'User-Agent': 'mist-static-site-editor'
  };
}

async function githubError(res) {
  const data = await res.json().catch(() => ({}));
  const err = new Error(data.message || `GitHub respondeu ${res.status}`);
  err.status = res.status;
  return err;
}

function encodePath(path) { return path.split('/').map(encodeURIComponent).join('/'); }

function utf8ToBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function friendlyError(error) {
  if (error?.status === 401) return 'Token do GitHub inválido ou expirado.';
  if (error?.status === 403) return 'O token não tem permissão para escrever no repositório.';
  if (error?.status === 409) return 'O GitHub detectou um conflito. Recarregue o editor e tente novamente.';
  return error?.message || 'Erro inesperado.';
}

function json(value, status, extraHeaders={}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', ...extraHeaders }
  });
}
