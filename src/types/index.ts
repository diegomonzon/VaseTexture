import * as THREE from 'three';

// Loft Editor Types
export interface LoftParameters {
    rings: number;
    segments: number;
    radius: number;
    height: number;
    twist: number;
    taper: number;
    showWireframe: boolean;
    showDisplacedWireframe: boolean;
    showNormals: boolean;
    normalsLength: number;
    normalsOffset: number;
    normalType: 'vertex' | 'face' | 'horizontal';
    textureRepeatU: number;
    textureRepeatV: number;
    textureRotation: number;
    showTexture: boolean;
    textureOpacity: number;
    displacementScale: number;
    displacementBias: number;
    smoothingIntensity: number;
    enableSmoothing: boolean;
    geometrySmoothing: number;
    falloffEnabled: boolean;
    falloffTop: number;
    falloffBottom: number;
    falloffPower: number;
    showFalloffZones: boolean;
    exportScale: number;
}

export interface BezierAnchor {
    position: THREE.Vector3;
    handleIn: THREE.Vector3;
    handleOut: THREE.Vector3;
    isSmooth: boolean;
    anchorMesh?: THREE.Mesh;
    handleInMesh?: THREE.Mesh;
    handleOutMesh?: THREE.Mesh;
    handleLineIn?: THREE.Line;
    handleLineOut?: THREE.Line;
}

export interface CapMeshes {
    bottom: THREE.Mesh | null;
    top: THREE.Mesh | null;
}

export interface FalloffIndicators {
    top: THREE.Mesh | null;
    bottom: THREE.Mesh | null;
}

// Mesh Repair Types
export interface VertexMap {
    [key: string]: number[];
}

export interface EdgeMap {
    [key: string]: number[];
}

// Watertight Test Types
export interface WatertightnessResult {
    watertight: boolean;
    unweldedBottom: number[];
    unweldedTop: number[];
}

// Export Types
export type ExportFormat = 'stl' | 'obj';

// GUI Types
export interface GUIFolder {
    add(object: any, property: string, min?: number, max?: number, step?: number): any;
    addColor(object: any, property: string): any;
    open(): void;
    close(): void;
}

// Event Types
export interface DragState {
    isDragging: boolean;
    dragPlane: THREE.Plane;
    dragOffset: THREE.Vector3;
    selectedAnchorIndex: number | null;
    selectedHandle: 'in' | 'out' | null;
}

// Geometry Processing Types
export interface GeometryProcessingOptions {
    tolerance?: number;
    iterations?: number;
    preserveBoundaries?: boolean;
}

// Constants
export const VERTEX_MERGE_TOLERANCE = 0.0001;
export const MIN_RADIUS = 0.1;
export const DEFAULT_SEGMENTS = 32;
export const DEFAULT_RINGS = 300;


