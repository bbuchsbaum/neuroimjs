/**
 * Example demonstrating how to set up the OrthogonalImageViewer
 * with a loaded NIFTI file
 */

import { read_vol } from '../src/io/nifti';
import { VolLayer } from '../src/display/VolLayer';
import { VolStack } from '../src/display/VolStack';
import { ImageLayer } from '../src/display/ImageLayer';
import { OrthogonalImageViewer } from '../src/display/OrthogonalImageViewer';
import { ColorMapFactory } from '../src/display/ColorMapFactory';

/**
 * Sets up an orthogonal viewer with a NIFTI file
 * @param niftiPath - Path to the NIFTI file
 * @param container - HTML container element for the viewer
 */
export async function setupOrthogonalViewer(
  niftiPath: string,
  container: HTMLElement
): Promise<OrthogonalImageViewer> {
  try {
    // 1. Load the NIFTI file
    console.log('Loading NIFTI file:', niftiPath);
    const volume = await read_vol(niftiPath);
    console.log('Volume loaded:', {
      dimensions: volume.dim,
      spacing: volume.space.spacing,
      origin: volume.space.origin
    });

    // 2. Create a VolLayer with the loaded volume
    // Use a grayscale colormap and auto-detect range
    const colorMap = ColorMapFactory.createGrayscale();
    const volLayer = new VolLayer(
      'main-volume',      // unique ID
      volume,             // the loaded volume
      colorMap,           // grayscale colormap
      null,               // auto-detect range
      [0, 0],            // no threshold
      1.0                 // full opacity
    );

    // 3. Create a VolStack and add the layer
    const volStack = new VolStack(volume.space);
    volStack.addLayer(volLayer);

    // 4. Create an ImageLayer with the VolStack
    const imageLayer = new ImageLayer(volStack);

    // 5. Create the OrthogonalImageViewer
    const viewer = new OrthogonalImageViewer({
      container: container,
      imageLayer: imageLayer,
      options: {
        showCrosshair: true,
        showSlider: true,
        width: 512,
        height: 512
      }
    });

    // 6. Initialize the viewer (this creates the sub-viewers)
    viewer.initialize();

    // 7. Set initial position to center of volume
    const centerVoxel = volume.dim.map(d => (d - 1) / 2);
    const centerWorld = volume.space.gridToCoord(centerVoxel);
    viewer.currentCoord = centerWorld;

    console.log('Orthogonal viewer setup complete');
    console.log('Initial position:', centerWorld);

    return viewer;

  } catch (error) {
    console.error('Error setting up orthogonal viewer:', error);
    throw error;
  }
}

/**
 * Example usage when a NIFTI file is double-clicked
 */
export async function handleNiftiFileOpen(filePath: string) {
  // Get or create the viewer container
  let container = document.getElementById('orthogonal-viewer-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'orthogonal-viewer-container';
    container.style.width = '100%';
    container.style.height = '100vh';
    document.body.appendChild(container);
  }

  // Clear any existing content
  container.innerHTML = '';

  // Setup the viewer
  try {
    const viewer = await setupOrthogonalViewer(filePath, container);
    
    // Store viewer reference for later use
    (window as any).currentViewer = viewer;
    
    // You can add event listeners or additional UI here
    // For example, listen for coordinate changes:
    viewer.on('coordChanged', (coord: number[]) => {
      console.log('Coordinate changed:', coord);
    });

  } catch (error) {
    console.error('Failed to open NIFTI file:', error);
    // Show error message to user
    container.innerHTML = `
      <div style="color: red; padding: 20px;">
        Error loading file: ${error.message}
      </div>
    `;
  }
}

/**
 * Integration with Rust backend
 * 
 * When the Rust backend loads a NIFTI file and stores it with an ID,
 * you need to retrieve that volume data and set up the viewer.
 * 
 * The error message shows the volume was loaded with ID: 8cb76cff-b008-44fc-a8b7-85bf1b66b46c
 * but there are "0 active layers" during rendering.
 * 
 * The issue is that the loaded volume needs to be:
 * 1. Retrieved from the Rust backend using the volume ID
 * 2. Converted to a VolLayer
 * 3. Added to the rendering pipeline
 */
export async function setupViewerFromBackendVolume(
  volumeId: string,
  container: HTMLElement
): Promise<OrthogonalImageViewer> {
  // This would need to communicate with the Rust backend to:
  // 1. Get the volume data for the given ID
  // 2. Create JavaScript NeuroVol object from that data
  // 3. Follow the same setup process as above
  
  // Placeholder for backend integration
  throw new Error('Backend integration not implemented - need to retrieve volume from Rust backend');
}