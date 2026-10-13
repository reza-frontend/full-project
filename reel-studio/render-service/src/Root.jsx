import React from 'react';
import { Composition } from 'remotion';
import { Reel } from './Reel';
import { computeTimeline } from './timeline';
import sample from './sample-spec.json';

export const RemotionRoot = () => (
  <Composition
    id="Reel"
    component={Reel}
    width={1080}
    height={1920}
    fps={30}
    durationInFrames={300}
    defaultProps={{ spec: sample }}
    calculateMetadata={({ props }) => {
      const tl = computeTimeline(props.spec || {});
      return { durationInFrames: tl.total, fps: tl.fps };
    }}
  />
);
