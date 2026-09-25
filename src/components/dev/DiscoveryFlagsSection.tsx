import { SparklesIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  DISCOVERABLE_FEATURES,
  type DiscoverableFeature,
  resetFeatureDiscovery,
  useFeatureDiscovery,
} from "@/features/discovery/featureDiscovery";

function DiscoveryFlagRow({ feature }: { feature: DiscoverableFeature }) {
  const discovery = useFeatureDiscovery(feature);

  return (
    <Label className="flex items-center justify-between gap-3 text-xs font-normal">
      <span className="font-mono">{feature}</span>
      <span className="flex items-center gap-2 text-muted-foreground">
        {discovery.seen ? "seen" : "unseen"}
        <Checkbox
          checked={discovery.seen}
          onCheckedChange={(checked) => discovery.setSeen(checked === true)}
          aria-label={`${feature} seen`}
        />
      </span>
    </Label>
  );
}

export function DiscoveryFlagsSection() {
  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
          <HugeiconsIcon icon={SparklesIcon} strokeWidth={2} className="size-3.5" />
          feature discovery
        </div>
        <Button type="button" size="sm" variant="ghost" onClick={() => resetFeatureDiscovery()}>
          reset all
        </Button>
      </div>
      <div className="grid gap-2 rounded-md border border-border bg-muted/40 p-2">
        {DISCOVERABLE_FEATURES.map((feature) => (
          <DiscoveryFlagRow key={feature} feature={feature} />
        ))}
      </div>
    </section>
  );
}
