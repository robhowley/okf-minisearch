---
type: concept
title: Telescope Alignment
tags:
  - telescope
  - alignment
  - optics
status: stable
---
# Telescope Alignment

## Purpose
Telescope alignment keeps the small observatory's pointing model trustworthy across the night. The operator should align after a mount restart, a pier intervention, or any move that could disturb the optical tube. A good alignment reduces reacquisition time and prevents a target from drifting out of a narrow instrument field.

## Procedure
Level the pier check, confirm the tube and finder are firmly seated, and focus on a bright star near the night's first target. Center that star with the mount controls, then record two additional stars separated in azimuth and altitude. Save the resulting model under the date and mount serial number rather than overwriting yesterday's file. Verify the model on a fourth star: slew to it, let tracking settle for two minutes, and measure the offset in arcseconds. If the offset exceeds 30 arcseconds, repeat the alignment and inspect balance, time settings, and cable drag before observing.

## Record
Log the operator, alignment stars, residual offset, and model filename in the night log. Keep failed models for troubleshooting, but mark them inactive.
