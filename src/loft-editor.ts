import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { exportMesh } from './loft-editor/export-utils';
import * as dat from 'dat.gui';

let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let renderer: THREE.WebGLRenderer;
let controls: OrbitControls;
let gridHelper: THREE.GridHelper;
let animationId: number;
let loftMesh: THREE.Mesh;
let capMeshes: { bottom: THREE.Mesh | null, top: THREE.Mesh | null } = { bottom: null, top: null };
let wireframeMesh: THREE.LineSegments | null = null;
let displacedWireframeMesh: THREE.Mesh | null = null;  // New wireframe for displaced mesh
let falloffIndicators: { top: THREE.Mesh | null, bottom: THREE.Mesh | null } = { top: null, bottom: null };
let loftGUI: dat.GUI;
let normalsHelper: THREE.LineSegments | null = null;  // Helper to visualize normals

// Loft parameters
const loftParams = {
    rings: 300,         // High resolution for smooth results
    segments: 300,      // High resolution for smooth results
    radius: 2,          // Base radius (fixed)
    height: 5,          // Total height (fixed)
    twist: 0,           // Twist angle in degrees (fixed)
    taper: 1.0,         // Taper factor (fixed, 1.0 = no taper)
    showWireframe: false,
    showDisplacedWireframe: false,  // New parameter to show wireframe of displaced mesh
    showNormals: false,  // Toggle visibility of normals
    normalsLength: 0.2,  // Length of normal vectors
    normalsOffset: 0.05,  // Offset distance from surface for normal lines
    normalType: 'horizontal' as 'vertex' | 'face' | 'horizontal',  // Type of normals to display
    textureRepeatU: 1.0, // Texture repeat in U direction (around cylinder)
    textureRepeatV: 1.0, // Texture repeat in V direction (along height)
    textureRotation: 0.0, // Texture rotation/twist in degrees (0-360)
    showTexture: false,   // Toggle visibility of the texture without affecting displacement
    textureOpacity: 1.0, // Opacity/influence of the color texture (0-1)
    displacementScale: 0.5, // Displacement strength
    displacementBias: -0.1,   // Displacement bias (offset)
    smoothingIntensity: 5,   // Number of smoothing passes (0-5)
    enableSmoothing: true,   // Enable/disable smoothing
    geometrySmoothing: 5,    // Geometry smoothing (0-5) - works without displacement
    // Displacement falloff parameters
    falloffEnabled: true,    // Enable displacement falloff
    falloffTop: 0.2,         // Top falloff zone (0-1, percentage of height)
    falloffBottom: 0.2,      // Bottom falloff zone (0-1, percentage of height)
    falloffPower: 2.0,       // Falloff curve power (1=linear, 2=quadratic, etc.)
    showFalloffZones: true,  // Visual indicator for falloff zones
    // Export settings
    exportScale: 10.0        // Scale factor for exported models
};

// Texture variables
let currentTexture: THREE.Texture | null = null;

// Bezier curve for controlling ring radii
interface LoftBezierAnchor {
    position: THREE.Vector3; // x = radius, y = height
    handleIn: THREE.Vector3;
    handleOut: THREE.Vector3;
    isSmooth: boolean;
    anchorMesh?: THREE.Mesh;
    handleInMesh?: THREE.Mesh;
    handleOutMesh?: THREE.Mesh;
    handleLineIn?: THREE.Line;
    handleLineOut?: THREE.Line;
}

let loftBezierAnchors: LoftBezierAnchor[] = [];
let curveLine: THREE.Line | null = null;
let selectedAnchorIndex: number | null = null;
let selectedHandle: 'in' | 'out' | null = null;
let isDragging = false;
let dragPlane = new THREE.Plane();
let dragOffset = new THREE.Vector3();

// Temporary click marker for debugging
// let clickMarker: THREE.Mesh | null = null;

// Debug segment lines
// let segmentDebugLines: THREE.Line[] = [];

// Store keyboard event listener for cleanup
let keydownListener: ((event: KeyboardEvent) => void) | null = null;

// Initialize bezier anchors for the loft profile
function initLoftBezierAnchors() {
    loftBezierAnchors = [];
    const numAnchors = 5; // Start with 5 control points
    
    for (let i = 0; i < numAnchors; i++) {
        const t = i / (numAnchors - 1);
        const height = t * loftParams.height;
        const radius = loftParams.radius; // Start with uniform radius
        
        loftBezierAnchors.push({
            position: new THREE.Vector3(radius, height, 0),
            handleIn: new THREE.Vector3(0, -0.1, 0),  // Reduced from -0.3
            handleOut: new THREE.Vector3(0, 0.1, 0),  // Reduced from 0.3
            isSmooth: true
        });
    }
    
    // Make first and last anchors corner points
    loftBezierAnchors[0].isSmooth = false;
    loftBezierAnchors[0].handleIn = new THREE.Vector3(0, 0, 0);
    loftBezierAnchors[numAnchors - 1].isSmooth = false;
    loftBezierAnchors[numAnchors - 1].handleOut = new THREE.Vector3(0, 0, 0);
}

// Get radius at a specific height using the bezier curve with proper interpolation
function getRadiusAtHeight(height: number): number {
    // Handle edge cases
    if (height <= 0) {
        return Math.max(0.1, loftBezierAnchors[0].position.x);
    }
    if (height >= loftParams.height) {
        return Math.max(0.1, loftBezierAnchors[loftBezierAnchors.length - 1].position.x);
    }
    
    // Find which segment contains this height
    for (let i = 0; i < loftBezierAnchors.length - 1; i++) {
        const a = loftBezierAnchors[i];
        const b = loftBezierAnchors[i + 1];
        
        if (height >= a.position.y && height <= b.position.y) {
            // Create the bezier curve for this segment
            const curve = new THREE.CubicBezierCurve3(
                a.position.clone(),
                a.position.clone().add(a.handleOut),
                b.position.clone().add(b.handleIn),
                b.position.clone()
            );
            
            // Binary search to find the t parameter that gives us the desired height
            let tMin = 0;
            let tMax = 1;
            let t = 0.5;
            const tolerance = 0.0001;
            const maxIterations = 20;
            
            for (let iter = 0; iter < maxIterations; iter++) {
                const point = curve.getPoint(t);
                const error = point.y - height;
                
                if (Math.abs(error) < tolerance) {
                    return Math.max(0.1, point.x);
                }
                
                if (error > 0) {
                    tMax = t;
                } else {
                    tMin = t;
                }
                t = (tMin + tMax) / 2;
            }
            
            // Return the radius at the final t value
            const finalPoint = curve.getPoint(t);
            return Math.max(0.1, finalPoint.x);
        }
    }
    
    // Fallback (shouldn't reach here)
    return loftParams.radius;
}

// Update visual representation of anchors and handles
function updateLoftAnchorMeshes() {
    const sphereGeom = new THREE.SphereGeometry(0.05, 16, 16);
    const handleGeom = new THREE.SphereGeometry(0.03, 12, 12);
    const anchorMat = new THREE.MeshBasicMaterial({ color: 0xff0000 }); // Red for anchors
    // const selectedMat = new THREE.MeshBasicMaterial({ color: 0xffff00 }); // Yellow for selected - Currently unused
    // const cornerMat = new THREE.MeshBasicMaterial({ color: 0xff00ff }); // Magenta for corner points - Currently unused
    const handleMat = new THREE.MeshBasicMaterial({ color: 0xffffff }); // White for handles
    const lineMat = new THREE.LineBasicMaterial({ color: 0x8888ff });
    
    loftBezierAnchors.forEach((anchor, i) => {
        // Create or update anchor mesh
        if (!anchor.anchorMesh) {
            anchor.anchorMesh = new THREE.Mesh(sphereGeom, anchorMat.clone());
            scene.add(anchor.anchorMesh);
        }
        
        anchor.anchorMesh.position.copy(anchor.position);
        
        // Set color based on selection and type
        const mat = anchor.anchorMesh.material as THREE.MeshBasicMaterial;
        if (i === selectedAnchorIndex && selectedHandle === null) {
            mat.color.setHex(0xffff00); // Yellow for selected
        } else if (!anchor.isSmooth) {
            mat.color.setHex(0xff00ff); // Magenta for corner
        } else {
            mat.color.setHex(0xff0000); // Red for smooth
        }
        
        // Create or update handle meshes
        if (!anchor.handleInMesh) {
            anchor.handleInMesh = new THREE.Mesh(handleGeom, handleMat.clone());
            scene.add(anchor.handleInMesh);
        }
        anchor.handleInMesh.position.copy(anchor.position.clone().add(anchor.handleIn));
        anchor.handleInMesh.visible = (selectedAnchorIndex === i);
        
        if (!anchor.handleOutMesh) {
            anchor.handleOutMesh = new THREE.Mesh(handleGeom, handleMat.clone());
            scene.add(anchor.handleOutMesh);
        }
        anchor.handleOutMesh.position.copy(anchor.position.clone().add(anchor.handleOut));
        anchor.handleOutMesh.visible = (selectedAnchorIndex === i);
        
        // Create or update handle lines
        if (!anchor.handleLineIn) {
            const geom = new THREE.BufferGeometry();
            anchor.handleLineIn = new THREE.Line(geom, lineMat.clone());
            scene.add(anchor.handleLineIn);
        }
        const inPoints = [anchor.position, anchor.position.clone().add(anchor.handleIn)];
        anchor.handleLineIn.geometry.setFromPoints(inPoints);
        anchor.handleLineIn.visible = (selectedAnchorIndex === i);
        
        if (!anchor.handleLineOut) {
            const geom = new THREE.BufferGeometry();
            anchor.handleLineOut = new THREE.Line(geom, lineMat.clone());
            scene.add(anchor.handleLineOut);
        }
        const outPoints = [anchor.position, anchor.position.clone().add(anchor.handleOut)];
        anchor.handleLineOut.geometry.setFromPoints(outPoints);
        anchor.handleLineOut.visible = (selectedAnchorIndex === i);
    });
}

// Update the curve line visualization
function updateLoftCurveLine() {
    // Instead of using buildLoftCurve which creates a CurvePath,
    // let's build the curve from the same segments we check in double-click
    const allPoints: THREE.Vector3[] = [];
    
    // Build points from each bezier segment exactly as we do in the click handler
    for (let i = 0; i < loftBezierAnchors.length - 1; i++) {
        const a = loftBezierAnchors[i];
        const b = loftBezierAnchors[i + 1];
        
        const segmentCurve = new THREE.CubicBezierCurve3(
            a.position.clone(),
            a.position.clone().add(a.handleOut),
            b.position.clone().add(b.handleIn),
            b.position.clone()
        );
        
        // Get points for this segment (don't include last point except for last segment)
        const segmentPoints = segmentCurve.getPoints(20);
        if (i < loftBezierAnchors.length - 2) {
            // Remove last point to avoid duplicates
            segmentPoints.pop();
        }
        allPoints.push(...segmentPoints);
    }
    
    if (!curveLine) {
        const geom = new THREE.BufferGeometry().setFromPoints(allPoints);
        const mat = new THREE.LineBasicMaterial({ 
            color: 0x00ff00, 
            linewidth: 3,
            opacity: 0.8,
            transparent: true
        });
        curveLine = new THREE.Line(geom, mat);
        scene.add(curveLine);
        
        // Add a thicker invisible line for better hit detection
        const hitGeom = new THREE.BufferGeometry().setFromPoints(allPoints);
        const hitMat = new THREE.LineBasicMaterial({ 
            color: 0x00ff00, 
            linewidth: 10,
            opacity: 0,
            transparent: true
        });
        const hitLine = new THREE.Line(hitGeom, hitMat);
        hitLine.name = 'curveHitArea';
        curveLine.add(hitLine); // Add as child so it moves with the curve
    } else {
        curveLine.geometry.setFromPoints(allPoints);
        // Update hit area geometry too
        const hitLine = curveLine.getObjectByName('curveHitArea') as THREE.Line;
        if (hitLine) {
            hitLine.geometry.setFromPoints(allPoints);
        }
    }
}

// Toggle smooth/corner for an anchor
function toggleLoftAnchorSmooth(index: number) {
    if (index < 0 || index >= loftBezierAnchors.length) return;
    
    const anchor = loftBezierAnchors[index];
    anchor.isSmooth = !anchor.isSmooth;
    
    if (anchor.isSmooth) {
        // Make handles colinear
        if (anchor.handleIn.lengthSq() > anchor.handleOut.lengthSq()) {
            anchor.handleOut.copy(anchor.handleIn).multiplyScalar(-1);
        } else {
            anchor.handleIn.copy(anchor.handleOut).multiplyScalar(-1);
        }
    }
    
    updateLoftAnchorMeshes();
    updateLoftCurveLine();
    updateLoftGeometry();
}

// Create loft geometry from ring profiles (body only, no caps)
function createLoftGeometry(params: typeof loftParams): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    const vertices: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    
    const { rings, segments, height, twist, taper } = params;
    const heightStep = height / (rings - 1);
    const twistStep = (twist * Math.PI / 180) / (rings - 1);
    
    // Minimum radius to ensure watertight geometry
    const minRadius = 0.1;
    
    // Pre-calculate all ring radii for smooth normal calculation
    const ringRadii: number[] = [];
    for (let ring = 0; ring < rings; ring++) {
        const y = ring * heightStep;
        const ringTaper = 1.0 - (1.0 - taper) * (ring / (rings - 1));
        const baseRadius = getRadiusAtHeight(y);
        ringRadii.push(Math.max(minRadius, baseRadius * ringTaper));
    }
    
    // Create vertices for each ring
    for (let ring = 0; ring < rings; ring++) {
        const y = ring * heightStep;
        const ringTwist = ring * twistStep;
        const ringRadius = ringRadii[ring];
        
        // Calculate slope for better normal computation
        let radiusSlope = 0;
        if (ring > 0 && ring < rings - 1) {
            // Central difference for slope
            const prevRadius = ringRadii[ring - 1];
            const nextRadius = ringRadii[ring + 1];
            radiusSlope = (nextRadius - prevRadius) / (2 * heightStep);
        } else if (ring === 0 && rings > 1) {
            // Forward difference at start
            radiusSlope = (ringRadii[1] - ringRadii[0]) / heightStep;
        } else if (ring === rings - 1 && rings > 1) {
            // Backward difference at end
            radiusSlope = (ringRadii[ring] - ringRadii[ring - 1]) / heightStep;
        }
        
        for (let seg = 0; seg <= segments; seg++) {
            const theta = (seg / segments) * Math.PI * 2 + ringTwist;
            const cosTheta = Math.cos(theta);
            const sinTheta = Math.sin(theta);
            
            const x = ringRadius * cosTheta;
            const z = ringRadius * sinTheta;
            
            vertices.push(x, y, z);
            
            // Calculate normal with slope consideration for smooth shading
            // The normal should account for the change in radius along the height
            // const radialDir = new THREE.Vector3(cosTheta, 0, sinTheta); // Currently unused
            const tangentY = new THREE.Vector3(-radiusSlope * cosTheta, 1, -radiusSlope * sinTheta);
            const normal = new THREE.Vector3().crossVectors(
                new THREE.Vector3(-sinTheta, 0, cosTheta), // tangent in theta direction
                tangentY // tangent in y direction
            ).normalize();
            
            normals.push(normal.x, normal.y, normal.z);
            
            // UV coordinates with texture rotation/twist
            let u = seg / segments;
            const v = ring / (rings - 1);
            
            // Apply progressive rotation based on height (v coordinate)
            // Convert rotation from degrees to radians and apply proportionally along height
            const rotationRadians = (params.textureRotation * Math.PI / 180) * v;
            u = (u + rotationRadians / (Math.PI * 2)) % 1.0;
            if (u < 0) u += 1.0; // Ensure positive UV coordinates
            
            uvs.push(u, v);
        }
    }
    
    // Create faces between rings
    for (let ring = 0; ring < rings - 1; ring++) {
        for (let seg = 0; seg < segments; seg++) {
            const a = ring * (segments + 1) + seg;
            const b = ring * (segments + 1) + seg + 1;
            const c = (ring + 1) * (segments + 1) + seg + 1;
            const d = (ring + 1) * (segments + 1) + seg;
            
            // Two triangles per quad
            indices.push(a, b, c);
            indices.push(a, c, d);
        }
    }
    
    // Set geometry attributes
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    
    // Don't recompute normals - use our carefully calculated ones
    // geometry.computeVertexNormals();
    
    return geometry;
}

// Get displaced vertices from the cylinder body for cap welding
function getDisplacedRingVertices(geometry: THREE.BufferGeometry, ringIndex: number, segments: number): THREE.Vector3[] {
    const positions = geometry.getAttribute('position');
    const vertices: THREE.Vector3[] = [];
    
    // Get vertices for the specific ring
    // IMPORTANT: We need segments+1 vertices to close the loop
    for (let seg = 0; seg <= segments; seg++) {
        const vertexIndex = ringIndex * (segments + 1) + seg;
        const x = positions.getX(vertexIndex);
        const y = positions.getY(vertexIndex);
        const z = positions.getZ(vertexIndex);
        
        // Store exact vertex position without any modification
        vertices.push(new THREE.Vector3(x, y, z));
    }
    
    return vertices;
}

// Create cap geometries that match displaced cylinder edges
function createWeldedCapGeometries(cylinderGeometry: THREE.BufferGeometry, params: typeof loftParams): { bottom: THREE.BufferGeometry, top: THREE.BufferGeometry } {
    const { segments, rings } = params;
    // const { height } = params; // Currently unused
    
    // Get displaced ring vertices
    const bottomRingVertices = getDisplacedRingVertices(cylinderGeometry, 0, segments);
    const topRingVertices = getDisplacedRingVertices(cylinderGeometry, rings - 1, segments);
    
    // Bottom cap
    const bottomGeometry = new THREE.BufferGeometry();
    const bottomVertices: number[] = [];
    const bottomNormals: number[] = [];
    const bottomUvs: number[] = [];
    const bottomIndices: number[] = [];
    
    // Calculate center point from displaced ring (including Y position)
    let centerX = 0, centerY = 0, centerZ = 0;
    for (let i = 0; i < segments; i++) {
        centerX += bottomRingVertices[i].x;
        centerY += bottomRingVertices[i].y;
        centerZ += bottomRingVertices[i].z;
    }
    centerX /= segments;
    centerY /= segments;
    centerZ /= segments;
    
    // Center vertex (use average Y from displaced ring)
    bottomVertices.push(centerX, centerY, centerZ);
    bottomNormals.push(0, -1, 0);
    bottomUvs.push(0.5, 0.5);
    
    // Ring vertices (use exact displaced positions)
    for (let seg = 0; seg <= segments; seg++) {
        const vertex = bottomRingVertices[seg];
        bottomVertices.push(vertex.x, vertex.y, vertex.z);
        bottomNormals.push(0, -1, 0);
        
        const u = 0.5 + 0.5 * Math.cos((seg / segments) * Math.PI * 2);
        const v = 0.5 + 0.5 * Math.sin((seg / segments) * Math.PI * 2);
        bottomUvs.push(u, v);
    }
    
    // Create triangles
    for (let seg = 0; seg < segments; seg++) {
        bottomIndices.push(0, seg + 2, seg + 1);
    }
    
    bottomGeometry.setAttribute('position', new THREE.Float32BufferAttribute(bottomVertices, 3));
    bottomGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(bottomNormals, 3));
    bottomGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(bottomUvs, 2));
    bottomGeometry.setIndex(bottomIndices);
    
    // Top cap
    const topGeometry = new THREE.BufferGeometry();
    const topVertices: number[] = [];
    const topNormals: number[] = [];
    const topUvs: number[] = [];
    const topIndices: number[] = [];
    
    // Calculate center point from displaced ring (including Y position)
    centerX = 0; centerY = 0; centerZ = 0;
    for (let i = 0; i < segments; i++) {
        centerX += topRingVertices[i].x;
        centerY += topRingVertices[i].y;
        centerZ += topRingVertices[i].z;
    }
    centerX /= segments;
    centerY /= segments;
    centerZ /= segments;
    
    // Center vertex (use average Y from displaced ring)
    topVertices.push(centerX, centerY, centerZ);
    topNormals.push(0, 1, 0);
    topUvs.push(0.5, 0.5);
    
    // Ring vertices (use exact displaced positions)
    for (let seg = 0; seg <= segments; seg++) {
        const vertex = topRingVertices[seg];
        topVertices.push(vertex.x, vertex.y, vertex.z);
        topNormals.push(0, 1, 0);
        
        const u = 0.5 + 0.5 * Math.cos((seg / segments) * Math.PI * 2);
        const v = 0.5 + 0.5 * Math.sin((seg / segments) * Math.PI * 2);
        topUvs.push(u, v);
    }
    
    // Create triangles
    for (let seg = 0; seg < segments; seg++) {
        topIndices.push(0, seg + 1, seg + 2);
    }
    
    topGeometry.setAttribute('position', new THREE.Float32BufferAttribute(topVertices, 3));
    topGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(topNormals, 3));
    topGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(topUvs, 2));
    topGeometry.setIndex(topIndices);
    
    return { bottom: bottomGeometry, top: topGeometry };
}

// Create wireframe helper for the loft
function createLoftWireframe(params: typeof loftParams): THREE.LineSegments {
    const { rings, segments, height, twist, taper } = params;
    const geometry = new THREE.BufferGeometry();
    const vertices: number[] = [];
    
    const heightStep = height / (rings - 1);
    const twistStep = (twist * Math.PI / 180) / (rings - 1);
    
    // Create ring outlines
    for (let ring = 0; ring < rings; ring++) {
        const y = ring * heightStep;
        const ringTwist = ring * twistStep;
        const ringTaper = 1.0 - (1.0 - taper) * (ring / (rings - 1));
        
        // Use bezier curve to determine radius at this height
        const baseRadius = getRadiusAtHeight(y);
        const ringRadius = baseRadius * ringTaper;
        
        for (let seg = 0; seg <= segments; seg++) {
            const theta = (seg / segments) * Math.PI * 2 + ringTwist;
            const x = ringRadius * Math.cos(theta);
            const z = ringRadius * Math.sin(theta);
            
            vertices.push(x, y, z);
            
            // Connect to next segment
            if (seg < segments) {
                const nextTheta = ((seg + 1) / segments) * Math.PI * 2 + ringTwist;
                const nextX = ringRadius * Math.cos(nextTheta);
                const nextZ = ringRadius * Math.sin(nextTheta);
                vertices.push(nextX, y, nextZ);
            }
        }
    }
    
    // Create vertical lines connecting rings
    for (let seg = 0; seg <= segments; seg += 4) { // Every 4th segment for clarity
        for (let ring = 0; ring < rings - 1; ring++) {
            const y1 = ring * heightStep;
            const y2 = (ring + 1) * heightStep;
            
            const ringTwist1 = ring * twistStep;
            const ringTwist2 = (ring + 1) * twistStep;
            
            const ringTaper1 = 1.0 - (1.0 - taper) * (ring / (rings - 1));
            const ringTaper2 = 1.0 - (1.0 - taper) * ((ring + 1) / (rings - 1));
            
            const theta1 = (seg / segments) * Math.PI * 2 + ringTwist1;
            const theta2 = (seg / segments) * Math.PI * 2 + ringTwist2;
            
            const baseRadius1 = getRadiusAtHeight(y1);
            const baseRadius2 = getRadiusAtHeight(y2);
            
            const x1 = baseRadius1 * ringTaper1 * Math.cos(theta1);
            const z1 = baseRadius1 * ringTaper1 * Math.sin(theta1);
            const x2 = baseRadius2 * ringTaper2 * Math.cos(theta2);
            const z2 = baseRadius2 * ringTaper2 * Math.sin(theta2);
            
            vertices.push(x1, y1, z1);
            vertices.push(x2, y2, z2);
        }
    }
    
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    
    const material = new THREE.LineBasicMaterial({ 
        color: 0x00ff00, 
        opacity: 0.3, 
        transparent: true 
    });
    
    return new THREE.LineSegments(geometry, material);
}

// Update the loft geometry when parameters change
function updateLoftGeometry() {
    // Remove old meshes
    if (loftMesh) {
        scene.remove(loftMesh);
        loftMesh.geometry.dispose();
        if (loftMesh.material instanceof THREE.Material) {
            loftMesh.material.dispose();
        }
    }
    
    // Remove old wireframe
    if (wireframeMesh) {
        scene.remove(wireframeMesh);
        wireframeMesh.geometry.dispose();
    }
    
    // Remove old displaced wireframe
    if (displacedWireframeMesh) {
        scene.remove(displacedWireframeMesh);
        displacedWireframeMesh.geometry.dispose();
        if (displacedWireframeMesh.material instanceof THREE.Material) {
            displacedWireframeMesh.material.dispose();
        }
        displacedWireframeMesh = null;
    }
    
    // Create new loft geometry (body only)
    const loftGeometry = createLoftGeometry(loftParams);
    
    // Ensure normals point outward from the start
    ensureNormalsPointOutward(loftGeometry);
    
    // Apply general geometry smoothing if enabled (works without displacement)
    if (loftParams.enableSmoothing && loftParams.geometrySmoothing > 0) {
        const rings = Math.floor(loftGeometry.getAttribute('position').count / (loftParams.segments + 1));
        smoothDisplacedGeometry(loftGeometry, loftParams.segments, rings, loftParams.geometrySmoothing);
        // Recompute normals after smoothing to maintain smooth shading
        recalculateSmoothNormals(loftGeometry, loftParams.segments, rings);
        // Ensure they still point outward after recalculation
        ensureNormalsPointOutward(loftGeometry);
    }
    
    // Apply displacement to actual geometry vertices if we have texture and displacement
    if (currentTexture && (loftParams.displacementScale !== 0 || loftParams.displacementBias !== 0)) {
        // Use vertex normals for displacement if normalType is 'vertex' or 'horizontal', face normals if 'face'
        const useVertexNormals = loftParams.normalType !== 'face';
        applyDisplacementToGeometry(loftGeometry, currentTexture, loftParams.displacementScale, loftParams.displacementBias, useVertexNormals);
    }
    
    // Create material (no shader displacement since we applied it to geometry)
    const loftMaterial = new THREE.MeshStandardMaterial({ 
        map: (currentTexture && loftParams.showTexture) ? currentTexture : null,
        // Color: white when showing texture, blue when not
        color: (currentTexture && loftParams.showTexture) ? 0xffffff : 0x3b82f6,
        metalness: 0.3,
        roughness: 0.6,
        side: THREE.DoubleSide
    });
    
    // Apply custom map opacity mixing if a texture is present and visible
    if (currentTexture && loftParams.showTexture && loftParams.textureOpacity < 1.0) {
        setupTextureOpacityBlending(loftMaterial);
    }
    
    loftMesh = new THREE.Mesh(loftGeometry, loftMaterial);
    loftMesh.position.y = 0;
    scene.add(loftMesh);
    
    // Always create watertight caps after geometry is finalized
    createWatertightCaps();
    
    // Create new wireframe
    if (loftParams.showWireframe) {
        wireframeMesh = createLoftWireframe(loftParams);
        wireframeMesh.position.y = 0;
        scene.add(wireframeMesh);
    } else {
        wireframeMesh = null;
    }
    
    // Update displaced wireframe if needed
    updateDisplacedWireframe();
    
    // Update normals helper if needed
    updateNormalsHelper();
    
    // Update falloff indicators if needed
    updateFalloffIndicators();
    
    // Update bezier curve visualization
    updateLoftCurveLine();
}

// Update visual indicators for falloff zones
function updateFalloffIndicators() {
    // Remove existing indicators
    if (falloffIndicators.bottom) {
        scene.remove(falloffIndicators.bottom);
        falloffIndicators.bottom.geometry.dispose();
        if (falloffIndicators.bottom.material instanceof THREE.Material) {
            falloffIndicators.bottom.material.dispose();
        }
        falloffIndicators.bottom = null;
    }
    
    if (falloffIndicators.top) {
        scene.remove(falloffIndicators.top);
        falloffIndicators.top.geometry.dispose();
        if (falloffIndicators.top.material instanceof THREE.Material) {
            falloffIndicators.top.material.dispose();
        }
        falloffIndicators.top = null;
    }
    
    // Only create indicators if enabled
    if (!loftParams.showFalloffZones || !loftParams.falloffEnabled) return;
    
    // Create ring geometries at falloff boundaries
    const createRingIndicator = (height: number, color: number) => {
        const radius = getRadiusAtHeight(height) + 0.05; // Slightly larger than actual mesh
        const geometry = new THREE.TorusGeometry(radius, 0.01, 8, 64);
        const material = new THREE.MeshBasicMaterial({ 
            color: color, 
            opacity: 0.5, 
            transparent: true 
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.rotation.x = Math.PI / 2;
        mesh.position.y = height;
        return mesh;
    };
    
    // Bottom falloff indicator
    const bottomHeight = loftParams.height * loftParams.falloffBottom;
    falloffIndicators.bottom = createRingIndicator(bottomHeight, 0x00ff00);
    scene.add(falloffIndicators.bottom);
    
    // Top falloff indicator
    const topHeight = loftParams.height * (1 - loftParams.falloffTop);
    falloffIndicators.top = createRingIndicator(topHeight, 0xff0000);
    scene.add(falloffIndicators.top);
}

// Update the displaced wireframe display
function updateDisplacedWireframe() {
    // Remove existing displaced wireframe
    if (displacedWireframeMesh) {
        scene.remove(displacedWireframeMesh);
        displacedWireframeMesh.geometry.dispose();
        if (displacedWireframeMesh.material instanceof THREE.Material) {
            displacedWireframeMesh.material.dispose();
        }
        displacedWireframeMesh = null;
    }
    
    // Only create if checkbox is enabled and we have a loft mesh
    if (loftParams.showDisplacedWireframe && loftMesh) {
        // Clone the actual displaced geometry
        const wireframeGeometry = loftMesh.geometry.clone();
        
        // Create wireframe material
        const wireframeMaterial = new THREE.MeshBasicMaterial({
            color: 0xff00ff,  // Magenta color for displaced wireframe
            wireframe: true,
            wireframeLinewidth: 1,
            transparent: true,
            opacity: 0.8
        });
        
        // Create the wireframe mesh
        displacedWireframeMesh = new THREE.Mesh(wireframeGeometry, wireframeMaterial);
        displacedWireframeMesh.position.copy(loftMesh.position);
        
        // Add to scene
        scene.add(displacedWireframeMesh);
    }
}

// Create normals visualization helper
function createNormalsHelper(geometry: THREE.BufferGeometry, length: number = 0.2, offset: number = 0.05, type: 'vertex' | 'face' | 'horizontal' = 'vertex'): THREE.LineSegments {
    const normalLines: number[] = [];
    
    if (type === 'vertex') {
        // Show vertex normals (smooth shading normals)
        const positions = geometry.getAttribute('position');
        const normals = geometry.getAttribute('normal');
        
        if (!positions || !normals) {
            console.warn('Geometry missing position or normal attributes');
            return new THREE.LineSegments();
        }
        
        // Create lines for each vertex normal
        for (let i = 0; i < positions.count; i++) {
            // Get vertex position
            const x = positions.getX(i);
            const y = positions.getY(i);
            const z = positions.getZ(i);
            
            // Get normal direction
            let nx = normals.getX(i);
            let ny = normals.getY(i);
            let nz = normals.getZ(i);
            
            // Ensure normals point outward from the Y-axis (cylinder center)
            // Calculate radial direction from Y-axis
            const radialLength = Math.sqrt(x * x + z * z);
            if (radialLength > 0.001) {
                const radialX = x / radialLength;
                const radialZ = z / radialLength;
                
                // Check if normal points inward (dot product with radial direction)
                const dotProduct = nx * radialX + nz * radialZ;
                if (dotProduct < 0) {
                    // Flip the normal to point outward
                    nx = -nx;
                    ny = -ny;
                    nz = -nz;
                }
            }
            
            // Start point (vertex position + small offset along normal to place it outside)
            normalLines.push(
                x + nx * offset,
                y + ny * offset,
                z + nz * offset
            );
            
            // End point (start point + normal * length)
            normalLines.push(
                x + nx * (offset + length),
                y + ny * (offset + length),
                z + nz * (offset + length)
            );
        }
    } else {
        // Show face normals (perpendicular to each triangle)
        const positions = geometry.getAttribute('position');
        const index = geometry.getIndex();
        
        if (!positions) {
            console.warn('Geometry missing position attribute');
            return new THREE.LineSegments();
        }
        
        // Helper vectors for face normal calculation
        const vA = new THREE.Vector3();
        const vB = new THREE.Vector3();
        const vC = new THREE.Vector3();
        const cb = new THREE.Vector3();
        const ab = new THREE.Vector3();
        const faceNormal = new THREE.Vector3();
        
        // Process each triangle
        if (index) {
            // Indexed geometry
            for (let i = 0; i < index.count; i += 3) {
                // Get triangle vertices
                const a = index.getX(i);
                const b = index.getX(i + 1);
                const c = index.getX(i + 2);
                
                vA.fromBufferAttribute(positions, a);
                vB.fromBufferAttribute(positions, b);
                vC.fromBufferAttribute(positions, c);
                
                // Calculate face normal
                cb.subVectors(vC, vB);
                ab.subVectors(vA, vB);
                faceNormal.crossVectors(cb, ab).normalize();
                
                // Calculate face center
                const centerX = (vA.x + vB.x + vC.x) / 3;
                const centerY = (vA.y + vB.y + vC.y) / 3;
                const centerZ = (vA.z + vB.z + vC.z) / 3;
                
                // Ensure face normal points outward from the Y-axis
                const radialLength = Math.sqrt(centerX * centerX + centerZ * centerZ);
                if (radialLength > 0.001) {
                    const radialX = centerX / radialLength;
                    const radialZ = centerZ / radialLength;
                    
                    // Check if normal points inward (dot product with radial direction)
                    const dotProduct = faceNormal.x * radialX + faceNormal.z * radialZ;
                    if (dotProduct < 0) {
                        // Flip the normal to point outward
                        faceNormal.multiplyScalar(-1);
                    }
                }
                
                // Add normal line from face center (offset outside the surface)
                normalLines.push(
                    centerX + faceNormal.x * offset,
                    centerY + faceNormal.y * offset,
                    centerZ + faceNormal.z * offset
                );
                normalLines.push(
                    centerX + faceNormal.x * (offset + length),
                    centerY + faceNormal.y * (offset + length),
                    centerZ + faceNormal.z * (offset + length)
                );
            }
        } else {
            // Non-indexed geometry
            for (let i = 0; i < positions.count; i += 3) {
                vA.fromBufferAttribute(positions, i);
                vB.fromBufferAttribute(positions, i + 1);
                vC.fromBufferAttribute(positions, i + 2);
                
                // Calculate face normal
                cb.subVectors(vC, vB);
                ab.subVectors(vA, vB);
                faceNormal.crossVectors(cb, ab).normalize();
                
                // Calculate face center
                const centerX = (vA.x + vB.x + vC.x) / 3;
                const centerY = (vA.y + vB.y + vC.y) / 3;
                const centerZ = (vA.z + vB.z + vC.z) / 3;
                
                // Ensure face normal points outward from the Y-axis
                const radialLength = Math.sqrt(centerX * centerX + centerZ * centerZ);
                if (radialLength > 0.001) {
                    const radialX = centerX / radialLength;
                    const radialZ = centerZ / radialLength;
                    
                    // Check if normal points inward (dot product with radial direction)
                    const dotProduct = faceNormal.x * radialX + faceNormal.z * radialZ;
                    if (dotProduct < 0) {
                        // Flip the normal to point outward
                        faceNormal.multiplyScalar(-1);
                    }
                }
                
                // Add normal line from face center (offset outside the surface)
                normalLines.push(
                    centerX + faceNormal.x * offset,
                    centerY + faceNormal.y * offset,
                    centerZ + faceNormal.z * offset
                );
                normalLines.push(
                    centerX + faceNormal.x * (offset + length),
                    centerY + faceNormal.y * (offset + length),
                    centerZ + faceNormal.z * (offset + length)
                );
            }
        }
    }
    
    // Create geometry for the normal lines
    const normalGeometry = new THREE.BufferGeometry();
    normalGeometry.setAttribute('position', new THREE.Float32BufferAttribute(normalLines, 3));
    
    // Create material for the normal lines
    const normalMaterial = new THREE.LineBasicMaterial({
        color: type === 'vertex' ? 0x00ffff : 0xff00ff,  // Cyan for vertex normals, magenta for face normals
        opacity: 0.6,
        transparent: true
    });
    
    return new THREE.LineSegments(normalGeometry, normalMaterial);
}

// Update normals helper
function updateNormalsHelper() {
    // Remove existing normals helper
    if (normalsHelper) {
        scene.remove(normalsHelper);
        normalsHelper.geometry.dispose();
        if (normalsHelper.material instanceof THREE.Material) {
            normalsHelper.material.dispose();
        }
        normalsHelper = null;
    }
    
    // Only create if checkbox is enabled and we have a loft mesh
    if (loftParams.showNormals && loftMesh) {
        normalsHelper = createNormalsHelper(loftMesh.geometry, loftParams.normalsLength, loftParams.normalsOffset, loftParams.normalType);
        normalsHelper.position.copy(loftMesh.position);
        scene.add(normalsHelper);
    }
}

// Initialize mouse interactions for bezier curve
function initLoftBezierInteractions() {
    let dragObject: THREE.Object3D | null = null;
    let temporaryDisplacementScale = 0;
    let temporaryDisplacementBias = 0;
    let displacementDisabledForDrag = false;
    
    // Pointer down - select anchor or handle
    renderer.domElement.addEventListener('pointerdown', (event: MouseEvent) => {
        const mouse = new THREE.Vector2(
            (event.clientX / renderer.domElement.clientWidth) * 2 - 1,
            -(event.clientY / renderer.domElement.clientHeight) * 2 + 1
        );
        
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, camera);
        
        // Check for intersection with anchors and handles
        for (let i = 0; i < loftBezierAnchors.length; i++) {
            const anchor = loftBezierAnchors[i];
            
            // Check anchor
            if (anchor.anchorMesh && raycaster.intersectObject(anchor.anchorMesh).length > 0) {
                selectedAnchorIndex = i;
                selectedHandle = null;
                dragObject = anchor.anchorMesh;
                isDragging = true;
                
                // Temporarily reduce displacement while dragging
                if (!displacementDisabledForDrag && (loftParams.displacementScale !== 0 || loftParams.displacementBias !== 0)) {
                    temporaryDisplacementScale = loftParams.displacementScale;
                    temporaryDisplacementBias = loftParams.displacementBias;
                    displacementDisabledForDrag = true;
                    loftParams.displacementScale *= 0.3;
                    loftParams.displacementBias *= 0.3;
                    updateLoftGeometry();
                }
                break;
            }
            
            // Check handles
            if (selectedAnchorIndex === i) {
                if (anchor.handleInMesh && anchor.handleInMesh.visible && 
                    raycaster.intersectObject(anchor.handleInMesh).length > 0) {
                    selectedHandle = 'in';
                    dragObject = anchor.handleInMesh;
                    isDragging = true;
                    break;
                }
                if (anchor.handleOutMesh && anchor.handleOutMesh.visible && 
                    raycaster.intersectObject(anchor.handleOutMesh).length > 0) {
                    selectedHandle = 'out';
                    dragObject = anchor.handleOutMesh;
                    isDragging = true;
                    break;
                }
            }
        }
        
        if (isDragging && dragObject) {
            controls.enabled = false;
            
            // Set up drag plane
            dragPlane.setFromNormalAndCoplanarPoint(
                camera.getWorldDirection(new THREE.Vector3()),
                dragObject.position
            );
            
            // Calculate offset
            const intersect = new THREE.Vector3();
            raycaster.ray.intersectPlane(dragPlane, intersect);
            dragOffset.copy(dragObject.position).sub(intersect);
            
            renderer.domElement.style.cursor = 'grabbing';
        } else {
            // Deselect if clicking empty space
            selectedAnchorIndex = null;
            selectedHandle = null;
        }
        
        updateLoftAnchorMeshes();
    });
    
    // Pointer move - drag selected object
    renderer.domElement.addEventListener('pointermove', (event: MouseEvent) => {
        if (!isDragging || selectedAnchorIndex === null) return;
        
        const mouse = new THREE.Vector2(
            (event.clientX / renderer.domElement.clientWidth) * 2 - 1,
            -(event.clientY / renderer.domElement.clientHeight) * 2 + 1
        );
        
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, camera);
        
        const intersect = new THREE.Vector3();
        raycaster.ray.intersectPlane(dragPlane, intersect);
        intersect.add(dragOffset);
        
        const anchor = loftBezierAnchors[selectedAnchorIndex];
        
        if (selectedHandle === null) {
            // Dragging anchor point
            // Constrain X (radius) to positive values
            anchor.position.x = Math.max(0.1, intersect.x);
            
            // Constrain Y (height) between 0 and max height
            if (selectedAnchorIndex === 0) {
                anchor.position.y = 0; // First anchor fixed at bottom
            } else if (selectedAnchorIndex === loftBezierAnchors.length - 1) {
                anchor.position.y = loftParams.height; // Last anchor fixed at top
            } else {
                anchor.position.y = Math.max(0, Math.min(loftParams.height, intersect.y));
            }
        } else if (selectedHandle === 'in') {
            // Dragging handle in
            anchor.handleIn.x = intersect.x - anchor.position.x;
            anchor.handleIn.y = intersect.y - anchor.position.y;
            anchor.handleIn.z = 0;
            
            if (anchor.isSmooth) {
                anchor.handleOut.copy(anchor.handleIn).multiplyScalar(-1);
            }
        } else if (selectedHandle === 'out') {
            // Dragging handle out
            anchor.handleOut.x = intersect.x - anchor.position.x;
            anchor.handleOut.y = intersect.y - anchor.position.y;
            anchor.handleOut.z = 0;
            
            if (anchor.isSmooth) {
                anchor.handleIn.copy(anchor.handleOut).multiplyScalar(-1);
            }
        }
        
        updateLoftAnchorMeshes();
        updateLoftCurveLine();
        updateLoftGeometry();
    });
    
    // Pointer up - stop dragging
    renderer.domElement.addEventListener('pointerup', () => {
        isDragging = false;
        dragObject = null;
        controls.enabled = true;
        renderer.domElement.style.cursor = '';
        
        // Restore full displacement after dragging
        if (displacementDisabledForDrag) {
            loftParams.displacementScale = temporaryDisplacementScale;
            loftParams.displacementBias = temporaryDisplacementBias;
            displacementDisabledForDrag = false;
            updateLoftGeometry();
        }
    });
    
    // Double click - add point on curve or toggle smooth/corner on anchor
    renderer.domElement.addEventListener('dblclick', (event: MouseEvent) => {
        const mouse = new THREE.Vector2(
            (event.clientX / renderer.domElement.clientWidth) * 2 - 1,
            -(event.clientY / renderer.domElement.clientHeight) * 2 + 1
        );
        
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, camera);
        
        // First check for anchor intersection to toggle smooth/corner
        let hitAnchor = false;
        for (let i = 0; i < loftBezierAnchors.length; i++) {
            const anchor = loftBezierAnchors[i];
            if (anchor.anchorMesh && raycaster.intersectObject(anchor.anchorMesh).length > 0) {
                toggleLoftAnchorSmooth(i);
                hitAnchor = true;
                break;
            }
        }
        
        // If no anchor was hit, check if we hit the curve line to add a new point
        if (!hitAnchor && curveLine) {
            // Check both the visible line and the hit area
            const objectsToCheck: THREE.Object3D[] = [curveLine];
            const hitArea = curveLine.getObjectByName('curveHitArea');
            if (hitArea) objectsToCheck.push(hitArea);
            
            const intersects = raycaster.intersectObjects(objectsToCheck, true);
            if (intersects.length > 0) {
                const clickedPoint = intersects[0].point;
                
                // Simple approach: find insertion point based on Y coordinate
                // This matches user visual expectations better than complex bezier math
                const clickY = clickedPoint.y;
                let insertIndex = 1; // Default to after first point
                
                // Find where this Y coordinate should be inserted based on anchor positions
                // We want to insert AFTER the anchor whose Y is less than clickY
                for (let i = 0; i < loftBezierAnchors.length; i++) {
                    const anchorY = loftBezierAnchors[i].position.y;
                    
                    if (clickY < anchorY) {
                        // Insert before this anchor
                        insertIndex = i;
                        break;
                    } else if (i === loftBezierAnchors.length - 1) {
                        // Insert after the last anchor
                        insertIndex = i;
                        break;
                    }
                }
                
                // Create new anchor at the clicked position
                const newAnchor: LoftBezierAnchor = {
                    position: new THREE.Vector3(
                        Math.max(0.1, clickedPoint.x), 
                        clickY, 
                        0
                    ),
                    handleIn: new THREE.Vector3(0, -0.1, 0),
                    handleOut: new THREE.Vector3(0, 0.1, 0),
                    isSmooth: true
                };
                
                // Insert the new anchor
                loftBezierAnchors.splice(insertIndex, 0, newAnchor);
                
                // Update everything
                updateLoftAnchorMeshes();
                updateLoftCurveLine();
                updateLoftGeometry();
            }
        }
    });
    
    // Keyboard events
    keydownListener = (event: KeyboardEvent) => {
        // Delete key - remove selected anchor
        if (event.key === 'Delete' || event.key === 'Backspace') {
            if (selectedAnchorIndex !== null && 
                selectedAnchorIndex > 0 && 
                selectedAnchorIndex < loftBezierAnchors.length - 1) {
                
                const anchor = loftBezierAnchors[selectedAnchorIndex];
                
                // Remove meshes
                if (anchor.anchorMesh) scene.remove(anchor.anchorMesh);
                if (anchor.handleInMesh) scene.remove(anchor.handleInMesh);
                if (anchor.handleOutMesh) scene.remove(anchor.handleOutMesh);
                if (anchor.handleLineIn) scene.remove(anchor.handleLineIn);
                if (anchor.handleLineOut) scene.remove(anchor.handleLineOut);
                
                // Remove anchor from array
                loftBezierAnchors.splice(selectedAnchorIndex, 1);
                selectedAnchorIndex = null;
                
                // Update everything
                updateLoftAnchorMeshes();
                updateLoftCurveLine();
                updateLoftGeometry();
            }
        }
    };
    window.addEventListener('keydown', keydownListener);
}

// Initialize GUI controls
function initLoftGUI() {
    loftGUI = new dat.GUI({ width: 300 });
    loftGUI.domElement.style.position = 'absolute';
    loftGUI.domElement.style.top = '0';
    loftGUI.domElement.style.right = '0';
    
    // Loft parameters folder
    const loftFolder = loftGUI.addFolder('Loft Parameters');
    loftFolder.add(loftParams, 'rings', 3, 400, 1).name('Rings').onChange(updateLoftGeometry);
    loftFolder.add(loftParams, 'segments', 3, 400, 1).name('Segments').onChange(updateLoftGeometry);
    loftFolder.open();
    
    // Display options folder
    const displayFolder = loftGUI.addFolder('Display Options');
    displayFolder.add(loftParams, 'showWireframe').name('Show Wireframe').onChange(() => {
        if (wireframeMesh) {
            wireframeMesh.visible = loftParams.showWireframe;
        } else {
            updateLoftGeometry();
        }
    });
    displayFolder.add(loftParams, 'showDisplacedWireframe').name('Show Displaced Wireframe').onChange(() => {
        updateDisplacedWireframe();
    });
    displayFolder.add(loftParams, 'showNormals').name('Show Normals').onChange(() => {
        updateNormalsHelper();
    });
    displayFolder.add(loftParams, 'normalType', ['vertex', 'face', 'horizontal']).name('Normal Type').onChange(() => {
        // Update normals visualization
        if (loftParams.showNormals) {
            updateNormalsHelper();
        }
        // If we have displacement, rebuild geometry with new normal type
        if (currentTexture && (loftParams.displacementScale !== 0 || loftParams.displacementBias !== 0)) {
            updateLoftGeometry();
        }
    });
    displayFolder.add(loftParams, 'normalsLength', 0.05, 1.0, 0.05).name('Normals Length').onChange(() => {
        if (loftParams.showNormals) {
            updateNormalsHelper();
        }
    });
    displayFolder.add(loftParams, 'normalsOffset', 0.0, 0.5, 0.01).name('Normals Offset').onChange(() => {
        if (loftParams.showNormals) {
            updateNormalsHelper();
        }
    });
    displayFolder.open();
    
    // Smoothing controls are applied by default (enabled), not exposed in UI
    
    // Profile curve controls removed from UI (displacement-centric workflow)
    
    // Texture controls folder
    const textureFolder = loftGUI.addFolder('Texture');
    
    // Add file input for texture
    textureFolder.add({
        loadTexture: () => {
            // Create a file input element
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.style.display = 'none';
            
            input.onchange = async (event) => {
                const file = (event.target as HTMLInputElement).files?.[0];
                if (file) {
                    try {
                        const texture = await loadImageTexture(file);
                        applyTextureToLoft(texture);

                    } catch (error) {
                        console.error('Failed to load texture:', error);
                        alert('Failed to load texture. Please try a different image file.');
                    }
                }
                // Clean up
                document.body.removeChild(input);
            };
            
            // Trigger file dialog
            document.body.appendChild(input);
            input.click();
        }
    }, 'loadTexture').name('Load Image');
    
    // Remove texture button
    textureFolder.add({
        removeTexture: () => {
            if (currentTexture) {
                currentTexture.dispose();
                currentTexture = null;
            }
            if (loftMesh && loftMesh.material instanceof THREE.Material) {
                loftMesh.material.dispose();
                // Reset to default material
                const defaultMaterial = new THREE.MeshStandardMaterial({
                    color: 0x3b82f6,
                    metalness: 0.3,
                    roughness: 0.6,
                    side: THREE.DoubleSide
                });
                loftMesh.material = defaultMaterial;
            }
            
            // Caps remain solid colored - no changes needed
            
            // Reset displacement parameters
            loftParams.displacementScale = 0.0;
            loftParams.displacementBias = 0.0;
            
            // Recreate caps to ensure proper welding after displacement reset
            updateLoftGeometry();
        }
    }, 'removeTexture').name('Remove Texture');
    
    // Texture repeat controls
    textureFolder.add(loftParams, 'textureRepeatU', 0.1, 10, 0.1)
        .name('Repeat U (Around)')
        .onChange(updateTextureRepeat);
    
    textureFolder.add(loftParams, 'textureRepeatV', 0.1, 10, 0.1)
        .name('Repeat V (Height)')
        .onChange(updateTextureRepeat);
    
    // Texture rotation/twist control
    textureFolder.add(loftParams, 'textureRotation', 0, 360, 1)
        .name('Texture Twist (°)')
        .onChange(() => {
            updateLoftGeometry(); // Rebuild geometry with new UV rotation
        });
    
    // Toggle showing the texture without affecting displacement
    textureFolder.add(loftParams, 'showTexture')
        .name('Show Image')
        .onChange(() => {
            if (loftMesh && loftMesh.material instanceof THREE.MeshStandardMaterial) {
                // Dispose of old material to force complete refresh
                const oldMat = loftMesh.material;
                oldMat.dispose();
                
                // Create new material with updated settings
                const newMat = new THREE.MeshStandardMaterial({
                    map: (loftParams.showTexture && currentTexture) ? currentTexture : null,
                    color: (loftParams.showTexture && currentTexture) ? 0xffffff : 0x3b82f6,
                    metalness: 0.3,
                    roughness: 0.6,
                    side: THREE.DoubleSide
                });
                
                // Apply opacity blending if needed
                if (loftParams.showTexture && currentTexture && loftParams.textureOpacity < 1.0) {
                    setupTextureOpacityBlending(newMat);
                }
                
                loftMesh.material = newMat;
                
                // Force a render update
                renderer.render(scene, camera);
            }
        });
    
    // Texture opacity (visual only)
    textureFolder.add(loftParams, 'textureOpacity', 0, 1, 0.01)
        .name('Image Opacity')
        .onChange(() => {
            // Update material blending without affecting displacement
            if (loftMesh && loftMesh.material instanceof THREE.MeshStandardMaterial && loftMesh.material.map) {
                // Dispose of old material
                const oldMat = loftMesh.material;
                oldMat.dispose();
                
                // Create new material
                const newMat = new THREE.MeshStandardMaterial({
                    map: currentTexture,
                    color: 0xffffff,
                    metalness: 0.3,
                    roughness: 0.6,
                    side: THREE.DoubleSide
                });
                
                // Apply opacity blending
                if (loftParams.textureOpacity < 1.0) {
                    setupTextureOpacityBlending(newMat);
                }
                
                loftMesh.material = newMat;
                
                // Force render update
                renderer.render(scene, camera);
            }
        });
    
    // Displacement controls
    textureFolder.add(loftParams, 'displacementScale', -2, 2, 0.01)
        .name('Displacement Scale')
        .onChange(updateDisplacement)
        .listen();
    
    textureFolder.add(loftParams, 'displacementBias', -1, 1, 0.01)
        .name('Displacement Bias')
        .onChange(updateDisplacement)
        .listen();
    
    // Displacement falloff controls
    const falloffFolder = textureFolder.addFolder('Displacement Falloff');
    
    falloffFolder.add(loftParams, 'falloffEnabled')
        .name('Enable Falloff')
        .onChange(updateDisplacement);
    
    falloffFolder.add(loftParams, 'falloffTop', 0, 0.5, 0.01)
        .name('Top Falloff')
        .onChange(() => {
            // Ensure top and bottom don't overlap
            if (loftParams.falloffTop + loftParams.falloffBottom > 0.95) {
                loftParams.falloffTop = 0.95 - loftParams.falloffBottom;
            }
            updateDisplacement();
            updateFalloffIndicators();
        });
    
    falloffFolder.add(loftParams, 'falloffBottom', 0, 0.5, 0.01)
        .name('Bottom Falloff')
        .onChange(() => {
            // Ensure top and bottom don't overlap
            if (loftParams.falloffTop + loftParams.falloffBottom > 0.95) {
                loftParams.falloffBottom = 0.95 - loftParams.falloffTop;
            }
            updateDisplacement();
            updateFalloffIndicators();
        });
    
    falloffFolder.add(loftParams, 'falloffPower', 0.5, 4, 0.1)
        .name('Falloff Curve')
        .onChange(updateDisplacement);
    
    falloffFolder.add(loftParams, 'showFalloffZones')
        .name('Show Zones')
        .onChange(updateFalloffIndicators);
    
    falloffFolder.open();
    textureFolder.open();
    
    // Export controls folder
    const exportFolder = loftGUI.addFolder('Export Model');
    
    // Add export scale control
    exportFolder.add(loftParams, 'exportScale', 0.1, 100, 0.1)
        .name('Export Scale')
        .onChange(() => {

        });
    
    exportFolder.add({
        exportSTL: () => {
            exportSTL();
        }
    }, 'exportSTL').name('Export as STL (ASCII)');
    
    exportFolder.add({
        exportSTLBinary: () => {
            exportSTLBinary();
        }
    }, 'exportSTLBinary').name('Export as STL (Binary)');
    
    exportFolder.add({
        exportOBJ: () => {
            exportOBJ();
        }
    }, 'exportOBJ').name('Export as OBJ');
    
    // Add info about export formats
    exportFolder.add({
        info: () => {
            alert(
                'Export Formats:\n\n' +
                'STL (ASCII): Standard 3D printing format, human-readable but larger file size\n' +
                'STL (Binary): Same as ASCII STL but smaller file size, recommended for 3D printing\n' +
                'OBJ: Universal 3D format, preserves UV coordinates and can be imported into most 3D software\n\n' +
                'Export Scale: Multiplies the model size by the specified factor.\n' +
                'Default is 10x to convert from scene units to millimeters for 3D printing.\n\n' +
                'All exports include the main body and caps as a single watertight mesh with corrected normals.'
            );
        }
    }, 'info').name('ℹ️ Format Info');
    
    exportFolder.open();
}

// Load image as texture
function loadImageTexture(file: File): Promise<THREE.Texture> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                const texture = new THREE.Texture(img);
                texture.needsUpdate = true;
                texture.wrapS = THREE.RepeatWrapping;
                texture.wrapT = THREE.RepeatWrapping;
                texture.repeat.set(loftParams.textureRepeatU, loftParams.textureRepeatV);
                resolve(texture);
            };
            img.onerror = reject;
            img.src = event.target?.result as string;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// Apply texture to the loft mesh
function applyTextureToLoft(texture: THREE.Texture) {
    currentTexture = texture;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(loftParams.textureRepeatU, loftParams.textureRepeatV);
    texture.needsUpdate = true;
    
    // Update the material to show the texture
    if (loftMesh && loftMesh.material instanceof THREE.MeshStandardMaterial) {
        // Dispose old material and create new one to ensure proper update
        const oldMat = loftMesh.material;
        oldMat.dispose();
        
        // Create new material with texture
        const newMat = new THREE.MeshStandardMaterial({
            map: loftParams.showTexture ? texture : null,
            color: loftParams.showTexture ? 0xffffff : 0x3b82f6,
            metalness: 0.3,
            roughness: 0.6,
            side: THREE.DoubleSide
        });
        
        // Apply opacity blending if needed
        if (loftParams.showTexture && loftParams.textureOpacity < 1.0) {
            setupTextureOpacityBlending(newMat);
        }
        
        loftMesh.material = newMat;
        
        // Force immediate render
        renderer.render(scene, camera);
    }
    
    // Only regenerate geometry if displacement is actually active
    if (loftParams.displacementScale !== 0 || loftParams.displacementBias !== 0) {
        updateLoftGeometry();
    }
}

// Update texture repeat and displacement
function updateTextureRepeat() {
    if (currentTexture) {
        currentTexture.repeat.set(loftParams.textureRepeatU, loftParams.textureRepeatV);
        currentTexture.needsUpdate = true;
        
        // Always regenerate geometry when texture repeat changes to update displacement
        // This ensures displacement is recalculated with new UV mapping
        updateLoftGeometry();
    }
}

// Update displacement settings
function updateDisplacement() {
    // Constrain displacement to prevent extreme deformation
    loftParams.displacementScale = Math.max(-2, Math.min(2, loftParams.displacementScale));
    loftParams.displacementBias = Math.max(-1, Math.min(1, loftParams.displacementBias));
    
    // Regenerate entire geometry with new displacement
    updateLoftGeometry();
}

// Calculate displacement falloff value based on height (0 to 1)
function calculateDisplacementFalloff(normalizedHeight: number, params: typeof loftParams): number {
    if (!params.falloffEnabled) {
        return 1.0; // No falloff, full displacement everywhere
    }
    
    const { falloffTop, falloffBottom, falloffPower } = params;
    
    // Bottom falloff zone
    if (normalizedHeight < falloffBottom) {
        // Smooth transition from 0 at bottom to 1 at end of falloff zone
        const t = normalizedHeight / falloffBottom;
        return Math.pow(t, falloffPower);
    }
    
    // Top falloff zone
    if (normalizedHeight > (1 - falloffTop)) {
        // Smooth transition from 1 at start of falloff zone to 0 at top
        const t = (1 - normalizedHeight) / falloffTop;
        return Math.pow(t, falloffPower);
    }
    
    // Middle zone - full displacement
    return 1.0;
}

// Calculate face normals for each vertex (average of adjacent face normals)
function calculateFaceNormalsForVertices(geometry: THREE.BufferGeometry): Map<number, THREE.Vector3> {
    const positions = geometry.getAttribute('position');
    const index = geometry.getIndex();
    const vertexFaceNormals = new Map<number, THREE.Vector3>();
    
    // Initialize normals for each vertex
    for (let i = 0; i < positions.count; i++) {
        vertexFaceNormals.set(i, new THREE.Vector3());
    }
    
    // Helper vectors
    const vA = new THREE.Vector3();
    const vB = new THREE.Vector3();
    const vC = new THREE.Vector3();
    const cb = new THREE.Vector3();
    const ab = new THREE.Vector3();
    const faceNormal = new THREE.Vector3();
    
    if (index) {
        // Indexed geometry
        for (let i = 0; i < index.count; i += 3) {
            const a = index.getX(i);
            const b = index.getX(i + 1);
            const c = index.getX(i + 2);
            
            vA.fromBufferAttribute(positions, a);
            vB.fromBufferAttribute(positions, b);
            vC.fromBufferAttribute(positions, c);
            
            // Calculate face normal
            cb.subVectors(vC, vB);
            ab.subVectors(vA, vB);
            faceNormal.crossVectors(cb, ab).normalize();
            
            // Ensure face normal points outward
            const centerX = (vA.x + vB.x + vC.x) / 3;
            const centerZ = (vA.z + vB.z + vC.z) / 3;
            const radialLength = Math.sqrt(centerX * centerX + centerZ * centerZ);
            if (radialLength > 0.001) {
                const radialX = centerX / radialLength;
                const radialZ = centerZ / radialLength;
                const dotProduct = faceNormal.x * radialX + faceNormal.z * radialZ;
                if (dotProduct < 0) {
                    faceNormal.multiplyScalar(-1);
                }
            }
            
            // Add this face normal to each vertex of the triangle
            vertexFaceNormals.get(a)!.add(faceNormal);
            vertexFaceNormals.get(b)!.add(faceNormal);
            vertexFaceNormals.get(c)!.add(faceNormal);
        }
    }
    
    // Normalize all vertex normals
    vertexFaceNormals.forEach((normal) => {
        normal.normalize();
    });
    
    return vertexFaceNormals;
}

// Ensure all normals point outward from the cylinder center (Y-axis)
function ensureNormalsPointOutward(geometry: THREE.BufferGeometry): void {
    const positions = geometry.getAttribute('position');
    const normals = geometry.getAttribute('normal');
    
    if (!positions || !normals) return;
    
    for (let i = 0; i < positions.count; i++) {
        // Get vertex position
        const x = positions.getX(i);
        const z = positions.getZ(i);
        
        // Get normal direction
        const nx = normals.getX(i);
        const ny = normals.getY(i);
        const nz = normals.getZ(i);
        
        // Calculate radial direction from Y-axis (cylinder center)
        const radialLength = Math.sqrt(x * x + z * z);
        if (radialLength > 0.001) {
            const radialX = x / radialLength;
            const radialZ = z / radialLength;
            
            // Check if normal points inward (negative dot product with radial direction)
            const dotProduct = nx * radialX + nz * radialZ;
            if (dotProduct < 0) {
                // Flip the normal to point outward
                normals.setXYZ(i, -nx, -ny, -nz);
            }
        }
    }
    
    normals.needsUpdate = true;
}

// Recalculate smooth normals for the lathe geometry
function recalculateSmoothNormals(geometry: THREE.BufferGeometry, segments: number, rings: number): void {
    const positions = geometry.getAttribute('position');
    const normals = geometry.getAttribute('normal');
    const vertsPerRing = segments + 1;
    
    for (let ring = 0; ring < rings; ring++) {
        for (let seg = 0; seg <= segments; seg++) {
            const idx = ring * vertsPerRing + seg;
            
            // Get current position
            const x = positions.getX(idx);
            // const y = positions.getY(idx); // Currently unused
            const z = positions.getZ(idx);
            
            // Calculate radius at this point
            // const radius = Math.sqrt(x * x + z * z); // Currently unused
            
            // Calculate slope by looking at neighboring rings
            let radiusSlope = 0;
            if (ring > 0 && ring < rings - 1) {
                // Get positions above and below
                const idxPrev = (ring - 1) * vertsPerRing + seg;
                const idxNext = (ring + 1) * vertsPerRing + seg;
                
                const xPrev = positions.getX(idxPrev);
                const zPrev = positions.getZ(idxPrev);
                const yPrev = positions.getY(idxPrev);
                const radiusPrev = Math.sqrt(xPrev * xPrev + zPrev * zPrev);
                
                const xNext = positions.getX(idxNext);
                const zNext = positions.getZ(idxNext);
                const yNext = positions.getY(idxNext);
                const radiusNext = Math.sqrt(xNext * xNext + zNext * zNext);
                
                radiusSlope = (radiusNext - radiusPrev) / (yNext - yPrev);
            }
            
            // Calculate normal considering the slope
            const theta = Math.atan2(z, x);
            const cosTheta = Math.cos(theta);
            const sinTheta = Math.sin(theta);
            
            // The normal accounts for the change in radius along height
            const tangentY = new THREE.Vector3(-radiusSlope * cosTheta, 1, -radiusSlope * sinTheta);
            const tangentTheta = new THREE.Vector3(-sinTheta, 0, cosTheta);
            const normal = new THREE.Vector3().crossVectors(tangentTheta, tangentY).normalize();
            
            normals.setXYZ(idx, normal.x, normal.y, normal.z);
        }
    }
    
    normals.needsUpdate = true;
}

// Smooth displaced geometry to reduce artifacts
function smoothDisplacedGeometry(geometry: THREE.BufferGeometry, segments: number, rings: number, passes: number = 2): void {
    const positions = geometry.getAttribute('position');
    const vertsPerRing = segments + 1;
    
    // Multiple smoothing passes for better results
    for (let pass = 0; pass < passes; pass++) {
        // Create a copy of positions for smoothing
        const smoothedPositions = new Float32Array(positions.array.length);
        
        for (let ring = 0; ring < rings; ring++) {
            for (let seg = 0; seg <= segments; seg++) {
                const idx = ring * vertsPerRing + seg;
                
                // Get current position
                const x = positions.getX(idx);
                const y = positions.getY(idx);
                const z = positions.getZ(idx);
                
                // For cap rings, don't smooth (keep them flat)
                if (ring === 0 || ring === rings - 1) {
                    smoothedPositions[idx * 3] = x;
                    smoothedPositions[idx * 3 + 1] = y;
                    smoothedPositions[idx * 3 + 2] = z;
                    continue;
                }
                
                // Calculate smoothed position using more neighbors
                let sumX = 0, sumY = 0, sumZ = 0;
                let totalWeight = 0;
                
                // Current vertex (higher weight)
                const centerWeight = 0.4;
                sumX += x * centerWeight;
                sumY += y * centerWeight;
                sumZ += z * centerWeight;
                totalWeight += centerWeight;
                
                // Vertical neighbors (rings above and below)
                const verticalWeight = 0.2;
                for (let ringOffset = -2; ringOffset <= 2; ringOffset++) {
                    if (ringOffset === 0) continue;
                    const neighborRing = ring + ringOffset;
                    if (neighborRing >= 0 && neighborRing < rings) {
                        const neighborIdx = neighborRing * vertsPerRing + seg;
                        const weight = verticalWeight / Math.abs(ringOffset);
                        sumX += positions.getX(neighborIdx) * weight;
                        sumY += positions.getY(neighborIdx) * weight;
                        sumZ += positions.getZ(neighborIdx) * weight;
                        totalWeight += weight;
                    }
                }
                
                // Horizontal neighbors (adjacent segments)
                const horizontalWeight = 0.1;
                for (let segOffset = -1; segOffset <= 1; segOffset++) {
                    if (segOffset === 0) continue;
                    let neighborSeg = seg + segOffset;
                    // Handle wrap-around for circular geometry
                    if (neighborSeg < 0) neighborSeg = segments - 1;
                    if (neighborSeg > segments) neighborSeg = 1;
                    
                    const neighborIdx = ring * vertsPerRing + neighborSeg;
                    sumX += positions.getX(neighborIdx) * horizontalWeight;
                    sumY += positions.getY(neighborIdx) * horizontalWeight;
                    sumZ += positions.getZ(neighborIdx) * horizontalWeight;
                    totalWeight += horizontalWeight;
                }
                
                // Normalize by total weight
                smoothedPositions[idx * 3] = sumX / totalWeight;
                smoothedPositions[idx * 3 + 1] = sumY / totalWeight;
                smoothedPositions[idx * 3 + 2] = sumZ / totalWeight;
            }
        }
        
        // Apply smoothed positions back
        for (let i = 0; i < positions.count; i++) {
            positions.setXYZ(
                i,
                smoothedPositions[i * 3],
                smoothedPositions[i * 3 + 1],
                smoothedPositions[i * 3 + 2]
            );
        }
    }
    
    // Ensure seam vertices remain matched after smoothing
    for (let ring = 0; ring < rings; ring++) {
        const firstIdx = ring * vertsPerRing;
        const lastIdx = ring * vertsPerRing + segments;
        
        const firstX = positions.getX(firstIdx);
        const firstY = positions.getY(firstIdx);
        const firstZ = positions.getZ(firstIdx);
        
        positions.setXYZ(lastIdx, firstX, firstY, firstZ);
    }
    
    positions.needsUpdate = true;
}

// Apply displacement directly to geometry vertices for watertight caps
function applyDisplacementToGeometry(geometry: THREE.BufferGeometry, texture: THREE.Texture | null, scale: number, bias: number, useVertexNormals: boolean = true): void {
    if (!texture) return;
    
    try {
        const positions = geometry.getAttribute('position');
        const normals = geometry.getAttribute('normal');
        const uvs = geometry.getAttribute('uv');
        // const index = geometry.getIndex(); // Currently unused
        
        // First, ensure all normals point outward from the cylinder center
        ensureNormalsPointOutward(geometry);
        
        // If using face normals, calculate them
        let faceNormalsMap: Map<number, THREE.Vector3> | null = null;
        if (!useVertexNormals) {
            faceNormalsMap = calculateFaceNormalsForVertices(geometry);
        }
        
        if (!texture.image) {
            console.warn('Texture image not loaded yet, skipping displacement');
            return;
        }
        
        // Create canvas to read texture data
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d')!;
        canvas.width = texture.image.width;
        canvas.height = texture.image.height;
        ctx.drawImage(texture.image, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        
        // Minimum radius to ensure watertight geometry
        const minRadius = 0.1;
        

        
        // Store displacement values for seam vertices (first vertex of each ring)
        const seamDisplacements: number[] = [];
        const vertsPerRing = loftParams.segments + 1;
        const numRings = Math.floor(positions.count / vertsPerRing);
        
        // First pass: calculate displacement for first vertex of each ring
        for (let ring = 0; ring < numRings; ring++) {
            const i = ring * vertsPerRing; // First vertex of the ring
            const u = 0; // First vertex is always at U=0
            const v = uvs.getY(i);
            
            // Apply texture repeat for sampling
            const uSample = (u * loftParams.textureRepeatU) % 1.0;
            const vSample = (v * loftParams.textureRepeatV) % 1.0;
            
            // Sample texture at UV coordinate with repeat
            const x = Math.floor(uSample * (canvas.width - 1));
            const y = Math.floor((1 - vSample) * (canvas.height - 1)); // Flip V coordinate
            const pixelIndex = (y * canvas.width + x) * 4;
            
            // Get grayscale value (0-1) from red channel
            let displacement = (imageData.data[pixelIndex] / 255) * scale + bias;
            
            // Apply falloff to seam displacement as well
            const normalizedHeight = v; // V coordinate is already 0-1 from bottom to top
            const falloffMultiplier = calculateDisplacementFalloff(normalizedHeight, loftParams);
            displacement *= falloffMultiplier;
            
            seamDisplacements.push(displacement);
        }
        
        // Apply displacement to each vertex
        for (let i = 0; i < positions.count; i++) {
            const ringIndex = Math.floor(i / vertsPerRing);
            const vertexInRing = i % vertsPerRing;
            
            let displacement: number;
            
            // For seam vertices (first and last vertex of each ring), ensure they get the same displacement
            if (vertexInRing === 0) {
                // This is the first vertex (U=0), use pre-calculated seam displacement
                displacement = seamDisplacements[ringIndex];
            } else if (vertexInRing === loftParams.segments) {
                // This is the last vertex (U=1), use the same displacement as first vertex
                displacement = seamDisplacements[ringIndex];
            } else {
                // Regular vertex, sample normally
                const u = uvs.getX(i);
                const v = uvs.getY(i);
                
                // Apply texture repeat for sampling
                const uSample = (u * loftParams.textureRepeatU) % 1.0;
                const vSample = (v * loftParams.textureRepeatV) % 1.0;
                
                // Sample texture at UV coordinate with repeat
                const x = Math.floor(uSample * (canvas.width - 1));
                const y = Math.floor((1 - vSample) * (canvas.height - 1)); // Flip V coordinate
                const pixelIndex = (y * canvas.width + x) * 4;
                
                // Get grayscale value (0-1) from red channel
                displacement = (imageData.data[pixelIndex] / 255) * scale + bias;
            }
            
            // Apply falloff based on normalized height (V coordinate represents height)
            const normalizedHeight = uvs.getY(i); // V coordinate is already 0-1 from bottom to top
            const falloffMultiplier = calculateDisplacementFalloff(normalizedHeight, loftParams);
            displacement *= falloffMultiplier;
            
            // Get the appropriate normal (vertex or face)
            let normalX, normalY, normalZ;
            if (useVertexNormals) {
                // Use smooth vertex normals
                normalX = normals.getX(i);
                normalY = normals.getY(i);
                normalZ = normals.getZ(i);
            } else {
                // Use face normals
                const faceNormal = faceNormalsMap!.get(i);
                if (faceNormal) {
                    normalX = faceNormal.x;
                    normalY = faceNormal.y;
                    normalZ = faceNormal.z;
                } else {
                    // Fallback to vertex normal if face normal not found
                    normalX = normals.getX(i);
                    normalY = normals.getY(i);
                    normalZ = normals.getZ(i);
                }
            }
            
            const currentX = positions.getX(i);
            const currentY = positions.getY(i);
            const currentZ = positions.getZ(i);
            
            // Check if this is a cap ring (first or last ring)
            const isCapRing = (ringIndex === 0 || ringIndex === numRings - 1);
            
            // Calculate new position based on normal type
            let newX, newY, newZ;
            
            if (loftParams.normalType === 'horizontal') {
                // Horizontal displacement mode: only displace in X and Z directions
                // Normalize the horizontal component of the normal
                const horizontalLength = Math.sqrt(normalX * normalX + normalZ * normalZ);
                if (horizontalLength > 0.001) {
                    const horizontalNormalX = normalX / horizontalLength;
                    const horizontalNormalZ = normalZ / horizontalLength;
                    newX = currentX + horizontalNormalX * displacement;
                    newY = currentY; // No vertical displacement
                    newZ = currentZ + horizontalNormalZ * displacement;
                } else {
                    // If normal has no horizontal component, don't displace
                    newX = currentX;
                    newY = currentY;
                    newZ = currentZ;
                }
            } else {
                // Original displacement modes (vertex or face normals)
                // For cap rings, only apply horizontal displacement to maintain flat caps
                newX = currentX + normalX * displacement;
                newY = isCapRing ? currentY : (currentY + normalY * displacement);
                newZ = currentZ + normalZ * displacement;
            }
            
            // Ensure minimum radius is maintained (distance from Y axis)
            const newRadius = Math.sqrt(newX * newX + newZ * newZ);
            if (newRadius < minRadius) {
                const scaleFactor = minRadius / newRadius;
                positions.setXYZ(
                    i,
                    newX * scaleFactor,
                    newY,
                    newZ * scaleFactor
                );
            } else {
                positions.setXYZ(
                    i,
                    newX,
                    newY,
                    newZ
                );
            }
        }
        
        // Final pass: Explicitly ensure seam vertices are identical
        // Copy the position of the first vertex to the last vertex for each ring
        for (let ring = 0; ring < numRings; ring++) {
            const firstVertexIndex = ring * vertsPerRing;
            const lastVertexIndex = ring * vertsPerRing + loftParams.segments;
            
            // Copy exact position from first to last vertex
            const firstX = positions.getX(firstVertexIndex);
            const firstY = positions.getY(firstVertexIndex);
            const firstZ = positions.getZ(firstVertexIndex);
            
            positions.setXYZ(lastVertexIndex, firstX, firstY, firstZ);
        }
        
        positions.needsUpdate = true;
        
        // Recalculate smooth normals for better shading
        recalculateSmoothNormals(geometry, loftParams.segments, numRings);
        
        // Apply smoothing to reduce artifacts
        if (Math.abs(scale) > 0.01 && loftParams.smoothingIntensity > 0) {
            smoothDisplacedGeometry(geometry, loftParams.segments, numRings, loftParams.smoothingIntensity);
            
            // Recompute normals after smoothing for better shading
            recalculateSmoothNormals(geometry, loftParams.segments, numRings);
            
            // Ensure normals still point outward after recalculation
            ensureNormalsPointOutward(geometry);
        }
        

    } catch (error) {
        console.error('Error applying displacement:', error);
    }
}

// Note: fixGeometryForExport is now replaced by the export-utils module
// which handles scaling and axis swapping without modifying the viewer
// The new approach creates a clone for export, preserving the original mesh

// Export the current model as STL (ASCII)
function exportSTL() {
    if (!loftMesh) {
        alert('No model to export. Please create a model first.');
        return;
    }
    
    // Create a group containing cloned mesh parts (don't modify originals)
    const exportGroup = new THREE.Group();
    
    // Clone the main loft mesh
    if (loftMesh) {
        const loftClone = loftMesh.clone();
        exportGroup.add(loftClone);
    }
    
    // Clone and add caps if they exist
    if (capMeshes.bottom) {
        const bottomCapClone = capMeshes.bottom.clone();
        exportGroup.add(bottomCapClone);
    }
    if (capMeshes.top) {
        const topCapClone = capMeshes.top.clone();
        exportGroup.add(topCapClone);
    }
    
    // Export using the new export utility (with Y-Z swap for 3D printing)
    exportMesh(exportGroup, 'stl', 'loft_model', loftParams.exportScale, true);

}

// Export the current model as OBJ
function exportOBJ() {
    if (!loftMesh) {
        alert('No model to export. Please create a model first.');
        return;
    }
    
    // Create a group containing cloned mesh parts (don't modify originals)
    const exportGroup = new THREE.Group();
    
    // Clone the main loft mesh
    if (loftMesh) {
        const loftClone = loftMesh.clone();
        exportGroup.add(loftClone);
    }
    
    // Clone and add caps if they exist
    if (capMeshes.top) {
        const topCapClone = capMeshes.top.clone();
        exportGroup.add(topCapClone);
    }
    
    // Export using the new export utility (with Y-Z swap for 3D printing)
    exportMesh(exportGroup, 'obj', 'loft_model', loftParams.exportScale, true);

}

// Export the current model as binary STL (smaller file size)
function exportSTLBinary() {
    if (!loftMesh) {
        alert('No model to export. Please create a model first.');
        return;
    }
    
    // Create a group containing cloned mesh parts (don't modify originals)
    const exportGroup = new THREE.Group();
    
    // Clone the main loft mesh
    if (loftMesh) {
        const loftClone = loftMesh.clone();
        exportGroup.add(loftClone);
    }
    
    // Clone and add caps if they exist
    if (capMeshes.bottom) {
        const bottomCapClone = capMeshes.bottom.clone();
        exportGroup.add(bottomCapClone);
    }
    if (capMeshes.top) {
        const topCapClone = capMeshes.top.clone();
        exportGroup.add(topCapClone);
    }
    
    // Export using the new export utility (with Y-Z swap for 3D printing)
    // Binary STL is handled internally by the export utility
    exportMesh(exportGroup, 'stl', 'loft_model_binary', loftParams.exportScale, true);

}

// Create perfectly welded caps that match current cylinder geometry
function createWatertightCaps(): void {
    if (!loftMesh) {
        return;
    }
    

    
    // Remove existing caps
    if (capMeshes.bottom) {
        scene.remove(capMeshes.bottom);
        capMeshes.bottom.geometry.dispose();
        if (capMeshes.bottom.material instanceof THREE.Material) {
            capMeshes.bottom.material.dispose();
        }
        capMeshes.bottom = null;
    }
    
    if (capMeshes.top) {
        scene.remove(capMeshes.top);
        capMeshes.top.geometry.dispose();
        if (capMeshes.top.material instanceof THREE.Material) {
            capMeshes.top.material.dispose();
        }
        capMeshes.top = null;
    }
    
    // Create caps based on current cylinder geometry (after any displacement)
    const capGeometries = createWeldedCapGeometries(loftMesh.geometry, loftParams);
    
    // Create solid color cap material
    const capMaterial = new THREE.MeshStandardMaterial({
        color: 0x3b82f6,
        metalness: 0.3,
        roughness: 0.6,
        side: THREE.DoubleSide
    });
    
    // Create cap meshes
    capMeshes.bottom = new THREE.Mesh(capGeometries.bottom, capMaterial.clone());
    capMeshes.bottom.position.y = 0;
    scene.add(capMeshes.bottom);
    
    capMeshes.top = new THREE.Mesh(capGeometries.top, capMaterial.clone());
    capMeshes.top.position.y = 0;
    scene.add(capMeshes.top);
    

}

export function initLoftEditor(container: HTMLElement) {

    
    // Clear container and set background
    container.style.backgroundColor = '#1a1a1a';
    
    // Create scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a1a);

    // Create camera
    camera = new THREE.PerspectiveCamera(
        75,
        window.innerWidth / window.innerHeight,
        0.1,
        1000
    );
    camera.position.set(8, 4, 8);
    camera.lookAt(2, 2.5, 0); // Look at middle of cylinder

    // Create renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setClearColor(0x1a1a1a, 1);
    container.appendChild(renderer.domElement);

    // Add orbit controls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    // Add grid helper
    gridHelper = new THREE.GridHelper(10, 10, 0x444444, 0x222222);
    scene.add(gridHelper);

    // Add axes helper
    const axesHelper = new THREE.AxesHelper(5);
    scene.add(axesHelper);

    // Add lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 10, 5);
    directionalLight.castShadow = true;
    scene.add(directionalLight);

    // Initialize bezier curve system
    initLoftBezierAnchors();
    updateLoftAnchorMeshes();
    
    // Create the loft geometry
    updateLoftGeometry();
    
    // Initialize mouse interactions
    initLoftBezierInteractions();
    
    // Initialize GUI
    initLoftGUI();



    // Handle window resize
    window.addEventListener('resize', onWindowResize);

    // Start animation loop
    animate();
    

}

// Configure material to visually blend texture with base color using textureOpacity
function setupTextureOpacityBlending(material: THREE.MeshStandardMaterial) {
    // Only apply if we have a texture and opacity is less than 1
    if (!material.map || loftParams.textureOpacity >= 1.0) {
        material.onBeforeCompile = undefined as any;
        if ((material as any).userData) {
            (material as any).userData.shader = undefined;
        }
        material.needsUpdate = true;
        return;
    }

    const updateUniform = (shader: any) => {
        if (shader && shader.uniforms) {
            if (shader.uniforms.uMapOpacity) {
                shader.uniforms.uMapOpacity.value = Math.max(0, Math.min(1, loftParams.textureOpacity));
            }
            if (shader.uniforms.uBaseColor) {
                shader.uniforms.uBaseColor.value = new THREE.Color(0x3b82f6);
            }
        }
    };

    // Attach/refresh shader hook for opacity blending
    material.onBeforeCompile = (shader: any) => {
        shader.uniforms.uMapOpacity = { value: Math.max(0, Math.min(1, loftParams.textureOpacity)) };
        shader.uniforms.uBaseColor = { value: new THREE.Color(0x3b82f6) };
        
        // Add uniform declarations
        shader.fragmentShader = 'uniform float uMapOpacity;\nuniform vec3 uBaseColor;\n' + shader.fragmentShader;
        
        // Replace the standard map application with a controllable mix
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <map_fragment>',
            `#ifdef USE_MAP
                vec4 sampledDiffuseColor = texture2D( map, vMapUv );
                // Apply color space conversion
                sampledDiffuseColor = mapTexelToLinear( sampledDiffuseColor );
                // Mix blue base color with textured color by uMapOpacity
                vec3 blueBase = uBaseColor;
                vec3 withMap = sampledDiffuseColor.rgb;
                diffuseColor.rgb = mix( blueBase, withMap, uMapOpacity );
            #endif`
        );

        (material as any).userData.shader = shader;
        updateUniform(shader);
    };

    // If already compiled, just update the uniform
    const existing = (material as any).userData.shader;
    if (existing) {
        updateUniform(existing);
    } else {
        material.needsUpdate = true;
    }
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    animationId = requestAnimationFrame(animate);
    
    // Update controls
    controls.update();
    
    // Render the scene
    renderer.render(scene, camera);
}

export function disposeLoftEditor() {
    // Cancel animation loop
    if (animationId) {
        cancelAnimationFrame(animationId);
    }

    // Remove event listeners
    window.removeEventListener('resize', onWindowResize);
    if (keydownListener) {
        window.removeEventListener('keydown', keydownListener);
        keydownListener = null;
    }

    // Dispose of GUI
    if (loftGUI) {
        loftGUI.destroy();
    }
    
    // Dispose of texture
    if (currentTexture) {
        currentTexture.dispose();
        currentTexture = null;
    }
    
    // Clean up bezier anchors
    loftBezierAnchors.forEach(anchor => {
        if (anchor.anchorMesh) {
            scene.remove(anchor.anchorMesh);
            anchor.anchorMesh.geometry.dispose();
            (anchor.anchorMesh.material as THREE.Material).dispose();
        }
        if (anchor.handleInMesh) {
            scene.remove(anchor.handleInMesh);
            anchor.handleInMesh.geometry.dispose();
            (anchor.handleInMesh.material as THREE.Material).dispose();
        }
        if (anchor.handleOutMesh) {
            scene.remove(anchor.handleOutMesh);
            anchor.handleOutMesh.geometry.dispose();
            (anchor.handleOutMesh.material as THREE.Material).dispose();
        }
        if (anchor.handleLineIn) {
            scene.remove(anchor.handleLineIn);
            anchor.handleLineIn.geometry.dispose();
            (anchor.handleLineIn.material as THREE.Material).dispose();
        }
        if (anchor.handleLineOut) {
            scene.remove(anchor.handleLineOut);
            anchor.handleLineOut.geometry.dispose();
            (anchor.handleLineOut.material as THREE.Material).dispose();
        }
    });
    
    // Clean up curve line
    if (curveLine) {
        scene.remove(curveLine);
        curveLine.geometry.dispose();
        (curveLine.material as THREE.Material).dispose();
    }

    // Dispose of Three.js objects
    scene.traverse((child) => {
        if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
            if (child.material instanceof THREE.Material) {
                child.material.dispose();
            }
        } else if (child instanceof THREE.LineSegments) {
            child.geometry.dispose();
            if (child.material instanceof THREE.Material) {
                child.material.dispose();
            }
        }
    });
    
    // Clean up cap meshes specifically
    if (capMeshes.bottom) {
        capMeshes.bottom.geometry.dispose();
        if (capMeshes.bottom.material instanceof THREE.Material) {
            capMeshes.bottom.material.dispose();
        }
        capMeshes.bottom = null;
    }
    
    if (capMeshes.top) {
        capMeshes.top.geometry.dispose();
        if (capMeshes.top.material instanceof THREE.Material) {
            capMeshes.top.material.dispose();
        }
        capMeshes.top = null;
    }
    
    // Clean up falloff indicators
    if (falloffIndicators.bottom) {
        scene.remove(falloffIndicators.bottom);
        falloffIndicators.bottom.geometry.dispose();
        if (falloffIndicators.bottom.material instanceof THREE.Material) {
            falloffIndicators.bottom.material.dispose();
        }
        falloffIndicators.bottom = null;
    }
    
    if (falloffIndicators.top) {
        scene.remove(falloffIndicators.top);
        falloffIndicators.top.geometry.dispose();
        if (falloffIndicators.top.material instanceof THREE.Material) {
            falloffIndicators.top.material.dispose();
        }
        falloffIndicators.top = null;
    }
    
    // Clean up normals helper
    if (normalsHelper) {
        scene.remove(normalsHelper);
        normalsHelper.geometry.dispose();
        if (normalsHelper.material instanceof THREE.Material) {
            normalsHelper.material.dispose();
        }
        normalsHelper = null;
    }

    renderer.dispose();
    controls.dispose();
    
    // Clear the container
    if (renderer.domElement.parentElement) {
        renderer.domElement.parentElement.removeChild(renderer.domElement);
    }
} 