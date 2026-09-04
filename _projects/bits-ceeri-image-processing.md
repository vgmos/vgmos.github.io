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
summary: FPGA and GPU acceleration study for image-processing kernels at CSIR-CEERI.
description: Accelerating image-processing kernels two ways at CSIR-CEERI — Vivado HLS on a Zynq ZC702 FPGA, and CUDA/OpenCV on an NVIDIA Jetson TX1 — with measured CPU-vs-GPU timings.
---

In summer 2017, during BITS's Practice School term at CSIR-CEERI, I studied which image-processing operations benefit from moving off the CPU and what each alternative requires.

I compared two approaches: Xilinx Vivado HLS to turn C++ image operations into hardware blocks on a Zynq ZC702 FPGA, and CUDA with OpenCV's GPU modules on an NVIDIA Jetson TX1.

## Implementation

The FPGA side ran on Vivado HLS 2014.4 and the Zynq ZC702 board. Implemented or studied operations included pass-through video, binarization, and Sobel filtering.

The red-object tracker converted frames to HSV and applied hue thresholds on the CPU, uploaded the mask for GPU erosion, dilation, and Canny filtering, then downloaded the result for centroid calculation and path drawing.

## Results

The report averaged repeated timings for each operation on the Jetson TX1:

<p class="project-table__hint" id="timing-table-hint">Scroll horizontally to compare every column →</p>
<div class="project-table" role="region" tabindex="0" aria-label="Reported Jetson TX1 operation timings" aria-describedby="timing-table-hint">
  <table>
    <thead>
      <tr><th scope="col">Operation</th><th scope="col">CPU time (ms)</th><th scope="col">GPU time (ms)</th><th scope="col">Reported CPU/GPU ratio</th></tr>
    </thead>
    <tbody>
      <tr><th scope="row">RGB to HSV</th><td>4.3</td><td>1.8</td><td>2.38×</td></tr>
      <tr><th scope="row">Morphological operations</th><td>36.2</td><td>8.1</td><td>4.46×</td></tr>
      <tr><th scope="row">Thresholding</th><td>4.4</td><td>0.9</td><td>4.88×</td></tr>
      <tr><th scope="row">Canny filtering</th><td>9</td><td>10</td><td>0.9×</td></tr>
    </tbody>
  </table>
</div>

Morphology saved the most time in this comparison; Canny was slightly slower on the GPU. In the tracker appendix, the CUDA timer starts after upload and stops before download, excluding transfers and the CPU stages. The report does not establish a common timing protocol for every table row or the complete pipeline's frame rate.

## Sources

- Practice School-I report at CSIR-CEERI, Pilani.
- End-term seminar deck on implementing image-processing algorithms on FPGA and GPU.
- Source code appendices for the FPGA binarization and GPU object-tracking pipelines.
