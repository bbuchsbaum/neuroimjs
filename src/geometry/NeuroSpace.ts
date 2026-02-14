import { Matrix, inverse, determinant } from 'ml-matrix';
import * as _ from 'lodash';
import {
  AxisSet,
  AxisSet1D,
  AxisSet2D,
  AxisSet3D,
  findAnatomy3D,
  findAnatomy2D,
  nearestAnatomy,
  NamedAxis,
  oppositeAxis, //  this
} from './Axis';

export class NeuroSpace {
  private dimValues: number[];
  private spacingValues: number[];
  private originValues: number[];
  private _axes: AxisSet;
  private _trans: Matrix;
  private _inverseTrans: Matrix;

  /**
   * Constructs a new NeuroSpace instance.
   * @param dim - An array representing the dimensions of the space.
   * @param spacing - Optional array representing the spacing of each dimension. Defaults to 1 for each dimension up to 3.
   * @param origin - Optional array representing the origin of the space. Defaults to 0 for each dimension up to 3.
   * @param axes - Optional AxisSet representing the orientation of the space.
   * @param transform - Optional transformation matrix. If not provided, an identity matrix is used.
   */
  constructor(
    dim: number[],
    spacing?: number[],
    origin?: number[],
    axes?: AxisSet,
    transform?: number[][]
  ) {
    // Check for non-positive dimensions
    if (dim.some(d => d <= 0)) {
      throw new Error('All dimension values must be positive');
    }

    this.dimValues = dim;
    const D = Math.min(dim.length, 3);

    // Check if spacing and origin lengths match
    if (spacing && origin && spacing.length !== origin.length) {
      throw new Error('Spacing and origin lengths must match');
    }

    // Initialize spacingValues to an array of ones
    this.spacingValues = Array(D).fill(1);
    if (spacing != null) {
      // Check for non-positive spacing - still require positive spacing even if dimensions can be zero
      if (spacing.some(s => s <= 0)) {
        throw new Error('All spacing values must be positive');
      }
      for (let i = 0; i < Math.min(spacing.length, D); i++) {
        this.spacingValues[i] = spacing[i];
      }
    }

    // Initialize originValues to an array of zeros
    this.originValues = Array(D).fill(0);
    if (origin != null) {
      for (let i = 0; i < Math.min(origin.length, D); i++) {
        this.originValues[i] = origin[i];
      }
    }

    if (transform) {
      // Use the provided transformation matrix
      this._trans = new Matrix(transform);

      // Only overwrite originValues if origin is not provided
      if (origin == null) {
        this.originValues = [];
        for (let i = 0; i < D; i++) {
          this.originValues[i] = this._trans.get(i, this._trans.columns - 1);
        }
      }

      if (axes) {
        this._axes = axes;
      } else {
        this._axes = nearestAnatomy(this._trans);
      }
    } else if (axes) {
      // Build the transformation matrix from axes, spacing, and origin
      this._axes = axes;
      this._trans = Matrix.zeros(D + 1, D + 1);
      const axesArray = this._axes.axes();

      // Construct the rotation-scaling part of the transformation matrix
      for (let i = 0; i < D; i++) {
        const dir = axesArray[i].direction;
        for (let j = 0; j < D; j++) {
          this._trans.set(j, i, dir[j] * this.spacingValues[i]);
        }
      }

      // Set the translation (origin) component
      for (let i = 0; i < D; i++) {
        this._trans.set(i, D, this.originValues[i]);
      }

      // Set the bottom row for homogeneous coordinates
      this._trans.set(D, D, 1);
    } else {
      // Neither transform nor axes provided, use default axes and identity transform
      this._axes = D === 2 
        ? new AxisSet2D(NamedAxis.LEFT_RIGHT, NamedAxis.POST_ANT)
        : new AxisSet3D(NamedAxis.LEFT_RIGHT, NamedAxis.POST_ANT, NamedAxis.INF_SUP);

      this._trans = Matrix.zeros(D + 1, D + 1);
      const axesArray = this._axes.axes();

      // Construct the rotation-scaling part of the transformation matrix
      for (let i = 0; i < D; i++) {
        const dir = axesArray[i].direction;
        for (let j = 0; j < D; j++) {
          this._trans.set(j, i, dir[j] * this.spacingValues[i]);
        }
      }

      // Set the translation (origin) component
      for (let i = 0; i < D; i++) {
        this._trans.set(i, D, this.originValues[i]);
      }

      // Set the bottom row for homogeneous coordinates
      this._trans.set(D, D, 1);
    }

    // Now, compute the inverse transformation
    try {
      this._inverseTrans = inverse(this._trans);
    } catch (error) {
      console.error('Error computing inverse transformation:', error);
      console.error('Transformation matrix:', this._trans.to2DArray());
      throw new Error('Failed to create NeuroSpace: transformation matrix is not invertible');
    }
  }

  // ... rest of the class remains unchanged ..

  extractSliceNeuroSpace(zlevel: number, axisToDrop?: number): NeuroSpace {
    const ndim = this.ndim();
    if (ndim <= 1) {
      throw new Error('Cannot extract slice from a 1D space');
    }
  
    // If axisToDrop is not specified, default to the last axis (backward compatibility)
    if (axisToDrop === undefined) {
      axisToDrop = ndim - 1;
    }
    
    // Validate axisToDrop
    if (axisToDrop < 0 || axisToDrop >= ndim) {
      throw new Error(`axisToDrop ${axisToDrop} is out of bounds for space with ${ndim} dimensions`);
    }
  
    // Validate zlevel
    if (zlevel < 0 || zlevel >= this.dimValues[axisToDrop]) {
      throw new Error(`zlevel ${zlevel} is out of bounds for axis ${axisToDrop}`);
    }
  
    // Update dimension arrays by removing the dropped axis
    const newDim = [...this.dimValues.slice(0, axisToDrop), ...this.dimValues.slice(axisToDrop + 1)];
    const newSpacing = [...this.spacingValues.slice(0, axisToDrop), ...this.spacingValues.slice(axisToDrop + 1)];
    const newOrigin = [...this.originValues.slice(0, axisToDrop), ...this.originValues.slice(axisToDrop + 1)];
  
    // Remove the axis corresponding to the dropped dimension
    const axesArray = this._axes.axes();
    const newAxesArray = [...axesArray.slice(0, axisToDrop), ...axesArray.slice(axisToDrop + 1)];
  
    // Create a new AxisSet based on the remaining axes
    let newAxes: AxisSet;
    if (newAxesArray.length === 2) {
      newAxes = new AxisSet2D(newAxesArray[0], newAxesArray[1]);
    } else if (newAxesArray.length === 1) {
      newAxes = new AxisSet1D(newAxesArray[0]);
    } else {
      throw new Error('Unsupported number of axes after dropping dimension');
    }
  
    // Construct the transformation matrix based on remaining dimensions
    const D = newAxesArray.length;
    const newTrans = Matrix.zeros(D + 1, D + 1);
  
    // Build the rotation-scaling part of the transformation matrix
    // For 2D slices, projecting 3D directions into a 2x2 can be singular
    // (e.g., an axis aligned with Z has [0,0] components). Instead, synthesize
    // an orthogonal 2D basis with correct scaling.
    if (D === 2) {
      newTrans.set(0, 0, newSpacing[0]); // u axis
      newTrans.set(1, 0, 0);
      newTrans.set(0, 1, 0);
      newTrans.set(1, 1, newSpacing[1]); // v axis
    } else {
      for (let i = 0; i < D; i++) {
        const dir = newAxesArray[i].direction;
        for (let j = 0; j < D; j++) {
          newTrans.set(j, i, dir[j] * newSpacing[i]);
        }
      }
    }
  
    // Set the translation (origin) component
    for (let i = 0; i < D; i++) {
      newTrans.set(i, D, newOrigin[i]);
    }
  
    // Set the bottom row for homogeneous coordinates
    newTrans.set(D, D, 1);
  
    // Create and return the new 2D NeuroSpace
    return new NeuroSpace(newDim, newSpacing, newOrigin, newAxes, newTrans.to2DArray());
  }


  dropDim(): NeuroSpace | null {
    const ndim = this.ndim();
    if (ndim <= 1) {
      return null;
    }


    // Create new arrays for dim, spacing, and origin, dropping the last element
    const newDim = this.dim.slice(0, -1);
    const newSpacing = this.spacing.slice(0, -1);
    const newOrigin = this.origin.slice(0, -1);

    // For AxisSet, we'll keep the first n-1 dimensions
    let newAxes: AxisSet;
    if (ndim > 3) {
      newAxes = this.axes;
    } else {
      newAxes = this.axes.dropDim() as AxisSet;
    }

    // For the transformation matrix, we need to create a proper homogeneous matrix
    const newNdim = newDim.length;
    const newTrans = Matrix.zeros(newNdim + 1, newNdim + 1);
    
    // For 3D to 2D reduction, we need special handling
    if (newNdim === 2 && ndim === 3) {
      // Get the axes that will be kept (first two axes from AxisSet3D.dropDim())
      const axesArray = this._axes.axes();
      const axis1 = axesArray[0];
      const axis2 = axesArray[1];
      const axis3 = axesArray[2]; // The axis being dropped
      
      // Get the transformation matrix columns for each axis (including spacing)
      const col1 = [
        this._trans.get(0, 0), // x component of first axis
        this._trans.get(1, 0), // y component of first axis
        this._trans.get(2, 0)  // z component of first axis
      ];
      
      const col2 = [
        this._trans.get(0, 1), // x component of second axis
        this._trans.get(1, 1), // y component of second axis
        this._trans.get(2, 1)  // z component of second axis
      ];
      
      // Check if the first two columns, when projected to 2D, would create a singular matrix
      // This happens when both columns point primarily in the Z direction
      const col1Magnitude2D = Math.sqrt(col1[0] * col1[0] + col1[1] * col1[1]);
      const col2Magnitude2D = Math.sqrt(col2[0] * col2[0] + col2[1] * col2[1]);
      
      // Check if either column has negligible XY components
      if (col1Magnitude2D < 1e-10 || col2Magnitude2D < 1e-10) {
        // At least one axis points primarily in Z direction
        // This will create a singular 2x2 matrix
        
        // Strategy: Create a valid 2D transformation that preserves as much structure as possible
        // We'll create an orthonormal 2D basis that best represents the data
        
        // If col1 has no XY component, use a default [1,0] direction
        let newCol1: number[];
        if (col1Magnitude2D < 1e-10) {
          newCol1 = [this.spacingValues[0], 0];
        } else {
          // Normalize the XY components and scale by original spacing
          const scale = Math.sqrt(col1[0] * col1[0] + col1[1] * col1[1] + col1[2] * col1[2]);
          newCol1 = [
            col1[0] * scale / col1Magnitude2D,
            col1[1] * scale / col1Magnitude2D
          ];
        }
        
        // For col2, ensure it's orthogonal to newCol1
        let newCol2: number[];
        if (col2Magnitude2D < 1e-10) {
          // Use perpendicular to newCol1
          newCol2 = [-newCol1[1] * this.spacingValues[1] / this.spacingValues[0], newCol1[0] * this.spacingValues[1] / this.spacingValues[0]];
        } else {
          // Project col2 onto plane and make orthogonal to newCol1
          const scale = Math.sqrt(col2[0] * col2[0] + col2[1] * col2[1] + col2[2] * col2[2]);
          const proj2 = [col2[0], col2[1]];
          
          // Gram-Schmidt orthogonalization
          const dot = (proj2[0] * newCol1[0] + proj2[1] * newCol1[1]) / (newCol1[0] * newCol1[0] + newCol1[1] * newCol1[1]);
          newCol2 = [
            (proj2[0] - dot * newCol1[0]) * scale / col2Magnitude2D,
            (proj2[1] - dot * newCol1[1]) * scale / col2Magnitude2D
          ];
          
          // Check if newCol2 is zero (parallel case)
          const newCol2Mag = Math.sqrt(newCol2[0] * newCol2[0] + newCol2[1] * newCol2[1]);
          if (newCol2Mag < 1e-10) {
            // Use perpendicular
            newCol2 = [-newCol1[1], newCol1[0]];
          }
        }
        
        // Set the transformation matrix
        newTrans.set(0, 0, newCol1[0]);
        newTrans.set(1, 0, newCol1[1]);
        newTrans.set(0, 1, newCol2[0]);
        newTrans.set(1, 1, newCol2[1]);
      } else {
        // Normal case: just copy the first 2x2 submatrix
        for (let i = 0; i < 2; i++) {
          for (let j = 0; j < 2; j++) {
            newTrans.set(i, j, this._trans.get(i, j));
          }
        }
      }
    } else {
      // General case: copy the appropriate submatrix
      for (let i = 0; i < newNdim; i++) {
        for (let j = 0; j < newNdim; j++) {
          newTrans.set(i, j, this._trans.get(i, j));
        }
      }
    }
    
    // Copy the translation part (origin)
    for (let i = 0; i < newNdim; i++) {
      newTrans.set(i, newNdim, this._trans.get(i, this.ndim()));
    }
    
    // Set the homogeneous coordinate
    newTrans.set(newNdim, newNdim, 1);

    // Create a new NeuroSpace with the updated properties
    return new NeuroSpace(
      newDim,
      newSpacing,
      newOrigin,
      newAxes,
      newTrans.to2DArray()
    );
  }


  

  /**
   * Gets the number of dimensions.
   * @returns The number of dimensions.
   */
  ndim(): number {
    return this.dim.length;
  }

  /**
   * Calculates the centroid of the NeuroSpace.
   * The centroid is the geometric center of the space, calculated by averaging
   * the coordinates of two opposite corners of the bounding box.
   * 
   * @returns An array representing the coordinates of the centroid.
   */
  centroid(): number[] {
    const [c1, c2] = this.bounds();
    //console.log(c1, c2);
    const ndim = Math.min(this.ndim(), 3);
    const centroid = c1.slice(0, ndim).map((coord, i) => (coord + c2[i]) / 2);
    //console.log(centroid);
    return centroid;
  }

  /**
   * Gets the size of a specific dimension based on the axis.
   * @param axis - The axis for which to get the dimension size.
   * @returns The size of the dimension.
   */
  dimOf(axis: NamedAxis): number {
    const dir = axis.direction.map(Math.abs);
    const dnum = this.whichDim(axis);
    return this.dim[dnum];
  }

  /**
   * Determines which dimension corresponds to the given axis.
   * @param axis - The axis to match.
   * @returns The index of the matching dimension.
   * @throws Error if no matching axis is found.
   */
  whichDim(axis: NamedAxis): number {
    const axes = this._axes.axes();
    const index = axes.findIndex(a => a.axis === axis.axis || a.axis === oppositeAxis(axis).axis);
    if (index === -1) {
      throw new Error(`Cannot find matching axis of: ${axis.axis}`);
    }
    return index;
  }


  get dim(): number[] {
    return [...this.dimValues];
  }

  get origin(): number[] {
    return this.originValues;
  } 

  /**
   * Gets the spacing values.
   * @returns An array of spacing values.
   */
  get spacing(): number[] {
    return this.spacingValues;
  }

  get axes(): Readonly<AxisSet> {
    return this._axes;
  }

  /**
   * Get the total number of elements (voxels) in this space.
   * @returns The product of all dimensions
   */
  get size(): number {
    return this.dimValues.reduce((acc, dim) => acc * dim, 1);
  }

  get trans(): Matrix {
    return this._trans;
  }

  get inverseTrans(): Matrix {
    return this._inverseTrans;
  } 

  /**
   * Calculates the bounds of the NeuroSpace.
   * @returns A tuple containing the minimum and maximum coordinates.
   */
  bounds(): [number[], number[]] {
    const d = Math.min(3, this.ndim());
    const zeroGrid = Array(d).fill(0);
    const maxGrid = this.dim.slice(0, d).map(d => d - 1);
    const c1 = this.gridToCoord(zeroGrid); 
    const c2 = this.gridToCoord(maxGrid);
    return [c1, c2];
  }

  

  /**
   * Converts a linear index to grid coordinates.
   * @param idx - The linear index.
   * @returns An array representing grid coordinates.
   */
  indexToGrid(idx: number): number[] {
    return indexToGrid(idx, this.dim);
  }

  /**
   * Converts a linear index to real-world coordinates.
   * @param idx - The linear index.
   * @returns An array representing real-world coordinates.
   */
  indexToCoord(idx: number): number[] {
    const d = Math.min(3, this.ndim());
    const grid = this.indexToGrid(idx);
    const extendedGrid = [...grid.slice(0, d), 1];
    const res = this.trans.mmul(Matrix.columnVector(extendedGrid));
    return res.getColumn(0).slice(0, d);
  }

  /**
   * Converts real-world coordinates to a linear index.
   * @param coords - An array of real-world coordinates.
   * @returns The corresponding linear index.
   */
  coordToIndex(coords: number[]): number {
    const grid = this._inverseTrans.mmul(Matrix.columnVector([...coords, 1])).to1DArray();
    return gridToIndex(this.dim, grid.slice(0, this.ndim()));
  }

  /**
   * Converts real-world coordinates to grid coordinates.
   * @param coords - An array of real-world coordinates.
   * @returns An array representing grid coordinates.
   */
  coordToGrid(coords: number[]): number[] {
    const grid = this._inverseTrans.mmul(Matrix.columnVector([...coords, 1])).to1DArray();
    return grid.slice(0, this.ndim());
  }

  containsCoord(coords: number[]): boolean {
    const grid = this.coordToGrid(coords);
    return grid.every((g, i) => g >= 0 && g < this.dim[i]);
  }

  /**
   * Converts voxel coordinates to world coordinates.
   * Alias for gridToCoord.
   * @param voxel - An array of voxel coordinates.
   * @returns An array representing world coordinates.
   */
  voxelToWorld(voxel: number[]): number[] {
    return this.gridToCoord(voxel);
  }

  /**
   * Converts world coordinates to voxel coordinates.
   * Alias for coordToGrid.
   * @param world - An array of world coordinates.
   * @returns An array representing voxel coordinates.
   */
  worldToVoxel(world: number[]): number[] {
    return this.coordToGrid(world);
  }

  /**
   * Converts voxel coordinates to real-world coordinates.
   * @param vox - An array of voxel coordinates.
   * @returns An array representing real-world coordinates.
   */
  gridToGrid(vox: number[]): number[] {
    const nd = this.ndim();
    const tx = this._inverseTrans.subMatrix(0, nd - 1, 0, nd - 1);
    const idx: [number, number][] = tx
      .to2DArray()
      .flatMap((row, i) =>
        row.map((v, j) => (v !== 0 ? ([i, j] as [number, number]) : null))
      )
      .filter((v): v is [number, number] => v !== null);

    idx.forEach(([i, j]) => tx.set(i, j, Math.sign(tx.get(i, j))));
    const ovox = tx.mmul(Matrix.columnVector(vox));
    const offset = tx
      .to2DArray()
      .map((row) => (row.some((v) => v < 0) ? this.dim[row.indexOf(-1)] : 0));
    return ovox.to1DArray().map((v, i) => v + offset[i]);
  }

  /**
   * Converts grid coordinates to real-world coordinates.
   * @param coords - An array of grid coordinates.
   * @returns An array representing real-world coordinates.
   */
  gridToCoord(coords: number[]): number[] {
    const requiredSize = this.trans.rows;
    const paddingSize = requiredSize - coords.length - 1; // Subtracting 1 for the homogeneous coordinate
    if (paddingSize < 0) {
      throw new Error('Too many coordinates provided for gridToCoord.');
    }
    const extendedCoords = [...coords, ...Array(paddingSize).fill(0), 1];
    const ret = this.trans.mmul(Matrix.columnVector(extendedCoords)).to1DArray();
    const md = Math.min(this.ndim(), 3);
    return ret.slice(0, md);
  }

  /**
   * Converts grid coordinates to a linear index.
   * @param coords - An array of grid coordinates.
   * @returns The corresponding linear index.
   */
  gridToIndex(coords: number[]): number {
    return gridToIndex(this.dim, coords);
  }

  
  reorient(orient: AxisSet): NeuroSpace {
  
    const ndim = this.ndim();
    if (ndim !== 2 && ndim !== 3) {
      throw new Error(`Reorientation is only supported for 2D and 3D spaces. Got ${ndim}D space.`);
    }
  
    let anat: AxisSet;
    try {
      anat = ndim === 2
        ? findAnatomy2D(orient.axes()[0].name, orient.axes()[1].name)
        : findAnatomy3D(orient.axes()[0].name, orient.axes()[1].name, orient.axes()[2].name);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to find matching anatomy: ${errorMessage}`);
    }
  
    // Compute permutation mapping
    const { perm, flip } = this.computeAxisPermutation(this.axes.axes(), anat.axes());
  
    // Reorder dim and spacing according to the permutation
    const newDim = perm.map((p) => this.dim[p]);
    const newSpacing = perm.map((p) => this.spacing[p]);
  
    // Calculate the new origin
    // We need to transform the corners of the original space to maintain the same physical bounds
    const newOrigin = new Array(ndim).fill(0);
    
    // For each axis in the new orientation
    for (let i = 0; i < ndim; i++) {
      const sourceAxisIndex = perm[i];
      
      if (flip[i] === -1) {
        // If the axis is flipped, the origin needs to be adjusted
        // to maintain the same physical bounds
        // The new origin is at the opposite end of the dimension
        newOrigin[i] = this.origin[sourceAxisIndex] + (this.dim[sourceAxisIndex] - 1) * this.spacing[sourceAxisIndex];
      } else {
        // If not flipped, keep the same origin value
        newOrigin[i] = this.origin[sourceAxisIndex];
      }
    }
  
    // Create a new transformation matrix
    const newTrans = Matrix.zeros(ndim + 1, ndim + 1);
    
    // Set the homogeneous coordinate
    newTrans.set(ndim, ndim, 1);
    
    // Build the rotation-scaling part of the transformation matrix
    const anatAxes = anat.axes();
    for (let i = 0; i < ndim; i++) {
      const dir = anatAxes[i].direction;
      for (let j = 0; j < ndim; j++) {
        newTrans.set(j, i, dir[j] * newSpacing[i]);
      }
    }
    
    // Set the translation component
    for (let i = 0; i < ndim; i++) {
      newTrans.set(i, ndim, newOrigin[i]);
    }
  
    
    // Create and return the new NeuroSpace with the updated properties
    const newSpace = new NeuroSpace(
      newDim,
      newSpacing,
      newOrigin,
      anat,
      newTrans.to2DArray()
    );
    
    // Verify the bounds are preserved after reorientation
    const [origMin, origMax] = this.bounds();
    const [newMin, newMax] = newSpace.bounds();
    
    return newSpace;
  }
  

 
  
  // Helper function to compute axis permutation and flips
computeAxisPermutation(oldAxes: NamedAxis[], newAxes: NamedAxis[]): { perm: number[], flip: number[] } {
    const ndim = oldAxes.length;
    const perm = new Array(ndim);
    const flip = new Array(ndim);
  
    for (let i = 0; i < ndim; i++) {
      const newAxis = newAxes[i];
      let found = false;
      for (let j = 0; j < ndim; j++) {
        const oldAxis = oldAxes[j];
        if (newAxis.name === oldAxis.name) {
          perm[i] = j;
          flip[i] = 1;
          found = true;
          break;
        } else if (newAxis.name === oppositeAxis(oldAxis).name) {
          perm[i] = j;
          flip[i] = -1;
          found = true;
          break;
        }
      }
      if (!found) {
        throw new Error(`Cannot find matching axis for ${newAxis.name}`);
      }
    }
    return { perm, flip };
  }

  permuteGridCoordinates(coords: number[], axes: AxisSet): number[] {
    //console.log("converting coords ... ", coords);
    //console.log("to axes ... ", axes);
    const permMatrix = this.getPermutationMatrixTo(axes);
    //console.log("permMatrix ... ", permMatrix);
    const cvec = Matrix.columnVector([...coords, 1]);
    //console.log("cvec ... ", cvec);
    const result = permMatrix.mmul(cvec).to1DArray();
    //console.log("result ... ", result);
    return result.slice(0, this.ndim());
  }

  /**
   * Calculates the bounds of the NeuroSpace with respect to a given set of axes.
   * @param axes - The AxisSet defining the desired orientation.
   * @returns A tuple containing the minimum and maximum coordinates in the local coordinate space.
   */
  boundsFromView(axes: AxisSet): [number[], number[]] {
    const ndim = Math.min(this.ndim(), 3); // Limit to 3D space
    const dims = this.dim.slice(0, ndim);

    // Generate all corner indices in grid space
    const cornerIndices = this.generateCornerIndices(dims);

    // Convert grid corners to world coordinates
    const worldCorners = cornerIndices.map((gridCoord) => this.gridToCoord(gridCoord));

    // Transform world coordinates to the local coordinate space of the provided axes
    const transformedCorners = worldCorners.map((coord) =>
      this.transformCoordToAxes(coord, axes)
    );

    // Initialize min and max bounds
    const minBounds = Array(ndim).fill(Infinity);
    const maxBounds = Array(ndim).fill(-Infinity);

    // Determine the min and max bounds along each axis
    for (const corner of transformedCorners) {
      for (let i = 0; i < ndim; i++) {
        if (corner[i] < minBounds[i]) minBounds[i] = corner[i];
        if (corner[i] > maxBounds[i]) maxBounds[i] = corner[i];
      }
    }

    return [minBounds, maxBounds];
  }

  /**
   * Generates all corner indices for an n-dimensional grid.
   * @param dims - The dimensions of the grid.
   * @returns An array of grid coordinates representing each corner.
   */
  generateCornerIndices(dims: number[]): number[][] {
    const ndim = dims.length;
    const numCorners = 2 ** ndim;
    const corners: number[][] = [];

    for (let i = 0; i < numCorners; i++) {
      const corner: number[] = [];
      for (let j = 0; j < ndim; j++) {
        // If the j-th bit of i is set, use the max index for that dimension
        const index = (i >> j) & 1 ? dims[j] - 1 : 0;
        corner.push(index);
      }
      corners.push(corner);
    }

    return corners;
  }

  /**
   * Transforms a coordinate from world space to the local coordinate space defined by the given axes.
   * @param coord - The coordinate in world space.
   * @param axes - The AxisSet defining the desired orientation.
   * @returns The coordinate in the local coordinate space.
   */
  transformCoordToAxes(coord: number[], axes: AxisSet): number[] {
    const ndim = Math.min(this.ndim(), 3); // Limit to 3D
    const sourceAxes = this._axes.axes();
    const targetAxes = axes.axes();

    // Build the rotation matrix to align source axes with target axes
    const rotationMatrix = Matrix.zeros(ndim, ndim);

    for (let i = 0; i < ndim; i++) {
      const targetAxis = targetAxes[i];

      // Find corresponding source axis
      let found = false;
      for (let j = 0; j < ndim; j++) {
        const sourceAxis = sourceAxes[j];
        if (targetAxis.name === sourceAxis.name) {
          // Direct match
          rotationMatrix.set(i, j, 1);
          found = true;
          break;
        } else if (targetAxis.name === oppositeAxis(sourceAxis).name) {
          // Opposite axis
          rotationMatrix.set(i, j, -1);
          found = true;
          break;
        }
      }

      if (!found) {
        throw new Error(`Axis ${targetAxis.name} does not have a matching source axis.`);
      }
    }

    const coordMatrix = Matrix.columnVector(coord.slice(0, ndim));
    const transformedCoord = rotationMatrix.mmul(coordMatrix).getColumn(0);

    return transformedCoord;
  }






  /**
   * Generates a sequence of values along a given axis within the space.
   * @param axis - The axis along which to generate the sequence.
   * @param step - The step size between values in the sequence.
   * @returns An array of numbers representing the sequence along the axis.
   * @throws Error if the provided axis doesn't match any axis in the space.
   */
  seqAlong(axis: NamedAxis, step: number): number[] {
    //console.log('step', step);
    const matchedAxisIndex = this.findMatchingAxis(axis);
    //console.log('matchedAxisIndex', matchedAxisIndex);
    if (matchedAxisIndex === null) {
      throw new Error('The provided axis does not match any axis in the space.');
    }

    const [start, end] = this.bounds().map((bound) => bound[matchedAxisIndex]);
    //console.log('start, end', start, end);
    const axes = this._axes.axes();
    const direction = axes[matchedAxisIndex].direction[matchedAxisIndex];
    //console.log(direction);
    //console.log(start, end);
    if (direction > 0) {
      return this.generateSequence(start, end, step);
    } else {
      return this.generateSequence(end, start, -step);
    }
  }

  /**
   * Returns an array of slice indices along a given axis.
   * @param axis - The axis along which to generate slice indices.
   * @returns An array of numbers representing the slice indices from 0 to ndom-1.
   * @throws Error if the provided axis doesn't match any axis in the space.
   */
  sliceIndices(axis: NamedAxis): number[] {
    const matchedAxisIndex = this.findMatchingAxis(axis);
    if (matchedAxisIndex === null) {
      throw new Error('The provided axis does not match any axis in the space.');
    }

    const d = this.dim[matchedAxisIndex];
    return Array.from({ length: d }, (_, i) => i);
  }

  /**
   * Finds the index of a matching axis in the space.
   * @param axis - The axis to match.
   * @param ignoreDirection - Whether to ignore the direction when matching. Defaults to false.
   * @returns The index of the matching axis, or null if no match is found.
   */
  private findMatchingAxis(axis: NamedAxis, ignoreDirection: boolean = false): number | null {
    const axes = this._axes.axes();
    for (let i = 0; i < axes.length; i++) {
      if (
        ignoreDirection
          ? axes[i].axis === axis.axis
          : axes[i].axis === axis.axis || axes[i].axis === oppositeAxis(axis).axis
      ) {
        return i;
      }
    }
    return null;
  }

  /**
   * Generates a sequence of numbers.
   * @param start - The starting value of the sequence.
   * @param end - The ending value of the sequence.
   * @param step - The step size between values.
   * @returns An array of numbers representing the sequence.
   */
  private generateSequence(start: number, end: number, step: number): number[] {
    //console.log('start, end, step', start, end, step);
    const sequence: number[] = [];
    if (step > 0) {
      for (let value = start; value <= end; value += step) {
        sequence.push(value);            
      }
    } else {
      for (let value = start; value >= end; value += step) {
        sequence.push(value);
      }
    }
    return sequence;
  }

  /**
   * Returns the origin values.
   * @returns An array representing the origin.
   */
  getOrigin(): number[] {
    return this.originValues;
  }

  /**
   * Returns the axes set.
   * @returns The AxisSet instance.
   */
  getAxes(): AxisSet {
    return this._axes;
  }

  /**
   * Returns the transformation matrix.
   * @returns The transformation Matrix.
   */
  getTrans(): Matrix {
    return this.trans;
  }

  /**
   * Returns the inverse transformation matrix.
   * @returns The inverse transformation Matrix.
   */
  getInverseTrans(): Matrix {
    return this._inverseTrans;
  }

  /**
   * Returns a string representation of the NeuroSpace object.
   * @returns A formatted string containing information about the NeuroSpace.
   */
  toString(): string {
    const dimensionInfo = `Dimensions: ${this.dim.join(' x ')}`;
    const spacingInfo = `Spacing: ${this.spacingValues.join(' x ')}`;
    const originInfo = `Origin: (${this.originValues.join(', ')})`;
    const axesInfo = `Axes: i=${this._axes instanceof AxisSet3D ? this._axes.i.name : this._axes.axes()[0].name}, j=${this._axes instanceof AxisSet3D ? this._axes.j.name : this._axes.axes()[1].name}${this.ndim() >= 3 && this._axes instanceof AxisSet3D ? `, k=${this._axes.k.name}` : ''}`;

    const transInfo =
      'Transformation Matrix:\n' +
      this.trans
        .to2DArray()
        .map((row) => row.map((val) => val.toFixed(4).padStart(10)).join(' '))
        .join('\n');

    return ['NeuroSpace:', dimensionInfo, spacingInfo, originInfo, axesInfo, transInfo].join('\n');
  }

  /**
   * Checks if this NeuroSpace object is equal to another NeuroSpace object.
   * @param other - The other NeuroSpace object to compare with.
   * @returns True if the objects are equal, false otherwise.
   */
  isEqualTo(other: NeuroSpace): boolean {
    return _.isEqual(this, other);
  }

  /**
   * Logs a string representation of the NeuroSpace object to the console.
   */
  print(): void {
    console.log(this.toString());
  }

  /**
   * Generates a transformation matrix to convert real-world coordinates from this space to another space.
   * @param targetSpace - The target NeuroSpace to convert coordinates to.
   * @returns A transformation matrix that converts real-world coordinates from this space to the target space.
   */
  getTransformationMatrixTo(targetSpace: NeuroSpace): Matrix {
    // Compute the transformation matrix from this space to the target space
    // M = T_target * inv(T_source)
    const invSourceTrans = this._inverseTrans;
    const targetTrans = targetSpace.getTrans();
    const transformationMatrix = targetTrans.mmul(invSourceTrans);
    return transformationMatrix;
  }

  /**
   * Generates a transformation matrix to convert voxel coordinates from this space to another compatible space.
   * @param targetAxes - The target NeuroSpace to convert coordinates to.
   * @returns A transformation matrix that converts voxel coordinates from this space to the target space.
   * @throws Error if the spaces are not compatible.
   */
  getPermutationMatrixTo(targetAxes: AxisSet): Matrix {
    if (!this.isCompatibleWithAxes(targetAxes)) {
      throw new Error('The axes are not compatible for transformation.');
    }

    const sourceAxes = this._axes.axes();
    const targetAxesArray = targetAxes.axes();
    const n = Math.min(this.ndim(), targetAxesArray.length, 3);

    // Initialize the transformation matrix
    const transformMatrix = Matrix.zeros(n + 1, n + 1);
    transformMatrix.set(n, n, 1); // Homogeneous coordinate

    for (let i = 0; i < n; i++) {
      const targetAxis = targetAxesArray[i];

      // Find corresponding source axis
      let found = false;
      for (let j = 0; j < n; j++) {
        const sourceAxis = sourceAxes[j];
        if (targetAxis.name === sourceAxis.name) {
          // Direct match
          transformMatrix.set(i, j, 1);
          found = true;
          break;
        } else if (targetAxis.name === oppositeAxis(sourceAxis).name) {
          // Opposite axis
          transformMatrix.set(i, j, -1);
          // Adjust translation component for reflection
          transformMatrix.set(i, n, this.dim[j] - 1);
          found = true;
          break;
        }
      }

      if (!found) {
        throw new Error(`Axis ${targetAxis.name} does not have a matching source axis.`);
      }
    }

    return transformMatrix;
  }

  /**
   * Checks if this space is compatible with another space for transformation.
   * @param otherSpace - The other NeuroSpace to check compatibility with.
   * @returns True if the spaces are compatible, false otherwise.
   */
  isCompatibleWith(otherSpace: NeuroSpace): boolean {
    const sourceAxes = new Set(this._axes.axes())
    const targetAxes = new Set(otherSpace.getAxes().axes())
    const isCompatible =
      sourceAxes.size === targetAxes.size &&
      [...sourceAxes].every(
        (axis) => targetAxes.has(axis) || targetAxes.has(oppositeAxis(axis))
      );

    //console.log('Source axes:', sourceAxes);
    //console.log('Target axes:', targetAxes);
    //console.log('Is compatible:', isCompatible);

    return isCompatible;
  }

  isCompatibleWithAxes(targetAxes: AxisSet): boolean {
    const sourceAxes = new Set(this._axes.axes());
    const targetAxesSet = new Set(targetAxes.axes());
    const isCompatible =
      sourceAxes.size === targetAxesSet.size &&
      [...sourceAxes].every(
        (axis) => targetAxesSet.has(axis) || targetAxesSet.has(oppositeAxis(axis))
      );

    //console.log('Source axes:', sourceAxes);
    //console.log('Target axes:', targetAxesSet);
    //console.log('Is compatible:', isCompatible);

    return isCompatible;
  }

  /**
   * Returns a string representation of the NeuroSpace object.
   * @returns A formatted string containing information about the NeuroSpace.
   */
  toStringDetailed(): string {
    const dimensionInfo = `Dimensions: ${this.dim.join(' x ')}`;
    const spacingInfo = `Spacing: ${this.spacingValues.join(' x ')}`;
    const originInfo = `Origin: (${this.originValues.join(', ')})`;
    const axesInfo = `Axes: i=${this._axes instanceof AxisSet3D ? this._axes.i.name : this._axes.axes()[0].name}, j=${this._axes instanceof AxisSet3D ? this._axes.j.name : this._axes.axes()[1].name}${this.ndim() >= 3 && this._axes instanceof AxisSet3D ? `, k=${this._axes.k.name}` : ''}`;

    const transInfo =
      'Transformation Matrix:\n' +
      this.trans
        .to2DArray()
        .map((row) => row.map((val) => val.toFixed(4).padStart(10)).join(' '))
        .join('\n');

    return ['NeuroSpace:', dimensionInfo, spacingInfo, originInfo, axesInfo, transInfo].join('\n');
  }

  /**
   * Prints a well-formatted, colorful representation of the NeuroSpace object to the console.
   * This method enhances debugging by highlighting key properties with colors and proper structure.
   */
  prettyPrint(): void {
    // Define ANSI color codes for console output
    const colors = {
      reset: '\x1b[0m',
      bright: '\x1b[1m',
      dim: '\x1b[2m',
      underscore: '\x1b[4m',
      blink: '\x1b[5m',
      reverse: '\x1b[7m',
      hidden: '\x1b[8m',
      
      fg: {
        black: '\x1b[30m',
        red: '\x1b[31m',
        green: '\x1b[32m',
        yellow: '\x1b[33m',
        blue: '\x1b[34m',
        magenta: '\x1b[35m',
        cyan: '\x1b[36m',
        white: '\x1b[37m',
        crimson: '\x1b[38m'
      },
      
      bg: {
        black: '\x1b[40m',
        red: '\x1b[41m',
        green: '\x1b[42m',
        yellow: '\x1b[43m',
        blue: '\x1b[44m',
        magenta: '\x1b[45m',
        cyan: '\x1b[46m',
        white: '\x1b[47m',
        crimson: '\x1b[48m'
      }
    };

    // Format helper for vectors and values
    const formatVector = (vec: number[], precision = 2): string => 
      `[${vec.map(v => v.toFixed(precision)).join(', ')}]`;
    
    const formatNumber = (num: number, precision = 2): string => num.toFixed(precision);

    // Build the output string with colors and formatting
    const header = `${colors.bright}${colors.fg.cyan}=== NeuroSpace ====${colors.reset}`;
    
    // Dimensions section
    const dimensionsTitle = `${colors.bright}${colors.fg.yellow}Dimensions:${colors.reset}`;
    const dimensionsValue = `${colors.fg.white}${this.dim.join(' × ')}${colors.reset}`;
    
    // Spacing section
    const spacingTitle = `${colors.bright}${colors.fg.yellow}Spacing:${colors.reset}`;
    const spacingValue = `${colors.fg.white}${formatVector(this.spacingValues)}${colors.reset}`;
    
    // Origin section
    const originTitle = `${colors.bright}${colors.fg.yellow}Origin:${colors.reset}`;
    const originValue = `${colors.fg.white}${formatVector(this.originValues)}${colors.reset}`;
    
    // Axes section
    const axesTitle = `${colors.bright}${colors.fg.yellow}Axes:${colors.reset}`;
    let axesValue = '';
    
    if (this._axes instanceof AxisSet3D) {
      axesValue = `${colors.fg.green}i=${this._axes.i.name}${colors.reset}, ` +
                  `${colors.fg.magenta}j=${this._axes.j.name}${colors.reset}, ` +
                  `${colors.fg.blue}k=${this._axes.k.name}${colors.reset}`;
    } else {
      const axes = this._axes.axes();
      axesValue = `${colors.fg.green}i=${axes[0].name}${colors.reset}`;
      if (axes.length > 1) {
        axesValue += `, ${colors.fg.magenta}j=${axes[1].name}${colors.reset}`;
      }
      if (axes.length > 2) {
        axesValue += `, ${colors.fg.blue}k=${axes[2].name}${colors.reset}`;
      }
    }
    
    // Bounds section
    const [minBound, maxBound] = this.bounds();
    const boundsTitle = `${colors.bright}${colors.fg.yellow}Bounds:${colors.reset}`;
    const boundsValue = `${colors.fg.white}Min: ${formatVector(minBound)}, Max: ${formatVector(maxBound)}${colors.reset}`;
    
    // Centroid section
    const centroidTitle = `${colors.bright}${colors.fg.yellow}Centroid:${colors.reset}`;
    const centroidValue = `${colors.fg.white}${formatVector(this.centroid())}${colors.reset}`;
    
    // Transform matrix section
    const transTitle = `${colors.bright}${colors.fg.yellow}Transformation Matrix:${colors.reset}`;
    const transMatrix = this.trans.to2DArray();
    let transValue = '';
    
    transMatrix.forEach((row, i) => {
      transValue += '  ';
      row.forEach((val, j) => {
        const formatted = formatNumber(val, 4).padStart(10);
        
        // Highlight different parts of the matrix with different colors
        let color = colors.fg.white;
        if (i === j && i < transMatrix.length - 1) {
          // Diagonal elements (scaling)
          color = colors.fg.green;
        } else if (j === transMatrix[0].length - 1 && i < transMatrix.length - 1) {
          // Translation components
          color = colors.fg.cyan;
        } else if (i === transMatrix.length - 1) {
          // Bottom row (typically 0s and 1)
          color = colors.fg.magenta;
        } else if (i < 3 && j < 3 && i !== j) {
          // Off-diagonal in the rotation part
          color = colors.fg.yellow;
        }
        
        transValue += `${color}${formatted}${colors.reset} `;
      });
      transValue += '\n';
    });
    
    // Determinant
    const d = determinant(this.trans.subMatrix(0, this.ndim() - 1, 0, this.ndim() - 1));
    const detTitle = `${colors.bright}${colors.fg.yellow}Determinant:${colors.reset}`;
    const detValue = `${colors.fg.white}${d.toFixed(4)}${colors.reset}`;
    
    // Combine all sections
    const output = [
      header,
      `${dimensionsTitle} ${dimensionsValue}`,
      `${spacingTitle} ${spacingValue}`,
      `${originTitle} ${originValue}`,
      `${axesTitle} ${axesValue}`,
      `${boundsTitle} ${boundsValue}`,
      `${centroidTitle} ${centroidValue}`,
      `${detTitle} ${detValue}`,
      `${transTitle}\n${transValue}`
    ].join('\n');
    
    console.log(output);
    
    // Give a hint about browser console
    console.log(`Note: For full color support, use a terminal that supports ANSI colors. 
Browser consoles may not display colors correctly, but the structural formatting is maintained.`);
  }
}

/**
 * Converts a linear index to grid coordinates based on the dimensions.
 * @param idx - The linear index.
 * @param dims - The dimensions of the space.
 * @returns An array representing grid coordinates.
 */
export function indexToGrid(idx: number, dims: number[]): number[] {
  const grid: number[] = [];
  let remaining = idx;
  for (let i = dims.length - 1; i >= 0; i--) {
    const planeSize = dims.slice(0, i).reduce((a, b) => a * b, 1);
    const coordinate = Math.floor(remaining / planeSize);
    grid.unshift(coordinate);
    remaining %= planeSize;
  }
  return grid;
}

/**
 * Converts grid coordinates to a linear index based on the dimensions.
 * @param dims - The dimensions of the space.
 * @param coords - The grid coordinates.
 * @returns The corresponding linear index.
 */
export function gridToIndex(dims: number[], coords: number[]): number {
  let index = 0;
  let multiplier = 1;
  for (let i = 0; i < dims.length; i++) {
    index += coords[i] * multiplier;
    multiplier *= dims[i];
  }
  return index;
}











