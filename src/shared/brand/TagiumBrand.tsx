export interface TagiumBrandProps {
  product?: "tagium" | "save";
  showTagline?: boolean;
}

/** The shared Tagium wordmark, with an optional companion-product label. */
export function TagiumBrand({ product = "tagium", showTagline = true }: TagiumBrandProps) {
  return (
    <div className="select-none text-center">
      <h1
        aria-label={product === "save" ? "tagium save" : "tagium"}
        className="text-7xl font-black leading-none tracking-[-0.04em] text-foreground"
      >
        tagium
        {product === "save" && (
          <span className="ml-[0.22em] align-baseline text-[0.34em] tracking-[-0.02em] text-brand">
            save
          </span>
        )}
      </h1>
      {showTagline && <p className="mt-3 text-base text-muted-foreground">tag your music</p>}
    </div>
  );
}
