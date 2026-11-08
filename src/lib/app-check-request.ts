/** Retry only explicit App Check rejections, before the API handler ran. */
export async function appCheckRequest(
  url: string,
  init: RequestInit,
  getToken: (forceRefresh?: boolean) => Promise<string>,
  send: typeof fetch = fetch,
): Promise<Response> {
  const request = async (forceRefresh: boolean) => {
    // Do not hide token acquisition failures by sending an unauthenticated request.
    const token = await getToken(forceRefresh);
    const headers = new Headers(init.headers);
    if (token) headers.set('X-Firebase-AppCheck', token);
    else headers.delete('X-Firebase-AppCheck');
    return send(url, { ...init, headers });
  };
  const response = await request(false);
  if (response.status !== 401) return response;
  const body = await response.clone().json().catch(() => ({})) as { code?: string; error?: string };
  const rejected = body.code === 'APP_CHECK_INVALID'
    || body.error === 'App Check không hợp lệ.'
    || body.error === 'App Check không hợp lệ hoặc đã hết hạn.';
  return rejected ? request(true) : response;
}
