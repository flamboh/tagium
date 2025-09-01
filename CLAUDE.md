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
- **Audio Processing**: music-metadata library for parsing audio file metadata
- **Form Management**: react-hook-form with Zod schema validation
- **Image Processing**: react-image-crop for cover art cropping functionality

## Project Structure

- `app/` - Next.js App Router pages and layouts
  - `page.tsx` - Main application page with AudioTagger component
  - `layout.tsx` - Global layout and metadata
- `components/ui/` - shadcn/ui components and custom UI components
  - Core shadcn components: button, input, label, popover, card
  - `image-cropper.tsx` - Custom cropping component using react-image-crop
- `components/audio/` - Audio metadata editing components
  - `audioTagger.tsx` - Main component with form handling and validation (Zod + react-hook-form)
  - `audioUpload.tsx` - File upload interface
  - `coverArt.tsx` - Album cover display and cropping functionality
  - `tagForm.tsx` - Form component for metadata editing
- `lib/` - Shared utilities and helpers
- `public/` - Static assets

## Available Components

The project uses shadcn/ui components. Available components include:

- **Core UI**: button, input, label, popover, card
- **Custom Components**:
  - `image-cropper` - React Image Crop integration with popover
  - `coverArt` - Album cover display with crop functionality
  - `audioUpload` - File upload component for audio files
  - `audioTagger` - Main metadata editor with form validation

Use `pnpm dlx shadcn@latest add <component>` to add more shadcn components

## Key Files

- `components.json` - shadcn/ui configuration
- `next.config.ts` - Next.js configuration
- `tailwind.config.ts` - Tailwind CSS configuration
- `tsconfig.json` - TypeScript configuration

## Development Notes

- The app style is all lowercase
- The app focuses on local file metadata editing with a clean, minimal UI
- Uses card-based layout for the main metadata editing interface
- Implements consistent 320px/384px sizing for image croppers and covers
- Form validation using Zod schemas with TypeScript inference
- Follows React Hook Form patterns for controlled components
- Keep commit messages concise and descriptive
- Follow existing code patterns and conventions

## Current Features

- **Audio File Upload**: Drag-and-drop or browse for audio files
- **Metadata Parsing**: Automatic extraction of title, artist, album, year, genre, track/disc numbers
- **Cover Art Management**: Display existing cover art or upload new images
- **Image Cropping**: Square aspect ratio cropping with react-image-crop in popovers
- **Form-Based Editing**: Structured form inputs with validation for all metadata fields
- **Technical Info Display**: Read-only display of duration, bitrate, sample rate
