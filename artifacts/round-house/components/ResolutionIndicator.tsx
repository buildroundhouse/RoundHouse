import React from 'react';
import { ResolutionToggleArtwork, resolutionAppearance } from './ResolutionToggleArtwork';
export function ResolutionIndicator({ status, followUps }: { status: 'attention' | 'waiting' | 'resolved'; followUps: number }) {
  return <ResolutionToggleArtwork appearance={resolutionAppearance(status, followUps)} />;
}
