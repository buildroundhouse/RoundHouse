import React, { useId } from 'react';
import { View } from 'react-native';
import Svg, { Defs, ClipPath, Path, Image, Filter, FeColorMatrix } from 'react-native-svg';

export type ResolutionAppearance = 'waiting' | 'attention' | 'follow-up-1' | 'follow-up-2' | 'urgent' | 'resolved';
export function resolutionAppearance(status: 'attention' | 'waiting' | 'resolved', followUps: number): ResolutionAppearance {
  if (status !== 'attention') return status;
  return followUps >= 3 ? 'urgent' : followUps >= 2 ? 'follow-up-2' : followUps >= 1 ? 'follow-up-1' : 'attention';
}
const STAGES = { waiting: 0, attention: 1, 'follow-up-1': 2, 'follow-up-2': 3, urgent: 4, resolved: 0 };
const LABELS = { waiting: 'Waiting on them', attention: 'Waiting on you', 'follow-up-1': 'Waiting on you, follow-up 1', 'follow-up-2': 'Waiting on you, follow-up 2', urgent: 'Waiting on you, urgent', resolved: 'Resolved or no action needed' };
import SOURCE from '../assets/resolution/original';

/** Original approved artwork, framed from the reference sheet without redrawing it.
 * The display filter removes the near-white page background. The closed/resting
 * state desaturates stage 1; the five active stages use the original signal colors.
 */
export function ResolutionToggleArtwork({ appearance, width = 100 }: { appearance: ResolutionAppearance; width?: number }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const stage = STAGES[appearance], x = [23, 379, 730, 1080, 1435][stage];
  // Exclude headings and captions. The notch excludes the stage-number badge
  // above the urgent icon while retaining the flames on either side.
  const clip = stage === 4 ? `M${x} 220H1554V250H1638V220H${x+320}V452H${x}Z`
    : `M${x} 270H${x+320}V452H${x}Z`;
  return <View accessible accessibilityLabel={LABELS[appearance]} style={{ width, height: width * 0.7 }}>
    <Svg width={width} height={width * 0.7} viewBox={`${x} 220 320 224`}>
      <Defs>
        <ClipPath id={`clip${id}`}><Path d={clip}/></ClipPath>
        <Filter id={`paper${id}`} x="0%" y="0%" width="100%" height="100%">
          <FeColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  -3 -3 -3 0 8"/>
          {appearance === 'resolved' ? <FeColorMatrix type="saturate" values="0"/> : null}
        </Filter>
      </Defs>
      <Image href={SOURCE} x={0} y={0} width={1774} height={887} clipPath={`url(#clip${id})`} filter={`url(#paper${id})`}/>
    </Svg>
  </View>;
}
