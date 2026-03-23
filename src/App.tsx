import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clipboard,
  Download,
  Image as ImageIcon,
  Import,
  LoaderCircle,
  MoreHorizontal,
  Plus,
  RefreshCcw,
  Scissors,
  Search,
  Stamp,
  Tags,
  Type as TypeIcon,
  Upload,
  WandSparkles,
} from "lucide-react";
import { Toaster, toast } from "sonner";

import { AppSidebar, type AppSection } from "@/components/app-sidebar";
import { FilterToolbar } from "@/components/filter-toolbar";
import { PaginationBar } from "@/components/pagination-bar";
import { HistorySection } from "@/components/sections/history-section";
import { RemoteServiceSection } from "@/components/sections/remote-service-section";
import { SiteHeader } from "@/components/site-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  createRepository,
  deleteRepository,
  deleteRepositoryFile,
  getPublicUrl,
  listUserRepositories,
  listRepositoryFiles,
  type CustomUrlMode,
  type GitHubConfig,
  getGitHubBlobUrl,
  type RepoMeta,
  type RepositoryFileItem,
  type RepositoryItem,
  type UploadRecord,
  type UrlMode,
  uploadFile,
  verifyRepository,
} from "@/lib/github";
import {
  applyWatermarkToFile,
  buildWatermarkPreview,
  defaultWatermarkSettings,
  fileToDataUrl,
  previewBaseImage,
  type WatermarkPosition,
  type WatermarkSettings,
} from "@/lib/watermark";
import {
  compressImageFile,
  defaultCompressionSettings,
  type CompressionSettings,
} from "@/lib/compress";
import {
  NAMING_VARIABLES,
  defaultNamingSettings,
  generateUploadFilename,
  type NamingMode,
  type NamingSettings,
} from "@/lib/naming";
import {
  createRemoteApiKey,
  deleteRemoteApiKey,
  getRemoteServerSettings,
  listRemoteApiKeys,
  listRemoteImages,
  pingRemoteService,
  queryRemoteImages,
  syncRemoteImage,
  deleteRemoteImage,
  updateRemoteApiKey,
  updateRemoteServerSettings,
  verifyRemoteService,
  type RemoteApiKey,
  type RemoteImageRecord,
  type RemoteServerSettings,
  type RemoteServiceSettings,
} from "@/lib/remote-service";
import { downloadSettingsFile, parseSettingsFile } from "@/lib/settings-transfer";

const STORAGE_KEY = "github-image-host-state";

const defaultConfig: GitHubConfig = {
  token: "",
  owner: "",
  repo: "",
  branch: "main",
  directory: "",
  urlMode: "raw",
  customUrlBase: "",
  customUrlMode: "replace",
};

const defaultRemoteServiceSettings: RemoteServiceSettings = {
  baseUrl: "http://127.0.0.1:38471",
  masterKey: "",
  syncEnabled: false,
};

type RepoUploadSettings = Pick<
  GitHubConfig,
  "branch" | "directory" | "urlMode" | "customUrlBase" | "customUrlMode"
>;

type PersistedState = {
  config: GitHubConfig;
  records: UploadRecord[];
  repoSettingsMap: Record<string, RepoUploadSettings>;
  remoteServiceSettings?: RemoteServiceSettings;
  remoteApiKeySecrets?: Record<string, string>;
  watermarkSettings?: WatermarkSettings;
  compressionSettings?: CompressionSettings;
  namingSettings?: NamingSettings;
  repoFileRefreshInterval?: number;
  theme?: "light" | "dark";
  onboardingSeen?: boolean;
  activityLogs?: ActivityLog[];
  repoCdnMap?: Record<string, { base: string; mode: CustomUrlMode }>;
};

const REPO_PAGE_SIZE = 8;
const FILE_PAGE_SIZE = 10;
const HISTORY_PAGE_SIZE = 10;
const REMOTE_API_KEY_PAGE_SIZE = 8;
const REMOTE_IMAGE_PAGE_SIZE = 10;
const DEFAULT_REPO_FILE_REFRESH_INTERVAL = 0;
const BACKGROUND_RETRY_DELAY_MS = 10_000;
const REPO_FILE_REFRESH_OPTIONS = [
  { label: "手动刷新", value: "0" },
  { label: "10 秒自动刷新", value: "10000" },
  { label: "30 秒自动刷新", value: "30000" },
  { label: "1 分钟自动刷新", value: "60000" },
  { label: "5 分钟自动刷新", value: "300000" },
] as const;
const IMAGE_TYPE_OPTIONS = [
  { label: "全部格式", value: "all" },
  { label: "PNG", value: "png" },
  { label: "JPG", value: "jpg" },
  { label: "JPEG", value: "jpeg" },
  { label: "WebP", value: "webp" },
  { label: "GIF", value: "gif" },
] as const;

type SelectedFileInsight = {
  key: string;
  width: number;
  height: number;
  expectedFormat: string;
  willCompress: boolean;
};

type ActivityLog = {
  id: string;
  message: string;
  createdAt: string;
};

type PreviewImageState = {
  name: string;
  path: string;
  originalUrl: string;
  previewUrl: string;
  customUrl?: string;
  markdown?: string;
  html?: string;
  isPrivate?: boolean;
  showPrivateTip?: boolean;
};

type RemoteApiKeyForm = {
  name: string;
  allowedRepos: string[];
  ipWhitelist: string;
  remark: string;
};

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

function formatRepoUsage(sizeInKb: number) {
  const used = formatBytes(sizeInKb * 1024);
  return `${used} / 1GB`;
}

function formatTime(isoString: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(isoString));
}

function normalizeUrlMode(value: string | undefined): UrlMode {
  return value === "custom" ? "custom" : "raw";
}

function getExpectedCompressionFormat(file: File, settings: CompressionSettings) {
  if (settings.outputFormat === "jpeg") return "JPEG";
  if (settings.outputFormat === "webp") return "WebP";

  if (file.type === "image/png") return "PNG";
  if (file.type === "image/webp") return "WebP";
  if (file.type === "image/gif") return "GIF";
  if (file.type === "image/jpeg") return "JPEG";
  return "原格式";
}

async function readImageSize(file: File) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      resolve({
        width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height,
      });
      URL.revokeObjectURL(objectUrl);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("图片尺寸读取失败"));
    };
    image.src = objectUrl;
  });
}

function getRecordOriginalUrl(record: UploadRecord) {
  if (record.sourceUrl) return record.sourceUrl;
  if (record.owner && record.repo && record.branch) {
    return getGitHubBlobUrl(
      {
        ...defaultConfig,
        owner: record.owner,
        repo: record.repo,
        branch: record.branch,
      },
      record.path,
    );
  }
  return record.url;
}

function getRecordCustomUrl(
  record: UploadRecord,
  repoSettingsMap?: Record<string, RepoUploadSettings>,
) {
  if (record.customUrl) return record.customUrl;

  if (record.owner && record.repo && record.path && repoSettingsMap) {
    const repoKey = `${record.owner}/${record.repo}`;
    const repoSettings = repoSettingsMap[repoKey];
    if (repoSettings?.urlMode === "custom" && repoSettings.customUrlBase.trim()) {
      const base = repoSettings.customUrlBase.trim().replace(/\/+$/g, "");
      const originalUrl =
        record.sourceUrl ||
        getGitHubBlobUrl(
          {
            ...defaultConfig,
            owner: record.owner,
            repo: record.repo,
            branch: record.branch || repoSettings.branch || defaultConfig.branch,
          },
          record.path,
        );

      return repoSettings.customUrlMode === "proxy"
        ? `${base}/${originalUrl}`
        : `${base}/${record.path}`;
    }
  }

  const originalUrl = getRecordOriginalUrl(record);
  if (record.url && record.url !== originalUrl) {
    return record.url;
  }

  return "";
}

function getRepoPrivateStatus(
  repoList: RepositoryItem[],
  owner?: string,
  repoName?: string,
) {
  if (!owner || !repoName) return false;
  return repoList.some((repo) => repo.owner === owner && repo.name === repoName && repo.private);
}

function readPersistedState(): PersistedState {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return {
      config: defaultConfig,
      records: [],
      repoSettingsMap: {},
      remoteServiceSettings: defaultRemoteServiceSettings,
      watermarkSettings: defaultWatermarkSettings,
      compressionSettings: defaultCompressionSettings,
      namingSettings: defaultNamingSettings,
      repoFileRefreshInterval: DEFAULT_REPO_FILE_REFRESH_INTERVAL,
      theme: "light",
      onboardingSeen: false,
      activityLogs: [],
    };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    const legacyRepoCdnMap = parsed.repoCdnMap ?? {};
    const repoSettingsMap = parsed.repoSettingsMap ?? {};

    Object.entries(legacyRepoCdnMap).forEach(([repoKey, value]) => {
      if (repoSettingsMap[repoKey]) return;

      repoSettingsMap[repoKey] = {
        branch: defaultConfig.branch,
        directory: defaultConfig.directory,
        urlMode: value.base ? "custom" : "raw",
        customUrlBase: value.base ?? "",
        customUrlMode: value.mode ?? defaultConfig.customUrlMode,
      };
    });

    return {
      config: {
        ...defaultConfig,
        ...parsed.config,
        urlMode: normalizeUrlMode(parsed.config?.urlMode),
      },
      records: parsed.records ?? [],
      remoteServiceSettings: {
        ...defaultRemoteServiceSettings,
        ...parsed.remoteServiceSettings,
      },
      remoteApiKeySecrets: parsed.remoteApiKeySecrets ?? {},
      watermarkSettings: {
        ...defaultWatermarkSettings,
        ...parsed.watermarkSettings,
      },
      compressionSettings: {
        ...defaultCompressionSettings,
        ...parsed.compressionSettings,
      },
      namingSettings: {
        ...defaultNamingSettings,
        ...parsed.namingSettings,
      },
      repoFileRefreshInterval: parsed.repoFileRefreshInterval ?? DEFAULT_REPO_FILE_REFRESH_INTERVAL,
      theme: parsed.theme === "dark" ? "dark" : "light",
      onboardingSeen: parsed.onboardingSeen ?? false,
      activityLogs: parsed.activityLogs ?? [],
      repoSettingsMap: Object.fromEntries(
        Object.entries(repoSettingsMap).map(([repoKey, settings]) => [
          repoKey,
          {
            ...settings,
            urlMode: normalizeUrlMode(settings.urlMode),
          },
        ]),
      ),
    };
  } catch {
    return {
      config: defaultConfig,
      records: [],
      repoSettingsMap: {},
      remoteServiceSettings: defaultRemoteServiceSettings,
      remoteApiKeySecrets: {},
      watermarkSettings: defaultWatermarkSettings,
      compressionSettings: defaultCompressionSettings,
      namingSettings: defaultNamingSettings,
      repoFileRefreshInterval: DEFAULT_REPO_FILE_REFRESH_INTERVAL,
      theme: "light",
      onboardingSeen: false,
      activityLogs: [],
    };
  }
}

async function copyText(value: string, message: string) {
  await navigator.clipboard.writeText(value);
  toast.success(message);
}

export default function App() {
  const [activeSection, setActiveSection] = useState<AppSection>("overview");
  const [config, setConfig] = useState<GitHubConfig>(defaultConfig);
  const [records, setRecords] = useState<UploadRecord[]>([]);
  const [repoSettingsMap, setRepoSettingsMap] = useState<Record<string, RepoUploadSettings>>({});
  const [remoteServiceSettings, setRemoteServiceSettings] = useState<RemoteServiceSettings>(
    defaultRemoteServiceSettings,
  );
  const [watermarkSettings, setWatermarkSettings] = useState<WatermarkSettings>(defaultWatermarkSettings);
  const [compressionSettings, setCompressionSettings] = useState<CompressionSettings>(defaultCompressionSettings);
  const [namingSettings, setNamingSettings] = useState<NamingSettings>(defaultNamingSettings);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [onboardingSeen, setOnboardingSeen] = useState(false);
  const [uploadResultRecords, setUploadResultRecords] = useState<UploadRecord[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [watermarkPreviewUrl, setWatermarkPreviewUrl] = useState(previewBaseImage);
  const [repoFileRefreshInterval, setRepoFileRefreshInterval] = useState(DEFAULT_REPO_FILE_REFRESH_INTERVAL);
  const [repoList, setRepoList] = useState<RepositoryItem[]>([]);
  const [repoFiles, setRepoFiles] = useState<RepositoryFileItem[]>([]);
  const [repoSearch, setRepoSearch] = useState("");
  const [repoPage, setRepoPage] = useState(1);
  const [filePage, setFilePage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const [repoMeta, setRepoMeta] = useState<RepoMeta | null>(null);
  const [remoteServerSettings, setRemoteServerSettings] = useState<RemoteServerSettings | null>(null);
  const [remoteApiKeys, setRemoteApiKeys] = useState<RemoteApiKey[]>([]);
  const [remoteImages, setRemoteImages] = useState<RemoteImageRecord[]>([]);
  const [remoteSyncedPaths, setRemoteSyncedPaths] = useState<string[]>([]);
  const [remoteApiKeySecrets, setRemoteApiKeySecrets] = useState<Record<string, string>>({});
  const [remoteApiKeyPage, setRemoteApiKeyPage] = useState(1);
  const [remoteImagePage, setRemoteImagePage] = useState(1);
  const [remoteImageTotal, setRemoteImageTotal] = useState(0);
  const [remoteConnected, setRemoteConnected] = useState(false);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteImageLoading, setRemoteImageLoading] = useState(false);
  const [remoteStatusMessage, setRemoteStatusMessage] = useState("");
  const [remoteApiKeyForm, setRemoteApiKeyForm] = useState<RemoteApiKeyForm>({
    name: "",
    allowedRepos: [],
    ipWhitelist: "127.0.0.1",
    remark: "",
  });
  const [repoLoadError, setRepoLoadError] = useState("");
  const [repoFilesError, setRepoFilesError] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [selectedFileInsights, setSelectedFileInsights] = useState<Record<string, SelectedFileInsight>>({});
  const [repoFileSearch, setRepoFileSearch] = useState("");
  const [repoFileTypeFilter, setRepoFileTypeFilter] = useState("all");
  const [historySearch, setHistorySearch] = useState("");
  const [historyTypeFilter, setHistoryTypeFilter] = useState("all");
  const [previewImage, setPreviewImage] = useState<PreviewImageState | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [loadingRepoFiles, setLoadingRepoFiles] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createRemoteApiKeyOpen, setCreateRemoteApiKeyOpen] = useState(false);
  const [remoteApiKeyReposOpen, setRemoteApiKeyReposOpen] = useState(false);
  const [repoSettingsOpen, setRepoSettingsOpen] = useState(false);
  const [remoteDocsOpen, setRemoteDocsOpen] = useState(false);
  const [privateLinkDialogOpen, setPrivateLinkDialogOpen] = useState(false);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [activeRepoForSettings, setActiveRepoForSettings] = useState<RepositoryItem | null>(null);
  const [activeRemoteApiKey, setActiveRemoteApiKey] = useState<RemoteApiKey | null>(null);
  const [pendingOriginalUrl, setPendingOriginalUrl] = useState("");
  const [confirmState, setConfirmState] = useState<
    | { type: "repo"; repo: RepositoryItem }
    | { type: "file"; file: RepositoryFileItem }
    | { type: "record"; record: UploadRecord }
    | { type: "remote-api-key"; item: RemoteApiKey }
    | { type: "remote-image"; item: RemoteImageRecord }
    | { type: "clear-history" }
    | null
  >(null);
  const [repoSettingsForm, setRepoSettingsForm] = useState<RepoUploadSettings>({
    branch: defaultConfig.branch,
    directory: defaultConfig.directory,
    urlMode: defaultConfig.urlMode,
    customUrlBase: defaultConfig.customUrlBase,
    customUrlMode: defaultConfig.customUrlMode,
  });
  const [creatingRepo, setCreatingRepo] = useState(false);
  const [deletingRepoId, setDeletingRepoId] = useState<number | null>(null);
  const repoRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remoteRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [createForm, setCreateForm] = useState({
    name: "",
    description: "",
    visibility: "public" as "public" | "private",
    autoInit: true,
  });

  useEffect(() => {
    const state = readPersistedState();
    setConfig(state.config);
    setRecords(state.records);
    setRepoSettingsMap(state.repoSettingsMap);
    setRemoteServiceSettings(state.remoteServiceSettings ?? defaultRemoteServiceSettings);
    setRemoteApiKeySecrets(state.remoteApiKeySecrets ?? {});
    setWatermarkSettings(state.watermarkSettings ?? defaultWatermarkSettings);
    setCompressionSettings(state.compressionSettings ?? defaultCompressionSettings);
    setNamingSettings(state.namingSettings ?? defaultNamingSettings);
    setTheme(state.theme === "dark" ? "dark" : "light");
    setOnboardingSeen(state.onboardingSeen ?? false);
    setActivityLogs(state.activityLogs ?? []);
    setRepoFileRefreshInterval(
      state.repoFileRefreshInterval ?? DEFAULT_REPO_FILE_REFRESH_INTERVAL,
    );
    setInitialized(true);
  }, []);

  useEffect(() => {
    return () => {
      if (repoRetryTimerRef.current) {
        clearTimeout(repoRetryTimerRef.current);
      }
      if (remoteRetryTimerRef.current) {
        clearTimeout(remoteRetryTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!initialized) return;
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        config,
        records,
        repoSettingsMap,
        remoteServiceSettings,
        remoteApiKeySecrets,
        watermarkSettings,
        compressionSettings,
        namingSettings,
        repoFileRefreshInterval,
        theme,
        onboardingSeen,
        activityLogs,
      } satisfies PersistedState),
    );
  }, [
    config,
    records,
    repoSettingsMap,
    remoteServiceSettings,
    remoteApiKeySecrets,
    watermarkSettings,
    compressionSettings,
    namingSettings,
    repoFileRefreshInterval,
    theme,
    onboardingSeen,
    activityLogs,
    initialized,
  ]);

  const configValid =
    Boolean(config.token && config.owner && config.repo && config.branch) &&
    (config.urlMode !== "custom" || Boolean(config.customUrlBase.trim()));

  const filteredRepos = useMemo(() => {
    const keyword = repoSearch.trim().toLowerCase();
    if (!keyword) return repoList;
    return repoList.filter(
      (repo) =>
        repo.name.toLowerCase().includes(keyword) ||
        repo.fullName.toLowerCase().includes(keyword),
    );
  }, [repoList, repoSearch]);

  const pagedRepos = useMemo(() => {
    const start = (repoPage - 1) * REPO_PAGE_SIZE;
    return filteredRepos.slice(start, start + REPO_PAGE_SIZE);
  }, [filteredRepos, repoPage]);

  const filteredHistoryRecords = useMemo(() => {
    const keyword = historySearch.trim().toLowerCase();

    return records.filter((record) => {
      const matchesSearch =
        !keyword ||
        record.name.toLowerCase().includes(keyword) ||
        record.path.toLowerCase().includes(keyword);

      if (historyTypeFilter === "all") {
        return matchesSearch;
      }

      return matchesSearch && record.name.toLowerCase().endsWith(`.${historyTypeFilter}`);
    });
  }, [records, historySearch, historyTypeFilter]);

  const pagedHistoryRecords = useMemo(() => {
    const start = (historyPage - 1) * HISTORY_PAGE_SIZE;
    return filteredHistoryRecords.slice(start, start + HISTORY_PAGE_SIZE);
  }, [filteredHistoryRecords, historyPage]);

  const pagedRemoteApiKeys = useMemo(() => {
    const start = (remoteApiKeyPage - 1) * REMOTE_API_KEY_PAGE_SIZE;
    return remoteApiKeys.slice(start, start + REMOTE_API_KEY_PAGE_SIZE);
  }, [remoteApiKeys, remoteApiKeyPage]);

  const sortedRepoFiles = useMemo(() => {
    return [...repoFiles].sort((a, b) => {
      const timeA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const timeB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;

      if (timeA !== timeB) {
        return timeB - timeA;
      }

      return b.path.localeCompare(a.path);
    });
  }, [repoFiles]);

  const filteredRepoFiles = useMemo(() => {
    const keyword = repoFileSearch.trim().toLowerCase();

    return sortedRepoFiles.filter((file) => {
      const matchesSearch =
        !keyword ||
        file.name.toLowerCase().includes(keyword) ||
        file.path.toLowerCase().includes(keyword);

      if (repoFileTypeFilter === "all") {
        return matchesSearch;
      }

      return matchesSearch && file.name.toLowerCase().endsWith(`.${repoFileTypeFilter}`);
    });
  }, [sortedRepoFiles, repoFileSearch, repoFileTypeFilter]);

  const pagedRepoFiles = useMemo(() => {
    const start = (filePage - 1) * FILE_PAGE_SIZE;
    return filteredRepoFiles.slice(start, start + FILE_PAGE_SIZE);
  }, [filteredRepoFiles, filePage]);

  const currentRepository = useMemo(
    () => repoList.find((repo) => repo.owner === config.owner && repo.name === config.repo) ?? null,
    [repoList, config.owner, config.repo],
  );

  function getRepoSettings(repo: RepositoryItem): RepoUploadSettings {
    return (
      repoSettingsMap[repo.fullName] ?? {
        branch: repo.defaultBranch || defaultConfig.branch,
        directory: defaultConfig.directory,
        urlMode: defaultConfig.urlMode,
        customUrlBase: defaultConfig.customUrlBase,
        customUrlMode: defaultConfig.customUrlMode,
      }
    );
  }

  function addActivityLog(message: string) {
    setActivityLogs((current) => [
      {
        id: crypto.randomUUID(),
        message,
        createdAt: new Date().toISOString(),
      },
      ...current,
    ].slice(0, 20));
  }

  function clearRepoRetryTimer() {
    if (repoRetryTimerRef.current) {
      clearTimeout(repoRetryTimerRef.current);
      repoRetryTimerRef.current = null;
    }
  }

  function clearRemoteRetryTimer() {
    if (remoteRetryTimerRef.current) {
      clearTimeout(remoteRetryTimerRef.current);
      remoteRetryTimerRef.current = null;
    }
  }

  function scheduleRepoRetry() {
    if (repoRetryTimerRef.current) {
      return false;
    }

    repoRetryTimerRef.current = setTimeout(() => {
      repoRetryTimerRef.current = null;
      if (!initialized || !config.token.trim() || repoList.length > 0 || loadingRepos) {
        return;
      }
      void handleLoadRepositories(true);
    }, BACKGROUND_RETRY_DELAY_MS);
  }

  function scheduleRemoteRetry() {
    if (remoteRetryTimerRef.current) {
      return;
    }

    remoteRetryTimerRef.current = setTimeout(() => {
      remoteRetryTimerRef.current = null;
      if (
        !initialized ||
        !remoteServiceSettings.baseUrl.trim() ||
        !remoteServiceSettings.masterKey.trim() ||
        remoteLoading
      ) {
        return;
      }
      void loadRemoteDashboard();
    }, BACKGROUND_RETRY_DELAY_MS);
  }

  function parseTextLines(value: string) {
    return value
      .split(/\r?\n|,/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  async function refreshRemoteSyncStatus() {
    if (
      !remoteConnected ||
      !remoteServiceSettings.baseUrl.trim() ||
      !remoteServiceSettings.masterKey.trim() ||
      !config.owner ||
      !config.repo
    ) {
      setRemoteSyncedPaths([]);
      return;
    }

    try {
      const result = await queryRemoteImages(
        remoteServiceSettings.baseUrl,
        remoteServiceSettings.masterKey,
        {
          owner: config.owner,
          repoName: config.repo,
          page: 1,
          pageSize: 500,
        },
      );
      setRemoteSyncedPaths(result.items.map((item) => item.path));
    } catch {
      setRemoteSyncedPaths([]);
    }
  }

  async function loadRemoteDashboard(showSuccess = false, imagePage = remoteImagePage) {
    if (!remoteServiceSettings.baseUrl.trim() || !remoteServiceSettings.masterKey.trim()) {
      throw new Error("请先填写远程服务地址和主管理密钥。");
    }

    setRemoteLoading(true);
    setRemoteImageLoading(true);
    try {
      const [verifyResult, settingsResult, apiKeysResult, imagesResult] = await Promise.all([
        verifyRemoteService(remoteServiceSettings.baseUrl, remoteServiceSettings.masterKey),
        getRemoteServerSettings(remoteServiceSettings.baseUrl, remoteServiceSettings.masterKey),
        listRemoteApiKeys(remoteServiceSettings.baseUrl, remoteServiceSettings.masterKey),
        listRemoteImages(
          remoteServiceSettings.baseUrl,
          remoteServiceSettings.masterKey,
          imagePage,
          REMOTE_IMAGE_PAGE_SIZE,
        ),
      ]);

      setRemoteConnected(true);
      setRemoteServerSettings(settingsResult);
      setRemoteApiKeys(apiKeysResult.items);
      setRemoteImages(imagesResult.items);
      setRemoteImageTotal(imagesResult.total);
      setRemoteStatusMessage(
        `已连接 ${verifyResult.service.server_name}（${verifyResult.service.listen_host}:${verifyResult.service.listen_port}）`,
      );
      if (showSuccess) {
        toast.success("远程服务连接成功。");
      }
      if (config.owner && config.repo) {
        void refreshRemoteSyncStatus();
      }
      clearRemoteRetryTimer();
      return true;
    } catch (error) {
      setRemoteConnected(false);
      setRemoteStatusMessage("");
      scheduleRemoteRetry();
      throw error;
    } finally {
      setRemoteLoading(false);
      setRemoteImageLoading(false);
    }
  }

  async function handlePingRemoteService() {
    if (!remoteServiceSettings.baseUrl.trim()) {
      toast.error("请先填写远程服务地址。");
      return;
    }

    try {
      const result = await pingRemoteService(remoteServiceSettings.baseUrl);
      toast.success(`远程服务在线：${result.listen_host}:${result.listen_port}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "远程服务连接失败。");
    }
  }

  async function handleConnectRemoteService() {
    try {
      await loadRemoteDashboard(true);
      addActivityLog("连接了远程服务");
    } catch (error) {
      setRemoteConnected(false);
      setRemoteStatusMessage("");
      toast.error(error instanceof Error ? error.message : "远程服务连接失败。");
    }
  }

  async function handleSaveRemoteServerSettings() {
    if (!remoteServerSettings) {
      toast.error("请先连接远程服务。");
      return;
    }

    try {
      const updated = await updateRemoteServerSettings(
        remoteServiceSettings.baseUrl,
        remoteServiceSettings.masterKey,
        remoteServerSettings,
      );
      setRemoteServerSettings(updated);
      toast.success("远程服务设置已保存。");
      addActivityLog("更新了远程服务设置");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "远程服务设置保存失败。");
    }
  }

  async function handleCreateRemoteApiKey() {
    if (!remoteConnected) {
      toast.error("请先连接远程服务。");
      return;
    }

    const plainKey = `${crypto.randomUUID()}${crypto.randomUUID().replace(/-/g, "")}`;
    try {
      await createRemoteApiKey(remoteServiceSettings.baseUrl, remoteServiceSettings.masterKey, {
        name: remoteApiKeyForm.name.trim(),
        plain_key: plainKey,
        allowed_repos: remoteApiKeyForm.allowedRepos,
        ip_whitelist: parseTextLines(remoteApiKeyForm.ipWhitelist),
        remark: remoteApiKeyForm.remark.trim(),
      });

      const keyPreview = plainKey.slice(0, 8);
      setRemoteApiKeySecrets((current) => ({
        ...current,
        [keyPreview]: plainKey,
      }));
      setRemoteApiKeyForm({
        name: "",
        allowedRepos: config.owner && config.repo ? [`${config.owner}/${config.repo}`] : [],
        ipWhitelist: "127.0.0.1",
        remark: "",
      });
      setCreateRemoteApiKeyOpen(false);
      await loadRemoteDashboard();
      toast.success("远程 API Key 已创建。");
      addActivityLog("创建了远程 API Key");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "远程 API Key 创建失败。");
    }
  }

  async function handleToggleRemoteApiKey(item: RemoteApiKey) {
    try {
      await updateRemoteApiKey(remoteServiceSettings.baseUrl, remoteServiceSettings.masterKey, item.id, {
        enabled: !item.enabled,
      });
      await loadRemoteDashboard();
      toast.success(item.enabled ? "远程 API Key 已禁用。" : "远程 API Key 已启用。");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "远程 API Key 更新失败。");
    }
  }

  async function handleDeleteRemoteApiKey(id: number) {
    try {
      await deleteRemoteApiKey(remoteServiceSettings.baseUrl, remoteServiceSettings.masterKey, id);
      await loadRemoteDashboard();
      toast.success("远程 API Key 已删除。");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "远程 API Key 删除失败。");
    }
  }

  async function handleDeleteRemoteImageRecord(item: RemoteImageRecord) {
    try {
      await deleteRemoteImage(remoteServiceSettings.baseUrl, remoteServiceSettings.masterKey, item.id);
      await loadRemoteDashboard(false, remoteImagePage);
      await refreshRemoteSyncStatus();
      toast.success("远程图片记录已删除。");
      addActivityLog(`删除了远程图片记录 ${item.name}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "远程图片记录删除失败。");
    }
  }

  async function handleUploadFileToRemote(file: RepositoryFileItem) {
    if (
      !remoteConnected ||
      !remoteServiceSettings.baseUrl.trim() ||
      !remoteServiceSettings.masterKey.trim()
    ) {
      toast.error("请先连接远程服务。");
      return;
    }

    try {
      await syncRemoteImage(remoteServiceSettings.baseUrl, remoteServiceSettings.masterKey, {
        name: file.name,
        owner: config.owner,
        repo_name: config.repo,
        branch: config.branch,
        path: file.path,
        original_url: file.sourceUrl,
        cdn_url: config.urlMode === "custom" ? getPublicUrl(config, file.path) : "",
        size: file.size,
        mime_type: "",
        sha: file.sha,
        uploaded_at: file.updatedAt || new Date().toISOString(),
        source: "local-client",
      });
      await refreshRemoteSyncStatus();
      await loadRemoteDashboard(false, 1);
      toast.success(`文件 ${file.name} 已上传到远程服务。`);
      addActivityLog(`上传了远程图片记录 ${file.name}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "上传到远程服务失败。");
    }
  }

  function openPreviewFromRecord(record: UploadRecord) {
    const originalUrl = getRecordOriginalUrl(record);
    const customUrl = getRecordCustomUrl(record, repoSettingsMap);
    const hasCustomCdn = Boolean(customUrl);
    const isPrivate = getRepoPrivateStatus(repoList, record.owner, record.repo);

    setPreviewImage({
      name: record.name,
      path: record.path,
      originalUrl,
      previewUrl: hasCustomCdn ? customUrl : originalUrl,
      customUrl,
      markdown: record.markdown,
      html: record.html,
      isPrivate,
      showPrivateTip: !hasCustomCdn && isPrivate,
    });
  }

  function openPreviewFromRepoFile(file: RepositoryFileItem, customUrl?: string) {
    const hasCustomCdn = Boolean(customUrl);
    const isPrivate = getRepoPrivateStatus(repoList, config.owner, config.repo);

    setPreviewImage({
      name: file.name,
      path: file.path,
      originalUrl: file.sourceUrl,
      previewUrl: hasCustomCdn ? customUrl! : file.sourceUrl,
      customUrl,
      isPrivate,
      showPrivateTip: !hasCustomCdn && isPrivate,
    });
  }

  function openPreviewFromRemoteImage(item: RemoteImageRecord) {
    const customUrl = item.cdn_url_snapshot || "";
    const isPrivate = getRepoPrivateStatus(repoList, item.owner, item.repo_name);

    setPreviewImage({
      name: item.name,
      path: item.path,
      originalUrl: item.original_url,
      previewUrl: customUrl || item.original_url,
      customUrl,
      isPrivate,
      showPrivateTip: !customUrl && isPrivate,
    });
  }

  function handleToggleTheme() {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  }

  async function handleImportSettings(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const parsed = await parseSettingsFile<Partial<PersistedState>>(file);

      if (parsed.repoSettingsMap) setRepoSettingsMap(parsed.repoSettingsMap);
      if (parsed.watermarkSettings) {
        setWatermarkSettings({ ...defaultWatermarkSettings, ...parsed.watermarkSettings });
      }
      if (parsed.compressionSettings) {
        setCompressionSettings({ ...defaultCompressionSettings, ...parsed.compressionSettings });
      }
      if (parsed.namingSettings) {
        setNamingSettings({ ...defaultNamingSettings, ...parsed.namingSettings });
      }
      if (parsed.theme) {
        setTheme(parsed.theme === "dark" ? "dark" : "light");
      }
      if (typeof parsed.repoFileRefreshInterval === "number") {
        setRepoFileRefreshInterval(parsed.repoFileRefreshInterval);
      }

      toast.success("设置已导入。");
      addActivityLog("导入了一份本地设置");
    } catch {
      toast.error("设置导入失败，请检查文件内容。");
    } finally {
      event.target.value = "";
    }
  }

  function handleExportSettings() {
    const exportData = {
      repoSettingsMap,
      watermarkSettings,
      compressionSettings,
      namingSettings,
      repoFileRefreshInterval,
      theme,
    } satisfies Partial<PersistedState>;

    downloadSettingsFile("github-image-host-settings.json", exportData);
    toast.success("设置已导出。");
    addActivityLog("导出了一份本地设置");
  }

  useEffect(() => {
    let cancelled = false;

    void buildWatermarkPreview(watermarkSettings)
      .then((url) => {
        if (!cancelled) {
          setWatermarkPreviewUrl(url);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setWatermarkPreviewUrl("");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [watermarkSettings]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  useEffect(() => {
    if (initialized && !onboardingSeen) {
      setOnboardingOpen(true);
      setOnboardingSeen(true);
    }
  }, [initialized, onboardingSeen]);

  useEffect(() => {
    if (selectedFiles.length === 0) {
      setSelectedFileInsights({});
      return;
    }

    let cancelled = false;

    void Promise.all(
      selectedFiles.map(async (file) => {
        const size = await readImageSize(file);
        const expectedFormat = getExpectedCompressionFormat(file, compressionSettings);
        const exceedsLimit =
          size.width > compressionSettings.maxWidth || size.height > compressionSettings.maxHeight;
        const formatChanges =
          compressionSettings.outputFormat !== "keep" &&
          ((compressionSettings.outputFormat === "jpeg" && file.type !== "image/jpeg") ||
            (compressionSettings.outputFormat === "webp" && file.type !== "image/webp"));

        return {
          key: `${file.name}-${file.size}`,
          width: size.width,
          height: size.height,
          expectedFormat,
          willCompress: compressionSettings.enabled && (exceedsLimit || formatChanges),
        } satisfies SelectedFileInsight;
      }),
    )
      .then((insights) => {
        if (cancelled) return;

        setSelectedFileInsights(
          Object.fromEntries(insights.map((item) => [item.key, item])),
        );
      })
      .catch(() => {
        if (!cancelled) {
          setSelectedFileInsights({});
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedFiles, compressionSettings]);

  async function refreshRepoFiles(resetPage = true) {
    if (!configValid) {
      setRepoFiles([]);
      setRepoFilesError("");
      return;
    }

    setLoadingRepoFiles(true);
    try {
      const files = await listRepositoryFiles(config);
      setRepoFiles(files);
      if (resetPage) {
        setFilePage(1);
      }
      setRepoFilesError("");
    } catch (error) {
      setRepoFiles([]);
      if (resetPage) {
        setFilePage(1);
      }
      setRepoFilesError(error instanceof Error ? error.message : "仓库文件加载失败。");
    } finally {
      setLoadingRepoFiles(false);
    }
  }

  useEffect(() => {
    if (activeSection !== "upload") {
      setRepoFilesError("");
      return;
    }

    void refreshRepoFiles();
  }, [activeSection, config]);

  useEffect(() => {
    if (
      activeSection !== "upload" ||
      !configValid ||
      repoFileRefreshInterval <= 0
    ) {
      return;
    }

    const timer = window.setInterval(() => {
      if (!document.hidden && !loadingRepoFiles) {
        void refreshRepoFiles(false);
      }
    }, repoFileRefreshInterval);

    return () => window.clearInterval(timer);
  }, [activeSection, configValid, repoFileRefreshInterval, loadingRepoFiles, config]);

  useEffect(() => {
    if (!initialized || !config.token.trim()) {
      return;
    }

    if (repoList.length > 0 || loadingRepos) {
      return;
    }

    void handleLoadRepositories(true);
  }, [initialized, config.token, repoList.length, loadingRepos]);

  useEffect(() => {
    if (!config.token.trim() || repoList.length > 0) {
      clearRepoRetryTimer();
    }
  }, [config.token, repoList.length]);

  useEffect(() => {
    setRepoPage(1);
  }, [repoSearch]);

  useEffect(() => {
    const totalRepoPages = Math.max(1, Math.ceil(filteredRepos.length / REPO_PAGE_SIZE));
    if (repoPage > totalRepoPages) {
      setRepoPage(totalRepoPages);
    }
  }, [filteredRepos.length, repoPage]);

  useEffect(() => {
    const totalFilePages = Math.max(1, Math.ceil(filteredRepoFiles.length / FILE_PAGE_SIZE));
    if (filePage > totalFilePages) {
      setFilePage(totalFilePages);
    }
  }, [filteredRepoFiles.length, filePage]);

  useEffect(() => {
    setFilePage(1);
  }, [repoFileSearch, repoFileTypeFilter]);

  useEffect(() => {
    setHistoryPage(1);
  }, [historySearch, historyTypeFilter]);

  useEffect(() => {
    const totalHistoryPages = Math.max(1, Math.ceil(filteredHistoryRecords.length / HISTORY_PAGE_SIZE));
    if (historyPage > totalHistoryPages) {
      setHistoryPage(totalHistoryPages);
    }
  }, [filteredHistoryRecords.length, historyPage]);

  useEffect(() => {
    if (
      !initialized ||
      !remoteServiceSettings.baseUrl.trim() ||
      !remoteServiceSettings.masterKey.trim() ||
      remoteLoading
    ) {
      return;
    }

    void loadRemoteDashboard();
  }, [
    initialized,
    remoteServiceSettings.baseUrl,
    remoteServiceSettings.masterKey,
  ]);

  useEffect(() => {
    if (
      !remoteServiceSettings.baseUrl.trim() ||
      !remoteServiceSettings.masterKey.trim() ||
      remoteConnected
    ) {
      clearRemoteRetryTimer();
    }
  }, [
    remoteServiceSettings.baseUrl,
    remoteServiceSettings.masterKey,
    remoteConnected,
  ]);

  useEffect(() => {
    setRemoteApiKeyPage(1);
  }, [remoteApiKeys.length]);

  useEffect(() => {
    const totalRemoteApiKeyPages = Math.max(1, Math.ceil(remoteApiKeys.length / REMOTE_API_KEY_PAGE_SIZE));
    if (remoteApiKeyPage > totalRemoteApiKeyPages) {
      setRemoteApiKeyPage(totalRemoteApiKeyPages);
    }
  }, [remoteApiKeys.length, remoteApiKeyPage]);

  useEffect(() => {
    if (
      activeSection !== "remote" ||
      !remoteConnected ||
      !remoteServiceSettings.baseUrl.trim() ||
      !remoteServiceSettings.masterKey.trim()
    ) {
      return;
    }

    void loadRemoteDashboard(false, remoteImagePage).catch(() => {
      setRemoteConnected(false);
    });
  }, [remoteImagePage]);

  useEffect(() => {
    const totalRemoteImagePages = Math.max(1, Math.ceil(remoteImageTotal / REMOTE_IMAGE_PAGE_SIZE));
    if (remoteImagePage > totalRemoteImagePages) {
      setRemoteImagePage(totalRemoteImagePages);
    }
  }, [remoteImageTotal, remoteImagePage]);

  useEffect(() => {
    if (createRemoteApiKeyOpen && repoList.length === 0 && config.token.trim()) {
      void handleLoadRepositories(true);
    }
  }, [createRemoteApiKeyOpen, repoList.length, config.token]);

  useEffect(() => {
    if (activeSection === "upload") {
      void refreshRemoteSyncStatus();
    }
  }, [activeSection, remoteConnected, config.owner, config.repo, config.branch, config.directory]);

  async function handleVerify() {
    const verifyConfig: GitHubConfig =
      activeRepoForSettings && repoSettingsOpen
        ? {
            ...config,
            owner: activeRepoForSettings.owner,
            repo: activeRepoForSettings.name,
            branch: repoSettingsForm.branch.trim() || activeRepoForSettings.defaultBranch || defaultConfig.branch,
            directory: repoSettingsForm.directory.trim(),
            urlMode: repoSettingsForm.urlMode,
            customUrlBase: repoSettingsForm.customUrlBase.trim(),
            customUrlMode: repoSettingsForm.customUrlMode,
          }
        : config;

    const verifyConfigValid =
      Boolean(
        verifyConfig.token &&
          verifyConfig.owner &&
          verifyConfig.repo &&
          verifyConfig.branch,
      ) &&
      (verifyConfig.urlMode !== "custom" || Boolean(verifyConfig.customUrlBase.trim()));

    if (!verifyConfigValid) {
      toast.error("请先填写完整的仓库配置。");
      return;
    }

    setVerifying(true);
    try {
      const meta = await verifyRepository(verifyConfig);
      setRepoMeta(meta);
      toast.success(
        meta.defaultBranch !== verifyConfig.branch
          ? `仓库连接成功，默认分支为 ${meta.defaultBranch}`
          : "仓库连接成功。",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "仓库验证失败。");
      setRepoMeta(null);
    } finally {
      setVerifying(false);
    }
  }

  async function handleLoadRepositories(silent = false) {
    if (!config.token.trim()) {
      if (!silent) {
        toast.error("请先输入 GitHub 密钥。");
      }
      return;
    }

    setLoadingRepos(true);
    try {
      const repos = await listUserRepositories(config.token);
      setRepoList(repos);
      setRepoPage(1);
      setRepoLoadError("");
      clearRepoRetryTimer();
      if (!silent) {
        toast.success(`已加载 ${repos.length} 个仓库。`);
      }
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "仓库加载失败。";
      setRepoLoadError(message);
      scheduleRepoRetry();
      if (!silent) {
        toast.error(message);
      }
      return false;
    } finally {
      setLoadingRepos(false);
    }
  }

  async function handleCreateRepository() {
    if (!config.token.trim() || !createForm.name.trim()) {
      toast.error("请填写 GitHub 密钥和仓库名称。");
      return;
    }

    setCreatingRepo(true);
    try {
      const repo = await createRepository({
        token: config.token,
        name: createForm.name.trim(),
        description: createForm.description.trim(),
        private: createForm.visibility === "private",
        autoInit: createForm.autoInit,
      });

      setRepoList((current) => [repo, ...current]);
      setRepoPage(1);
      setCreateOpen(false);
      setCreateForm({ name: "", description: "", visibility: "public", autoInit: true });
      toast.success(`仓库 ${repo.name} 创建成功。`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "创建仓库失败。");
    } finally {
      setCreatingRepo(false);
    }
  }

  async function performDeleteRepository(repo: RepositoryItem) {
    if (!config.token.trim()) {
      toast.error("请先输入 GitHub 密钥。");
      return;
    }

    setDeletingRepoId(repo.id);
    try {
      await deleteRepository(config.token, repo.owner, repo.name);
      setRepoList((current) => current.filter((item) => item.id !== repo.id));
      setRepoSettingsMap((current) => {
        const next = { ...current };
        delete next[repo.fullName];
        return next;
      });
      if (config.owner === repo.owner && config.repo === repo.name) {
        setConfig((current) => ({
          ...current,
          owner: "",
          repo: "",
          branch: defaultConfig.branch,
          directory: defaultConfig.directory,
          urlMode: defaultConfig.urlMode,
          customUrlBase: defaultConfig.customUrlBase,
          customUrlMode: defaultConfig.customUrlMode,
        }));
      }
      setRepoPage(1);
      toast.success(`仓库 ${repo.name} 已删除。`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除仓库失败。");
    } finally {
      setDeletingRepoId(null);
    }
  }

  function handleOpenRepoSettings(repo: RepositoryItem) {
    setActiveRepoForSettings(repo);
    setRepoSettingsForm(getRepoSettings(repo));
    setRepoSettingsOpen(true);
  }

  function handleSaveRepoSettings() {
    if (!activeRepoForSettings) return;

    const nextSettings: RepoUploadSettings = {
      branch: repoSettingsForm.branch.trim() || activeRepoForSettings.defaultBranch || defaultConfig.branch,
      directory: repoSettingsForm.directory.trim(),
      urlMode: repoSettingsForm.urlMode,
      customUrlBase: repoSettingsForm.customUrlBase.trim(),
      customUrlMode: repoSettingsForm.customUrlMode,
    };

    setRepoSettingsMap((current) => ({
      ...current,
      [activeRepoForSettings.fullName]: nextSettings,
    }));

    if (config.owner === activeRepoForSettings.owner && config.repo === activeRepoForSettings.name) {
      setConfig((current) => ({
        ...current,
        ...nextSettings,
      }));
    }

    setRepoSettingsOpen(false);
    toast.success("仓库上传配置已保存。");
  }

  function handleSelectRepository(repo: RepositoryItem) {
    const repoSettings = getRepoSettings(repo);
    setConfig((current) => ({
      ...current,
      owner: repo.owner,
      repo: repo.name,
      ...repoSettings,
    }));
    setActiveSection("upload");
    toast.success(`已选择仓库 ${repo.fullName}`);
  }

  async function performDeleteFile(file: RepositoryFileItem) {
    try {
      await deleteRepositoryFile(config, file.path, file.sha);

      let remoteRecordDeleted = false;
      if (
        remoteConnected &&
        remoteServiceSettings.baseUrl.trim() &&
        remoteServiceSettings.masterKey.trim() &&
        remoteSyncedPaths.includes(file.path)
      ) {
        try {
          const remoteResult = await queryRemoteImages(
            remoteServiceSettings.baseUrl,
            remoteServiceSettings.masterKey,
            {
              owner: config.owner,
              repoName: config.repo,
              page: 1,
              pageSize: 500,
            },
          );
          const matchedRecord = remoteResult.items.find((item) => item.path === file.path);
          if (matchedRecord) {
            await deleteRemoteImage(
              remoteServiceSettings.baseUrl,
              remoteServiceSettings.masterKey,
              matchedRecord.id,
            );
            remoteRecordDeleted = true;
          }
        } catch (remoteError) {
          toast.error(
            remoteError instanceof Error
              ? `GitHub 文件已删除，但远程元数据删除失败：${remoteError.message}`
              : "GitHub 文件已删除，但远程元数据删除失败。",
          );
        }
      }

      setRepoFiles((current) => current.filter((item) => item.path !== file.path));
      setRecords((current) =>
        current.map((item) =>
          item.owner === config.owner && item.repo === config.repo && item.path === file.path
            ? { ...item, deleted: true }
            : item,
        ),
      );
      if (remoteRecordDeleted) {
        await refreshRemoteSyncStatus();
        if (remoteConnected) {
          await loadRemoteDashboard(false, remoteImagePage);
        }
      } else if (remoteSyncedPaths.includes(file.path)) {
        await refreshRemoteSyncStatus();
      }
      setFilePage(1);
      toast.success(`文件 ${file.name} 已删除。`);
      addActivityLog(
        remoteRecordDeleted
          ? `删除了文件 ${file.name}，并同步删除了远程元数据`
          : `删除了文件 ${file.name}`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除文件失败。");
    }
  }

  function requestDeleteRepository(repo: RepositoryItem) {
    setConfirmState({ type: "repo", repo });
    setConfirmDialogOpen(true);
  }

  function requestDeleteFile(file: RepositoryFileItem) {
    setConfirmState({ type: "file", file });
    setConfirmDialogOpen(true);
  }

  function requestDeleteRecord(record: UploadRecord) {
    setConfirmState({ type: "record", record });
    setConfirmDialogOpen(true);
  }

  function requestDeleteRemoteApiKey(item: RemoteApiKey) {
    setConfirmState({ type: "remote-api-key", item });
    setConfirmDialogOpen(true);
  }

  function openRemoteApiKeyRepos(item: RemoteApiKey) {
    setActiveRemoteApiKey(item);
    setRemoteApiKeyReposOpen(true);
  }

  function requestDeleteRemoteImage(item: RemoteImageRecord) {
    setConfirmState({ type: "remote-image", item });
    setConfirmDialogOpen(true);
  }

  function requestClearHistory() {
    setConfirmState({ type: "clear-history" });
    setConfirmDialogOpen(true);
  }

  async function handleConfirmDelete() {
    if (!confirmState) return;

    if (confirmState.type === "repo") {
      await performDeleteRepository(confirmState.repo);
    }

    if (confirmState.type === "file") {
      await performDeleteFile(confirmState.file);
    }

    if (confirmState.type === "record") {
      setRecords((current) => current.filter((item) => item.id !== confirmState.record.id));
      addActivityLog(`删除了历史记录 ${confirmState.record.name}`);
      toast.success(`记录 ${confirmState.record.name} 已删除。`);
    }

    if (confirmState.type === "remote-api-key") {
      await handleDeleteRemoteApiKey(confirmState.item.id);
    }

    if (confirmState.type === "remote-image") {
      await handleDeleteRemoteImageRecord(confirmState.item);
    }

    if (confirmState.type === "clear-history") {
      setRecords([]);
      addActivityLog("清空了本地历史");
      toast.success("本地历史已清空。");
    }

    setConfirmDialogOpen(false);
    setConfirmState(null);
  }

  async function handleWatermarkImageChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const imageDataUrl = await fileToDataUrl(file);
      setWatermarkSettings((current) => ({
        ...current,
        imageEnabled: true,
        imageDataUrl,
      }));
      toast.success("图片水印已更新。");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "图片水印读取失败。");
    } finally {
      event.target.value = "";
    }
  }

  function handleClearWatermarkImage() {
    setWatermarkSettings((current) => ({
      ...current,
      imageEnabled: false,
      imageDataUrl: "",
    }));
    toast.success("图片水印已清空。");
  }

  function updateWatermarkPosition(key: "textPosition" | "imagePosition", value: WatermarkPosition) {
    setWatermarkSettings((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function appendSelectedFiles(files: File[]) {
    setSelectedFiles((current) => [...current, ...files]);
  }

  function handleFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    appendSelectedFiles(Array.from(event.target.files ?? []));
  }

  function handleFileDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    const files = Array.from(event.dataTransfer.files ?? []).filter((file) =>
      file.type.startsWith("image/"),
    );
    if (files.length === 0) return;
    appendSelectedFiles(files);
    addActivityLog(`拖拽加入了 ${files.length} 个文件`);
  }

  async function handleUpload() {
    if (!configValid || selectedFiles.length === 0) return;
    setUploading(true);
    const next: UploadRecord[] = [];

    try {
      for (const file of selectedFiles) {
        const watermarkProcessedFile = await applyWatermarkToFile(file, watermarkSettings);
        const uploadReadyFile = await compressImageFile(
          watermarkProcessedFile,
          compressionSettings,
        );
        const uploadFilename = generateUploadFilename(uploadReadyFile.name, namingSettings);
        const record = await uploadFile(config, uploadReadyFile, uploadFilename);
        next.push(record);
      }
      setRecords((current) => [...next, ...current]);
      setUploadResultRecords(next);
      setSelectedFiles([]);
      await refreshRepoFiles(false);
      if (remoteServiceSettings.syncEnabled && remoteServiceSettings.baseUrl.trim() && remoteServiceSettings.masterKey.trim()) {
        try {
          await Promise.all(
            next.map((record) =>
              syncRemoteImage(remoteServiceSettings.baseUrl, remoteServiceSettings.masterKey, {
                name: record.name,
                owner: record.owner ?? config.owner,
                repo_name: record.repo ?? config.repo,
                branch: record.branch ?? config.branch,
                path: record.path,
                original_url: getRecordOriginalUrl(record),
                cdn_url: getRecordCustomUrl(record, repoSettingsMap),
                size: record.size,
                mime_type: "",
                sha: record.sha,
                uploaded_at: record.uploadedAt,
                source: "local-client",
              }),
            ),
          );
          if (remoteConnected) {
            setRemoteImagePage(1);
            await loadRemoteDashboard(false, 1);
          }
          addActivityLog(`同步了 ${next.length} 个远程图片记录`);
          toast.success(`成功同步 ${next.length} 条远程记录。`);
        } catch (syncError) {
          toast.error(syncError instanceof Error ? `GitHub 上传成功，但远程同步失败：${syncError.message}` : "GitHub 上传成功，但远程同步失败。");
        }
      }
      setActiveSection("upload");
      addActivityLog(`上传了 ${next.length} 个文件`);
      toast.success(`成功上传 ${next.length} 张图片。`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "上传失败。");
    } finally {
      setUploading(false);
    }
  }

  async function handleCopyOriginalLink(url: string) {
    if (currentRepository?.private) {
      setPendingOriginalUrl(url);
      setPrivateLinkDialogOpen(true);
      return;
    }

    await copyText(url, "原始链接已复制。");
  }

  async function confirmCopyPrivateLink() {
    if (!pendingOriginalUrl) return;
    await copyText(pendingOriginalUrl, "原始链接已复制。");
    setPrivateLinkDialogOpen(false);
    setPendingOriginalUrl("");
  }

  const sectionTitleMap: Record<AppSection, string> = {
    overview: "概览",
    config: "仓库配置",
    upload: "上传图片",
    watermark: "水印设置",
    compress: "压缩设置",
    naming: "命名规则",
    remote: "远程服务",
    history: "历史记录",
    guide: "关于程序",
  };

  return (
    <SidebarProvider
      style={
        {
          "--header-height": "3.5rem",
        } as React.CSSProperties
      }
    >
      <AppSidebar activeSection={activeSection} onSectionChange={setActiveSection} recordCount={records.length} />
      <SidebarInset>
        <SiteHeader
          currentSection={sectionTitleMap[activeSection]}
          onUploadClick={() => setActiveSection("upload")}
          onToggleTheme={handleToggleTheme}
          onOpenTips={() => setOnboardingOpen(true)}
          isDarkMode={theme === "dark"}
        />
        <div className="flex flex-1 flex-col gap-4 p-4">
          {activeSection === "overview" ? (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <Card>
                  <CardHeader>
                    <CardDescription>当前仓库</CardDescription>
                    <CardTitle>{config.owner && config.repo ? `${config.owner}/${config.repo}` : "未选择"}</CardTitle>
                  </CardHeader>
                </Card>
                <Card>
                  <CardHeader>
                    <CardDescription>历史记录</CardDescription>
                    <CardTitle>{records.length} 条</CardTitle>
                  </CardHeader>
                </Card>
                <Card>
                  <CardHeader>
                    <CardDescription>已加载仓库</CardDescription>
                    <CardTitle>{repoList.length} 个</CardTitle>
                  </CardHeader>
                </Card>
                <Card>
                  <CardHeader>
                    <CardDescription>待上传文件</CardDescription>
                    <CardTitle>{selectedFiles.length} 个</CardTitle>
                  </CardHeader>
                </Card>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>最近操作</CardTitle>
                    <CardDescription>这里只记录浏览器本地最近进行过的关键操作。</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {activityLogs.length === 0 ? (
                      <p className="text-sm text-muted-foreground">还没有最近操作记录。</p>
                    ) : (
                      activityLogs.slice(0, 6).map((item) => (
                        <div key={item.id} className="flex items-start justify-between gap-3 rounded-lg border p-3 text-sm">
                          <span>{item.message}</span>
                          <span className="shrink-0 text-muted-foreground">{formatTime(item.createdAt)}</span>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>设置导出 / 导入</CardTitle>
                    <CardDescription>可把本地功能设置迁移到另一台设备，不包含仓库中的图片数据。</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" className="gap-2" onClick={handleExportSettings}>
                        <Download className="size-4" />
                        导出设置
                      </Button>
                      <Button variant="outline" className="gap-2" asChild>
                        <label>
                          <Import className="size-4" />
                          导入设置
                          <input type="file" accept="application/json" className="hidden" onChange={handleImportSettings} />
                        </label>
                      </Button>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      会导出仓库配置、水印、压缩、命名规则、刷新策略和主题设置。
                    </p>
                  </CardContent>
                </Card>
              </div>
            </div>
          ) : null}

          {activeSection === "config" ? (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>仓库管理</CardTitle>
                  <CardDescription>输入 GitHub 密钥后，加载并管理你名下的仓库。</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 xl:grid-cols-[1fr_180px]">
                    <div className="space-y-2">
                      <Label htmlFor="token">GitHub 密钥</Label>
                      <Input
                        id="token"
                        type="password"
                        placeholder="ghp_xxx / github_pat_xxx"
                        value={config.token}
                        onChange={(event) => setConfig((current) => ({ ...current, token: event.target.value }))}
                      />
                    </div>
                    <div className="flex items-end">
                      <Button className="w-full gap-2" onClick={() => void handleLoadRepositories()} disabled={loadingRepos}>
                        {loadingRepos ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCcw className="size-4" />}
                        加载仓库
                      </Button>
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="relative w-full md:max-w-sm">
                      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        className="pl-9"
                        placeholder="搜索仓库名称"
                        value={repoSearch}
                        onChange={(event) => setRepoSearch(event.target.value)}
                      />
                    </div>
                    <Button className="gap-2" onClick={() => setCreateOpen(true)}>
                      <Plus className="size-4" />
                      新建仓库
                    </Button>
                  </div>

                  {config.owner && config.repo ? (
                    <Alert>
                      <CheckCircle2 className="size-4" />
                      <AlertTitle>当前默认仓库</AlertTitle>
                      <AlertDescription>{config.owner}/{config.repo}</AlertDescription>
                    </Alert>
                  ) : null}

                  {repoLoadError ? (
                    <Alert>
                      <AlertCircle className="size-4" />
                      <AlertTitle>仓库加载失败</AlertTitle>
                      <AlertDescription>{repoLoadError}</AlertDescription>
                    </Alert>
                  ) : null}

                  <div className="overflow-hidden rounded-xl border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>仓库名称</TableHead>
                          <TableHead>公开属性</TableHead>
                          <TableHead>可用容量 / 总容量</TableHead>
                          <TableHead>创建日期</TableHead>
                          <TableHead className="text-right">菜单</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pagedRepos.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                              {repoList.length === 0 ? "请先输入密钥并加载仓库。" : "没有匹配的仓库。"}
                            </TableCell>
                          </TableRow>
                        ) : (
                          pagedRepos.map((repo) => (
                            <TableRow key={repo.id}>
                              <TableCell>
                                <div className="space-y-1">
                                  <button
                                    type="button"
                                    className="font-medium text-left hover:underline"
                                    onClick={() => handleSelectRepository(repo)}
                                  >
                                    {repo.fullName}
                                  </button>
                                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <span>默认分支：{repo.defaultBranch}</span>
                                    {config.owner === repo.owner && config.repo === repo.name ? (
                                      <Badge variant="secondary" className="text-[10px]">默认仓库</Badge>
                                    ) : null}
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell>
                                <Badge variant={repo.private ? "secondary" : "outline"}>
                                  {repo.private ? "私有" : "公开"}
                                </Badge>
                              </TableCell>
                              <TableCell>{formatRepoUsage(repo.sizeInKb)}</TableCell>
                              <TableCell>{formatTime(repo.createdAt)}</TableCell>
                              <TableCell className="text-right">
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon">
                                      <MoreHorizontal className="size-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem onClick={() => handleSelectRepository(repo)}>
                                      设为当前仓库
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => handleOpenRepoSettings(repo)}>
                                      上传配置
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      className="text-destructive"
                                      onClick={() => requestDeleteRepository(repo)}
                                      disabled={deletingRepoId === repo.id}
                                    >
                                      删除仓库
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>

                  <PaginationBar
                    page={repoPage}
                    total={filteredRepos.length}
                    pageSize={REPO_PAGE_SIZE}
                    onChange={setRepoPage}
                  />

                  <Alert>
                    <AlertCircle className="size-4" />
                    <AlertTitle>容量说明</AlertTitle>
                    <AlertDescription>
                      GitHub 仓库接口可以返回当前仓库已用大小，但没有统一公开“剩余容量 / 总容量”字段，
                      这里统一按 1GB 展示总容量。每个仓库的上传目录、分支和外链规则可在右侧菜单的“上传配置”里单独设置。
                    </AlertDescription>
                  </Alert>
                </CardContent>
              </Card>
            </div>
          ) : null}

          {activeSection === "upload" ? (
            <div className="space-y-4">
              <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
              <Card>
                <CardHeader>
                  <CardTitle>上传图片</CardTitle>
                  <CardDescription>浏览器会直接调用 GitHub Contents API 上传图片。</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {watermarkSettings.enabled ? (
                    <Alert>
                      <Stamp className="size-4" />
                      <AlertTitle>已开启全局上传水印</AlertTitle>
                      <AlertDescription>
                        当前上传的图片会先在浏览器内自动添加水印，再上传到 GitHub。你可以到“水印设置”里继续调整文字水印或图片水印效果。
                      </AlertDescription>
                    </Alert>
                  ) : null}
                  {compressionSettings.enabled ? (
                    <Alert>
                      <Scissors className="size-4" />
                      <AlertTitle>已开启全局上传压缩</AlertTitle>
                      <AlertDescription>
                        当前上传的图片会在浏览器内先压缩，再上传到 GitHub。你可以到“压缩设置”里调整尺寸上限、压缩质量和输出格式。
                      </AlertDescription>
                    </Alert>
                  ) : null}
                  {remoteServiceSettings.syncEnabled && remoteServiceSettings.baseUrl.trim() && remoteServiceSettings.masterKey.trim() ? (
                    <Alert>
                      <CheckCircle2 className="size-4" />
                      <AlertTitle>已开启远程服务同步</AlertTitle>
                      <AlertDescription>
                        当前上传成功后会把图片元数据同步到远程服务 {remoteServiceSettings.baseUrl}。如果你刚开启了这个功能，请确认 Python 服务端已经重启到最新版本。
                      </AlertDescription>
                    </Alert>
                  ) : null}
                  <Alert>
                    <Tags className="size-4" />
                    <AlertTitle>当前命名规则</AlertTitle>
                    <AlertDescription>
                      {namingSettings.mode === "keep"
                        ? "上传时会尽量保留原文件名。"
                        : namingSettings.mode === "uuid"
                          ? "上传时会使用 UUID 作为文件名。"
                          : namingSettings.mode === "prefix"
                            ? `上传时会使用自定义前缀 ${namingSettings.prefix || "image"} 生成文件名。`
                            : "上传时会使用时间戳命名文件。"} 你可以到“命名规则”里调整。
                    </AlertDescription>
                  </Alert>
                  <div
                    className={`rounded-xl border border-dashed p-4 transition-colors ${
                      dragActive ? "border-primary bg-primary/5" : "border-border"
                    }`}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setDragActive(true);
                    }}
                    onDragLeave={() => setDragActive(false)}
                    onDrop={handleFileDrop}
                  >
                    <p className="mb-3 text-sm text-muted-foreground">
                      可点击选择图片，也可以直接把图片拖进这里。
                    </p>
                    <Input type="file" multiple accept="image/*" onChange={handleFileInputChange} />
                  </div>
                  {selectedFiles.length > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      列顺序：文件名 / 大小 / 预计输出格式（含尺寸） / 是否会被压缩
                    </p>
                  ) : null}
                  {selectedFiles.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>文件名</TableHead>
                          <TableHead>大小</TableHead>
                          <TableHead>预计输出格式</TableHead>
                          <TableHead>是否会被压缩</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selectedFiles.map((file) => (
                          <TableRow key={`${file.name}-${file.size}`}>
                            <TableCell>{file.name}</TableCell>
                            <TableCell>{formatBytes(file.size)}</TableCell>
                            <TableCell>
                              {selectedFileInsights[`${file.name}-${file.size}`]
                                ? `${selectedFileInsights[`${file.name}-${file.size}`].expectedFormat} (${selectedFileInsights[`${file.name}-${file.size}`].width} × ${selectedFileInsights[`${file.name}-${file.size}`].height})`
                                : "读取中..."}
                            </TableCell>
                            <TableCell>
                              {compressionSettings.enabled
                                ? selectedFileInsights[`${file.name}-${file.size}`]
                                  ? selectedFileInsights[`${file.name}-${file.size}`].willCompress
                                    ? "会压缩"
                                    : "不会压缩"
                                  : "检测中..."
                                : "压缩未开启"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : null}
                  <div className="flex gap-2">
                    <Button onClick={handleUpload} disabled={!configValid || selectedFiles.length === 0 || uploading}>
                      {uploading ? <LoaderCircle className="size-4 animate-spin" /> : <Upload className="size-4" />}
                      开始上传
                    </Button>
                    <Button variant="outline" onClick={() => setSelectedFiles([])}>清空待上传</Button>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>上传检查</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-muted-foreground">
                  <p>当前仓库：{config.owner && config.repo ? `${config.owner}/${config.repo}` : "未选择"}</p>
                  <p>仓库配置：{configValid ? "已完成" : "未完成"}</p>
                  <p>目标目录：{config.directory || "/"}</p>
                  <p>外链模式：{config.urlMode === "custom" ? "自定义 CDN" : "原始链接"}</p>
                  <p>上传水印：{watermarkSettings.enabled ? "已开启" : "已关闭"}</p>
                  <p>上传压缩：{compressionSettings.enabled ? "已开启" : "已关闭"}</p>
                  <p>命名规则：{namingSettings.mode === "keep" ? "保留原名" : namingSettings.mode === "uuid" ? "UUID" : namingSettings.mode === "prefix" ? "自定义前缀" : "时间戳"}</p>
                </CardContent>
              </Card>
              </div>

              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <CardTitle>当前仓库内容</CardTitle>
                      <CardDescription>
                        显示当前上传目录中的文件内容。当前目录：{config.directory || "/"}
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <Select
                        value={String(repoFileRefreshInterval)}
                        onValueChange={(value) => setRepoFileRefreshInterval(Number(value))}
                      >
                        <SelectTrigger className="w-[180px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {REPO_FILE_REFRESH_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button variant="outline" size="sm" className="gap-2" onClick={() => void refreshRepoFiles(false)} disabled={loadingRepoFiles || !configValid}>
                      {loadingRepoFiles ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCcw className="size-4" />}
                      刷新
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <FilterToolbar
                    searchPlaceholder="搜索当前目录文件"
                    searchValue={repoFileSearch}
                    onSearchChange={setRepoFileSearch}
                    typeValue={repoFileTypeFilter}
                    onTypeChange={setRepoFileTypeFilter}
                    typeOptions={[...IMAGE_TYPE_OPTIONS]}
                  />

                  <Alert>
                    <AlertCircle className="size-4" />
                    <AlertTitle>显示可能有延迟</AlertTitle>
                    <AlertDescription>
                      新上传的图片有时会因为 GitHub 接口缓存或列表刷新延迟，暂时不会马上出现在这里。建议先到“历史记录”中复制链接，稍后再回到这里查看或管理文件。
                    </AlertDescription>
                  </Alert>

                  {repoFilesError ? (
                    <Alert>
                      <AlertCircle className="size-4" />
                      <AlertTitle>仓库内容读取失败</AlertTitle>
                      <AlertDescription>{repoFilesError}</AlertDescription>
                    </Alert>
                  ) : null}

                  {loadingRepoFiles ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <LoaderCircle className="size-4 animate-spin" />
                      正在加载仓库文件...
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>文件名</TableHead>
                          <TableHead>上传时间</TableHead>
                          <TableHead>大小</TableHead>
                          <TableHead className="text-right">菜单</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pagedRepoFiles.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                              当前目录下暂无文件。
                            </TableCell>
                          </TableRow>
                        ) : (
                          pagedRepoFiles.map((file) => {
                            const hasCustomCdn =
                              config.urlMode === "custom" && Boolean(config.customUrlBase.trim());
                            const customUrl = hasCustomCdn
                              ? config.customUrlMode === "proxy"
                                ? `${config.customUrlBase.replace(/\/+$/g, "")}/${file.sourceUrl}`
                                : `${config.customUrlBase.replace(/\/+$/g, "")}/${file.path}`
                              : "";
                            const isSyncedToRemote = remoteSyncedPaths.includes(file.path);

                            return (
                              <TableRow key={file.path}>
                                <TableCell>
                                  <div className="font-medium">{file.name}</div>
                                  <div className="mt-1 flex flex-wrap gap-2">
                                    {isSyncedToRemote ? <Badge variant="secondary">已上传到服务端</Badge> : null}
                                  </div>
                                </TableCell>
                                <TableCell>{file.updatedAt ? formatTime(file.updatedAt) : "--"}</TableCell>
                                <TableCell>{formatBytes(file.size)}</TableCell>
                                <TableCell className="text-right">
                                  <div className="flex justify-end">
                                    <DropdownMenu>
                                      <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="icon">
                                          <MoreHorizontal className="size-4" />
                                        </Button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="end">
                                        <DropdownMenuItem onClick={() => void handleCopyOriginalLink(file.sourceUrl)}>
                                          复制原始链接
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => openPreviewFromRepoFile(file, customUrl)}>
                                          查看图片
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                          disabled={!hasCustomCdn}
                                          onClick={() => copyText(customUrl, "自定义 CDN 地址已复制。")}
                                        >
                                          复制自定义 CDN 地址
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                          disabled={!remoteConnected || isSyncedToRemote}
                                          onClick={() => void handleUploadFileToRemote(file)}
                                        >
                                          上传到服务端
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                          className="text-destructive"
                                          onClick={() => requestDeleteFile(file)}
                                        >
                                          删除图片
                                        </DropdownMenuItem>
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          })
                        )}
                      </TableBody>
                    </Table>
                  )}

                  <PaginationBar
                    page={filePage}
                    total={filteredRepoFiles.length}
                    pageSize={FILE_PAGE_SIZE}
                    onChange={setFilePage}
                  />
                </CardContent>
              </Card>
            </div>
          ) : null}

          {activeSection === "watermark" ? (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
              <Card>
                <CardHeader>
                  <CardTitle>全局上传水印</CardTitle>
                  <CardDescription>
                    这里的设置会在浏览器内先处理图片，再上传到 GitHub。开启后，后续所有上传都会自动带上水印。
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>全局水印</Label>
                      <Select
                        value={watermarkSettings.enabled ? "enabled" : "disabled"}
                        onValueChange={(value) =>
                          setWatermarkSettings((current) => ({
                            ...current,
                            enabled: value === "enabled",
                          }))
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="enabled">开启</SelectItem>
                          <SelectItem value="disabled">关闭</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>当前状态</Label>
                      <div className="flex h-10 items-center rounded-md border px-3 text-sm text-muted-foreground">
                        {watermarkSettings.enabled
                          ? "上传时会自动处理文字水印和图片水印"
                          : "当前不会在上传前处理水印"}
                      </div>
                    </div>
                  </div>

                  <Tabs defaultValue="text" className="space-y-4">
                    <TabsList className="grid w-full grid-cols-2">
                      <TabsTrigger value="text" className="gap-2">
                        <TypeIcon className="size-4" />
                        文字水印
                      </TabsTrigger>
                      <TabsTrigger value="image" className="gap-2">
                        <ImageIcon className="size-4" />
                        图片水印
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="text" className="space-y-4">
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <Label>文字水印</Label>
                          <Select
                            value={watermarkSettings.textEnabled ? "enabled" : "disabled"}
                            onValueChange={(value) =>
                              setWatermarkSettings((current) => ({
                                ...current,
                                textEnabled: value === "enabled",
                              }))
                            }
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="enabled">开启</SelectItem>
                              <SelectItem value="disabled">关闭</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="watermark-text-color">文字颜色</Label>
                          <Input
                            id="watermark-text-color"
                            type="color"
                            className="h-10 w-full"
                            value={watermarkSettings.textColor}
                            onChange={(event) =>
                              setWatermarkSettings((current) => ({
                                ...current,
                                textColor: event.target.value,
                              }))
                            }
                          />
                        </div>
                        <div className="space-y-2 md:col-span-2">
                          <Label htmlFor="watermark-text-rotation">
                            文字旋转：{watermarkSettings.textRotation}°
                          </Label>
                          <Input
                            id="watermark-text-rotation"
                            type="range"
                            className="w-full"
                            min="-45"
                            max="45"
                            step="1"
                            value={watermarkSettings.textRotation}
                            onChange={(event) =>
                              setWatermarkSettings((current) => ({
                                ...current,
                                textRotation: Number(event.target.value),
                              }))
                            }
                          />
                        </div>
                        <div className="space-y-2 md:col-span-2">
                          <Label htmlFor="watermark-text">水印文案</Label>
                          <Input
                            id="watermark-text"
                            className="w-full"
                            placeholder="例如：仅供 SongXi 使用"
                            value={watermarkSettings.text}
                            onChange={(event) =>
                              setWatermarkSettings((current) => ({
                                ...current,
                                text: event.target.value,
                              }))
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="watermark-text-size">
                            文字大小：{watermarkSettings.textSize}px
                          </Label>
                          <Input
                            id="watermark-text-size"
                            type="range"
                            className="w-full"
                            min="16"
                            max="96"
                            step="2"
                            value={watermarkSettings.textSize}
                            onChange={(event) =>
                              setWatermarkSettings((current) => ({
                                ...current,
                                textSize: Number(event.target.value),
                              }))
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="watermark-text-opacity">
                            文字透明度：{Math.round(watermarkSettings.textOpacity * 100)}%
                          </Label>
                          <Input
                            id="watermark-text-opacity"
                            type="range"
                            className="w-full"
                            min="10"
                            max="100"
                            step="5"
                            value={Math.round(watermarkSettings.textOpacity * 100)}
                            onChange={(event) =>
                              setWatermarkSettings((current) => ({
                                ...current,
                                textOpacity: Number(event.target.value) / 100,
                              }))
                            }
                          />
                        </div>
                        <div className="space-y-2 md:col-span-2">
                          <Label>文字位置</Label>
                          <Select
                            value={watermarkSettings.textPosition}
                            onValueChange={(value: WatermarkPosition) =>
                              updateWatermarkPosition("textPosition", value)
                            }
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="top-left">左上角</SelectItem>
                              <SelectItem value="top-right">右上角</SelectItem>
                              <SelectItem value="bottom-left">左下角</SelectItem>
                              <SelectItem value="bottom-right">右下角</SelectItem>
                              <SelectItem value="center">居中</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </TabsContent>

                    <TabsContent value="image" className="space-y-4">
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <Label>图片水印</Label>
                          <Select
                            value={watermarkSettings.imageEnabled ? "enabled" : "disabled"}
                            onValueChange={(value) =>
                              setWatermarkSettings((current) => ({
                                ...current,
                                imageEnabled: value === "enabled",
                              }))
                            }
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="enabled">开启</SelectItem>
                              <SelectItem value="disabled">关闭</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="watermark-image">选择水印图</Label>
                          <Input
                            id="watermark-image"
                            type="file"
                            className="w-full"
                            accept="image/*"
                            onChange={(event) => void handleWatermarkImageChange(event)}
                          />
                        </div>
                        <div className="space-y-2 md:col-span-2">
                          <Label>已选图片</Label>
                          <div className="flex min-h-24 items-center justify-between rounded-xl border bg-muted/40 p-3">
                            {watermarkSettings.imageDataUrl ? (
                              <div className="flex items-center gap-3">
                                <img
                                  src={watermarkSettings.imageDataUrl}
                                  alt="水印预览"
                                  className="h-16 w-16 rounded-md border bg-background object-contain"
                                />
                                <p className="text-sm text-muted-foreground">
                                  当前图片水印会在上传时自动叠加到原图上。
                                </p>
                              </div>
                            ) : (
                              <p className="text-sm text-muted-foreground">
                                还没有选择图片水印，建议上传透明 PNG 或浅色 Logo。
                              </p>
                            )}
                            <Button
                              variant="outline"
                              onClick={handleClearWatermarkImage}
                              disabled={!watermarkSettings.imageDataUrl}
                            >
                              清空图片
                            </Button>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="watermark-image-scale">
                            图片大小：{watermarkSettings.imageScale}%
                          </Label>
                          <Input
                            id="watermark-image-scale"
                            type="range"
                            className="w-full"
                            min="8"
                            max="40"
                            step="1"
                            value={watermarkSettings.imageScale}
                            onChange={(event) =>
                              setWatermarkSettings((current) => ({
                                ...current,
                                imageScale: Number(event.target.value),
                              }))
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="watermark-image-opacity">
                            图片透明度：{Math.round(watermarkSettings.imageOpacity * 100)}%
                          </Label>
                          <Input
                            id="watermark-image-opacity"
                            type="range"
                            className="w-full"
                            min="10"
                            max="100"
                            step="5"
                            value={Math.round(watermarkSettings.imageOpacity * 100)}
                            onChange={(event) =>
                              setWatermarkSettings((current) => ({
                                ...current,
                                imageOpacity: Number(event.target.value) / 100,
                              }))
                            }
                          />
                        </div>
                        <div className="space-y-2 md:col-span-2">
                          <Label>图片位置</Label>
                          <Select
                            value={watermarkSettings.imagePosition}
                            onValueChange={(value: WatermarkPosition) =>
                              updateWatermarkPosition("imagePosition", value)
                            }
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="top-left">左上角</SelectItem>
                              <SelectItem value="top-right">右上角</SelectItem>
                              <SelectItem value="bottom-left">左下角</SelectItem>
                              <SelectItem value="bottom-right">右下角</SelectItem>
                              <SelectItem value="center">居中</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </Card>

              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Stamp className="size-4" />
                      演示预览
                    </CardTitle>
                    <CardDescription>
                      左侧改动后，这里会实时演示文字水印和图片水印叠加后的效果。
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="overflow-hidden rounded-xl border bg-muted/30">
                      <img
                        src={watermarkPreviewUrl}
                        alt="水印演示"
                        className="aspect-[3/2] w-full object-cover"
                      />
                    </div>
                  </CardContent>
                </Card>

                <Alert>
                  <AlertCircle className="size-4" />
                  <AlertTitle>使用建议</AlertTitle>
                  <AlertDescription>
                    图片水印推荐使用透明 PNG。文字和图片水印可以同时开启；如果两者位置相同，预览里看到的重叠效果也会在上传时保持一致。
                  </AlertDescription>
                </Alert>
              </div>
            </div>
          ) : null}

          {activeSection === "compress" ? (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
              <Card>
                <CardHeader>
                  <CardTitle>全局上传压缩</CardTitle>
                  <CardDescription>
                    上传前先在浏览器内压缩图片，再提交到 GitHub。适合控制大图体积、加快上传速度和节省仓库空间。
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>全局压缩</Label>
                      <Select
                        value={compressionSettings.enabled ? "enabled" : "disabled"}
                        onValueChange={(value) =>
                          setCompressionSettings((current) => ({
                            ...current,
                            enabled: value === "enabled",
                          }))
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="enabled">开启</SelectItem>
                          <SelectItem value="disabled">关闭</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>输出格式</Label>
                      <Select
                        value={compressionSettings.outputFormat}
                        onValueChange={(value: CompressionSettings["outputFormat"]) =>
                          setCompressionSettings((current) => ({
                            ...current,
                            outputFormat: value,
                          }))
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="keep">保持原格式</SelectItem>
                          <SelectItem value="jpeg">统一转 JPEG</SelectItem>
                          <SelectItem value="webp">统一转 WebP</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="compress-max-width">
                        最大宽度：{compressionSettings.maxWidth}px
                      </Label>
                      <Input
                        id="compress-max-width"
                        type="range"
                        min="640"
                        max="4096"
                        step="64"
                        value={compressionSettings.maxWidth}
                        onChange={(event) =>
                          setCompressionSettings((current) => ({
                            ...current,
                            maxWidth: Number(event.target.value),
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="compress-max-height">
                        最大高度：{compressionSettings.maxHeight}px
                      </Label>
                      <Input
                        id="compress-max-height"
                        type="range"
                        min="640"
                        max="4096"
                        step="64"
                        value={compressionSettings.maxHeight}
                        onChange={(event) =>
                          setCompressionSettings((current) => ({
                            ...current,
                            maxHeight: Number(event.target.value),
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <Label htmlFor="compress-quality">
                        压缩质量：{Math.round(compressionSettings.quality * 100)}%
                      </Label>
                      <Input
                        id="compress-quality"
                        type="range"
                        min="40"
                        max="100"
                        step="2"
                        value={Math.round(compressionSettings.quality * 100)}
                        onChange={(event) =>
                          setCompressionSettings((current) => ({
                            ...current,
                            quality: Number(event.target.value) / 100,
                          }))
                        }
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Scissors className="size-4" />
                      当前策略
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm text-muted-foreground">
                    <p>{compressionSettings.enabled ? "上传前自动压缩已开启" : "当前上传原图，不做压缩"}</p>
                    <p>尺寸上限：{compressionSettings.maxWidth}px × {compressionSettings.maxHeight}px</p>
                    <p>压缩质量：{Math.round(compressionSettings.quality * 100)}%</p>
                    <p>
                      输出格式：
                      {compressionSettings.outputFormat === "keep"
                        ? "保持原格式"
                        : compressionSettings.outputFormat === "jpeg"
                          ? "JPEG"
                          : "WebP"}
                    </p>
                  </CardContent>
                </Card>

                <Alert>
                  <AlertCircle className="size-4" />
                  <AlertTitle>处理顺序</AlertTitle>
                  <AlertDescription>
                    如果同时开启了水印和压缩，系统会先添加水印，再压缩图片，最后再上传到 GitHub。
                  </AlertDescription>
                </Alert>

                <Alert>
                  <AlertCircle className="size-4" />
                  <AlertTitle>使用建议</AlertTitle>
                  <AlertDescription>
                    如果你更在意清晰度，建议把质量保持在 80% 以上；如果你更在意体积，可以适当降低质量并限制图片最大宽高。
                  </AlertDescription>
                </Alert>
              </div>
            </div>
          ) : null}

          {activeSection === "naming" ? (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
              <Card>
                <CardHeader>
                  <CardTitle>全局上传命名规则</CardTitle>
                  <CardDescription>
                    这里决定上传到 GitHub 时文件会用什么名字保存。设置后会对后续上传统一生效。
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-2">
                    <Label>命名模式</Label>
                    <Select
                      value={namingSettings.mode}
                      onValueChange={(value: NamingMode) =>
                        setNamingSettings((current) => ({ ...current, mode: value }))
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="timestamp">时间戳</SelectItem>
                        <SelectItem value="uuid">UUID</SelectItem>
                        <SelectItem value="keep">保留原名</SelectItem>
                        <SelectItem value="prefix">自定义前缀</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="naming-prefix">前缀内容</Label>
                    <Input
                      id="naming-prefix"
                      placeholder="img-{date}-{original}"
                      disabled={namingSettings.mode !== "prefix"}
                      value={namingSettings.prefix}
                      onChange={(event) =>
                        setNamingSettings((current) => ({
                          ...current,
                          prefix: event.target.value,
                        }))
                      }
                    />
                    <div className="flex flex-wrap gap-2">
                      {NAMING_VARIABLES.map((variable) => (
                        <Button
                          key={variable.value}
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={namingSettings.mode !== "prefix"}
                          onClick={() =>
                            setNamingSettings((current) => ({
                              ...current,
                              prefix: `${current.prefix}${variable.value}`,
                            }))
                          }
                        >
                          {variable.label}
                        </Button>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      可点击上面的变量快速插入，例如 <code>img-{"{date}"}-{"{original}"}</code>。
                    </p>
                  </div>
                </CardContent>
              </Card>

              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Tags className="size-4" />
                      命名预览
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm text-muted-foreground">
                    <p>示例原名：`demo-image.png`</p>
                    <p>
                      预计结果：
                      {generateUploadFilename("demo-image.png", namingSettings)}
                    </p>
                  </CardContent>
                </Card>

                <Alert>
                  <AlertCircle className="size-4" />
                  <AlertTitle>使用建议</AlertTitle>
                  <AlertDescription>
                    如果你更看重可读性，推荐用“保留原名”或“自定义前缀”；如果更在意避免重名，推荐用“时间戳”或“UUID”。
                  </AlertDescription>
                </Alert>
              </div>
            </div>
          ) : null}

          {activeSection === "remote" ? (
            <RemoteServiceSection
              remoteDocsOpen={remoteDocsOpen}
              onRemoteDocsOpenChange={setRemoteDocsOpen}
              remoteServiceSettings={remoteServiceSettings}
              setRemoteServiceSettings={setRemoteServiceSettings}
              onPingRemoteService={() => void handlePingRemoteService()}
              onConnectRemoteService={() => void handleConnectRemoteService()}
              remoteLoading={remoteLoading}
              remoteStatusMessage={remoteStatusMessage}
              remoteConnected={remoteConnected}
              remoteServerSettings={remoteServerSettings}
              setRemoteServerSettings={setRemoteServerSettings}
              parseTextLines={parseTextLines}
              onSaveRemoteServerSettings={() => void handleSaveRemoteServerSettings()}
              onOpenCreateRemoteApiKey={() => setCreateRemoteApiKeyOpen(true)}
              pagedRemoteApiKeys={pagedRemoteApiKeys}
              remoteApiKeys={remoteApiKeys}
              remoteApiKeySecrets={remoteApiKeySecrets}
              onToggleRemoteApiKey={(item) => void handleToggleRemoteApiKey(item)}
              onCopyText={copyText}
              onOpenRemoteApiKeyRepos={openRemoteApiKeyRepos}
              onDeleteRemoteApiKey={requestDeleteRemoteApiKey}
              remoteApiKeyPage={remoteApiKeyPage}
              onRemoteApiKeyPageChange={setRemoteApiKeyPage}
              remoteApiKeyPageSize={REMOTE_API_KEY_PAGE_SIZE}
              remoteImages={remoteImages}
              remoteImageLoading={remoteImageLoading}
              onDeleteRemoteImage={requestDeleteRemoteImage}
              onPreviewRemoteImage={openPreviewFromRemoteImage}
              remoteImagePage={remoteImagePage}
              onRemoteImagePageChange={setRemoteImagePage}
              remoteImagePageSize={REMOTE_IMAGE_PAGE_SIZE}
              remoteImageTotal={remoteImageTotal}
              formatBytes={formatBytes}
              formatTime={formatTime}
            />
          ) : null}

          {activeSection === "history" ? (
            <HistorySection
              records={records}
              filteredHistoryRecords={filteredHistoryRecords}
              pagedHistoryRecords={pagedHistoryRecords}
              historySearch={historySearch}
              onHistorySearchChange={setHistorySearch}
              historyTypeFilter={historyTypeFilter}
              onHistoryTypeFilterChange={setHistoryTypeFilter}
              historyPage={historyPage}
              onHistoryPageChange={setHistoryPage}
              repoSettingsMap={repoSettingsMap}
              formatBytes={formatBytes}
              formatTime={formatTime}
              getRecordOriginalUrl={getRecordOriginalUrl}
              getRecordCustomUrl={getRecordCustomUrl}
              handleCopyOriginalLink={handleCopyOriginalLink}
              copyText={copyText}
              onPreviewRecord={openPreviewFromRecord}
              onDeleteRecord={requestDeleteRecord}
              onClearHistory={requestClearHistory}
              historyPageSize={HISTORY_PAGE_SIZE}
            />
          ) : null}

          {activeSection === "guide" ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <CardTitle>关于程序</CardTitle>
                      <CardDescription>这里展示当前程序的版权信息、许可证和基础说明。</CardDescription>
                    </div>
                    <img
                      src="/logo.png"
                      alt="项目标识"
                      className="size-16 -rotate-6 rounded-2xl object-cover shadow-sm ring-1 ring-border"
                    />
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-muted-foreground">
                  <p>程序名称：GitHub 图床</p>
                  <p>版权方：小曦的园子</p>
                  <p>官方网站：https://xiaoxi.ac.cn/</p>
                  <p>许可证：MIT License</p>
                  <p>本程序为纯前端应用，上传、建仓、删仓等操作均直接调用 GitHub API，本地配置保存在浏览器 localStorage。</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>使用的开源产品</CardTitle>
                  <CardDescription>以下是当前程序使用到的主要开源项目与基础服务。</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-muted-foreground">
                  <p>1. React：用于构建前端交互界面。</p>
                  <p>2. Vite：用于本地开发与前端构建。</p>
                  <p>3. shadcn/ui：用于页面组件与应用布局。</p>
                  <p>4. Tailwind CSS：用于样式系统与响应式布局。</p>
                  <p>5. Lucide React：用于图标展示。</p>
                  <p>6. Sonner：用于消息提示。</p>
                  <p>7. GitHub REST API：用于仓库管理、文件上传与文件删除。</p>
                </CardContent>
              </Card>
            </div>
          ) : null}
        </div>

        <Dialog open={Boolean(previewImage)} onOpenChange={(open) => !open && setPreviewImage(null)}>
          <DialogContent className="sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>{previewImage?.name}</DialogTitle>
              <DialogDescription>{previewImage?.path}</DialogDescription>
            </DialogHeader>
            {previewImage ? (
              <div className="space-y-4">
                {previewImage.showPrivateTip ? (
                  <Alert>
                    <AlertCircle className="size-4" />
                    <AlertTitle>私有仓库预览提示</AlertTitle>
                    <AlertDescription>
                      当前图片没有可用 CDN，正在使用私有仓库原始链接预览。外部没有仓库权限的用户通常无法正常打开这张图。
                    </AlertDescription>
                  </Alert>
                ) : null}
                <div className="overflow-hidden rounded-xl border bg-muted">
                  <img
                    src={previewImage.previewUrl}
                    alt={previewImage.name}
                    className="max-h-[60vh] w-full object-contain"
                  />
                </div>
                <div className="grid gap-2">
                  <Button
                    variant="outline"
                    className="justify-start gap-2"
                    onClick={() => void handleCopyOriginalLink(previewImage.originalUrl)}
                  >
                    <Clipboard className="size-4" />
                    复制原始链接
                  </Button>
                  <Button
                    variant="outline"
                    className="justify-start gap-2"
                    disabled={!previewImage.customUrl}
                    onClick={() => copyText(previewImage.customUrl || "", "自定义 CDN 地址已复制。")}
                  >
                    <Clipboard className="size-4" />
                    复制自定义 CDN 地址
                  </Button>
                  <Button
                    variant="outline"
                    className="justify-start gap-2"
                    onClick={() =>
                      window.open(previewImage.previewUrl, "_blank", "noopener,noreferrer")
                    }
                  >
                    <ImageIcon className="size-4" />
                    在新窗口打开当前预览
                  </Button>
                  {previewImage.html ? (
                    <Button
                      variant="outline"
                      className="justify-start gap-2"
                      onClick={() => copyText(previewImage.html || "", "HTML 已复制。")}
                    >
                      <Clipboard className="size-4" />
                      复制 HTML
                    </Button>
                  ) : null}
                  {previewImage.markdown ? (
                    <Button
                      variant="outline"
                      className="justify-start gap-2"
                      onClick={() => copyText(previewImage.markdown || "", "Markdown 已复制。")}
                    >
                      <Clipboard className="size-4" />
                      复制 Markdown
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </DialogContent>
        </Dialog>

        <Dialog
          open={uploadResultRecords.length > 0}
          onOpenChange={(open) => {
            if (!open) {
              setUploadResultRecords([]);
            }
          }}
        >
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>上传完成</DialogTitle>
              <DialogDescription>
                这里汇总了本次上传的结果，你可以直接复制原始链接、CDN 地址或 Markdown。
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              {uploadResultRecords.map((record) => {
                const originalUrl = getRecordOriginalUrl(record);
                const customUrl = getRecordCustomUrl(record, repoSettingsMap);
                const hasCustomCdn = Boolean(customUrl);

                return (
                  <div key={record.id} className="rounded-xl border p-3">
                    <div className="mb-3">
                      <div className="font-medium">{record.name}</div>
                      <div className="text-xs text-muted-foreground">{record.path}</div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={() => void handleCopyOriginalLink(originalUrl)}>
                        复制原始链接
                      </Button>
                      <Button variant="outline" size="sm" disabled={!hasCustomCdn} onClick={() => copyText(customUrl, "自定义 CDN 地址已复制。")}>
                        复制 CDN
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => copyText(record.markdown, "Markdown 已复制。")}>
                        复制 Markdown
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => copyText(record.html, "HTML 已复制。")}>
                        复制 HTML
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={onboardingOpen} onOpenChange={setOnboardingOpen}>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>使用提示</DialogTitle>
              <DialogDescription>
                这是一份可重复打开的快捷提示，帮你快速回忆当前图床支持的主要能力。
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 text-sm text-muted-foreground">
              <Alert>
                <WandSparkles className="size-4" />
                <AlertTitle>推荐流程</AlertTitle>
                <AlertDescription>
                  先在“仓库配置”选择默认仓库，再按需配置水印、压缩和命名规则，最后去“上传图片”直接拖拽或选择文件上传。
                </AlertDescription>
              </Alert>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border p-3">
                  <div className="font-medium text-foreground">上传前处理</div>
                  <p className="mt-2">支持全局水印、全局压缩、全局命名规则。</p>
                </div>
                <div className="rounded-xl border p-3">
                  <div className="font-medium text-foreground">上传后操作</div>
                  <p className="mt-2">支持原始链接、CDN 链接、Markdown、HTML 的快速复制。</p>
                </div>
                <div className="rounded-xl border p-3">
                  <div className="font-medium text-foreground">仓库内容</div>
                  <p className="mt-2">支持搜索、格式筛选、自动刷新和仓库文件删除。</p>
                </div>
                <div className="rounded-xl border p-3">
                  <div className="font-medium text-foreground">本地配置</div>
                  <p className="mt-2">支持暗色模式、最近操作日志，以及设置导出 / 导入。</p>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={createRemoteApiKeyOpen} onOpenChange={setCreateRemoteApiKeyOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>创建业务 API Key</DialogTitle>
              <DialogDescription>业务 API Key 会在本地生成，再提交到远程服务登记。生成后请及时保存。</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="remote-key-name">名称</Label>
                <Input
                  id="remote-key-name"
                  value={remoteApiKeyForm.name}
                  onChange={(event) =>
                    setRemoteApiKeyForm((current) => ({ ...current, name: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="remote-key-repos">允许仓库</Label>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button id="remote-key-repos" variant="outline" className="w-full justify-between">
                      <span className="truncate">
                        {remoteApiKeyForm.allowedRepos.length > 0
                          ? `已选择 ${remoteApiKeyForm.allowedRepos.length} 个仓库`
                          : "请选择允许访问的仓库"}
                      </span>
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-[320px]">
                    {repoList.length === 0 ? (
                      <DropdownMenuItem onClick={() => void handleLoadRepositories()}>
                        {loadingRepos ? "正在获取仓库..." : "加载仓库列表"}
                      </DropdownMenuItem>
                    ) : (
                      repoList.map((repo) => {
                        const repoKey = repo.fullName;
                        const checked = remoteApiKeyForm.allowedRepos.includes(repoKey);

                        return (
                          <DropdownMenuCheckboxItem
                            key={repo.id}
                            checked={checked}
                            onCheckedChange={(nextChecked) =>
                              setRemoteApiKeyForm((current) => ({
                                ...current,
                                allowedRepos: nextChecked
                                  ? [...current.allowedRepos, repoKey]
                                  : current.allowedRepos.filter((item) => item !== repoKey),
                              }))
                            }
                          >
                            {repoKey}
                          </DropdownMenuCheckboxItem>
                        );
                      })
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
                <p className="text-xs text-muted-foreground">
                  仓库列表会自动读取你当前 GitHub 密钥下已加载的仓库，可多选。
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="remote-key-whitelist">API Key 白名单</Label>
                <Textarea
                  id="remote-key-whitelist"
                  rows={3}
                  value={remoteApiKeyForm.ipWhitelist}
                  onChange={(event) =>
                    setRemoteApiKeyForm((current) => ({ ...current, ipWhitelist: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="remote-key-remark">备注</Label>
                <Input
                  id="remote-key-remark"
                  value={remoteApiKeyForm.remark}
                  onChange={(event) =>
                    setRemoteApiKeyForm((current) => ({ ...current, remark: event.target.value }))
                  }
                />
              </div>
              <div className="flex gap-2">
                <Button onClick={() => void handleCreateRemoteApiKey()}>
                  <Plus className="size-4" />
                  生成并登记
                </Button>
                <Button variant="outline" onClick={() => setCreateRemoteApiKeyOpen(false)}>
                  取消
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog
          open={remoteApiKeyReposOpen}
          onOpenChange={(open) => {
            setRemoteApiKeyReposOpen(open);
            if (!open) {
              setActiveRemoteApiKey(null);
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>允许仓库</DialogTitle>
              <DialogDescription>
                {activeRemoteApiKey
                  ? `这里展示业务 API Key ${activeRemoteApiKey.name} 当前可访问的仓库范围。`
                  : "这里展示当前业务 API Key 可访问的仓库范围。"}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              {activeRemoteApiKey?.allowed_repos.length ? (
                activeRemoteApiKey.allowed_repos.map((repo) => (
                  <div key={repo} className="rounded-xl border px-3 py-2 text-sm">
                    {repo}
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">当前没有配置允许仓库。</p>
              )}
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>新建仓库</DialogTitle>
              <DialogDescription>可以设置仓库名称、仓库说明和公开属性。</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="new-name">仓库名称</Label>
                <Input id="new-name" value={createForm.name} onChange={(e) => setCreateForm((current) => ({ ...current, name: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-desc">仓库说明</Label>
                <Textarea id="new-desc" value={createForm.description} onChange={(e) => setCreateForm((current) => ({ ...current, description: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>公开属性</Label>
                <Select value={createForm.visibility} onValueChange={(value: "public" | "private") => setCreateForm((current) => ({ ...current, visibility: value }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="public">公开</SelectItem>
                    <SelectItem value="private">私有</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2">
                <Button onClick={handleCreateRepository} disabled={creatingRepo}>
                  {creatingRepo ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}
                  创建仓库
                </Button>
                <Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog
          open={repoSettingsOpen}
          onOpenChange={(open) => {
            setRepoSettingsOpen(open);
            if (!open) {
              setActiveRepoForSettings(null);
              setRepoMeta(null);
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>仓库上传配置</DialogTitle>
              <DialogDescription>
                {activeRepoForSettings
                  ? `为 ${activeRepoForSettings.fullName} 单独设置上传目录、分支和外链规则`
                  : "设置仓库的上传目录、分支和外链规则"}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="repo-branch">分支</Label>
                <Input
                  id="repo-branch"
                  value={repoSettingsForm.branch}
                  onChange={(e) =>
                    setRepoSettingsForm((current) => ({ ...current, branch: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="repo-directory">目录</Label>
                <Input
                  id="repo-directory"
                  placeholder="留空表示根目录"
                  value={repoSettingsForm.directory}
                  onChange={(e) =>
                    setRepoSettingsForm((current) => ({ ...current, directory: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>外链模式</Label>
                <Select
                  value={repoSettingsForm.urlMode}
                  onValueChange={(value: UrlMode) =>
                    setRepoSettingsForm((current) => ({ ...current, urlMode: value }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="raw">原始链接</SelectItem>
                    <SelectItem value="custom">自定义 CDN</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {activeRepoForSettings?.private
                    ? "私有仓库使用原始链接时，通常只有你本人或拥有该仓库权限的用户才能访问。"
                    : "公开仓库可直接使用 GitHub 原始链接；私有仓库请留意访问权限限制。"}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="repo-cdn-prefix">CDN 域名</Label>
                <Input
                  id="repo-cdn-prefix"
                  placeholder="https://cdn.example.com"
                  disabled={repoSettingsForm.urlMode !== "custom"}
                  value={repoSettingsForm.customUrlBase}
                  onChange={(e) =>
                    setRepoSettingsForm((current) => ({
                      ...current,
                      customUrlBase: e.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>转换方式</Label>
                <Select
                  value={repoSettingsForm.customUrlMode}
                  onValueChange={(value: CustomUrlMode) =>
                    setRepoSettingsForm((current) => ({ ...current, customUrlMode: value }))
                  }
                  disabled={repoSettingsForm.urlMode !== "custom"}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="proxy">前缀代理</SelectItem>
                    <SelectItem value="replace">地址替换</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {repoSettingsForm.customUrlMode === "proxy"
                    ? "示例：https://github.com/xxx -> https://xx.com/https://github.com/xxx"
                    : "示例：https://github.com/111.jpg -> https://xx.com/111.jpg"}
                </p>
              </div>
              <div className="flex gap-2 sm:col-span-2">
                <Button onClick={handleSaveRepoSettings}>保存</Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setRepoSettingsOpen(false);
                    setActiveRepoForSettings(null);
                    setRepoMeta(null);
                  }}
                >
                  取消
                </Button>
                {activeRepoForSettings ? (
                  <Button
                    variant="outline"
                    onClick={handleVerify}
                    disabled={
                      !config.token.trim() ||
                      !activeRepoForSettings.owner ||
                      !activeRepoForSettings.name ||
                      !repoSettingsForm.branch.trim() ||
                      (repoSettingsForm.urlMode === "custom" &&
                        !repoSettingsForm.customUrlBase.trim()) ||
                      verifying
                    }
                  >
                    {verifying ? (
                      <LoaderCircle className="size-4 animate-spin" />
                    ) : (
                      <RefreshCcw className="size-4" />
                    )}
                    验证仓库
                  </Button>
                ) : null}
              </div>
              {repoMeta ? (
                <div className="sm:col-span-2">
                  <Alert>
                    <CheckCircle2 className="size-4" />
                    <AlertTitle>验证成功</AlertTitle>
                    <AlertDescription>
                      默认分支：{repoMeta.defaultBranch}；仓库类型：{repoMeta.isPrivate ? "私有" : "公开"}。
                    </AlertDescription>
                  </Alert>
                </div>
              ) : null}
            </div>
          </DialogContent>
        </Dialog>

        <Dialog
          open={confirmDialogOpen}
          onOpenChange={(open) => {
            setConfirmDialogOpen(open);
            if (!open) {
              setConfirmState(null);
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>确认删除</DialogTitle>
              <DialogDescription>
                {confirmState?.type === "repo"
                  ? `确定要删除仓库 ${confirmState.repo.fullName} 吗？此操作不可恢复。`
                  : confirmState?.type === "file"
                    ? `确定要删除文件 ${confirmState.file.name} 吗？`
                    : confirmState?.type === "record"
                      ? `确定要删除历史记录 ${confirmState.record.name} 吗？`
                      : confirmState?.type === "remote-api-key"
                        ? `确定要删除业务 API Key ${confirmState.item.name} 吗？删除后依赖它的第三方调用将失效。`
                        : confirmState?.type === "remote-image"
                          ? `确定要删除远程记录 ${confirmState.item.name} 吗？这只会删除服务端上的记录，不会删除 GitHub 仓库里的文件，也不会删除本地历史。`
                      : confirmState?.type === "clear-history"
                        ? "确定要清空本地历史记录吗？这不会删除 GitHub 仓库里的文件。"
                      : "请确认是否继续。"}
              </DialogDescription>
            </DialogHeader>
            <div className="flex gap-2">
              <Button variant="destructive" onClick={() => void handleConfirmDelete()}>
                删除
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setConfirmDialogOpen(false);
                  setConfirmState(null);
                }}
              >
                取消
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog
          open={privateLinkDialogOpen}
          onOpenChange={(open) => {
            setPrivateLinkDialogOpen(open);
            if (!open) {
              setPendingOriginalUrl("");
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>私有仓库链接提示</DialogTitle>
              <DialogDescription>
                当前仓库为私有仓库，复制的原始链接通常只有你本人或拥有该仓库访问权限的用户才能打开，
                外部没有权限的人无法直接访问。
              </DialogDescription>
            </DialogHeader>
            <div className="flex gap-2">
              <Button onClick={() => void confirmCopyPrivateLink()}>继续复制</Button>
              <Button
                variant="outline"
                onClick={() => {
                  setPrivateLinkDialogOpen(false);
                  setPendingOriginalUrl("");
                }}
              >
                取消
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </SidebarInset>
      <Toaster richColors position="top-right" />
    </SidebarProvider>
  );
}
