import { useEffect } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PrototypeVariant {
  key: string;
  name: string;
}

interface PrototypeSwitcherProps {
  variants: PrototypeVariant[];
  current: string;
  onChange: (variant: string) => void;
}

export default function PrototypeSwitcher({ variants, current, onChange }: PrototypeSwitcherProps) {
  const currentIndex = Math.max(
    0,
    variants.findIndex((variant) => variant.key === current),
  );

  const cycle = (direction: -1 | 1) => {
    const nextIndex = (currentIndex + direction + variants.length) % variants.length;
    const nextVariant = variants[nextIndex];
    if (nextVariant) onChange(nextVariant.key);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }

      if (event.key === "ArrowLeft") cycle(-1);
      if (event.key === "ArrowRight") cycle(1);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const activeVariant = variants[currentIndex];

  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/15 bg-zinc-950 p-1.5 text-white shadow-2xl">
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="rounded-full text-white hover:bg-white/15 hover:text-white"
        onClick={() => cycle(-1)}
        aria-label="previous prototype variant"
      >
        <ArrowLeft />
      </Button>
      <div className="min-w-48 px-3 text-center text-xs font-medium">
        {activeVariant?.key} — {activeVariant?.name}
      </div>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="rounded-full text-white hover:bg-white/15 hover:text-white"
        onClick={() => cycle(1)}
        aria-label="next prototype variant"
      >
        <ArrowRight />
      </Button>
    </div>
  );
}
