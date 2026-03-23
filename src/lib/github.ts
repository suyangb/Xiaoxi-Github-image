export type UrlMode = "raw" | "custom";
export type CustomUrlMode = "proxy" | "replace";

export interface GitHubConfig {
  token: string;
  owner: string;
  repo: string;
  branch: string;
  directory: string;
  urlMode: UrlMode;
  customUrlBase: string;
  customUrlMode: CustomUrlMode;
}

export interface UploadRecord {
  id: string;
  name: string;
  size: number;
  path: string;
  sha: string;
  owner?: string;
  repo?: string;
  branch?: string;
  url: string;
  sourceUrl?: string;
  customUrl?: string;
  markdown: string;
  html: string;
  uploadedAt: string;
  deleted?: boolean;
}

export interface RepoMeta {
  defaultBranch: string;
  isPrivate: boolean;
}

export interface RepositoryItem {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  private: boolean;
  visibility: "public" | "private" | string;
  defaultBranch: string;
  sizeInKb: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRepositoryInput {
  token: string;
  name: string;
  description: string;
  private: boolean;
  autoInit: boolean;
}

export interface RepositoryFileItem {
  name: string;
  path: string;
  sha: string;
  size: number;
  type: string;
  sourceUrl: string;
  rawUrl: string;
  updatedAt: string;
}

const GITHUB_API_BASE = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";

function trimSlashes(value: string) {
  return value.replace(/^\/+|\/+$/g, "");
}

function joinPath(...parts: string[]) {
  return parts
    .map((part) => trimSlashes(part))
    .filter(Boolean)
    .join("/");
}

function encodePath(path: string) {
  return path
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function normalizeFilename(name: string) {
  const extensionIndex = name.lastIndexOf(".");
  const extension = extensionIndex > -1 ? name.slice(extensionIndex) : "";
  const baseName = extensionIndex > -1 ? name.slice(0, extensionIndex) : name;
  const safeBase = baseName
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-_]/g, "");

  return `${safeBase || "image"}${extension.toLowerCase()}`;
}

async function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("文件读取失败"));
        return;
      }

      const [, base64 = ""] = result.split(",");
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("文件读取失败"));
    reader.readAsDataURL(file);
  });
}

function getHeaders(token: string) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
  };
}

async function parseGitHubError(response: Response) {
  const fallback = `GitHub 请求失败（${response.status}）`;

  try {
    const data = (await response.json()) as { message?: string };
    return data.message || fallback;
  } catch {
    return fallback;
  }
}

type RawRepository = {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  visibility?: "public" | "private" | string;
  default_branch: string;
  size: number;
  created_at: string;
  updated_at: string;
  owner: {
    login: string;
  };
};

function mapRepository(item: RawRepository): RepositoryItem {
  return {
    id: item.id,
    name: item.name,
    fullName: item.full_name,
    owner: item.owner.login,
    private: item.private,
    visibility: item.visibility ?? (item.private ? "private" : "public"),
    defaultBranch: item.default_branch,
    sizeInKb: item.size,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  };
}

export function getPublicUrl(config: GitHubConfig, path: string) {
  const cleanPath = trimSlashes(path);
  const originalUrl = getGitHubBlobUrl(config, cleanPath);

  if (config.urlMode === "custom") {
    const base = config.customUrlBase.trim().replace(/\/+$/g, "");
    if (config.customUrlMode === "proxy") {
      return `${base}/${originalUrl}`;
    }
    return `${base}/${cleanPath}`;
  }

  return originalUrl;
}

export function getGitHubBlobUrl(config: GitHubConfig, path: string) {
  const cleanPath = trimSlashes(path);
  return `https://github.com/${config.owner}/${config.repo}/blob/${config.branch}/${cleanPath}?raw=true`;
}

function buildUploadPath(config: GitHubConfig, file: File, filename?: string) {
  const normalizedName = normalizeFilename(filename || file.name);
  return joinPath(config.directory, normalizedName);
}

export async function verifyRepository(config: GitHubConfig) {
  const response = await fetch(
    `${GITHUB_API_BASE}/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`,
    {
      headers: getHeaders(config.token),
    },
  );

  if (!response.ok) {
    throw new Error(await parseGitHubError(response));
  }

  const data = (await response.json()) as {
    default_branch: string;
    private: boolean;
  };

  return {
    defaultBranch: data.default_branch,
    isPrivate: data.private,
  } satisfies RepoMeta;
}

export async function listUserRepositories(token: string) {
  const response = await fetch(
    `${GITHUB_API_BASE}/user/repos?sort=updated&per_page=100&affiliation=owner`,
    {
      headers: getHeaders(token),
    },
  );

  if (!response.ok) {
    throw new Error(await parseGitHubError(response));
  }

  const data = (await response.json()) as RawRepository[];
  return data.map(mapRepository);
}

export async function createRepository(input: CreateRepositoryInput) {
  const response = await fetch(`${GITHUB_API_BASE}/user/repos`, {
    method: "POST",
    headers: getHeaders(input.token),
    body: JSON.stringify({
      name: input.name,
      description: input.description || undefined,
      private: input.private,
      auto_init: input.autoInit,
    }),
  });

  if (!response.ok) {
    throw new Error(await parseGitHubError(response));
  }

  const data = (await response.json()) as RawRepository;
  return mapRepository(data);
}

export async function deleteRepository(token: string, owner: string, repo: string) {
  const response = await fetch(
    `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    {
      method: "DELETE",
      headers: getHeaders(token),
    },
  );

  if (!response.ok) {
    throw new Error(await parseGitHubError(response));
  }
}

async function fetchLatestCommitDate(token: string, owner: string, repo: string, path: string) {
  const response = await fetch(
    `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?path=${encodeURIComponent(path)}&per_page=1`,
    {
      headers: getHeaders(token),
    },
  );

  if (!response.ok) {
    return "";
  }

  const data = (await response.json()) as Array<{
    commit?: {
      author?: {
        date?: string;
      };
    };
  }>;

  return data[0]?.commit?.author?.date ?? "";
}

export async function listRepositoryFiles(config: GitHubConfig) {
  const directory = trimSlashes(config.directory);
  const contentsPath = directory
    ? `/contents/${encodePath(directory)}`
    : "/contents";
  const response = await fetch(
    `${GITHUB_API_BASE}/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}${contentsPath}`,
    {
      headers: getHeaders(config.token),
    },
  );

  if (!response.ok) {
    throw new Error(await parseGitHubError(response));
  }

  const data = (await response.json()) as Array<{
    name: string;
    path: string;
    sha: string;
    size: number;
    type: string;
  }>;

  const files = data.filter((item) => item.type === "file");
  const withDates = await Promise.all(
    files.map(async (file) => ({
      name: file.name,
      path: file.path,
      sha: file.sha,
      size: file.size,
      type: file.type,
      sourceUrl: getGitHubBlobUrl(config, file.path),
      rawUrl: getPublicUrl(config, file.path),
      updatedAt: await fetchLatestCommitDate(config.token, config.owner, config.repo, file.path),
    })),
  );

  return withDates satisfies RepositoryFileItem[];
}

export async function deleteRepositoryFile(config: GitHubConfig, path: string, sha: string) {
  const response = await fetch(
    `${GITHUB_API_BASE}/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${encodePath(path)}`,
    {
      method: "DELETE",
      headers: getHeaders(config.token),
      body: JSON.stringify({
        message: `delete: ${path}`,
        sha,
        branch: config.branch,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(await parseGitHubError(response));
  }
}

export async function uploadFile(config: GitHubConfig, file: File, filename?: string) {
  const path = buildUploadPath(config, file, filename);
  const content = await fileToBase64(file);

  const response = await fetch(
    `${GITHUB_API_BASE}/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${encodePath(path)}`,
    {
      method: "PUT",
      headers: getHeaders(config.token),
      body: JSON.stringify({
        message: `upload: ${file.name}`,
        content,
        branch: config.branch,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(await parseGitHubError(response));
  }

  const data = (await response.json()) as {
    content?: {
      path: string;
      sha: string;
    };
  };

  if (!data.content?.path || !data.content.sha) {
    throw new Error("GitHub 返回的数据不完整");
  }

  const url = getPublicUrl(config, data.content.path);

  return {
    id: crypto.randomUUID(),
    name: file.name,
    size: file.size,
    path: data.content.path,
    sha: data.content.sha,
    owner: config.owner,
    repo: config.repo,
    branch: config.branch,
    url,
    sourceUrl: getGitHubBlobUrl(config, data.content.path),
    customUrl: config.urlMode === "custom" ? url : "",
    markdown: `![${file.name}](${url})`,
    html: `<img src="${url}" alt="${file.name}" />`,
    uploadedAt: new Date().toISOString(),
  } satisfies UploadRecord;
}
