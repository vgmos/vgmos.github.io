---
title: Accelerating Image Processing on FPGA and GPGPU
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
summary: FPGA against GPU for image processing at CSIR-CEERI, with measured speedups on a Jetson TX1 and a live object-tracking demo.
description: Accelerating image-processing kernels two ways at CSIR-CEERI — Vivado HLS on a Zynq ZC702 FPGA, and CUDA/OpenCV on an NVIDIA Jetson TX1 — with measured CPU-vs-GPU timings.
---

In summer 2017 I spent BITS's Practice School term at CSIR-CEERI working on a plain question: which image-processing work is worth moving off the CPU, and what does each alternative cost you?

Two paths, same goal. One used Xilinx Vivado HLS to turn C++ image operations into hardware blocks on a Zynq ZC702 FPGA. The other used CUDA and OpenCV's GPU modules on an NVIDIA Jetson TX1. Real-time vision exposes the price of pushing pixel operations through a sequential processor quickly — even simple kernels get expensive once the image is large, the frame rate is fixed, and every pixel must be touched.

## Implementation

The FPGA side ran on Vivado HLS 2014.4 and the Zynq ZC702 board. Implemented or studied operations included pass-through video, binarization, and Sobel filtering, with C++ synthesized into hardware-oriented blocks.

The GPU side ended in a live demo I was fond of: tracking a red object in real time by converting frames to HSV, thresholding by hue, applying morphological opening and closing to clean up the mask, and drawing the tracked path over the input feed.

## Numbers

The report's CPU-vs-GPU timings on the Jetson: about 2.38× faster for RGB-to-HSV conversion, 4.46× for morphological operations, 4.88× for thresholding. Canny filtering came out roughly even in that setup.

The unevenness was the lesson. Acceleration is workload-specific, and what decides the win is mostly data movement — which operation dominates latency, and how many times the pixels have to cross a bus to get there.

## Sources

- Practice School-I report at CSIR-CEERI, Pilani.
- End-term seminar deck on implementing image-processing algorithms on FPGA and GPU.
- Source code appendices for the FPGA binarization and GPU object-tracking pipelines.
