# Wood reward artwork

The supplied September 14 Wood artwork replaces the entire Command Center
reward button. The artwork itself opens the existing Reward Center.

`original.ts` reassembles the exact attached JPEG (described as PNG in the
request) from data parts to avoid large connector uploads. No redraw or
re-encoding is applied. The renderer removes the near-white background at
display time. Source SHA-256: `9f233bbbe50a74e672af0f05d06103dc7982353cb12994a836fe27342dd867ca`.

The header slot is 80 × 56 points. Artwork occupies the top 80 × 34 points,
leaving 22 points below for the later ticker and bus bar. The tap target is
44 points high; it has no pill, border, award icon, or separate visible label.

Checked on light/dark backgrounds at a 390-point mobile viewport, with a
working press callback. Production web export passes.
