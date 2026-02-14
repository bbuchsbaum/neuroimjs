#!/usr/bin/env node

/**
 * This script loads the MNI template NIfTI file and pretty prints its NeuroSpace information.
 * Run with: node tests/scripts/print_mni_volume.js
 */

import * as path from 'path';
import { fileURLToPath } from 'url';
import { JSDOM } from 'jsdom';

// Set up a browser-like environment
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'http://localhost',
  pretendToBeVisual: true,
  resources: 'usable'
});

// Set up global variables that would be available in a browser
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.customElements = dom.window.customElements;
global.navigator = dom.window.navigator;

// Now import the library
import { read_vol } from '../../dist/neuroimjs.es.js';

// Get the directory name in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to the MNI template file
const mniFilePath = path.join(__dirname, '../data/volumes/tpl-MNI152NLin2009aAsym_res-1_T1w.nii.gz');

async function main() {
  try {
    console.log('Loading MNI template file:', mniFilePath);
    console.log('This may take a moment...');
    
    // Load the NIfTI file
    const volume = await read_vol(mniFilePath);
    
    console.log('\nMNI Template Volume Information:');
    console.log('-------------------------------');
    
    // Get the NeuroSpace from the volume
    const space = volume.space;
    
    // Use the prettyPrint method to display the NeuroSpace information
    space.prettyPrint();
    
    // Print some additional volume information
    console.log('\nVolume Data Information:');
    console.log('----------------------');
    console.log(`Data Type: ${volume.dataType}`);
    console.log(`Number of Voxels: ${volume.data.length}`);
    
    // Calculate some basic statistics
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    let nonZeroCount = 0;
    
    for (let i = 0; i < volume.data.length; i++) {
      const value = volume.data[i];
      min = Math.min(min, value);
      max = Math.max(max, value);
      sum += value;
      if (value !== 0) nonZeroCount++;
    }
    
    const mean = sum / volume.data.length;
    
    console.log(`Min Value: ${min}`);
    console.log(`Max Value: ${max}`);
    console.log(`Mean Value: ${mean.toFixed(2)}`);
    console.log(`Non-Zero Voxels: ${nonZeroCount} (${(nonZeroCount / volume.data.length * 100).toFixed(2)}%)`);
    
  } catch (error) {
    console.error('Error loading or processing the MNI template:', error);
  }
}

// Run the main function
main(); 