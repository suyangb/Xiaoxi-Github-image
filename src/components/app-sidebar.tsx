import {
  FolderGit2,
  History,
  House,
  ImageUp,
  Info,
  Scissors,
  Server,
  Stamp,
  Tags,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

export type AppSection =
  | "overview"
  | "config"
  | "upload"
  | "watermark"
  | "compress"
  | "naming"
  | "remote"
  | "history"
  | "guide";

const items: Array<{
  key: AppSection;
  title: string;
  icon: typeof House;
}> = [
  { key: "overview", title: "概览", icon: House },
  { key: "config", title: "仓库配置", icon: FolderGit2 },
  { key: "upload", title: "上传图片", icon: ImageUp },
  { key: "watermark", title: "水印设置", icon: Stamp },
  { key: "compress", title: "压缩设置", icon: Scissors },
  { key: "naming", title: "命名规则", icon: Tags },
  { key: "remote", title: "远程服务", icon: Server },
  { key: "history", title: "历史记录", icon: History },
  { key: "guide", title: "关于程序", icon: Info },
];

export function AppSidebar({
  activeSection,
  onSectionChange,
  recordCount,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  activeSection: AppSection;
  onSectionChange: (section: AppSection) => void;
  recordCount: number;
}) {
  return (
    <Sidebar {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <button type="button" onClick={() => onSectionChange("overview")}>
                <div className="flex aspect-square size-8 items-center justify-center">
                  <img src="/logo.png" alt="小曦 GitHub 图床" className="size-full object-contain" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium"> 小曦 GitHub 图床</span>
                  <span className="truncate text-xs">开源图床项目 Broccoli V2.0</span>
                </div>
              </button>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => {
                const Icon = item.icon;
                return (
                  <SidebarMenuItem key={item.key}>
                    <SidebarMenuButton
                      isActive={activeSection === item.key}
                      tooltip={item.title}
                      onClick={() => onSectionChange(item.key)}
                    >
                      <Icon />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <div className="rounded-lg border border-sidebar-border p-3 text-sm">
          <div className="text-sidebar-foreground/70">本地记录</div>
          <div className="mt-1 text-xl font-semibold">{recordCount}</div>
          <div className="mt-2 text-xs leading-5 text-sidebar-foreground/70">
            Token 保存在浏览器本地，建议仅在自己的设备上使用。
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
