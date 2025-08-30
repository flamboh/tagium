# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

Tagium is a Next.js application for editing local file metadata with a focus on user experience.

## Core Development Philosophy

### KISS (Keep It Simple, Stupid)

Simplicity should be a key goal in design. Choose straightforward solutions over complex ones whenever possible. Simple solutions are easier to understand, maintain, and debug.

### YAGNI (You Aren't Gonna Need It)

Avoid building functionality on speculation. Implement features only when they are needed, not when you anticipate they might be useful in the future.

### Design Principles

- **Dependency Inversion**: High-level modules should not depend on low-level modules. Both should depend on abstractions.
- **Open/Closed Principle**: Software entities should be open for extension but closed for modification.
- **Single Responsibility**: Each function, class, and module should have one clear purpose.
- **Fail Fast**: Check for potential errors early and raise exceptions immediately when issues occur.

## Code Structure & Modularity

### File and Function Limits

- **Never create a file longer than 500 lines of code**. If approaching this limit, refactor by splitting into modules.
- **Functions should be under 50 lines** with a single, clear responsibility.
- **Classes should be under 100 lines** and represent a single concept or entity.
- **Organize code into clearly separated modules**, grouped by feature or responsibility.

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
