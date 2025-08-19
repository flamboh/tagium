# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Development Server

```bash
npm run dev                # Start development server
npm run dev -- --open     # Start dev server and open browser
```

### Building

```bash
npm run build             # Create production build
npm run preview           # Preview production build
```

### Code Quality

```bash
npm run check             # Type check with svelte-check
npm run check:watch       # Type check in watch mode
npm run lint              # Run prettier and eslint checks
npm run format            # Format code with prettier
```

## Architecture Overview

This is a SvelteKit project with the following structure:

- **Framework**: SvelteKit with Svelte 5
- **Styling**: Tailwind CSS 4.0
- **Build Tool**: Vite
- **Deployment**: Configured for Vercel (adapter-vercel)
- **Language**: TypeScript

### Key Configuration Files

- `svelte.config.js` - SvelteKit configuration with Vercel adapter
- `vite.config.ts` - Vite build configuration with Tailwind and SvelteKit plugins
- `package.json` - Contains all development scripts and dependencies

### Project Structure

- `src/routes/` - SvelteKit file-based routing
- `src/lib/` - Shared library code (importable via `$lib` alias)
- `static/` - Static assets served at root

### Current State

The project appears to be a fresh SvelteKit installation with minimal custom code - the main page is currently empty with just a gray background.

## Svelte 5 Key Concepts

### Runes System

This project uses Svelte 5, which introduces **runes** - explicit reactivity primitives:

- **`$state()`** - Declares reactive state variables

  ```js
  let count = $state(0);
  ```

- **`$derived()`** - Creates computed/derived values

  ```js
  let doubled = $derived(count * 2);
  ```

- **`$effect()`** - Runs side effects when dependencies change

  ```js
  $effect(() => {
  	console.log('Count changed:', count);
  });
  ```

- **`$props()`** - Receives component properties
  ```js
  let { title, data } = $props();
  ```

### Component Structure

- Use `$props()` instead of `export let` for component props
- Event handlers are regular properties (use `onclick` instead of `on:click`)
- Content passing uses snippets instead of slots:
  ```svelte
  {#snippet header()}
  	<h1>Header content</h1>
  {/snippet}
  ```

### File Extensions

- Use `.svelte.js` or `.svelte.ts` for JavaScript/TypeScript files that use runes
- This enables runes like `$state` outside of `.svelte` components

- Keep commit messages brief. One sentence titles. Bullet points in the body, if necessary.