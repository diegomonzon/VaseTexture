import * as THREE from 'three';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter';
import { ExportFormat } from '../types';

/**
 * Exports a mesh to the specified format
 * @param mesh - The mesh to export
 * @param format - Export format ('stl' or 'obj')
 * @param filename - Name of the file (without extension)
 * @param scale - Scale factor for export
 * @param swapYZ - Whether to swap Y and Z axes for 3D printing
 */
export function exportMesh(
    mesh: THREE.Mesh | THREE.Group,
    format: ExportFormat,
    filename: string,
    scale: number = 1.0,
    swapYZ: boolean = true
): void {

    
    // Validate input mesh
    if (!mesh) {
        throw new Error('No mesh provided for export');
    }
    
    // Create a clone for export to avoid modifying the viewer
    const exportObject = createExportClone(mesh, scale, swapYZ);

    
    // Validate the cloned object has valid geometry
    if (exportObject instanceof THREE.Mesh) {
        if (!exportObject.geometry || exportObject.geometry.getAttribute('position').count === 0) {
            throw new Error('Export mesh has no valid geometry');
        }

    } else if (exportObject instanceof THREE.Group) {
        let totalVertices = 0;
        exportObject.traverse((child) => {
            if (child instanceof THREE.Mesh && child.geometry) {
                totalVertices += child.geometry.getAttribute('position').count;
            }
        });
        if (totalVertices === 0) {
            throw new Error('Export group has no valid geometry');
        }

    }
    
    let data: string | ArrayBuffer;
    let mimeType: string;
    let extension: string;
    
    // Helper function to safely get byte length
    const getByteLength = (data: string | ArrayBuffer): number => {
        if (data instanceof ArrayBuffer) {
            return data.byteLength;
        }
        return data.length;
    };
    
    try {
        switch (format) {
            case 'stl':
                const stlExporter = new STLExporter();
                // For STL, we need to handle both ASCII and binary formats
                // Check if filename contains 'binary' to determine format
                const isBinary = filename.toLowerCase().includes('binary');

                
                try {
                    const stlResult = stlExporter.parse(exportObject, { binary: isBinary });

                    
                    if (isBinary) {
                        // Binary STL should return ArrayBuffer, but let's handle different return types
                        if (stlResult instanceof ArrayBuffer) {
                            data = stlResult;

                        } else if (stlResult instanceof Uint8Array) {
                            // Sometimes STL exporter returns Uint8Array for binary
                            data = stlResult.buffer.slice(stlResult.byteOffset, stlResult.byteOffset + stlResult.byteLength);

                        } else if (stlResult && typeof stlResult === 'object' && 'buffer' in stlResult) {
                            // Handle case where result has a buffer property
                            const buffer = (stlResult as any).buffer;
                            if (buffer instanceof ArrayBuffer) {
                                data = buffer;

                            } else {
                                throw new Error(`Binary STL returned object with invalid buffer property: ${typeof buffer}`);
                            }
                        } else {
                            throw new Error(`Binary STL returned unexpected type: ${typeof stlResult}, constructor: ${stlResult?.constructor?.name}`);
                        }
                        
                        if (getByteLength(data) === 0) {
                            throw new Error('Binary STL export resulted in empty ArrayBuffer');
                        }
                        mimeType = 'application/octet-stream';
                    } else {
                        // ASCII STL returns string
                        if (typeof stlResult === 'string') {
                            data = stlResult;

                            if (data.length === 0) {
                                throw new Error('ASCII STL export resulted in empty string');
                            }
                        } else {
                            throw new Error(`Expected string for ASCII STL, got ${typeof stlResult}`);
                        }
                        mimeType = 'text/plain';
                    }
                    extension = 'stl';
                } catch (stlError) {
                    console.error('STL export error:', stlError);
                    throw new Error(`STL export failed: ${stlError}`);
                }
                break;
                
            case 'obj':
                const objExporter = new OBJExporter();
                data = objExporter.parse(exportObject);
                mimeType = 'text/plain';
                extension = 'obj';

                break;
                
            default:
                console.error(`Unsupported export format: ${format}`);
                return;
        }
        

        
        // Clean up the cloned object (not attached to scene, so just dispose geometry)
        if (exportObject instanceof THREE.Mesh && exportObject.geometry) {
            exportObject.geometry.dispose();
        } else if (exportObject instanceof THREE.Group) {
            exportObject.traverse((child) => {
                if (child instanceof THREE.Mesh && child.geometry) {
                    child.geometry.dispose();
                }
            });
        }
        
        // Download the file
        downloadFile(data, `${filename}.${extension}`, mimeType);

        
    } catch (error) {
        console.error('Export failed:', error);
        alert(`Export failed: ${error}`);
    }
}

/**
 * Creates a clone of a mesh for export with scaling and axis swapping
 * @param mesh - The mesh to clone
 * @param scale - Scale factor
 * @param swapYZ - Whether to swap Y and Z axes for 3D printing
 * @returns Cloned mesh ready for export
 */
function createExportClone(
    mesh: THREE.Mesh | THREE.Group,
    scale: number,
    swapYZ: boolean
): THREE.Mesh | THREE.Group {
    // Deep clone the mesh to avoid modifying the original
    const clone = mesh.clone(true);
    
    // Process the clone
    if (clone instanceof THREE.Mesh && clone.geometry) {
        clone.geometry = clone.geometry.clone();
        processGeometryForExport(clone.geometry, scale, swapYZ);
    } else if (clone instanceof THREE.Group) {
        clone.traverse((child) => {
            if (child instanceof THREE.Mesh && child.geometry) {
                child.geometry = child.geometry.clone();
                processGeometryForExport(child.geometry, scale, swapYZ);
            }
        });
    }
    
    // Reset transform since we've baked it into the geometry
    clone.position.set(0, 0, 0);
    clone.rotation.set(0, 0, 0);
    clone.scale.set(1, 1, 1);
    
    return clone;
}

/**
 * Processes geometry for export by applying scale and axis swapping
 * @param geometry - The geometry to process
 * @param scale - Scale factor
 * @param swapYZ - Whether to swap Y and Z axes
 */
function processGeometryForExport(
    geometry: THREE.BufferGeometry,
    scale: number,
    swapYZ: boolean
): void {
    const positions = geometry.getAttribute('position');
    
    if (positions) {
        // Apply transformations to each vertex
        for (let i = 0; i < positions.count; i++) {
            let x = positions.getX(i) * scale;
            let y = positions.getY(i) * scale;
            let z = positions.getZ(i) * scale;
            
            // Swap Y and Z for 3D printing (Z becomes vertical)
            if (swapYZ) {
                const tempY = y;
                y = z;
                z = tempY;
            }
            
            positions.setXYZ(i, x, y, z);
        }
        
        positions.needsUpdate = true;
    }
    
    // Also update normals if we swapped axes
    if (swapYZ) {
        const normals = geometry.getAttribute('normal');
        if (normals) {
            for (let i = 0; i < normals.count; i++) {
                const nx = normals.getX(i);
                let ny = normals.getY(i);
                let nz = normals.getZ(i);
                
                // Swap Y and Z components of normals
                const tempNy = ny;
                ny = nz;
                nz = tempNy;
                
                normals.setXYZ(i, nx, ny, nz);
            }
            normals.needsUpdate = true;
        }
    }
    
    // Ensure geometry is properly prepared for STL export
    prepareGeometryForSTL(geometry);
    
    // Recompute bounding box and sphere
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
}

/**
 * Ensures geometry is properly prepared for STL export
 * @param geometry - The geometry to prepare
 */
function prepareGeometryForSTL(geometry: THREE.BufferGeometry): void {
    // Ensure we have an index buffer (required for proper STL export)
    if (!geometry.index) {
        console.warn('Geometry has no index, creating one for STL export');
        geometry.setIndex(Array.from({ length: geometry.getAttribute('position').count }, (_, i) => i));
    }
    
    // Ensure normals are computed
    if (!geometry.getAttribute('normal')) {

        geometry.computeVertexNormals();
    }
    
    // Ensure the geometry is not empty
    const positionCount = geometry.getAttribute('position').count;
    if (positionCount === 0) {
        throw new Error('Geometry has no vertices');
    }
    

}

/**
 * Downloads data as a file
 * @param data - The data to download
 * @param filename - Name of the file
 * @param mimeType - MIME type of the file
 */
function downloadFile(
    data: string | ArrayBuffer,
    filename: string,
    mimeType: string
): void {
    const blob = data instanceof ArrayBuffer
        ? new Blob([data], { type: mimeType })
        : new Blob([data], { type: mimeType });
    
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    URL.revokeObjectURL(url);
}

/**
 * Merges multiple geometries into a single geometry
 * @param geometries - Array of geometries to merge
 * @returns Merged geometry
 */
export function mergeGeometries(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
    const mergedGeometry = new THREE.BufferGeometry();
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    
    let indexOffset = 0;
    
    for (const geometry of geometries) {
        const pos = geometry.getAttribute('position');
        const norm = geometry.getAttribute('normal');
        const uv = geometry.getAttribute('uv');
        const index = geometry.getIndex();
        
        // Add positions
        if (pos) {
            for (let i = 0; i < pos.count; i++) {
                positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
            }
        }
        
        // Add normals
        if (norm) {
            for (let i = 0; i < norm.count; i++) {
                normals.push(norm.getX(i), norm.getY(i), norm.getZ(i));
            }
        }
        
        // Add UVs
        if (uv) {
            for (let i = 0; i < uv.count; i++) {
                uvs.push(uv.getX(i), uv.getY(i));
            }
        }
        
        // Add indices
        if (index) {
            const arr = index.array;
            for (let i = 0; i < arr.length; i++) {
                indices.push(arr[i] + indexOffset);
            }
            indexOffset += pos ? pos.count : 0;
        }
    }
    
    // Set attributes
    if (positions.length > 0) {
        mergedGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    }
    if (normals.length > 0) {
        mergedGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    }
    if (uvs.length > 0) {
        mergedGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    }
    if (indices.length > 0) {
        mergedGeometry.setIndex(indices);
    }
    
    return mergedGeometry;
}

/**
 * Creates a watertight mesh by merging body and cap geometries
 * @param bodyGeometry - The main body geometry
 * @param bottomCapGeometry - Bottom cap geometry
 * @param topCapGeometry - Top cap geometry
 * @returns Merged watertight geometry
 */
export function createWatertightMesh(
    bodyGeometry: THREE.BufferGeometry,
    bottomCapGeometry: THREE.BufferGeometry | null,
    topCapGeometry: THREE.BufferGeometry | null
): THREE.BufferGeometry {
    const geometriesToMerge: THREE.BufferGeometry[] = [bodyGeometry];
    
    if (bottomCapGeometry) {
        geometriesToMerge.push(bottomCapGeometry);
    }
    
    if (topCapGeometry) {
        geometriesToMerge.push(topCapGeometry);
    }
    
    return mergeGeometries(geometriesToMerge);
}
