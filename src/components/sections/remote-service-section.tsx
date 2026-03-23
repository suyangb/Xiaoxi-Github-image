import { AlertCircle, CheckCircle2, Clipboard, LoaderCircle, MoreHorizontal, Plus, RefreshCcw } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";

import { PaginationBar } from "@/components/pagination-bar";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import type { RemoteApiKey, RemoteImageRecord, RemoteServerSettings, RemoteServiceSettings } from "@/lib/remote-service";

type RemoteServiceSectionProps = {
  remoteDocsOpen: boolean;
  onRemoteDocsOpenChange: (open: boolean) => void;
  remoteServiceSettings: RemoteServiceSettings;
  setRemoteServiceSettings: Dispatch<SetStateAction<RemoteServiceSettings>>;
  onPingRemoteService: () => void;
  onConnectRemoteService: () => void;
  remoteLoading: boolean;
  remoteStatusMessage: string;
  remoteConnected: boolean;
  remoteServerSettings: RemoteServerSettings | null;
  setRemoteServerSettings: Dispatch<SetStateAction<RemoteServerSettings | null>>;
  parseTextLines: (value: string) => string[];
  onSaveRemoteServerSettings: () => void;
  onOpenCreateRemoteApiKey: () => void;
  pagedRemoteApiKeys: RemoteApiKey[];
  remoteApiKeys: RemoteApiKey[];
  remoteApiKeySecrets: Record<string, string>;
  onToggleRemoteApiKey: (item: RemoteApiKey) => void;
  onCopyText: (value: string, message: string) => void;
  onOpenRemoteApiKeyRepos: (item: RemoteApiKey) => void;
  onDeleteRemoteApiKey: (item: RemoteApiKey) => void;
  remoteApiKeyPage: number;
  onRemoteApiKeyPageChange: (page: number) => void;
  remoteApiKeyPageSize: number;
  remoteImages: RemoteImageRecord[];
  remoteImageLoading: boolean;
  onDeleteRemoteImage: (item: RemoteImageRecord) => void;
  onPreviewRemoteImage: (item: RemoteImageRecord) => void;
  remoteImagePage: number;
  onRemoteImagePageChange: (page: number) => void;
  remoteImagePageSize: number;
  remoteImageTotal: number;
  formatBytes: (size: number) => string;
  formatTime: (value: string) => string;
};

export function RemoteServiceSection({
  remoteDocsOpen,
  onRemoteDocsOpenChange,
  remoteServiceSettings,
  setRemoteServiceSettings,
  onPingRemoteService,
  onConnectRemoteService,
  remoteLoading,
  remoteStatusMessage,
  remoteConnected,
  remoteServerSettings,
  setRemoteServerSettings,
  parseTextLines,
  onSaveRemoteServerSettings,
  onOpenCreateRemoteApiKey,
  pagedRemoteApiKeys,
  remoteApiKeys,
  remoteApiKeySecrets,
  onToggleRemoteApiKey,
  onCopyText,
  onOpenRemoteApiKeyRepos,
  onDeleteRemoteApiKey,
  remoteApiKeyPage,
  onRemoteApiKeyPageChange,
  remoteApiKeyPageSize,
  remoteImages,
  remoteImageLoading,
  onDeleteRemoteImage,
  onPreviewRemoteImage,
  remoteImagePage,
  onRemoteImagePageChange,
  remoteImagePageSize,
  remoteImageTotal,
  formatBytes,
  formatTime,
}: RemoteServiceSectionProps) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle>远程服务连接</CardTitle>
              <CardDescription>这里连接独立 Python 服务端，并使用主管理密钥管理服务配置与开放 API Key。</CardDescription>
            </div>
            <Button variant="outline" onClick={() => onRemoteDocsOpenChange(true)}>
              <Clipboard className="size-4" />
              开放 API 文档
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <AlertCircle className="size-4" />
            <AlertTitle>服务提示</AlertTitle>
            <AlertDescription>
              服务端首次启动会在同目录自动生成data/config.json与data/app.db。主管理密钥拥有完整管理权限，上传成功后的远程同步只写入图片元数据，不接管 GitHub 文件本体。
            </AlertDescription>
          </Alert>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <div className="space-y-2 xl:col-span-1">
              <Label htmlFor="remote-base-url">服务地址</Label>
              <Input
                id="remote-base-url"
                placeholder="http://127.0.0.1:38471"
                value={remoteServiceSettings.baseUrl}
                onChange={(event) =>
                  setRemoteServiceSettings((current) => ({
                    ...current,
                    baseUrl: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2 xl:col-span-1">
              <Label htmlFor="remote-master-key">主管理密钥</Label>
              <Input
                id="remote-master-key"
                placeholder="填写服务端生成的超级长密钥"
                value={remoteServiceSettings.masterKey}
                onChange={(event) =>
                  setRemoteServiceSettings((current) => ({
                    ...current,
                    masterKey: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2 xl:col-span-1">
              <Label>上传后远程同步</Label>
              <Select
                value={remoteServiceSettings.syncEnabled ? "enabled" : "disabled"}
                onValueChange={(value) =>
                  setRemoteServiceSettings((current) => ({
                    ...current,
                    syncEnabled: value === "enabled",
                  }))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="disabled">关闭</SelectItem>
                  <SelectItem value="enabled">开启</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={onPingRemoteService}>
              <RefreshCcw className="size-4" />
              测试连通性
            </Button>
            <Button onClick={onConnectRemoteService} disabled={remoteLoading}>
              {remoteLoading ? <LoaderCircle className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
              连接并加载管理数据
            </Button>
          </div>

          {remoteStatusMessage ? (
            <Alert>
              <CheckCircle2 className="size-4" />
              <AlertTitle>{remoteConnected ? "远程服务已连接" : "远程服务未连接"}</AlertTitle>
              <AlertDescription>{remoteStatusMessage}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>服务端设置</CardTitle>
          <CardDescription>这里直接管理服务端名称和访问白名单。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {remoteServerSettings ? (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="remote-server-name">服务名称</Label>
                  <Input
                    id="remote-server-name"
                    value={remoteServerSettings.server_name}
                    onChange={(event) =>
                      setRemoteServerSettings((current) =>
                        current ? { ...current, server_name: event.target.value } : current,
                      )
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>服务端白名单</Label>
                  <Select
                    value={remoteServerSettings.whitelist_enabled ? "enabled" : "disabled"}
                    onValueChange={(value) =>
                      setRemoteServerSettings((current) =>
                        current ? { ...current, whitelist_enabled: value === "enabled" } : current,
                      )
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
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="remote-whitelist">白名单列表</Label>
                  <Textarea
                    id="remote-whitelist"
                    rows={4}
                    value={remoteServerSettings.whitelist_entries.join("\n")}
                    onChange={(event) =>
                      setRemoteServerSettings((current) =>
                        current
                          ? { ...current, whitelist_entries: parseTextLines(event.target.value) }
                          : current,
                      )
                    }
                  />
                </div>
              </div>
              <Button onClick={onSaveRemoteServerSettings}>保存服务端设置</Button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">请先连接远程服务后再管理设置。</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>业务 API Key 列表</CardTitle>
              <CardDescription>可启用、禁用或删除远程服务中的业务调用密钥。</CardDescription>
            </div>
            <Button onClick={onOpenCreateRemoteApiKey}>
              <Plus className="size-4" />
              创建业务 API Key
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead>前缀</TableHead>
                <TableHead>允许仓库</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagedRemoteApiKeys.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                    暂无远程 API Key。
                  </TableCell>
                </TableRow>
              ) : (
                pagedRemoteApiKeys.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <div className="font-medium">{item.name}</div>
                      <div className="text-xs text-muted-foreground">{item.remark || "无备注"}</div>
                    </TableCell>
                    <TableCell>{item.key_preview}</TableCell>
                    <TableCell>{item.allowed_repos.length} 个</TableCell>
                    <TableCell>{item.enabled ? "启用" : "禁用"}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => onToggleRemoteApiKey(item)}>
                              {item.enabled ? "禁用" : "启用"}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => onCopyText(item.key_preview, "API Key 前缀已复制。")}
                            >
                              复制前缀
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => onOpenRemoteApiKeyRepos(item)}>
                              查看允许仓库
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={!remoteApiKeySecrets[item.key_preview]}
                              onClick={() =>
                                onCopyText(
                                  remoteApiKeySecrets[item.key_preview],
                                  "完整 API Key 已复制。",
                                )
                              }
                            >
                              复制完整 Key
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => onDeleteRemoteApiKey(item)}
                            >
                              删除
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          <PaginationBar
            page={remoteApiKeyPage}
            total={remoteApiKeys.length}
            pageSize={remoteApiKeyPageSize}
            onChange={onRemoteApiKeyPageChange}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>远程图片记录</CardTitle>
              <CardDescription>这里展示服务端已接收的最近图片记录。</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={onConnectRemoteService} disabled={remoteLoading}>
              <RefreshCcw className={`size-4 ${remoteImageLoading ? "animate-spin" : ""}`} />
              刷新远程记录
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>文件名</TableHead>
                <TableHead>仓库</TableHead>
                <TableHead>时间</TableHead>
                <TableHead>CDN</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {remoteImages.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                    暂无远程图片记录。
                  </TableCell>
                </TableRow>
              ) : (
                remoteImages.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <div className="font-medium">{item.name}</div>
                      <div className="text-xs text-muted-foreground">{formatBytes(item.size)}</div>
                    </TableCell>
                    <TableCell>{item.repo_key}</TableCell>
                    <TableCell>{formatTime(item.uploaded_at)}</TableCell>
                    <TableCell>{item.cdn_url_snapshot ? "已上传" : "未设置"}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => onCopyText(item.original_url, "原始链接已复制。")}
                            >
                              复制原始链接
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => onPreviewRemoteImage(item)}>
                              查看图片
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={!item.cdn_url_snapshot}
                              onClick={() => onCopyText(item.cdn_url_snapshot, "CDN 地址已复制。")}
                            >
                              复制 CDN 地址
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => onDeleteRemoteImage(item)}
                            >
                              删除远程记录
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          <PaginationBar
            page={remoteImagePage}
            total={remoteImageTotal}
            pageSize={remoteImagePageSize}
            onChange={onRemoteImagePageChange}
          />
        </CardContent>
      </Card>

      <Sheet open={remoteDocsOpen} onOpenChange={onRemoteDocsOpenChange}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>开放 API 文档</SheetTitle>
            <SheetDescription>业务 API Key 主要用于读取数据，写入和删除元数据仅允许主管理密钥调用。</SheetDescription>
          </SheetHeader>
          <div className="mt-6 space-y-4 px-1 pb-6 text-sm">
            <div className="space-y-2 rounded-xl border p-4">
              <div className="font-medium"><code>GET /api/open/repos</code></div>
              <p className="text-muted-foreground">读取当前业务 API Key 可访问的仓库列表。</p>
              <p className="text-muted-foreground">请求头：<code>Authorization: Bearer &lt;业务 API Key&gt;</code></p>
              <p className="text-muted-foreground">返回：<code>owner</code>、<code>repo_name</code>、<code>repo_key</code></p>
            </div>

            <div className="space-y-2 rounded-xl border p-4">
              <div className="font-medium"><code>GET /api/open/images</code></div>
              <p className="text-muted-foreground">按仓库分页读取图片元数据列表。</p>
              <p className="text-muted-foreground">请求头：<code>Authorization: Bearer &lt;业务 API Key&gt;</code></p>
              <p className="text-muted-foreground">常用参数：<code>repo_name</code>、<code>owner</code>、<code>page</code>、<code>page_size</code>、<code>keyword</code></p>
              <p className="text-muted-foreground">返回：<code>items</code>、<code>total</code>、<code>page</code>、<code>page_size</code></p>
            </div>

            <div className="space-y-2 rounded-xl border p-4">
              <div className="font-medium"><code>POST /api/open/images</code></div>
              <p className="text-muted-foreground">上传完成后，把图片元数据同步到远程服务。</p>
              <p className="text-muted-foreground">权限：仅主管理密钥可调用。</p>
              <p className="text-muted-foreground">请求头：<code>Authorization: Bearer &lt;主管理密钥&gt;</code>、<code>Content-Type: application/json</code></p>
              <p className="text-muted-foreground">必填字段：<code>name</code>、<code>owner</code>、<code>repo_name</code>、<code>path</code>、<code>original_url</code></p>
              <p className="text-muted-foreground">可选字段：<code>branch</code>、<code>cdn_url</code>、<code>size</code>、<code>mime_type</code>、<code>sha</code>、<code>uploaded_at</code>、<code>source</code></p>
            </div>

            <div className="space-y-2 rounded-xl border p-4">
              <div className="font-medium"><code>DELETE /api/open/images/:id</code></div>
              <p className="text-muted-foreground">删除远程服务中的图片元数据记录。</p>
              <p className="text-muted-foreground">权限：仅主管理密钥可调用。</p>
              <p className="text-muted-foreground">只删除服务端元数据，不会删除 GitHub 仓库中的文件。</p>
            </div>

            <div className="space-y-2 rounded-xl border bg-muted/30 p-4 text-muted-foreground">
              <p>示例 <code>curl</code>：</p>
              <code className="block whitespace-pre-wrap break-all text-xs">
                curl -H "Authorization: Bearer YOUR_API_KEY" "http://127.0.0.1:38471/api/open/images?repo_name=esa_img&page=1&page_size=20"
              </code>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
