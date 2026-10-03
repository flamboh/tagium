import { Cancel01Icon, Moon02Icon, Sun03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/features/theme/useTheme";
import { cn } from "@/lib/utils";
import type { TagSidebarPanelProps } from "@/features/library/TagSidebarPanel";

export default function TagSidebarHeader({
  mobileOpen,
  onMobileClose,
  onGoHome,
}: Pick<TagSidebarPanelProps, "mobileOpen" | "onMobileClose" | "onGoHome">) {
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="h-14 flex items-center px-5 border-b flex-shrink-0">
      <button
        type="button"
        aria-label="tagium, go to workspace home"
        onClick={onGoHome}
        className="cursor-pointer font-black text-xl tracking-tight select-none rounded-sm transition-colors hover:text-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        tagium
      </button>
      <button
        type="button"
        className={cn(
          "group ml-auto inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          !(mobileOpen && onMobileClose) && "-mr-3",
        )}
        aria-label={`switch to ${theme === "light" ? "dark" : "light"} mode`}
        onClick={toggleTheme}
      >
        {theme === "light" ? (
          <HugeiconsIcon
            icon={Moon02Icon}
            strokeWidth={2}
            className="size-4 origin-center transition-transform duration-150 ease-out group-hover:scale-110 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
          />
        ) : (
          <HugeiconsIcon
            icon={Sun03Icon}
            strokeWidth={2}
            className="size-4 origin-center transition-transform duration-150 ease-out group-hover:scale-110 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
          />
        )}
      </button>
      {mobileOpen && onMobileClose ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11 md:hidden"
          aria-label="close library"
          onClick={onMobileClose}
        >
          <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
        </Button>
      ) : null}
    </div>
  );
}
