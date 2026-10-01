<!--
SPDX-FileCopyrightText: 2026 The Khronos Group Inc.
SPDX-License-Identifier: Apache-2.0
-->

# SPIR-V Visualizer

> Live link: https://www.khronos.org/spirv/visualizer/

> Tested on Chrome and Firefox

Client side only Javascript to visualize a SPIR-V Module binary.

This project is aimed to be a tool for people learning to read disassemble SPIR-V. The tool can also be described as a glorified version of `spirv-dis`.

Currently assumes a valid SPIR-V Module is used with it.

## How to run offline

```bash
git clone https://github.com/KhronosGroup/SPIRV-Visualizer.git

cd SPIRV-Visualizer

git submodule init
git submodule update

# You can use your other favorite method to start server in root directory too!
python -m http.server 8000
```

then open http://localhost:8000/

## How it works

The visualizer uses the SPIR-V Grammar JSON files to parse out all the instructions.

There is a 2 pass system, the first pass tracks all the instructions, the second pass handles all the HTML/CSS changes.

The DAG shown for an instruction is laid out and drawn as SVG by `source/dag.js`, no libraries are needed for it.
