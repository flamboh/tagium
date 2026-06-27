import type { CSSProperties } from "react";

export const LIBRARY_TREE_STYLE = {
  "--trees-action-lane-width-override": "22px",
  "--trees-bg-override": "var(--card)",
  "--trees-bg-muted-override": "var(--accent)",
  "--trees-border-color-override": "var(--border)",
  "--trees-border-radius-override": "4px",
  "--trees-fg-muted-override": "var(--muted-foreground)",
  "--trees-fg-override": "var(--foreground)",
  "--trees-focus-ring-color-override": "var(--ring)",
  "--trees-font-family-override": "inherit",
  "--trees-font-size-override": "14px",
  "--trees-icon-width-override": "14px",
  "--trees-item-margin-x-override": "8px",
  "--trees-item-padding-x-override": "8px",
  "--trees-level-gap-override": "10px",
  "--trees-padding-inline-override": "0px",
  "--trees-selected-bg-override": "var(--accent)",
  "--trees-selected-fg-override": "var(--accent-foreground)",
} as CSSProperties;

export const LIBRARY_TREE_CSS = `
  [data-type='item'] {
    border-radius: 0;
  }

  [data-item-section='decoration'] {
    min-width: 22px;
    text-align: right;
    font-size: 11px;
  }
`;
