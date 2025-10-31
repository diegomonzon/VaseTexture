import './style.css';
import { initLoftEditor, disposeLoftEditor } from './loft-editor';
import { DEFAULT_SEGMENTS } from './types';

// Declare custom window properties for TypeScript
declare global {
    interface Window {
        currentSegments: number;
        loftEditor?: {
            dispose: () => void;
        };
    }
}

/**
 * Creates and configures the main application container
 * @returns The created container element
 */
function createAppContainer(): HTMLDivElement {
    const container = document.createElement('div');
    container.id = 'app';
    container.style.cssText = 'width: 100%; height: 100%;';
    return container;
}

/**
 * Initializes global application state
 */
function initializeGlobalState(): void {
    window.currentSegments = DEFAULT_SEGMENTS;
}

/**
 * Main application initialization
 */
function init(): void {
    try {

        
        // Initialize global state
        initializeGlobalState();
        
        // Create and append main container
        const mainContainer = createAppContainer();
        document.body.appendChild(mainContainer);

        
        // Initialize loft editor
        initLoftEditor(mainContainer);

        
        // Store reference for cleanup
        window.loftEditor = {
            dispose: disposeLoftEditor
        };
    } catch (error) {
        console.error('Failed to initialize application:', error);
    }
}

// Handle cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (window.loftEditor) {
        window.loftEditor.dispose();
    }
});

// Start the application when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}