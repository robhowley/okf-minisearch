---
type: concept
title: Calibration Frames
tags:
  - calibration
  - imaging
  - detectors
status: draft
---
# Calibration Frames

## Purpose
Calibration frames measure detector behavior so science exposures can be corrected without erasing real signal. The observatory collects bias, dark, flat, and, when spectroscopy is scheduled, arc-lamp frames for each relevant instrument setup.

## Collection
Take at least  fifteen bias frames at the shortest supported exposure and the same readout mode as the science run. Capture five darks at each science exposure time, with the shutter closed and the detector at its regulated temperature. For flats, aim for counts near half the detector's linear range; take twilight flats for imaging and lamp flats for a stable spectrograph response. Change the calibration set whenever filter, binning, gain, grating, or detector temperature changes. Never combine frames from different hardware configurations merely because their filenames look similar.

## Quality checks
Inspect the median level, saturated-pixel fraction, gradients, and cosmic-ray contamination. Reject frames with shutter motion, unstable lamp output, or counts outside the linear range. Store masters with their input list, combine method, temperature, and processing version. Link the master set to the science sequence before handoff so reduction software can select it reproducibly.
