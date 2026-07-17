interface MotionRect {
  left: number;
  top: number;
  width: number;
}

export const getMediaUrlEntryMotionKeyframes = (from: MotionRect, to: MotionRect): Keyframe[] => [
  {
    left: `${from.left}px`,
    top: `${from.top}px`,
    width: `${from.width}px`,
  },
  {
    left: `${to.left}px`,
    top: `${to.top}px`,
    width: `${to.width}px`,
  },
];
