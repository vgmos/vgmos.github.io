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
summary: Why speeding up an image-processing pipeline depends as much on data movement and CPU stages as on the FPGA or GPU kernel itself.
description: Image-processing kernels at CSIR-CEERI using Vivado HLS on a Zynq ZC702 FPGA and CUDA/OpenCV on an NVIDIA Jetson TX1, examining streaming hardware vs. host–device transfer costs.
---

Offloading an image filter from a CPU to an FPGA or GPU looks like an automatic win until you trace pixels end to end across the system. Arithmetic throughput is rarely the sole bottleneck: moving frames across memory interfaces and waiting on unaccelerated CPU stages can swallow the time saved inside a fast hardware kernel.

In summer 2017, during BITS Pilani's Practice School-I term at CSIR-CEERI, I compared two acceleration flows side by side: high-level synthesis (Xilinx Vivado HLS 2014.4) compiling C++ image operators into RTL blocks on a Zynq ZC702 FPGA, and CUDA with OpenCV's GPU modules on an NVIDIA Jetson TX1.

## Two hardware paths

On the **FPGA** side (Vivado HLS 2014.4 on the Zynq ZC702), I built and evaluated streaming video kernels including pass-through video, binarization, and Sobel edge filtering. An FPGA shines on operators that stream pixels in raster order — holding just a few active rows in on-chip line buffers for a 3×3 neighborhood like Sobel — so pixels flow continuously without round-tripping intermediate frames to external DRAM.

On the **GPU** side (Jetson TX1), the work culminated in a real-time red-object tracker partitioned across CPU and GPU:

1. Convert each incoming frame to HSV and apply hue thresholding on the **CPU**.
2. Upload the binary mask to the **GPU** for morphological erosion, dilation, and Canny edge detection.
3. Download the filtered mask back to the **CPU** for centroid calculation and trajectory overlay.

## The system lesson

Timing an isolated GPU kernel measures peak arithmetic rate, not frame-to-frame latency. In the red-object tracker, color-space conversion, thresholding, centroid extraction, explicit host–device buffer copies, and stream synchronization all stayed on the critical path alongside the CUDA kernels. Whether you target an FPGA or a GPU, real system speedup comes from keeping pixels resident across consecutive pipeline stages — not just accelerating one operator trapped between round-trip memory transfers.

## Further reading

- Kari Pulli, Anatoly Baksheev, Kirill Kornyakov, and Victor Eruhimov, ["Real-Time Computer Vision with OpenCV,"](https://doi.org/10.1145/2184319.2184337) Communications of the ACM, vol. 55, no. 6, pp. 61–69, June 2012.
- Xilinx, ["Vivado Design Suite User Guide: High-Level Synthesis,"](https://docs.amd.com/v/u/2014.3-English/ug902-vivado-high-level-synthesis) UG902, v2014.3, September 30, 2014.
