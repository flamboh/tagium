import { Num, Plural, T } from "gt-react";

export function ProcessingTracksLabel({ count }: { count: number }) {
  return (
    <T>
      <Plural
        n={count}
        one={
          <>
            <Num>{count}</Num> track is still processing key/bpm
          </>
        }
        other={
          <>
            <Num>{count}</Num> tracks are still processing key/bpm
          </>
        }
      />
    </T>
  );
}
