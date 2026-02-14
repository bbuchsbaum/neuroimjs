import React from 'react';
import { OrthogonalImageViewer } from './display/OrthogonalImageViewer';
import { LayerControlPanel } from './controls/LayerControlPanel_old';
import { ImageLayer } from './display/ImageLayer';

export const App: React.FC = () => {
  const [sliceViewer, setSliceViewer] = React.useState<SliceViewer | null>(null);

  React.useEffect(() => {
    // Initialize your OrthogonalImageViewer and ImageLayer
    const imageLayer = new ImageLayer(/* your VolStack or other params */);
    OrthogonalImageViewer.create({
      container: document.getElementById('viewer-container') as HTMLElement,
      imageLayer,
      options: { showCrosshair: true, showSlider: true },
    }).then((viewer) => {
      setSliceViewer(viewer.getSliceViewer());
    });
  }, []);

  return (
    <div className="flex h-screen">
      <div className="w-1/4 bg-gray-900">
        {sliceViewer && <LayerControlPanel sliceViewer={sliceViewer} />}
      </div>
      <div className="w-3/4" id="viewer-container">
        {/* OrthogonalImageViewer will render here */}
      </div>
    </div>
  );
};