function normalizeBaseUrl(serverUrl) {
  return String(serverUrl || '').trim().replace(/\/+$/, '');
}

export async function cookieHeaderForSession(electronSession, serverUrl) {
  const base = normalizeBaseUrl(serverUrl);
  const cookies = await electronSession.cookies.get({ url: `${base}/` });
  return cookies.map(item => `${item.name}=${item.value}`).join('; ');
}

export async function apiRequest(electronSession, serverUrl, pathname, options = {}) {
  const base = normalizeBaseUrl(serverUrl);
  const url = `${base}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
  const headers = {
    Accept: 'application/json',
    'X-Agency-Client': 'desktop',
    ...(options.headers || {})
  };
  const cookieHeader = await cookieHeaderForSession(electronSession, base);
  if (cookieHeader) headers.Cookie = cookieHeader;
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok === false) {
    const error = new Error(result.error || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return result;
}
