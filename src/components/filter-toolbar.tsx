import { Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type FilterOption = {
  label: string;
  value: string;
};

type FilterToolbarProps = {
  searchPlaceholder: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
  typeValue: string;
  onTypeChange: (value: string) => void;
  typeOptions: FilterOption[];
  actionLabel?: string;
  onActionClick?: () => void;
  actionDisabled?: boolean;
};

export function FilterToolbar({
  searchPlaceholder,
  searchValue,
  onSearchChange,
  typeValue,
  onTypeChange,
  typeOptions,
  actionLabel,
  onActionClick,
  actionDisabled,
}: FilterToolbarProps) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative w-full md:max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder={searchPlaceholder}
            value={searchValue}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </div>
        <Select value={typeValue} onValueChange={onTypeChange}>
          <SelectTrigger className="w-full md:w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {typeOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {actionLabel && onActionClick ? (
        <Button variant="outline" onClick={onActionClick} disabled={actionDisabled}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}
