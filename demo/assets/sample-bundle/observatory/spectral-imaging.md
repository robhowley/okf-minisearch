---
type: concept
title: Spectral Imaging
tags:
  - spectroscopy
  - imaging
  - filters
  - analysis
status: stable
---
# Spectral Imaging

## Purpose
Spectral imaging combines a spatial image with measurements through selected filters or a low-resolution disperser. At the observatory it is used to compare nebular structure, stellar colors, and emission-line regions with a consistent instrument setup.

## Acquisition
Before the sequence, record the filter wheel position, grating or prism state, detector mode, focus, and target orientation. Take a short acquisition image, then center the target without changing the planned position angle. Observe filters in an order that limits airmass changes, and include a nearby standard star when calibrated fluxes are needed. Keep individual exposures below the detector's saturation limit; use repeated exposures rather than one very long frame so cosmic rays and tracking failures can be identified.

## Reduction notes
Apply bias or dark correction, flat-field each filter separately, and correct bad pixels before alignment. For dispersed data, save the wavelength solution and arc exposure with the image set. Record atmospheric conditions and any filter changes in the sequence metadata. Do not compare raw counts between filters without accounting for exposure time, detector response, and standard-star calibration. Export a preview with scale, orientation, and units so a collaborator can interpret it without opening the control software.
