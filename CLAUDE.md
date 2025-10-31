# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- **Start development server**: `npm run dev`
- **Build project**: `npm run build`
- **Install dependencies**: `npm install`

Note: Jest is configured but no test command is defined in package.json.

## Architecture Overview

This is a Three.js-based 3D web application for creating vase geometries using Bézier curve profiles, specifically designed for clay/ceramic 3D printing workflows.

### Core Components

1. **Entry Points**:
   - `index.html` → `src/main.ts`: Main vase editor with full UI controls
   - `bezier.html` → `src/bezier-demo.ts`: Standalone Bézier curve editor

2. **Key Modules**:
   - `src/scene.ts`: Three.js scene initialization, lighting, camera, and controls setup
   - `src/geometry.ts`: Vase geometry generation from Bézier profiles, mesh repair algorithms
   - `src/bezier-profile.ts`: Interactive Bézier curve editing system with anchor points and handles
   - `src/constants.ts`: Configuration constants for UI and geometry generation

3. **Geometry Pipeline**:
   - Bézier curve points → LatheGeometry generation → Mesh repair → Watertight validation → OBJ export

### Key Technical Details

- **Mesh Repair**: Custom algorithms in `geometry.ts` for non-manifold edge repair, vertex merging, and cap generation to ensure watertight meshes suitable for 3D printing
- **UI System**: Uses lil-gui for control panels with real-time updates
- **Export Format**: OBJ file format for compatibility with 3D printing software
- **Performance**: Implements throttling for real-time geometry updates during curve editing

### Development Notes

- TypeScript strict mode is enabled
- Vite is used for development server and building
- The project uses ES modules throughout
- Git repository with meaningful commit history focused on mesh repair and geometry generation improvements