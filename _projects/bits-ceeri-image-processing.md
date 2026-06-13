---
title: Accelerating Image Processing on FPGA and GPGPU
institution: BITS Pilani / CSIR-CEERI
period: 2017
role: Practice School-I researcher
kind: project
featured: true
topics:
  - image processing
  - FPGA
  - GPGPU
  - high-level synthesis
status: Practice School-I project
date: 2017-07-12
updated: 2026-06-12
summary: A CSIR-CEERI practice-school project comparing FPGA/HLS and Jetson TX1 GPU acceleration paths for image-processing and color-object-tracking tasks.
description: BITS Pilani Practice School-I project at CSIR-CEERI on accelerating image-processing algorithms with Vivado HLS, Zynq ZC702 FPGA hardware, CUDA, OpenCV, and NVIDIA Jetson TX1.
---

This project asked a practical embedded-computing question: when image-processing latency matters, which parts of the workload should move away from a conventional CPU?

At CEERI, the work compared two acceleration paths. One path used Xilinx Vivado HLS to map C++/OpenCV-like image-processing code onto a Zynq ZC702 FPGA. The other used CUDA and OpenCV GPU modules on an NVIDIA Jetson TX1. Both were aimed at the same underlying goal: reduce latency for video/image workloads by matching the algorithm to a more parallel substrate.

## Problem

Computer vision often starts as software, but real-time systems quickly expose the cost of moving pixel operations through a sequential processor. Even simple operations become expensive when the image is large, the frame rate is fixed, and every pixel must be touched.

The engineering question was less glamorous than "AI vision" and more useful: which common image-processing operations can be accelerated cleanly, and what does each platform teach about programmability, throughput, and implementation overhead?

## Implementation

The FPGA side used Vivado HLS 2014.4, the Xilinx toolchain, and a Zynq ZC702 board. Implemented or studied operations included pass-through video, binarization, and Sobel filtering, with C++ code synthesized into hardware-oriented blocks.

The GPU side used CUDA, OpenCV GPU modules, and the Jetson TX1. The final real-time demonstration tracked a red object by converting video frames to HSV, thresholding by hue ranges, applying morphological opening/closing to reduce noise, and drawing the tracked path over the input feed.

## Result

The report measured CPU-vs-GPU timing for several operations. The Jetson GPU improved RGB-to-HSV conversion by about 2.38x, morphological operations by about 4.46x, and thresholding by about 4.88x. Canny filtering was roughly comparable in that setup, which is a useful reminder that acceleration is workload-specific rather than automatic.

## Sources

- Practice School-I report at CSIR-CEERI, Pilani.
- End-term seminar deck titled around implementing image-processing algorithms on FPGA and GPU.
- Source code appendices for FPGA binarization and GPU object-tracking pipelines.

## What I Learned

This was an early lesson in hardware/software co-design. A faster machine is not the same as a faster system. The useful question is where the data moves, which operation dominates latency, and whether the programming model helps or hides the real bottleneck.
