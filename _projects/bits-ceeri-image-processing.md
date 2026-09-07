---
title: FPGA and GPGPU Image Processing
institution: BITS Pilani / CSIR-CEERI
period: 2017
role: Practice School-I researcher
kind: project
featured: false
topics:
  - image processing
  - FPGA
  - GPGPU
  - high-level synthesis
status: Practice School-I project
date: 2017-07-12
summary: Why image-processing acceleration depends on the whole pipeline, including data movement and CPU work.
description: Image-processing kernels at CSIR-CEERI using Vivado HLS on a Zynq ZC702 FPGA and CUDA/OpenCV on an NVIDIA Jetson TX1, with attention to data-transfer costs.
---

In summer 2017, during BITS's Practice School term at CSIR-CEERI, I studied which image-processing operations benefit from moving off the CPU and what each alternative requires.

I compared two approaches: Xilinx Vivado HLS to turn C++ image operations into hardware blocks on a Zynq ZC702 FPGA, and CUDA with OpenCV's GPU modules on an NVIDIA Jetson TX1.

## Implementation

The FPGA side ran on Vivado HLS 2014.4 and the Zynq ZC702 board. Implemented or studied operations included pass-through video, binarization, and Sobel filtering.

The red-object tracker converted frames to HSV and applied hue thresholds on the CPU, uploaded the mask for GPU erosion, dilation, and Canny filtering, then downloaded the result for centroid calculation and path drawing.

## Design lesson

A fast GPU kernel does not guarantee a faster tracker. The useful measure is the time from an input frame to its processed result, including data movement, synchronization, and the work that remains on the CPU. In this tracker, color conversion, thresholding, and centroid calculation still ran on the CPU. Timing GPU kernels alone therefore does not measure the full pipeline.

## Further reading

- Kari Pulli, Anatoly Baksheev, Kirill Kornyakov, and Victor Eruhimov, ["Real-Time Computer Vision with OpenCV,"](https://doi.org/10.1145/2184319.2184337) Communications of the ACM, vol. 55, no. 6, pp. 61–69, June 2012.
- Xilinx, ["Vivado Design Suite User Guide: High-Level Synthesis,"](https://docs.amd.com/v/u/2014.3-English/ug902-vivado-high-level-synthesis) UG902, v2014.3, September 30, 2014.
