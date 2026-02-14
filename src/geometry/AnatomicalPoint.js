// geometry/AnatomicalPoints.js
import { AxisSet3D } from './Axis.js';

/**
 * Base class for anatomical points.
 * Encapsulates common properties and methods for all dimensional points.
 */
class AnatomicalPoint {
  /**
   * Constructs an AnatomicalPoint.
   * @param {AxisSet3D} axisSet - The axis set defining the coordinate system.
   */
  constructor(axisSet) {
    this.axisSet = axisSet;
  }

  /**
   * Converts the AnatomicalPoint to a string representation.
   * To be implemented by derived classes.
   * @returns {string} The string representation.
   */
  toString() {
    throw new Error('toString method must be implemented by subclasses');
  }

  /**
   * Checks equality with another AnatomicalPoint.
   * To be implemented by derived classes.
   * @param {AnatomicalPoint} other - The other AnatomicalPoint to compare with.
   * @returns {boolean} True if equal, false otherwise.
   */
  equals(other) {
    throw new Error('equals method must be implemented by subclasses');
  }
}

/**
 * Class representing a 3D anatomical point.
 */
export class AnatomicalPoint3D extends AnatomicalPoint {
  /**
   * Constructs an AnatomicalPoint3D.
   * @param {number} x - The x-coordinate.
   * @param {number} y - The y-coordinate.
   * @param {number} z - The z-coordinate.
   * @param {AxisSet3D} axisSet - The axis set defining the coordinate system.
   */
  constructor(x, y, z, axisSet) {
    super(axisSet);
    this.x = x;
    this.y = y;
    this.z = z;
  }

  /**
   * Returns the coordinates as an array [x, y, z].
   * @returns {number[]} The coordinates.
   */
  getCoordinates() {
    return [this.x, this.y, this.z];
  }

  /**
   * Converts the AnatomicalPoint3D to a string representation.
   * @returns {string} The string representation.
   */
  toString() {
    return `AnatomicalPoint3D(x: ${this.x}, y: ${this.y}, z: ${this.z}, axisSet: ${this.axisSet.toString()})`;
  }

  /**
   * Checks equality with another AnatomicalPoint3D.
   * @param {AnatomicalPoint3D} other - The other AnatomicalPoint3D to compare with.
   * @returns {boolean} True if equal, false otherwise.
   */
  equals(other) {
    return (
      other instanceof AnatomicalPoint3D &&
      this.x === other.x &&
      this.y === other.y &&
      this.z === other.z &&
      this.axisSet.equals(other.axisSet)
    );
  }
}

/**
 * Class representing a 2D anatomical point.
 */
export class AnatomicalPoint2D extends AnatomicalPoint {
  /**
   * Constructs an AnatomicalPoint2D.
   * @param {number} x - The x-coordinate.
   * @param {number} y - The y-coordinate.
   * @param {AxisSet2D} axisSet - The axis set defining the coordinate system.
   */
  constructor(x, y, axisSet) {
    super(axisSet);
    this.x = x;
    this.y = y;
  }

  /**
   * Returns the coordinates as an array [x, y].
   * @returns {number[]} The coordinates.
   */
  getCoordinates() {
    return [this.x, this.y];
  }

  /**
   * Converts the AnatomicalPoint2D to a string representation.
   * @returns {string} The string representation.
   */
  toString() {
    return `AnatomicalPoint2D(x: ${this.x}, y: ${this.y}, axisSet: ${this.axisSet.toString()})`;
  }

  /**
   * Checks equality with another AnatomicalPoint2D.
   * @param {AnatomicalPoint2D} other - The other AnatomicalPoint2D to compare with.
   * @returns {boolean} True if equal, false otherwise.
   */
  equals(other) {
    return (
      other instanceof AnatomicalPoint2D &&
      this.x === other.x &&
      this.y === other.y &&
      this.axisSet.equals(other.axisSet)
    );
  }
}

/**
 * Class representing a 1D anatomical point.
 */
export class AnatomicalPoint1D extends AnatomicalPoint {
  /**
   * Constructs an AnatomicalPoint1D.
   * @param {number} x - The x-coordinate.
   * @param {AxisSet1D} axisSet - The axis set defining the coordinate system.
   */
  constructor(x, axisSet) {
    super(axisSet);
    this.x = x;
  }

  /**
   * Returns the coordinate as a number.
   * @returns {number} The coordinate.
   */
  getCoordinate() {
    return this.x;
  }

  /**
   * Converts the AnatomicalPoint1D to a string representation.
   * @returns {string} The string representation.
   */
  toString() {
    return `AnatomicalPoint1D(x: ${this.x}, axisSet: ${this.axisSet.toString()})`;
  }

  /**
   * Checks equality with another AnatomicalPoint1D.
   * @param {AnatomicalPoint1D} other - The other AnatomicalPoint1D to compare with.
   * @returns {boolean} True if equal, false otherwise.
   */
  equals(other) {
    return (
      other instanceof AnatomicalPoint1D &&
      this.x === other.x &&
      this.axisSet.equals(other.axisSet)
    );
  }
}