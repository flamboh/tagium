# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

Tagium is a Next.js application for editing local file metadata with a focus on user experience.

## Development Commands

### Development Server
```bash
npm run dev     # Start development server on http://localhost:3000
pnpm dev        # Alternative with pnpm
```

### Building
```bash
npm run build   # Create production build
npm run start   # Start production server
```

### Code Quality
```bash
npm run lint    # Run ESLint
npm run type-check  # TypeScript type checking (if available)
```

## Architecture

- **Framework**: Next.js 15 with App Router
- **Styling**: Tailwind CSS with shadcn/ui components
- **Language**: TypeScript
- **UI Components**: shadcn/ui (React-based)
- **Package Manager**: pnpm

## Project Structure

- `app/` - Next.js App Router pages and layouts
- `components/ui/` - shadcn/ui components
- `lib/` - Shared utilities and helpers
- `public/` - Static assets

## Available Components

The project uses shadcn/ui components. Available components include:
- button, input (already added)
- Use `pnpm dlx shadcn@latest add <component>` to add more components

## Key Files

- `components.json` - shadcn/ui configuration
- `next.config.ts` - Next.js configuration
- `tailwind.config.ts` - Tailwind CSS configuration
- `tsconfig.json` - TypeScript configuration

## Development Notes

- The app focuses on local file metadata editing
- Keep commit messages concise and descriptive
- Follow existing code patterns and conventions