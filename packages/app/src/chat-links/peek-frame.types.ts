export interface PeekFrameProps {
  url: string;
  /** Accessible name for the embedded page. */
  title: string;
  /** Off: a static, scaled-down look. On: real size, scrolling, and pointer input. */
  interactive: boolean;
  onLoad: () => void;
  onError: () => void;
}
