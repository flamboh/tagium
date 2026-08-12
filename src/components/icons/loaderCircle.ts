import type { IconSvgElement } from "@hugeicons/react";

/**
 * A 300° arc with round caps — the ring spinner hugeicons' free set does not ship. Declared as
 * hugeicons icon data rather than a component so call sites keep using `<HugeiconsIcon icon={...} />`
 * and inherit its sizing, stroke width and colour handling unchanged.
 *
 * The gap sits at the top-left so the leading cap reads as the head of the spin.
 */
export const loaderCircleIcon: IconSvgElement = [
  [
    "path",
    {
      d: "M12 3a9 9 0 1 1-7.794 4.5",
      stroke: "currentColor",
      strokeLinecap: "round",
      strokeLinejoin: "round",
      strokeWidth: "1.5",
      key: "0",
    },
  ],
];
