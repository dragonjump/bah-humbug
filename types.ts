// Adding MediaPipe types to the global window object
export interface HandLandmark {
  x: number;
  y: number;
  z: number;
}

export interface NormalizedLandmarkList extends Array<HandLandmark> {}

export interface Results {
  multiHandLandmarks: NormalizedLandmarkList[];
  image: HTMLVideoElement;
}

export interface HandsOptions {
  maxNumHands?: number;
  modelComplexity?: number;
  minDetectionConfidence?: number;
  minTrackingConfidence?: number;
  selfieMode?: boolean;
}

export interface HandsConfig {
  locateFile: (file: string) => string;
}

export declare class Hands {
  constructor(config?: HandsConfig);
  setOptions(options: HandsOptions): void;
  onResults(callback: (results: Results) => void): void;
  send(input: { image: HTMLVideoElement | HTMLCanvasElement }): Promise<void>;
  close(): Promise<void>;
}

declare global {
  interface Window {
    Hands: typeof Hands;
    drawConnectors: any;
    drawLandmarks: any;
    HAND_CONNECTIONS: any;
  }
}