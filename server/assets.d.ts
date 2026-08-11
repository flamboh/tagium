declare module "*.ttf?inline" {
  const dataUrl: string;
  export default dataUrl;
}

declare module "*.svg?raw" {
  const source: string;
  export default source;
}
