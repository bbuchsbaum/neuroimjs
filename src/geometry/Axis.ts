import { Matrix, inverse, solve, determinant } from 'ml-matrix';

export class NamedAxis {
  name: string;
  direction: number[];
  axis: string;

  constructor(name: string, direction: number[] = [0, 0, 0]) {
    this.name = name;
    this.direction = direction;
    this.axis = name;
  }

  permMat(): Matrix {
    return new Matrix([this.direction]);
  }

  axes(): NamedAxis[] {
    return [this];
  }

  toString(): string {
    return `NamedAxis: ${this.name} (direction: [${this.direction.join(', ')}])`;
  }

  equals(other: NamedAxis): boolean {
    return (
      this.name === other.name &&
      this.direction.every((val, index) => val === other.direction[index])
    );
  }

  static LEFT_RIGHT = new NamedAxis('LEFT_RIGHT', [1, 0, 0]);
  static RIGHT_LEFT = new NamedAxis('RIGHT_LEFT', [-1, 0, 0]);
  static ANT_POST = new NamedAxis('ANT_POST', [0, -1, 0]);
  static POST_ANT = new NamedAxis('POST_ANT', [0, 1, 0]);
  static INF_SUP = new NamedAxis('INF_SUP', [0, 0, 1]);
  static SUP_INF = new NamedAxis('SUP_INF', [0, 0, -1]);
}

export abstract class AxisSet {
  ndim: number;

  constructor(ndim: number) {
    this.ndim = ndim;
  }

  abstract permMat(): Matrix;

  abstract axes(): NamedAxis[] 

  abstract dropDim(): AxisSet | null 
  
  names(): string[] {
    return this.axes().map((ax) => ax.name);
  }

  whichAxis(axis: NamedAxis, ignoreDirection: boolean = true): number {
    const axes = this.axes();
    for (let i = 0; i < axes.length; i++) {
      if (ignoreDirection && axes[i].name === axis.name) {
        return i;
      } else if (
        !ignoreDirection &&
        axes[i].name === axis.name &&
        axes[i].direction.every((val, index) => val === axis.direction[index])
      ) {
        return i;
      }
    }
    throw new Error(
      `Axis ${axis.name} not found in ${this.axes()
        .map((ax) => ax.name)
        .join(', ')}`
    );
  }

  equals(other: AxisSet): boolean {
    return this.axes().every((ax, index) => ax.equals(other.axes()[index]));
  }

  static oppositeAxis(axis: NamedAxis): NamedAxis {
    switch (axis.name) {
      case NamedAxis.LEFT_RIGHT.name:
        return NamedAxis.RIGHT_LEFT;
      case NamedAxis.RIGHT_LEFT.name:
        return NamedAxis.LEFT_RIGHT;
      case NamedAxis.ANT_POST.name:
        return NamedAxis.POST_ANT;
      case NamedAxis.POST_ANT.name:
        return NamedAxis.ANT_POST;
      case NamedAxis.INF_SUP.name:
        return NamedAxis.SUP_INF;
      case NamedAxis.SUP_INF.name:
        return NamedAxis.INF_SUP;
      default:
        throw new Error(`No opposite axis found for ${axis.name}`);
    }
  }
}

export class AxisSet1D extends AxisSet {
  i: NamedAxis;

  constructor(i: NamedAxis) {
    super(1);
    this.i = i;
  }

  permMat(): Matrix {
    return new Matrix([this.i.direction]);
  }

  perm_mat(): Matrix {
    return this.permMat();
  }

  axes(): NamedAxis[] {
    return [this.i];
  }

  dropDim(): AxisSet | null {
    return null;
  }

  toString(): string {
    return `AxisSet1D: ${this.i.name}`;
  }

  static LEFT_RIGHT = new AxisSet1D(NamedAxis.LEFT_RIGHT);
  static RIGHT_LEFT = new AxisSet1D(NamedAxis.RIGHT_LEFT);
  static ANT_POST = new AxisSet1D(NamedAxis.ANT_POST);
  static POST_ANT = new AxisSet1D(NamedAxis.POST_ANT);
  static INF_SUP = new AxisSet1D(NamedAxis.INF_SUP);
  static SUP_INF = new AxisSet1D(NamedAxis.SUP_INF);
}

export class AxisSet2D extends AxisSet {
  i: NamedAxis;
  j: NamedAxis;

  constructor(i: NamedAxis, j: NamedAxis) {
    super(2);
    this.i = i;
    this.j = j;
  }

  dropDim(): AxisSet | null {
    return new AxisSet1D(this.i);
  }

  permMat(): Matrix {
    return new Matrix([this.i.direction, this.j.direction]);
  }

  perm_mat(): Matrix {
    return this.permMat();
  }

  axes(): NamedAxis[] {
    return [this.i, this.j];
  }

  toString(): string {
    return `AxisSet2D: ${this.i.axis}, ${this.j.axis}`;
  }

  // Static properties for 2D orientations
  static SAGITTAL_AI = new AxisSet2D(NamedAxis.ANT_POST, NamedAxis.INF_SUP);
  static SAGITTAL_PI = new AxisSet2D(NamedAxis.POST_ANT, NamedAxis.INF_SUP);
  static SAGITTAL_PS = new AxisSet2D(NamedAxis.POST_ANT, NamedAxis.SUP_INF);
  static SAGITTAL_AS = new AxisSet2D(NamedAxis.ANT_POST, NamedAxis.SUP_INF);
  
  static CORONAL_LI = new AxisSet2D(NamedAxis.LEFT_RIGHT, NamedAxis.INF_SUP);
  static CORONAL_RI = new AxisSet2D(NamedAxis.RIGHT_LEFT, NamedAxis.INF_SUP);
  static CORONAL_RS = new AxisSet2D(NamedAxis.RIGHT_LEFT, NamedAxis.SUP_INF);
  static CORONAL_LS = new AxisSet2D(NamedAxis.LEFT_RIGHT, NamedAxis.SUP_INF);
   
  static AXIAL_LA = new AxisSet2D(NamedAxis.LEFT_RIGHT, NamedAxis.ANT_POST);
  static AXIAL_RA = new AxisSet2D(NamedAxis.RIGHT_LEFT, NamedAxis.ANT_POST);
  static AXIAL_RP = new AxisSet2D(NamedAxis.RIGHT_LEFT, NamedAxis.POST_ANT);
  static AXIAL_LP = new AxisSet2D(NamedAxis.LEFT_RIGHT, NamedAxis.POST_ANT);
 
  static orientations(): AxisSet2D[] {
    return [
      AxisSet2D.SAGITTAL_AI,
      AxisSet2D.SAGITTAL_PI,
      AxisSet2D.SAGITTAL_PS,
      AxisSet2D.SAGITTAL_AS,
      AxisSet2D.CORONAL_LI,
      AxisSet2D.CORONAL_RI,
      AxisSet2D.CORONAL_RS,
      AxisSet2D.CORONAL_LS,
      AxisSet2D.AXIAL_LA,
      AxisSet2D.AXIAL_RA,
      AxisSet2D.AXIAL_RP,
      AxisSet2D.AXIAL_LP,
    ];
  }
}

export class AxisSet3D extends AxisSet {
    i: NamedAxis;
    j: NamedAxis;
    k: NamedAxis;
  
    constructor(i: NamedAxis, j: NamedAxis, k: NamedAxis) {
      super(3);
      this.i = i;
      this.j = j;
      this.k = k;
    }
  
    permMat(): Matrix {
      return new Matrix([this.i.direction, this.j.direction, this.k.direction]);
    }

    perm_mat(): Matrix {
      return this.permMat();
    }

    dropDim(): AxisSet | null {
      return new AxisSet2D(this.i, this.j);
    }
  
    axes(): NamedAxis[] {
      return [this.i, this.j, this.k];
    }
  
    toString(): string {
      return `AxisSet3D: ${this.i.axis}, ${this.j.axis}, ${this.k.axis}`;
    }
  
    get id(): string {
      // Return a simple identifier based on the axes
      // This is used for cache keys and logging
      return `${this.i.axis}_${this.j.axis}_${this.k.axis}`;
    }
  
    // Static properties for 3D orientations
    static SAGITTAL_AIL = new AxisSet3D(NamedAxis.ANT_POST, NamedAxis.INF_SUP, NamedAxis.LEFT_RIGHT);
    static SAGITTAL_PIL = new AxisSet3D(NamedAxis.POST_ANT, NamedAxis.INF_SUP, NamedAxis.LEFT_RIGHT);
    static SAGITTAL_PSL = new AxisSet3D(NamedAxis.POST_ANT, NamedAxis.SUP_INF, NamedAxis.LEFT_RIGHT);
    static SAGITTAL_ASL = new AxisSet3D(NamedAxis.ANT_POST, NamedAxis.SUP_INF, NamedAxis.LEFT_RIGHT);
    static SAGITTAL_IAL = new AxisSet3D(NamedAxis.INF_SUP, NamedAxis.ANT_POST, NamedAxis.LEFT_RIGHT);
    static SAGITTAL_IPL = new AxisSet3D(NamedAxis.INF_SUP, NamedAxis.POST_ANT, NamedAxis.LEFT_RIGHT);
    static SAGITTAL_SPL = new AxisSet3D(NamedAxis.SUP_INF, NamedAxis.POST_ANT, NamedAxis.LEFT_RIGHT);
    static SAGITTAL_SAL = new AxisSet3D(NamedAxis.SUP_INF, NamedAxis.ANT_POST, NamedAxis.LEFT_RIGHT);
  
    static CORONAL_LIA = new AxisSet3D(NamedAxis.LEFT_RIGHT, NamedAxis.INF_SUP, NamedAxis.ANT_POST);
    static CORONAL_LIP = new AxisSet3D(NamedAxis.LEFT_RIGHT, NamedAxis.INF_SUP, NamedAxis.POST_ANT);
    static CORONAL_RIA = new AxisSet3D(NamedAxis.RIGHT_LEFT, NamedAxis.INF_SUP, NamedAxis.ANT_POST);
    static CORONAL_RSA = new AxisSet3D(NamedAxis.RIGHT_LEFT, NamedAxis.SUP_INF, NamedAxis.ANT_POST);
    static CORONAL_LSA = new AxisSet3D(NamedAxis.LEFT_RIGHT, NamedAxis.SUP_INF, NamedAxis.ANT_POST);
   
    static AXIAL_LAI = new AxisSet3D(NamedAxis.LEFT_RIGHT, NamedAxis.ANT_POST, NamedAxis.INF_SUP);
    static AXIAL_RAI = new AxisSet3D(NamedAxis.RIGHT_LEFT, NamedAxis.ANT_POST, NamedAxis.INF_SUP);
    static AXIAL_RPI = new AxisSet3D(NamedAxis.RIGHT_LEFT, NamedAxis.POST_ANT, NamedAxis.INF_SUP);
    static AXIAL_LPI = new AxisSet3D(NamedAxis.LEFT_RIGHT, NamedAxis.POST_ANT, NamedAxis.INF_SUP);
   
    static AXIAL_RAS = new AxisSet3D(NamedAxis.RIGHT_LEFT, NamedAxis.ANT_POST, NamedAxis.SUP_INF);
    static AXIAL_LAS = new AxisSet3D(NamedAxis.LEFT_RIGHT, NamedAxis.ANT_POST, NamedAxis.SUP_INF);
    static AXIAL_RPS = new AxisSet3D(NamedAxis.RIGHT_LEFT, NamedAxis.POST_ANT, NamedAxis.SUP_INF);
    static AXIAL_LPS = new AxisSet3D(NamedAxis.LEFT_RIGHT, NamedAxis.POST_ANT, NamedAxis.SUP_INF);
   
    static orientations(): AxisSet3D[] {
      return [
        AxisSet3D.SAGITTAL_AIL,
        AxisSet3D.SAGITTAL_PIL,
        AxisSet3D.SAGITTAL_PSL,
        AxisSet3D.SAGITTAL_ASL,
        AxisSet3D.CORONAL_LIA,
        AxisSet3D.CORONAL_RIA,
        AxisSet3D.CORONAL_RSA,
        AxisSet3D.CORONAL_LSA,
        AxisSet3D.CORONAL_LIP,
        AxisSet3D.AXIAL_LAI,
        AxisSet3D.AXIAL_RAI,
        AxisSet3D.AXIAL_RPI,
        AxisSet3D.AXIAL_LPI,
        AxisSet3D.AXIAL_RAS,
        AxisSet3D.AXIAL_LAS,
        AxisSet3D.AXIAL_RPS,
        AxisSet3D.AXIAL_LPS,
      ];
    }

    /**
     * Create AxisSet3D from string representation
     * Common representations:
     * - 'XYZ' for axial view (X=left-right, Y=anterior-posterior, Z=inferior-superior)
     * - 'YZX' for sagittal view  
     * - 'XZY' for coronal view
     */
    static fromStr(str: string): AxisSet3D {
      const upperStr = str.toUpperCase();
      
      // Map common view strings to standard anatomical orientations
      switch (upperStr) {
        // Axial views (looking from top down)
        case 'XYZ':
        case 'AXIAL':
          return AxisSet3D.AXIAL_LPI; // Standard neurological convention
          
        // Sagittal views (looking from the side)
        case 'YZX':
        case 'SAGITTAL':
          return AxisSet3D.SAGITTAL_PIL;
          
        // Coronal views (looking from front)
        case 'XZY':
        case 'CORONAL':
          return AxisSet3D.CORONAL_LIP;
          
        // Alternative axial representations
        case 'ZXY':
          return AxisSet3D.AXIAL_RAI;
        case 'ZYX':
          return AxisSet3D.AXIAL_LAI;
          
        // LPI variations (common in NIFTI)
        case 'LPI':
          return AxisSet3D.AXIAL_LPI;
        case 'RPI':
          return AxisSet3D.AXIAL_RPI;
        case 'LAS':
          return AxisSet3D.AXIAL_LAS;
        case 'RAS':
          return AxisSet3D.AXIAL_RAS;
          
        default:
          // Try to parse as three-letter anatomical code
          if (str.length === 3) {
            try {
              const axis1 = matchAxis(str[0]);
              const axis2 = matchAxis(str[1]);
              const axis3 = matchAxis(str[2]);
              return matchAnatomy3D(axis1, axis2, axis3);
            } catch (e) {
              throw new Error(`Unknown axis string: ${str}. Use XYZ, YZX, XZY, or anatomical codes like LPI`);
            }
          }
          throw new Error(`Unknown axis string: ${str}. Use XYZ, YZX, XZY, or anatomical codes like LPI`);
      }
    }
  }
  
  export class AxisSet4D extends AxisSet {
    i: NamedAxis;
    j: NamedAxis;
    k: NamedAxis;
    l: NamedAxis;
  
    constructor(i: NamedAxis, j: NamedAxis, k: NamedAxis, l: NamedAxis) {
      super(4);
      this.i = i;
      this.j = j;
      this.k = k;
      this.l = l;
    }

    dropDim(): AxisSet | null {
      return new AxisSet3D(this.i, this.j, this.k);
    }
  
    axes(): NamedAxis[] {
      return [this.i, this.j, this.k, this.l];
    }

    permMat(): Matrix {
      return new Matrix([this.i.direction, this.j.direction, this.k.direction]);
    }
  
    toString(): string {
      return `AxisSet4D: ${this.i.axis}, ${this.j.axis}, ${this.k.axis}, ${this.l.axis}`;
    }
  }
  
  export class AxisSet5D extends AxisSet {
    i: NamedAxis;
    j: NamedAxis;
    k: NamedAxis;
    l: NamedAxis;
    m: NamedAxis;
  
    constructor(i: NamedAxis, j: NamedAxis, k: NamedAxis, l: NamedAxis, m: NamedAxis) {
      super(5);
      this.i = i;
      this.j = j;
      this.k = k;
      this.l = l;
      this.m = m;
    }
  
    axes(): NamedAxis[] {
      return [this.i, this.j, this.k, this.l, this.m];
    }

    dropDim(): AxisSet | null {
      return new AxisSet4D(this.i, this.j, this.k, this.l);
    }

    permMat(): Matrix {
      return new Matrix([this.i.direction, this.j.direction, this.k.direction]);
    }
  
    toString(): string {
      return `AxisSet5D: ${this.i.axis}, ${this.j.axis}, ${this.k.axis}, ${this.l.axis}, ${this.m.axis}`;
    }

    
  }
  
  export function matchAxis(firstAxis: string): NamedAxis {
    const upperAxis = firstAxis.toUpperCase();
    switch (upperAxis) {
      case 'LEFT':
      case 'L':
      case 'LEFT_RIGHT':
        return NamedAxis.LEFT_RIGHT;
      case 'RIGHT':
      case 'R':
      case 'RIGHT_LEFT':
        return NamedAxis.RIGHT_LEFT;
      case 'ANTERIOR':
      case 'A':
      case 'ANT_POST':
        return NamedAxis.ANT_POST;
      case 'POSTERIOR':
      case 'P':
      case 'POST_ANT':
        return NamedAxis.POST_ANT;
      case 'INFERIOR':
      case 'I':
      case 'INF_SUP':
        return NamedAxis.INF_SUP;
      case 'SUPERIOR':
      case 'S':
      case 'SUP_INF':
        return NamedAxis.SUP_INF;
      default:
        throw new Error(`Unknown axis: ${firstAxis}`);
    }
  }
  
  export function findAnatomy2D(axis1: string = 'L', axis2: string = 'P'): AxisSet2D {
    const matchedAxes = [axis1, axis2].map(matchAxis);
    return matchAnatomy2D(matchedAxes[0], matchedAxes[1]);
}
  
  export function findAnatomy3D(axis1: string = 'L', axis2: string = 'P', axis3: string = 'I'): AxisSet3D {
    const matchedAxes = [axis1, axis2, axis3].map(matchAxis);
    return matchAnatomy3D(matchedAxes[0], matchedAxes[1], matchedAxes[2]);
  }
  
  export function matchAnatomy2D(axis1: NamedAxis, axis2: NamedAxis): AxisSet2D {
    for (const orient of AxisSet2D.orientations()) {
      if (orient.i.equals(axis1) && orient.j.equals(axis2)) {
        return orient;
      }
    }
    throw new Error(`No matching anatomical orientation for axes: ${axis1.name}, ${axis2.name}`);
  }
  
  export function matchAnatomy3D(axis1: NamedAxis, axis2: NamedAxis, axis3: NamedAxis): AxisSet3D {
    //console.log("matchAnatomy3D", axis1, axis2, axis3);
    //console.log("AxisSet3D.orientations()", AxisSet3D.orientations());
    for (const orient of AxisSet3D.orientations()) {
      //console.log("orient", orient);
      if (orient.i.equals(axis1) && orient.j.equals(axis2) && orient.k.equals(axis3)) {
        return orient;
      }
    }
    throw new Error(`No matching anatomical orientation for axes: ${axis1.name}, ${axis2.name}, ${axis3.name}`);
  }

  export function oppositeAxis(axis: NamedAxis): NamedAxis {
    switch (axis) {
      case NamedAxis.LEFT_RIGHT:
        return NamedAxis.RIGHT_LEFT;
      case NamedAxis.RIGHT_LEFT:
        return NamedAxis.LEFT_RIGHT;
      case NamedAxis.ANT_POST:
        return NamedAxis.POST_ANT;
      case NamedAxis.POST_ANT:
        return NamedAxis.ANT_POST;
      case NamedAxis.INF_SUP:
        return NamedAxis.SUP_INF;
      case NamedAxis.SUP_INF:
        return NamedAxis.INF_SUP;
      default:
        throw new Error(`Unknown axis: ${axis}`);
    }
  }


  
  export function nearestAnatomy(mat44: Matrix): AxisSet3D {
    let mat33 = mat44.subMatrix(0, 2, 0, 2);
    let icol = mat33.getColumnVector(0);
    let jcol = mat33.getColumnVector(1);
    let kcol = mat33.getColumnVector(2);
  
    // Normalize columns
    icol = icol.div(Math.sqrt(icol.dot(icol)));
    jcol = orthogonalize(icol, jcol);
    const knorm = Math.sqrt(kcol.dot(kcol));
    kcol = knorm === 0.0 ? crossProduct(icol, jcol) : kcol.div(knorm);
    kcol = orthogonalize(icol, kcol);
    kcol = orthogonalize(jcol, kcol);
  
    const Q = new Matrix([icol.to1DArray(), jcol.to1DArray(), kcol.to1DArray()]).transpose();
    const detQ = determinant(Q);
    if (detQ === 0.0) throw new Error('Invalid matrix input, determinant is 0');
  
    let vbest = -Infinity;
    let ibest = 0, jbest = 1, kbest = 2;
    let pbest = 1, qbest = 1, rbest = 1;
  
    // Iterate over permutations and orientations to find the best match
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        if (i === j) continue;
        for (let k = 0; k < 3; k++) {
          if (i === k || j === k) continue;
          for (const p of [-1, 1]) {
            for (const q of [-1, 1]) {
              for (const r of [-1, 1]) {
                const P = new Matrix([
                  [p * (i === 0 ? 1 : 0), p * (i === 1 ? 1 : 0), p * (i === 2 ? 1 : 0)],
                  [q * (j === 0 ? 1 : 0), q * (j === 1 ? 1 : 0), q * (j === 2 ? 1 : 0)],
                  [r * (k === 0 ? 1 : 0), r * (k === 1 ? 1 : 0), r * (k === 2 ? 1 : 0)]
                ]);
                const detP = determinant(P);
                if (detP * detQ <= 0.0) continue;
                const M = P.mmul(Q);
                const crit = M.trace();
                if (crit > vbest) {
                  vbest = crit;
                  ibest = i;
                  jbest = j;
                  kbest = k;
                  pbest = p;
                  qbest = q;
                  rbest = r;
                }
              }
            }
          }
        }
      }
    }
  
    function getAxis(num: number): NamedAxis {
      switch (num) {
        case 1: return NamedAxis.LEFT_RIGHT;
        case -1: return NamedAxis.RIGHT_LEFT;
        case 2: return NamedAxis.POST_ANT;
        case -2: return NamedAxis.ANT_POST;
        case 3: return NamedAxis.INF_SUP;
        case -3: return NamedAxis.SUP_INF;
        default: throw new Error(`Invalid axis number: ${num}`);
      }
    }
  
    //const ax1 = getAxis(ibest * pbest + 1);
    //const ax2 = getAxis(jbest * qbest + 1);
    //const ax3 = getAxis(kbest * rbest + 1);

    const ax1 = getAxis((ibest + 1) * pbest);
    const ax2 = getAxis((jbest + 1) * qbest);
    const ax3 = getAxis((kbest + 1) * rbest);
  
    return new AxisSet3D(ax1, ax2, ax3);
  }
  
  // Utility function to orthogonalize two vectors
  function orthogonalize(col1: Matrix, col2: Matrix): Matrix {
    const dotp = col1.dot(col2);
    if (Math.abs(dotp) > 1.e-4) {
      col2 = col2.sub(col1.mul(dotp));
      const norm = Math.sqrt(col2.dot(col2));
      col2 = col2.div(norm);
    }
    return col2;
  }
  
  // Utility function to compute cross product
  function crossProduct(a: Matrix, b: Matrix): Matrix {
    return new Matrix([
      [a.get(1, 0) * b.get(2, 0) - a.get(2, 0) * b.get(1, 0)],
      [a.get(2, 0) * b.get(0, 0) - b.get(2, 0) * a.get(0, 0)],
      [a.get(0, 0) * b.get(1, 0) - a.get(1, 0) * b.get(0, 0)]
    ]);
  }

// Standalone exports for common orientations (aliases to AxisSet3D static members)
export const AXIAL_LPI = AxisSet3D.AXIAL_LPI;
export const CORONAL_LIP = AxisSet3D.CORONAL_LIP;
export const SAGITTAL_AIL = AxisSet3D.SAGITTAL_AIL;

