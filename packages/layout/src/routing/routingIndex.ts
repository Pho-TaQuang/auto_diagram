import type { DiagramPoint } from "../../../core/src/index.js";

export function roundCoordinate(value: number): number {
  return Number(value.toFixed(3));
}

export function pathSegments(points: DiagramPoint[]): Array<[DiagramPoint, DiagramPoint]> {
  const segments: Array<[DiagramPoint, DiagramPoint]> = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    segments.push([points[index], points[index + 1]]);
  }
  return segments;
}

export interface RoutingSegment {
  start: DiagramPoint;
  end: DiagramPoint;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export class OrthogonalRoutingIndex {
  private horizontalOverlaps = new Map<number, RoutingSegment[]>();
  private verticalOverlaps = new Map<number, RoutingSegment[]>();

  private horizontalYKeys: number[] = [];
  private verticalXKeys: number[] = [];

  public addPath(points: DiagramPoint[]): void {
    const segments = pathSegments(points);
    for (const [rawStart, rawEnd] of segments) {
      const start = { x: roundCoordinate(rawStart.x), y: roundCoordinate(rawStart.y) };
      const end = { x: roundCoordinate(rawEnd.x), y: roundCoordinate(rawEnd.y) };

      const minX = Math.min(start.x, end.x);
      const maxX = Math.max(start.x, end.x);
      const minY = Math.min(start.y, end.y);
      const maxY = Math.max(start.y, end.y);

      const segment: RoutingSegment = { start, end, minX, maxX, minY, maxY };

      if (start.y === end.y) {
        let list = this.horizontalOverlaps.get(start.y);
        if (!list) {
          list = [];
          this.horizontalOverlaps.set(start.y, list);
          this.insertSorted(this.horizontalYKeys, start.y);
        }
        list.push(segment);
      } else if (start.x === end.x) {
        let list = this.verticalOverlaps.get(start.x);
        if (!list) {
          list = [];
          this.verticalOverlaps.set(start.x, list);
          this.insertSorted(this.verticalXKeys, start.x);
        }
        list.push(segment);
      }
    }
  }

  private insertSorted(array: number[], value: number): void {
    let low = 0;
    let high = array.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (array[mid] < value) low = mid + 1;
      else high = mid;
    }
    array.splice(low, 0, value);
  }

  public countIllegalSegmentOverlaps(points: DiagramPoint[]): number {
    let overlaps = 0;
    const segments = pathSegments(points);

    for (const [rawStart, rawEnd] of segments) {
      const start = { x: roundCoordinate(rawStart.x), y: roundCoordinate(rawStart.y) };
      const end = { x: roundCoordinate(rawEnd.x), y: roundCoordinate(rawEnd.y) };

      if (start.y === end.y) {
        const list = this.horizontalOverlaps.get(start.y);
        if (list) {
          const minX = Math.min(start.x, end.x);
          const maxX = Math.max(start.x, end.x);
          for (const accepted of list) {
            if (minX < accepted.maxX && maxX > accepted.minX) {
              overlaps++;
            }
          }
        }
      }
      
      if (start.x === end.x) {
        const list = this.verticalOverlaps.get(start.x);
        if (list) {
          const minY = Math.min(start.y, end.y);
          const maxY = Math.max(start.y, end.y);
          for (const accepted of list) {
            if (minY < accepted.maxY && maxY > accepted.minY) {
              overlaps++;
            }
          }
        }
      }
    }
    return overlaps;
  }

  public countCrossingsWithAccepted(points: DiagramPoint[]): number {
    let crossings = 0;
    const segments = pathSegments(points);

    for (const [rawStart, rawEnd] of segments) {
      const start = { x: roundCoordinate(rawStart.x), y: roundCoordinate(rawStart.y) };
      const end = { x: roundCoordinate(rawEnd.x), y: roundCoordinate(rawEnd.y) };

      const minX = Math.min(start.x, end.x);
      const maxX = Math.max(start.x, end.x);
      const minY = Math.min(start.y, end.y);
      const maxY = Math.max(start.y, end.y);

      if (start.y === end.y) {
        const relevantX = this.getRange(this.verticalXKeys, minX, maxX);
        for (const x of relevantX) {
          const list = this.verticalOverlaps.get(x);
          if (list) {
            for (const accepted of list) {
              if (this.isCrossing(start, end, minX, maxX, minY, maxY, accepted)) {
                crossings++;
              }
            }
          }
        }
      } else if (start.x === end.x) {
        const relevantY = this.getRange(this.horizontalYKeys, minY, maxY);
        for (const y of relevantY) {
          const list = this.horizontalOverlaps.get(y);
          if (list) {
            for (const accepted of list) {
              if (this.isCrossing(start, end, minX, maxX, minY, maxY, accepted)) {
                crossings++;
              }
            }
          }
        }
      }
    }
    return crossings;
  }

  private isCrossing(
    start: DiagramPoint, end: DiagramPoint,
    minX: number, maxX: number,
    minY: number, maxY: number,
    accepted: RoutingSegment
  ): boolean {
    if (!(minX <= accepted.maxX && maxX >= accepted.minX && minY <= accepted.maxY && maxY >= accepted.minY)) {
      return false;
    }

    if (start.x === end.x && accepted.start.x === accepted.end.x && start.x === accepted.start.x) {
      if (minY < accepted.maxY && maxY > accepted.minY) return false;
    }
    if (start.y === end.y && accepted.start.y === accepted.end.y && start.y === accepted.start.y) {
      if (minX < accepted.maxX && maxX > accepted.minX) return false;
    }

    if (
      this.orientation(start, end, accepted.start) * this.orientation(start, end, accepted.end) > 0 ||
      this.orientation(accepted.start, accepted.end, start) * this.orientation(accepted.start, accepted.end, end) > 0
    ) {
      return false;
    }

    if (
      this.pointsEqual(start, accepted.start) ||
      this.pointsEqual(start, accepted.end) ||
      this.pointsEqual(end, accepted.start) ||
      this.pointsEqual(end, accepted.end)
    ) {
      return false;
    }

    return true;
  }

  private orientation(a: DiagramPoint, b: DiagramPoint, c: DiagramPoint): number {
    const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
    if (Math.abs(value) < 1e-3) return 0;
    return value > 0 ? 1 : -1;
  }

  private pointsEqual(left: DiagramPoint, right: DiagramPoint): boolean {
    return left.x === right.x && left.y === right.y;
  }

  private getRange(sortedKeys: number[], minVal: number, maxVal: number): number[] {
    const result: number[] = [];
    let low = 0;
    let high = sortedKeys.length - 1;
    let startIdx = sortedKeys.length;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (sortedKeys[mid] >= minVal) {
        startIdx = mid;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }

    for (let i = startIdx; i < sortedKeys.length; i++) {
      if (sortedKeys[i] <= maxVal) {
        result.push(sortedKeys[i]);
      } else {
        break;
      }
    }
    return result;
  }
}
