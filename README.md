# SPIR-V Visualizer

> Live link: https://www.khronos.org/spir/visualizer/

> Tested on Chrome and Firefox

Client side only Javascript to visualize a SPIR-V Module binary.

This project is aimed to be a tool for people learning to read disassemble SPIR-V. The tool can also be described as a glorified version of `spirv-dis`.

Currently assumes a valid SPIR-V Module is used with it.

## How to run offline

1. `git clone`
2. `git submodule init`
3. `git submodule update`
4. Use favorite method to start server in root directory

## How it works

The visualizer uses the SPIR-V Grammar JSON files to parse out all the instructions.

There is a 2 pass system, the first pass tracks all the instructions, the second pass handles all the HTML/CSS changes.

This project makes use of the d3.js library to handle all the data driven UI diagrams.
