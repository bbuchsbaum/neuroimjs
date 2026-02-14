import cv, { Mat, MatVector, Point } from 'opencv-ts';
import { NeuroSlice } from '../volume/NeuroSlice';

/**
 * Converts the `NeuroSlice` data to an OpenCV `Mat`.
 * @param neuroSlice - The NeuroSlice instance containing the data.
 * @returns An OpenCV Mat object.
 */
export function neuroSliceToMat(neuroSlice: NeuroSlice): Mat {
  const [width, height] = neuroSlice.dim;
  const data = neuroSlice.getData();

  // Create a Mat of the same size with 32-bit signed integers
  const mat = new cv.Mat(height, width, cv.CV_32SC1);

  // Copy data into the Mat
  mat.data32S.set(data);

  return mat;
}

/**
 * Extracts contours for each unique cluster index in the NeuroSlice.
 * @param neuroSlice - The NeuroSlice instance.
 * @returns An object mapping cluster indices to their contours.
 */
export function extractContours(
  neuroSlice: NeuroSlice
): { [clusterIndex: number]: Point[][] } {
  const mat = neuroSliceToMat(neuroSlice);
  const dataArray = Array.from(neuroSlice.getData());

  // Get unique cluster indices
  const uniqueIndices = Array.from(new Set(dataArray));

  const contoursPerCluster: { [clusterIndex: number]: Point[][] } = {};

  uniqueIndices.forEach((clusterIndex) => {
    if (clusterIndex === 0) return; // Skip background if 0 represents background

    // Create a binary mask for the current cluster
    const clusterMask = new cv.Mat();
    const lower = new cv.Mat(mat.rows, mat.cols, mat.type(), new cv.Scalar(clusterIndex));
    const upper = new cv.Mat(mat.rows, mat.cols, mat.type(), new cv.Scalar(clusterIndex));
    cv.inRange(mat, lower, upper, clusterMask);
    // Apply morphological operations to clean up the mask
    const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3), new cv.Point(-1, -1));
    const anchor = new cv.Point(-1, -1);
    cv.morphologyEx(clusterMask, clusterMask, cv.MORPH_CLOSE, kernel, anchor, 1, cv.BORDER_CONSTANT, cv.morphologyDefaultBorderValue());
    cv.morphologyEx(clusterMask, clusterMask, cv.MORPH_OPEN, kernel, anchor, 1, cv.BORDER_CONSTANT, cv.morphologyDefaultBorderValue());
    // Find contours
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    cv.findContours(
      clusterMask,
      contours,
      hierarchy,
      cv.RETR_EXTERNAL,
      cv.CHAIN_APPROX_SIMPLE
    );

    // Simplify contours to reduce points and smooth edges
    const simplifiedContours: Point[][] = [];
    for (let i = 0; i < contours.size(); i++) {
      const contour = contours.get(i);
      const simplified = new cv.Mat();
      cv.approxPolyDP(
        contour,
        simplified,
        1.5, // Adjust the approximation accuracy as needed
        true
      );

      // Convert simplified contour to array of Points
      const points: Point[] = [];
      for (let j = 0; j < simplified.rows; j++) {
        const point = new cv.Point(
          simplified.intAt(j, 0),
          simplified.intAt(j, 1)
        );
        points.push(point);
      }
      simplifiedContours.push(points);
      contour.delete();
      simplified.delete();
    }

    contoursPerCluster[clusterIndex] = simplifiedContours;

    // Clean up
    clusterMask.delete();
    contours.delete();
    hierarchy.delete();
    lower.delete();
    upper.delete();
    kernel.delete();
  });

  mat.delete();

  return contoursPerCluster;
}