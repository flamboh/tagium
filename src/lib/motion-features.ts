import { domMax } from "motion/react";

// Loaded lazily by MotionProvider. domMax (rather than domAnimation) is required for layout
// animations, which the media url entry uses to move between its landing and editor positions.
export default domMax;
