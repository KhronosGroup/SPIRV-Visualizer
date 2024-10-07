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
'use strict';

var spirv = {
    // When all the needed JSON grammar files load, let the UI know
    JsonIsReady: false,

    // Common Helper Functions/Utils
    validateHeader: undefined,
    getLiteralString: undefined,

    GrammarPath: '',
    Version: '0.0.0',
    Meta: {},

    Enums: {},                // enum values for opcodes and operands
    Instructions: new Map(),  // details information about opcodes
    Operands: new Map(),      // details information about operands in 'operand_kinds' section

    NameToOpcode: new Map(),  // [ 'OpCode' string : opcode number id ]

    ExtInstructions: new Map(),  // Same mapping as Instructions, but for each grammar file
    ExtOperands: new Map(),      // Same mapping as Operands, but for each grammar file
    // To save everyone having to build this map themselve, provide helpers
    ResultToExtImport: new Map(),  // Map result ID of OpExtInstImport to actual
    setResultToExtImportMap: undefined,
    getExtInstructions: undefined,
    getExtOperands: undefined,

    // Non-Semantic instructions don't have literals, so we need to manually map ValueEnum/BitEnum
    // DebugBreak and DebugPrintf don't have any operands that need checking
    getNonSemanticType: undefined,

    OpcodesWithResultType: [],
    OpcodesWithResult: [],
};

const SPV_ENV_UNIVERSAL_1_0 = 0x00_01_00_00;
const SPV_ENV_UNIVERSAL_1_1 = 0x00_01_01_00;
const SPV_ENV_UNIVERSAL_1_2 = 0x00_01_02_00;
const SPV_ENV_UNIVERSAL_1_3 = 0x00_01_03_00;
const SPV_ENV_UNIVERSAL_1_4 = 0x00_01_04_00;
const SPV_ENV_UNIVERSAL_1_5 = 0x00_01_05_00;
const SPV_ENV_UNIVERSAL_1_6 = 0x00_01_06_00;
const SPV_ENV_VULKAN_1_0 = 0x00_01_00_00;
const SPV_ENV_VULKAN_1_1 = 0x00_01_01_00;
const SPV_ENV_VULKAN_1_2 = 0x00_01_03_00;
const SPV_ENV_VULKAN_1_3 = 0x00_01_05_00;

// number of json files needed to be loaded
var jsonRefCount = 0;
const jsonRefTotal = 9;

function spirvJsonLoaded() {
    jsonRefCount++;

    if (jsonRefCount == jsonRefTotal) {
        spirv.JsonIsReady = true;

        if (TEST_SUITE == true) {
            // Kick off test suite
            runTestSuite();
        } else if (DEBUG == true) {
            // Debug flow to preload a spirv binary
            console.log('DEBUG MODE --- ON');
            var xhr = new XMLHttpRequest();
            xhr.open('GET', DEBUG_FILE, true);
            xhr.responseType = 'arraybuffer';
            xhr.onload = function(e) {
                // simulate HTML dom change
                var filename = this.responseURL.replace(/^.*[\\\/]/, '');
                fileSelected(this.response, filename);
            };
            xhr.send();
        } else {
            // Prompt user to select file
            document.getElementById('preLoad').style.display = 'none';
            document.getElementById('filePrompt').style.visibility = 'visible';
            document.getElementById('spirvVersion').innerText = spirv.Version;
        }
    }
}

// TODO When internal SPIR-V spec issue #611 is resolved should not need this
const ExtInstTypeGlslStd450 = 0;
const ExtInstTypeOpenCLStd = 1;
const ExtInstTypeNonSemanitcDebugPrintf = 2;
const ExtInstTypeNonSemanitcClspvReflection = 3;
const ExtInstTypeNonSemanitcDebugInfo = 4;
const ExtInstTypeDebugInfo = 5;
const ExtInstTypeOpenCLDebug100 = 6;

// Call at OpExtInstImport to save mapping, retrieve with getExtInstructions/getExtOperands
spirv.setResultToExtImportMap = function(extendedName, resultId) {
    if (extendedName.includes("GLSL.std.450")) {
        spirv.ResultToExtImport.set(resultId, ExtInstTypeGlslStd450);
    } else if (extendedName.includes("OpenCL.std")) {
        spirv.ResultToExtImport.set(resultId, ExtInstTypeOpenCLStd);
    } else if (extendedName.includes("NonSemantic.DebugPrintf")) {
        spirv.ResultToExtImport.set(resultId, ExtInstTypeNonSemanitcDebugPrintf);
    } else if (extendedName.includes("NonSemantic.ClspvReflection")) {
        spirv.ResultToExtImport.set(resultId, ExtInstTypeNonSemanitcClspvReflection);
    } else if (extendedName.includes("NonSemantic.Shader.DebugInfo")) {
        spirv.ResultToExtImport.set(resultId, ExtInstTypeNonSemanitcDebugInfo);
    } else if (extendedName.includes("DebugInfo")) {
        spirv.ResultToExtImport.set(resultId, ExtInstTypeDebugInfo);
    } else if (extendedName.includes("OpenCL.DebugInfo.100")) {
        spirv.ResultToExtImport.set(resultId, ExtInstTypeOpenCLDebug100);
    } else {
        console.log('Warning: Full support for ' + extendedName + ' has not been added. Good chance things might break.');
    }
}
spirv.getExtInstructions = function(setId) {
    const id = spirv.ResultToExtImport.get(setId);
    return spirv.ExtInstructions.get(id);
}

spirv.getExtOperands = function(setId) {
    const id = spirv.ResultToExtImport.get(setId);
    return spirv.ExtOperands.get(id);
}

function loadSpirvJson() {
    // C Header equivalent
    $.getJSON(spirv.GrammarPath + 'spirv.json', function(json) {
        spirv.Meta = json.spv.meta;
        for (let i = 0; i < json.spv.enum.length; i++) {
            spirv.Enums[json.spv.enum[i].Name] = json.spv.enum[i].Values;
        }
        spirvJsonLoaded();
    });
}

function loadCoreGrammar() {
    $.getJSON(spirv.GrammarPath + 'spirv.core.grammar.json', function(json) {
        spirv.Version = json.major_version + "." + json.minor_version + "." + json.revision;
        // put in map as need faster way to lookup then search large array each time
        for (let i = 0; i < json.instructions.length; i++) {
            const opcode = json.instructions[i].opcode;
            spirv.NameToOpcode.set(json.instructions[i].opname, opcode)
            spirv.Instructions.set(opcode, json.instructions[i]);

            if (json.instructions[i].operands) {
                // IdResultType is always first operand listed
                if (json.instructions[i].operands[0].kind == "IdResultType") {
                    spirv.OpcodesWithResultType.push(opcode);
                }

                // IdResult is always first or second operand listed
                const checkOperands = Math.min(json.instructions[i].operands.length, 2);
                for (let j = 0; j < checkOperands; j++) {
                    if (json.instructions[i].operands[j].kind == "IdResult") {
                        spirv.OpcodesWithResult.push(opcode);
                    }
                }
            }
        }

        for (let i = 0; i < json.operand_kinds.length; i++) {
            spirv.Operands.set(json.operand_kinds[i].kind, json.operand_kinds[i]);
        }
        spirvJsonLoaded();
    });
}

// Extended Instruction sets
function loadExtInstImport() {
    $.getJSON(spirv.GrammarPath + 'extinst.glsl.std.450.grammar.json', function(json) {
        spirv.ExtInstructions.set(ExtInstTypeGlslStd450, new Map());
        for (let i = 0; i < json.instructions.length; i++) {
            spirv.ExtInstructions.get(ExtInstTypeGlslStd450).set(json.instructions[i].opcode, json.instructions[i]);
        }
        spirvJsonLoaded();
    });

    $.getJSON(spirv.GrammarPath + 'extinst.opencl.std.100.grammar.json', function(json) {
        spirv.ExtInstructions.set(ExtInstTypeOpenCLStd, new Map());
        for (let i = 0; i < json.instructions.length; i++) {
            spirv.ExtInstructions.get(ExtInstTypeOpenCLStd).set(json.instructions[i].opcode, json.instructions[i]);
        }
        spirvJsonLoaded();
    });

    $.getJSON(spirv.GrammarPath + 'extinst.nonsemantic.debugprintf.grammar.json', function(json) {
        spirv.ExtInstructions.set(ExtInstTypeNonSemanitcDebugPrintf, new Map());
        for (let i = 0; i < json.instructions.length; i++) {
            spirv.ExtInstructions.get(ExtInstTypeNonSemanitcDebugPrintf).set(json.instructions[i].opcode, json.instructions[i]);
        }
        spirvJsonLoaded();
    });

    $.getJSON(spirv.GrammarPath + 'extinst.nonsemantic.clspvreflection.grammar.json', function(json) {
        spirv.ExtInstructions.set(ExtInstTypeNonSemanitcClspvReflection, new Map());
        for (let i = 0; i < json.instructions.length; i++) {
            spirv.ExtInstructions.get(ExtInstTypeNonSemanitcClspvReflection).set(json.instructions[i].opcode, json.instructions[i]);
        }
        spirvJsonLoaded();
    });

    $.getJSON(spirv.GrammarPath + 'extinst.nonsemantic.shader.debuginfo.100.grammar.json', function(json) {
        spirv.ExtInstructions.set(ExtInstTypeNonSemanitcDebugInfo, new Map());
        for (let i = 0; i < json.instructions.length; i++) {
            spirv.ExtInstructions.get(ExtInstTypeNonSemanitcDebugInfo).set(json.instructions[i].opcode, json.instructions[i]);
        }
        spirvJsonLoaded();
    });

    $.getJSON(spirv.GrammarPath + 'extinst.debuginfo.grammar.json', function(json) {
        spirv.ExtInstructions.set(ExtInstTypeDebugInfo, new Map());
        for (let i = 0; i < json.instructions.length; i++) {
            spirv.ExtInstructions.get(ExtInstTypeDebugInfo).set(json.instructions[i].opcode, json.instructions[i]);
        }

        spirv.ExtOperands.set(ExtInstTypeDebugInfo, new Map());
        for (let i = 0; i < json.operand_kinds.length; i++) {
            spirv.ExtOperands.get(ExtInstTypeDebugInfo).set(json.operand_kinds[i].kind, json.operand_kinds[i]);
        }
        spirvJsonLoaded();
    });

    $.getJSON(spirv.GrammarPath + 'extinst.opencl.debuginfo.100.grammar.json', function(json) {
        spirv.ExtInstructions.set(ExtInstTypeOpenCLDebug100, new Map());
        for (let i = 0; i < json.instructions.length; i++) {
            spirv.ExtInstructions.get(ExtInstTypeOpenCLDebug100).set(json.instructions[i].opcode, json.instructions[i]);
        }

        spirv.ExtOperands.set(ExtInstTypeOpenCLDebug100, new Map());
        for (let i = 0; i < json.operand_kinds.length; i++) {
            spirv.ExtOperands.get(ExtInstTypeOpenCLDebug100).set(json.operand_kinds[i].kind, json.operand_kinds[i]);
        }
        spirvJsonLoaded();
    });
}

// Init into Loading SPIR-V grammar files
function loadSpirv(spirvHeaderPath) {
    spirv.GrammarPath = spirvHeaderPath;
    loadSpirvJson();
    loadCoreGrammar();
    loadExtInstImport();
}

// @param header Uint32Array with 5 elements in it
spirv.validateHeader = function(header) {
    assert(header[0] == spirv.Meta.MagicNumber, 'Magic Number doesn\'t match, are you sure this is a binary SPIR-V file?');
    assert(header[1] <= spirv.Meta.Version, 'SPIR-V Headers are older than version of module');
    assert(header[4] == 0, 'Only support schema 0 currently');
}

// @param words Slice of array of words in instruction
spirv.getLiteralString = function(words) {
    let result = '';
    for (let i = 0; i < words.length; i++) {
        let word = words[i];
        let char0 = (word >> 24) & 0xFF;
        let char1 = (word >> 16) & 0xFF;
        let char2 = (word >> 8) & 0xFF;
        let char3 = word & 0xFF;

        result += char3 ? String.fromCharCode(char3) : '';
        result += char2 ? String.fromCharCode(char2) : '';
        result += char1 ? String.fromCharCode(char1) : '';
        result += char0 ? String.fromCharCode(char0) : '';

        // null terminated
        if ((char0 == 0) || (char1 == 0) || (char2 == 0) || (char3 == 0)) {
            break;
        }
    }
    return result;
}