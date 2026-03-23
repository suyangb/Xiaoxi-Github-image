import { MoreHorizontal } from "lucide-react";

import { FilterToolbar } from "@/components/filter-toolbar";
import { PaginationBar } from "@/components/pagination-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { CustomUrlMode, UploadRecord, UrlMode } from "@/lib/github";

const IMAGE_TYPE_OPTIONS = [
  { label: "全部格式", value: "all" },
  { label: "PNG", value: "png" },
  { label: "JPG", value: "jpg" },
  { label: "JPEG", value: "jpeg" },
  { label: "WebP", value: "webp" },
  { label: "GIF", value: "gif" },
];

type RepoUploadSettings = {
  branch: string;
  directory: string;
  urlMode: UrlMode;
  customUrlBase: string;
  customUrlMode: CustomUrlMode;
};

type HistorySectionProps = {
  records: UploadRecord[];
  filteredHistoryRecords: UploadRecord[];
  pagedHistoryRecords: UploadRecord[];
  historySearch: string;
  onHistorySearchChange: (value: string) => void;
  historyTypeFilter: string;
  onHistoryTypeFilterChange: (value: string) => void;
  historyPage: number;
  onHistoryPageChange: (page: number) => void;
  repoSettingsMap: Record<string, RepoUploadSettings>;
  formatBytes: (size: number) => string;
  formatTime: (value: string) => string;
  getRecordOriginalUrl: (record: UploadRecord) => string;
  getRecordCustomUrl: (
    record: UploadRecord,
    repoSettingsMap?: Record<string, RepoUploadSettings>,
  ) => string;
  handleCopyOriginalLink: (url: string) => Promise<void>;
  copyText: (value: string, message: string) => void;
  onPreviewRecord: (record: UploadRecord) => void;
  onDeleteRecord: (record: UploadRecord) => void;
  onClearHistory: () => void;
  historyPageSize: number;
};

export function HistorySection({
  records,
  filteredHistoryRecords,
  pagedHistoryRecords,
  historySearch,
  onHistorySearchChange,
  historyTypeFilter,
  onHistoryTypeFilterChange,
  historyPage,
  onHistoryPageChange,
  repoSettingsMap,
  formatBytes,
  formatTime,
  getRecordOriginalUrl,
  getRecordCustomUrl,
  handleCopyOriginalLink,
  copyText,
  onPreviewRecord,
  onDeleteRecord,
  onClearHistory,
  historyPageSize,
}: HistorySectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>历史记录</CardTitle>
        <CardDescription>这里只清理浏览器本地记录，不删除 GitHub 仓库中的文件。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <FilterToolbar
          searchPlaceholder="搜索历史文件"
          searchValue={historySearch}
          onSearchChange={onHistorySearchChange}
          typeValue={historyTypeFilter}
          onTypeChange={onHistoryTypeFilterChange}
          typeOptions={IMAGE_TYPE_OPTIONS}
          actionLabel="清空本地历史"
          onActionClick={onClearHistory}
          actionDisabled={records.length === 0}
        />
        {filteredHistoryRecords.length === 0 ? (
          <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
            暂无上传记录。
          </div>
        ) : (
          <div className="space-y-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>文件</TableHead>
                  <TableHead>路径</TableHead>
                  <TableHead>时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedHistoryRecords.map((record) => {
                  const originalUrl = getRecordOriginalUrl(record);
                  const customUrl = getRecordCustomUrl(record, repoSettingsMap);
                  const hasCustomCdn = Boolean(customUrl);

                  return (
                    <TableRow key={record.id}>
                      <TableCell>
                        <div className="font-medium">{record.name}</div>
                        <div className="text-xs text-muted-foreground">{formatBytes(record.size)}</div>
                        {record.deleted ? (
                          <div className="mt-1">
                            <Badge variant="secondary">已删除</Badge>
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <code className="text-xs">{record.path}</code>
                      </TableCell>
                      <TableCell>{formatTime(record.uploadedAt)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon">
                                <MoreHorizontal className="size-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {!record.deleted ? (
                                <>
                                  <DropdownMenuItem onClick={() => void handleCopyOriginalLink(originalUrl)}>
                                    复制原始链接
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    disabled={!hasCustomCdn}
                                    onClick={() => copyText(customUrl, "自定义 CDN 地址已复制。")}
                                  >
                                    复制自定义 CDN 地址
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => copyText(record.markdown, "Markdown 已复制。")}
                                  >
                                    复制 Markdown
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => onPreviewRecord(record)}>
                                    预览图片
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() =>
                                      window.open(originalUrl, "_blank", "noopener,noreferrer")
                                    }
                                  >
                                    在新窗口打开
                                  </DropdownMenuItem>
                                </>
                              ) : null}
                              <DropdownMenuItem
                                className="text-destructive"
                                onClick={() => onDeleteRecord(record)}
                              >
                                删除记录
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <PaginationBar
              page={historyPage}
              total={filteredHistoryRecords.length}
              pageSize={historyPageSize}
              onChange={onHistoryPageChange}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
