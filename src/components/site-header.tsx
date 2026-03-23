import { CircleHelp, ImageUp, Moon, SidebarIcon, Sun } from "lucide-react";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useSidebar } from "@/components/ui/sidebar";

export function SiteHeader({
  currentSection,
  onUploadClick,
  onToggleTheme,
  onOpenTips,
  isDarkMode,
}: {
  currentSection: string;
  onUploadClick: () => void;
  onToggleTheme: () => void;
  onOpenTips: () => void;
  isDarkMode: boolean;
}) {
  const { toggleSidebar } = useSidebar();

  return (
    <header className="sticky top-0 z-50 flex w-full items-center border-b bg-background">
      <div className="flex h-(--header-height) w-full items-center gap-2 px-4">
        <Button className="h-8 w-8" variant="ghost" size="icon" onClick={toggleSidebar}>
          <SidebarIcon />
        </Button>
        <Separator orientation="vertical" className="mr-2 h-4" />
        <Breadcrumb className="hidden sm:block">
          <BreadcrumbList>
            <BreadcrumbItem>GitHub 图床</BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{currentSection}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-2" onClick={onOpenTips}>
            <CircleHelp className="size-4" />
            使用提示
          </Button>
          <Button variant="outline" size="icon" onClick={onToggleTheme}>
            {isDarkMode ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </Button>
          <Button className="gap-2" onClick={onUploadClick}>
            <ImageUp className="size-4" />
            上传图片
          </Button>
        </div>
      </div>
    </header>
  );
}
