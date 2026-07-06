import process from "node:process";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite-plus";
import type { Plugin, ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";

const isTest = process.env.VITEST === "true" || process.env.VITEST === "1";
const libavDist = fileURLToPath(
  new URL("./node_modules/@imput/libav.js-encode-cli/dist/", import.meta.url),
);
const libavAssetFiles = ["libav-6.8.7.1-encode-cli.wasm.mjs", "libav-6.8.7.1-encode-cli.wasm.wasm"];

const contentTypes: Record<string, string> = {
  ".js": "text/javascript;charset=UTF-8",
  ".mjs": "text/javascript;charset=UTF-8",
  ".wasm": "application/wasm",
};

const libavAssets = (): Plugin => ({
  name: "tagium-libav-assets",
  async writeBundle() {
    const outputDir = resolve(".output/public/_libav");
    await mkdir(outputDir, { recursive: true });
    await Promise.all(
      libavAssetFiles.map((filename) =>
        copyFile(join(libavDist, filename), join(outputDir, filename)),
      ),
    );
  },
  configureServer(server: ViteDevServer) {
    server.middlewares.use(
      "/_libav",
      async (request: IncomingMessage, response: ServerResponse, next: () => void) => {
        const requestUrl = new URL(request.url ?? "/", "http://localhost");
        const filePath = normalize(join(libavDist, decodeURIComponent(requestUrl.pathname)));
        const libavRelativePath = relative(libavDist, filePath);

        if (libavRelativePath.startsWith("..") || libavRelativePath.includes(`..${sep}`)) {
          next();
          return;
        }

        try {
          const fileStat = await stat(filePath);
          if (!fileStat.isFile()) {
            next();
            return;
          }

          const contentType = contentTypes[extname(filePath)];
          if (contentType) {
            response.setHeader("Content-Type", contentType);
          }
          response.setHeader("Content-Length", fileStat.size);
          createReadStream(filePath).pipe(response);
        } catch {
          next();
        }
      },
    );
  },
});

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt: {
    ignorePatterns: ["repos/effect"],
  },
  lint: {
    plugins: ["oxc", "typescript", "unicorn", "react"],
    categories: {
      correctness: "warn",
    },
    env: {
      builtin: true,
    },
    ignorePatterns: ["dist", "build", "coverage", "node_modules", "repos/effect"],
    overrides: [
      {
        files: ["**/*.{ts,tsx}"],
        rules: {
          "constructor-super": "error",
          "for-direction": "error",
          "getter-return": "error",
          "no-async-promise-executor": "error",
          "no-case-declarations": "error",
          "no-class-assign": "error",
          "no-compare-neg-zero": "error",
          "no-cond-assign": "error",
          "no-const-assign": "error",
          "no-constant-binary-expression": "error",
          "no-constant-condition": "error",
          "no-control-regex": "error",
          "no-debugger": "error",
          "no-delete-var": "error",
          "no-dupe-class-members": "error",
          "no-dupe-else-if": "error",
          "no-dupe-keys": "error",
          "no-duplicate-case": "error",
          "no-empty": "error",
          "no-empty-character-class": "error",
          "no-empty-pattern": "error",
          "no-empty-static-block": "error",
          "no-ex-assign": "error",
          "no-extra-boolean-cast": "error",
          "no-fallthrough": "error",
          "no-func-assign": "error",
          "no-global-assign": "error",
          "no-import-assign": "error",
          "no-invalid-regexp": "error",
          "no-irregular-whitespace": "error",
          "no-loss-of-precision": "error",
          "no-misleading-character-class": "error",
          "no-new-native-nonconstructor": "error",
          "no-nonoctal-decimal-escape": "error",
          "no-obj-calls": "error",
          "no-prototype-builtins": "error",
          "no-redeclare": "error",
          "no-regex-spaces": "error",
          "no-self-assign": "error",
          "no-setter-return": "error",
          "no-shadow-restricted-names": "error",
          "no-sparse-arrays": "error",
          "no-this-before-super": "error",
          "no-undef": "error",
          "no-unexpected-multiline": "error",
          "no-unreachable": "error",
          "no-unsafe-finally": "error",
          "no-unsafe-negation": "error",
          "no-unsafe-optional-chaining": "error",
          "no-unused-labels": "error",
          "no-unused-private-class-members": "error",
          "no-unused-vars": "error",
          "no-useless-backreference": "error",
          "no-useless-catch": "error",
          "no-useless-escape": "error",
          "no-with": "error",
          "require-yield": "error",
          "use-isnan": "error",
          "valid-typeof": "error",
          "no-array-constructor": "error",
          "no-unused-expressions": "error",
          "typescript/ban-ts-comment": "error",
          "typescript/no-duplicate-enum-values": "error",
          "typescript/no-empty-object-type": "error",
          "typescript/no-explicit-any": "error",
          "typescript/no-extra-non-null-assertion": "error",
          "typescript/no-misused-new": "error",
          "typescript/no-namespace": "error",
          "typescript/no-non-null-asserted-optional-chain": "error",
          "typescript/no-require-imports": "error",
          "typescript/no-this-alias": "error",
          "typescript/no-unnecessary-type-constraint": "error",
          "typescript/no-unsafe-declaration-merging": "error",
          "typescript/no-unsafe-function-type": "error",
          "typescript/no-wrapper-object-types": "error",
          "typescript/prefer-as-const": "error",
          "typescript/prefer-namespace-keyword": "error",
          "typescript/triple-slash-reference": "error",
          "react/rules-of-hooks": "error",
          "react/exhaustive-deps": "warn",
          "react/only-export-components": "off",
        },
        env: {
          es2020: true,
          browser: true,
        },
      },
    ],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  plugins: [react(), libavAssets(), ...(isTest ? [] : [nitro()])],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
});
