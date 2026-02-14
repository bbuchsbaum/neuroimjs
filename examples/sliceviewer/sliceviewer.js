import { read_vol, ColorMap, VolLayer, VolStack, ImageLayer, OrthogonalImageViewer, NeuroAtlas, AxisSet3D } from '../../dist/neuroimjs.es.js';

document.addEventListener('DOMContentLoaded', async () => {
  console.log('DOM loaded');
  const filePath = './tpl-MNI152NLin2009aAsym_res-1_T1w.nii.gz'; // Use a relative path

  const viewerContainer = document.getElementById('viewer-container');
  if (!viewerContainer) {
    console.error('Viewer container not found');
    return;
  }

  try {
    const response = await fetch(filePath);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const vol = await read_vol(arrayBuffer);

    const range = vol.getRange();
    const colorMap = ColorMap.GRAY_SCALE;

    // Create a VolLayer instance
    const volLayer = new VolLayer(
      "layer1",
      vol,
      colorMap,
      [range[0],range[1]],
      [0,0],
      1.0
    );

    const atlas = await NeuroAtlas.loadSchaeferAtlas({
      parcels: 400,
      networks: 17,
      resolution: 2
    });
    
    console.log("Atlas loaded:", atlas);
    
    const atlasData = atlas.atlas.getData();
    const atlasRange = atlas.atlas.getRange();
    console.log("Atlas range from data:", atlasRange);

    // Create a VolLayer with the range determined from the atlas data
    const atlasLayer = new VolLayer(
      "atlas",
      atlas.atlas,
      ColorMap.fromPreset('Set3'),
      atlasRange,
      [0, 0],
      1.0
    );

    // Create a VolStack and add layers - using volLayer as primary
    const volStack = new VolStack(volLayer);
    // Add the atlas layer as a secondary layer
    volStack.addLayer(atlasLayer);
    
    // Create an ImageLayer with the VolStack
    const imageLayer = new ImageLayer(volStack);

    console.log('Volume loaded:', vol);
    console.log('VolStack created:', volStack);

    // Get the space information from the volume
    const neuroSpace = vol.space;
    console.log('NeuroSpace:', neuroSpace);
    
    // Check if neuroSpace and its dim property are available
    if (!neuroSpace || !neuroSpace.dim) {
      console.error('NeuroSpace or its dim property is undefined. Using default dimensions.');
      
      // Use default coordinate at [0,0,0] if dimensions are not available
      var initialCoord = [0, 0, 0];
    } else {
      console.log('Volume dimensions:', neuroSpace.dim);
      
      // Initial position at the center of the volume
      var initialCoord = [
        Math.floor(neuroSpace.dim[0] / 2),
        Math.floor(neuroSpace.dim[1] / 2),
        Math.floor(neuroSpace.dim[2] / 2)
      ];
    }
    
    console.log('Initial coordinate:', initialCoord);

    // Create the OrthogonalImageViewer instead of SliceViewer
    console.log('Creating OrthogonalImageViewer...');
    const viewer = await OrthogonalImageViewer.create({
      container: viewerContainer,   // DOM element to attach the view
      imageLayer: imageLayer,       // The image layer to display
      options: {                    // Options
        showCrosshair: true,
        showSlider: true,
      }
    });
    
    console.log('OrthogonalImageViewer created:', viewer);
    
    // Set the initial position
    // OrthogonalImageViewer handles this differently from SliceViewer
    viewer.currentCoord = initialCoord;
    
    // Wait for the custom elements to be defined
    console.log('Waiting for layer-control-panel to be defined...');
    await customElements.whenDefined('layer-control-panel');
    console.log('layer-control-panel defined');
    
    const controlPanel = document.querySelector('layer-control-panel');
    if (controlPanel) {
      console.log('Setting imageLayer on controlPanel');
      controlPanel.imageLayer = imageLayer;
      controlPanel.requestUpdate();
    }

    // Wait for the status-bar to be defined
    await customElements.whenDefined('status-bar');
    console.log('status-bar defined');
    
    const statusBar = document.querySelector('status-bar');
    if (statusBar) {
      console.log('Setting viewer on StatusBar');
      statusBar.viewer = viewer;
      statusBar.requestUpdate();
      console.log('StatusBar updated with viewer');
    }

  } catch (error) {
    console.error('Error in main script:', error);
    document.body.innerHTML += '<p>Error: ' + error.message + '</p>';
  }
});
