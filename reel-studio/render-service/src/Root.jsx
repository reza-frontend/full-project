import React from 'react';
import { Composition } from 'remotion';
import { Reel } from './Reel';
import { Edit } from './Edit';
import { computeTimeline } from './timeline';
import { buildEdit } from './editTimeline';
import sample from './sample-spec.json';
import sampleEdit from './sample-edit.json';

export const RemotionRoot = () => (
  <>
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
    <Composition
      id="Edit"
      component={Edit}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={300}
      defaultProps={{ spec: sampleEdit }}
      calculateMetadata={({ props }) => {
        const tl = buildEdit(props.spec || {});
        return { durationInFrames: tl.totalFrames, fps: tl.fps };
      }}
    />
  </>
);
