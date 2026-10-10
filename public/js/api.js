export class APIError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export async function request(path, { method = 'GET', body, signal } = {}) {
  let response;
  try {
    response = await fetch(new URL(`api${path}`, document.baseURI), {
      method,
      credentials: 'same-origin',
      signal,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new APIError('暂时无法连接服务器，请检查网络后重试。', 0, 'NETWORK');
  }
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new APIError(data.error || '请求未能完成，请稍后重试。', response.status, data.code);
  return data;
}
