// Copyright (c) 2021-2023 The Khronos Group Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
"use strict";

//
// All logic related to dealing with SPIR-V concepts
//

// These are globals that hold subsets of the grammar file so it can be
// more easily and efficiently accessed
var spirvMeta = {}; // meta data for parsing
var spirvVersion = "Unknown"; // version of grammar file
var spirvEnum = {}; // enum values for opcodes and operands
var spirvInstruction = new Map(); // details information about opcodes
var spirvOperand = new Map(); // details information about operands in 'operand_kinds' section
var spirvExtInst = new Map(); // Same mapping as spirvInstruction, but for each grammar file
var spirvExtOperand = new Map(); // Same mapping as spirvOperand, but for each grammar file

// TODO When #611 is resolved should not need this
const ExtInstTypeGlslStd450 = 0;
const ExtInstTypeOpenCLStd = 1;
const ExtInstTypeNonSemanitcDebugPrintf = 2;
const ExtInstTypeNonSemanitcClspvReflection = 3;
const ExtInstTypeDebugInfo = 4;
const ExtInstTypeOpenCLDebug100 = 5;

spirvExtInst.set(ExtInstTypeGlslStd450, new Map());
spirvExtInst.set(ExtInstTypeOpenCLStd, new Map());
spirvExtInst.set(ExtInstTypeNonSemanitcDebugPrintf, new Map());
spirvExtInst.set(ExtInstTypeNonSemanitcClspvReflection, new Map());
spirvExtInst.set(ExtInstTypeDebugInfo, new Map());
spirvExtInst.set(ExtInstTypeOpenCLDebug100, new Map());

// Not all extended sets have a mapping for operand kinds
spirvExtOperand.set(ExtInstTypeOpenCLDebug100, new Map());
spirvExtOperand.set(ExtInstTypeDebugInfo, new Map());

// When all the needed JSON grammar files load, let the UI know
var spirvJsonReady = false;
var spirvJsonRefCount = 0;
// number of json files needed to be loaded
const spirvJsonRefTotal = 8;

function spirvJsonLoaded() {
    spirvJsonRefCount++;

    if (spirvJsonRefCount == spirvJsonRefTotal) {
        spirvJsonReady = true;

        if (TEST_SUITE == true) {
            // Kick off test suite
            runTestSuite();
        } else if (DEBUG == true) {
            // Debug flow to preload a spirv binary
            console.log("DEBUG MODE --- ON");
            var xhr = new XMLHttpRequest();
            xhr.open("GET", DEBUG_FILE, true);
            xhr.responseType = "arraybuffer";
            xhr.onload = function(e) {
                // simulate HTML dom change
                filename = this.responseURL.replace(/^.*[\\\/]/, '');
                fileSelected(this.response, filename);
            };
            xhr.send();
        } else {
            // Prompt user to select file
            document.getElementById("preLoad").style.display = "none";
            document.getElementById("filePrompt").style.visibility = "visible";
            document.getElementById("spirvVersion").innerText = spirvVersion;
        }
    }
}

function loadSpirvJson() {
    const spirvHeaderPath = "SPIRV-Headers/include/spirv/unified1/"
    // C Header equivalent
    $.getJSON(spirvHeaderPath + "spirv.json", function(json) {
        spirvMeta = json.spv.meta;
        for (let i = 0; i < json.spv.enum.length; i++) {
            spirvEnum[json.spv.enum[i].Name] = json.spv.enum[i].Values;
        }
        spirvJsonLoaded();
    });
    $.getJSON(spirvHeaderPath + "spirv.core.grammar.json", function(json) {
        spirvVersion = json.major_version + "." + json.minor_version + "." + json.revision;
        // put in map as need faster way to lookup then search large array each time
        for (let i = 0; i < json.instructions.length; i++) {
            spirvInstruction.set(json.instructions[i].opcode, json.instructions[i]);
        }
        for (let i = 0; i < json.operand_kinds.length; i++) {
            spirvOperand.set(json.operand_kinds[i].kind, json.operand_kinds[i]);
        }
        spirvJsonLoaded();
    });

    // Extended sets
    // TODO - If loading speed becomes an issue, can load only when found in OpExtInstImport
    $.getJSON(spirvHeaderPath + "extinst.glsl.std.450.grammar.json", function(json) {
        for (let i = 0; i < json.instructions.length; i++) {
            spirvExtInst.get(ExtInstTypeGlslStd450).set(json.instructions[i].opcode, json.instructions[i]);
        }
        spirvJsonLoaded();
    });
    $.getJSON(spirvHeaderPath + "extinst.opencl.std.100.grammar.json", function(json) {
        for (let i = 0; i < json.instructions.length; i++) {
            spirvExtInst.get(ExtInstTypeOpenCLStd).set(json.instructions[i].opcode, json.instructions[i]);
        }
        spirvJsonLoaded();
    });
    $.getJSON(spirvHeaderPath + "extinst.nonsemantic.debugprintf.grammar.json", function(json) {
        for (let i = 0; i < json.instructions.length; i++) {
            spirvExtInst.get(ExtInstTypeNonSemanitcDebugPrintf).set(json.instructions[i].opcode, json.instructions[i]);
        }
        spirvJsonLoaded();
    });
    $.getJSON(spirvHeaderPath + "extinst.nonsemantic.clspvreflection.grammar.json", function(json) {
        for (let i = 0; i < json.instructions.length; i++) {
            spirvExtInst.get(ExtInstTypeNonSemanitcClspvReflection).set(json.instructions[i].opcode, json.instructions[i]);
        }
        spirvJsonLoaded();
    });
    $.getJSON(spirvHeaderPath + "extinst.debuginfo.grammar.json", function(json) {
        for (let i = 0; i < json.instructions.length; i++) {
            spirvExtInst.get(ExtInstTypeDebugInfo).set(json.instructions[i].opcode, json.instructions[i]);
        }
        for (let i = 0; i < json.operand_kinds.length; i++) {
            spirvExtOperand.get(ExtInstTypeDebugInfo).set(json.operand_kinds[i].kind, json.operand_kinds[i]);
        }
        spirvJsonLoaded();
    });
    $.getJSON(spirvHeaderPath + "extinst.opencl.debuginfo.100.grammar.json", function(json) {
        for (let i = 0; i < json.instructions.length; i++) {
            spirvExtInst.get(ExtInstTypeOpenCLDebug100).set(json.instructions[i].opcode, json.instructions[i]);
        }
        for (let i = 0; i < json.operand_kinds.length; i++) {
            spirvExtOperand.get(ExtInstTypeOpenCLDebug100).set(json.operand_kinds[i].kind, json.operand_kinds[i]);
        }
        spirvJsonLoaded();
    });
};

function opcodeHasResultType(opcode) {
    let instructionInfo = spirvInstruction.get(opcode);
    if (instructionInfo.operands) {
        // IdResultType is always first operand listed
        if (instructionInfo.operands[0].kind == "IdResultType") {
            return true;
        }
    }
    return false;
}

function opcodeHasResult(opcode) {
    let instructionInfo = spirvInstruction.get(opcode);
    if (instructionInfo.operands) {
        const checkOperands = Math.min(instructionInfo.operands.length, 2);
        // IdResult is always first or second operand listed
        for (let i = 0; i < checkOperands; i++) {
            if (instructionInfo.operands[i].kind == "IdResult") {
                return true;
            }
        }
    }
    return false;
}

// @param header Uint32Array with 5 elements in it
function validateHeader(header) {
    assert(header[0] == spirvMeta.MagicNumber, "Magic Number doesn't match, are you sure this is a binary SPIR-V file?");
    assert(header[1] <= spirvMeta.Version, "SPIR-V Headers are older than version of module");
    assert(header[4] == 0, "Only support schema 0 currently");
}

// @param words Slice of array of words in instruction
function getLiteralString(words) {
    let result = "";
    for (let i = 0; i < words.length; i++) {
        let word = words[i];
        let char0 = (word >> 24) & 0xFF;
        let char1 = (word >> 16) & 0xFF;
        let char2 = (word >> 8) & 0xFF;
        let char3 = word & 0xFF;

        result += char3 ? String.fromCharCode(char3) : "";
        result += char2 ? String.fromCharCode(char2) : "";
        result += char1 ? String.fromCharCode(char1) : "";
        result += char0 ? String.fromCharCode(char0) : "";

        // null terminated
        if ((char0 == 0) || (char1 == 0) || (char2 == 0) || (char3 == 0)) {
            break;
        }
    }
    return result;
}
