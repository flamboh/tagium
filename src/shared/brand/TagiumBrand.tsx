export interface TagiumBrandProps {
  product?: "tagium" | "save";
}

/** The shared Tagium wordmark, with an optional companion-product label. */
export function TagiumBrand({ product = "tagium" }: TagiumBrandProps) {
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
    </div>
  );
}
