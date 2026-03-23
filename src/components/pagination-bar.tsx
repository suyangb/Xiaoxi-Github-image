import { Button } from "@/components/ui/button";

type PaginationBarProps = {
  page: number;
  total: number;
  pageSize: number;
  onChange: (page: number) => void;
};

export function PaginationBar({ page, total, pageSize, onChange }: PaginationBarProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">
        第 {page} / {totalPages} 页，共 {total} 条
      </p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          上一页
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onChange(page + 1)}
        >
          下一页
        </Button>
      </div>
    </div>
  );
}
