---
title: Accelerating Image Processing on FPGA and GPGPU
institution: BITS Pilani / CSIR-CEERI
period: May-July 2017
role: Practice School-I researcher
kind: project
featured: true
topics:
  - image processing
  - FPGA
  - GPGPU
  - high-level synthesis
status: Scaffolded from report and seminar deck
date: 2017-07-12
updated: 2026-06-12
summary: A CEERI practice-school project comparing FPGA and GPU acceleration paths for real-time image-processing tasks.
description: A restored BITS Pilani practice-school project on accelerating image-processing algorithms with FPGA high-level synthesis and GPU computing.
---

## Why It Belongs

This is one of the most complete surviving BITS-era artifacts. The original report and seminar deck give a full project arc: problem statement, hardware, algorithms, implementation notes, and performance-oriented framing.

The work is also useful as an early marker of taste. It sits before the analog-design thread fully took over, but it already shows a concern for the physical substrate of computation: which machine should do the work, where the latency lives, and how software structure changes when the target is no longer a CPU.

## Source Trail

- Practice School-I report at CSIR-CEERI, Pilani, submitted July 12, 2017.
- End-term seminar deck titled around implementing image-processing algorithms on FPGA and GPU.
- Older BITS research CV, which lists the CEERI work as a summer internship with FPGA, OpenCV, CUDA, and high-level synthesis.

## Technical Shape

The project studied image-processing acceleration on two hardware paths:

- Xilinx Zynq ZC702 FPGA using Vivado HLS, C++, and OpenCV-like libraries.
- NVIDIA Jetson TX1 using CUDA and OpenCV GPU libraries.

The report frames the task as reducing image-processing latency for video workloads. Implemented or discussed algorithms include pass-through video, binarization, Sobel filtering, and color-based object tracking. The strongest final writeup should compare what each platform teaches about throughput, programmability, and the cost of moving from algorithm to deployed hardware.

## Presentation Plan

This should become a compact technical reconstruction with:

- A small system diagram: camera/video input, accelerator path, display/output.
- A comparison table for FPGA HLS vs. GPGPU implementation.
- A short reflection on what still holds up technically and what was naive in the 2017 framing.

The public page should avoid becoming a scanned report archive. The better version is a clear retrospective: what problem was attacked, what tools were used, what was learned about acceleration, and how it fed later circuit-level thinking.
