import React from 'react';
import { Composition } from 'remotion';
import { SupervisorTutorial } from './SupervisorTutorial';

export function Root() {
  return (
    <>
      <Composition
        id="SupervisorTutorialHindi"
        component={SupervisorTutorial}
        durationInFrames={3450}
        fps={30}
        width={1080}
        height={1920}
      />
    </>
  );
}
