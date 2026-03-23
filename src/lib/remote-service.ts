export type RemoteServiceSettings = {
  baseUrl: string;
  masterKey: string;
  syncEnabled: boolean;
};

export type RemoteServerSettings = {
  server_name: string;
  whitelist_enabled: boolean;
  whitelist_entries: string[];
  updated_at: string;
};

export type RemoteApiKey = {
  id: number;
  name: string;
  key_preview: string;
  enabled: boolean;
  allowed_repos: string[];
  ip_whitelist: string[];
  remark: string;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
};

export type RemoteImageRecord = {
  id: number;
  name: string;
  owner: string;
  repo_name: string;
  repo_key: string;
  branch: string;
  path: string;
  original_url: string;
  cdn_url_snapshot: string;
  cdn_url_current: string;
  size: number;
  mime_type: string;
  sha: string;
  uploaded_at: string;
  created_at: string;
  updated_at: string;
  source: string;
};

export type RemoteImageListResponse = {
  page: number;
  page_size: number;
  total: number;
  items: RemoteImageRecord[];
};

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  token?: string;
  body?: unknown;
};

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.trim().replace(/\/+$/g, "");
}

async function request<T>(baseUrl: string, path: string, options: RequestOptions = {}) {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const data = (await response.json().catch(() => ({}))) as
    | T
    | { error?: { message?: string } };

  if (!response.ok) {
    const message =
      typeof data === "object" && data && "error" in data && data.error?.message
        ? data.error.message
        : "远程服务请求失败。";
    throw new Error(message);
  }

  return data as T;
}

export async function pingRemoteService(baseUrl: string) {
  return request<{ ok: boolean; server_time: string; listen_host: string; listen_port: number }>(
    baseUrl,
    "/api/ping",
  );
}

export async function verifyRemoteService(baseUrl: string, masterKey: string) {
  return request<{
    ok: boolean;
    service: { server_name: string; listen_host: string; listen_port: number };
    settings: RemoteServerSettings;
  }>(baseUrl, "/api/admin/verify", {
    token: masterKey,
  });
}

export async function getRemoteServerSettings(baseUrl: string, masterKey: string) {
  return request<RemoteServerSettings>(baseUrl, "/api/admin/settings", {
    token: masterKey,
  });
}

export async function updateRemoteServerSettings(
  baseUrl: string,
  masterKey: string,
  payload: Partial<RemoteServerSettings>,
) {
  return request<RemoteServerSettings>(baseUrl, "/api/admin/settings", {
    method: "PATCH",
    token: masterKey,
    body: payload,
  });
}

export async function listRemoteApiKeys(baseUrl: string, masterKey: string) {
  return request<{ items: RemoteApiKey[] }>(baseUrl, "/api/admin/api-keys", {
    token: masterKey,
  });
}

export async function createRemoteApiKey(
  baseUrl: string,
  masterKey: string,
  payload: {
    name: string;
    plain_key: string;
    allowed_repos: string[];
    ip_whitelist: string[];
    remark: string;
  },
) {
  return request<{ ok: boolean }>(baseUrl, "/api/admin/api-keys", {
    method: "POST",
    token: masterKey,
    body: payload,
  });
}

export async function updateRemoteApiKey(
  baseUrl: string,
  masterKey: string,
  id: number,
  payload: {
    name?: string;
    enabled?: boolean;
    allowed_repos?: string[];
    ip_whitelist?: string[];
    remark?: string;
  },
) {
  return request<{ ok: boolean }>(baseUrl, `/api/admin/api-keys/${id}`, {
    method: "PATCH",
    token: masterKey,
    body: payload,
  });
}

export async function deleteRemoteApiKey(baseUrl: string, masterKey: string, id: number) {
  return request<{ ok: boolean }>(baseUrl, `/api/admin/api-keys/${id}`, {
    method: "DELETE",
    token: masterKey,
  });
}

export async function listRemoteImages(baseUrl: string, masterKey: string, page = 1, pageSize = 10) {
  return request<RemoteImageListResponse>(baseUrl, `/api/admin/images?page=${page}&page_size=${pageSize}`, {
    token: masterKey,
  });
}

export async function queryRemoteImages(
  baseUrl: string,
  masterKey: string,
  options: {
    page?: number;
    pageSize?: number;
    owner?: string;
    repoName?: string;
  } = {},
) {
  const params = new URLSearchParams();
  params.set("page", String(options.page ?? 1));
  params.set("page_size", String(options.pageSize ?? 100));
  if (options.owner) params.set("owner", options.owner);
  if (options.repoName) params.set("repo_name", options.repoName);

  return request<RemoteImageListResponse>(baseUrl, `/api/admin/images?${params.toString()}`, {
    token: masterKey,
  });
}

export async function deleteRemoteImage(baseUrl: string, masterKey: string, id: number) {
  return request<{ ok: boolean }>(baseUrl, `/api/open/images/${id}`, {
    method: "DELETE",
    token: masterKey,
  });
}

export async function syncRemoteImage(
  baseUrl: string,
  apiKey: string,
  payload: {
    name: string;
    owner: string;
    repo_name: string;
    branch: string;
    path: string;
    original_url: string;
    cdn_url: string;
    size: number;
    mime_type: string;
    sha: string;
    uploaded_at: string;
    source: string;
  },
) {
  return request<RemoteImageRecord>(baseUrl, "/api/open/images", {
    method: "POST",
    token: apiKey,
    body: payload,
  });
}
